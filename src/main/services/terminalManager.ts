import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import type { WebContents } from 'electron';
import type * as PtyType from '@homebridge/node-pty-prebuilt-multiarch';
import { CLI_PRESETS } from '../../shared/cli';
import type { CliAssignment } from '../../shared/cli';
import { IpcChannels } from '../../shared/ipc';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionDescriptor,
  TerminalStartInput,
  TerminalStartResult,
} from '../../shared/terminal';
import { resolveCommand } from './cliValidator';
import { getPtyLoadError, loadPty } from './ptyLoader';

/**
 * Interactive PTY sessions for role terminals. A session runs either the role's
 * assigned CLI in its native interactive mode ('cli') or the OS default shell
 * ('shell'), with the project workspace as the cwd. Output streams to the
 * renderer over `terminal:data`; keystrokes come back over `terminal:input`.
 *
 * Cross-platform: node-pty uses ConPTY on Windows and forkpty on macOS/Linux.
 * The same prebuilt-multiarch binary the one-shot invoker already ships handles
 * all three. Windows .cmd/.bat shims (how npm installs `claude` et al.) are
 * launched through cmd.exe — node-pty quotes the args itself, so we never build
 * a verbatim command string (no `/s` outer-quote dance needed here).
 */

interface Session {
  descriptor: TerminalSessionDescriptor;
  pty: PtyType.IPty;
  /** The renderer that opened this session — the ONLY one allowed to drive it. */
  sender: WebContents;
  /** The project this session belongs to ('' for the onboarding shell). */
  projectId: string;
}

/** Per-session cap on bytes pushed to the renderer; a runaway producer is a
 * memory risk, not a feature (the terminal scrolls regardless). */
const OUTPUT_BYTE_CAP = 64_000_000;

const sessions = new Map<string, Session>();
/** WebContents we've already hooked for destroy-cleanup. */
const hookedSenders = new WeakSet<WebContents>();

/**
 * Everything {@link startTerminal} needs, resolved by the handler from the
 * trusted registry/team — never the renderer's claim. For cli mode the handler
 * resolves the CLI path async (PATH search) and passes the result here so the
 * spawn itself stays synchronous.
 */
export interface StartContext {
  workspacePath: string;
  /** Display label for the session, e.g. "Claude CLI". */
  cliName: string;
  /** Resolved absolute CLI path (cli mode). null for shell mode or if unresolved. */
  resolvedCommand: string | null;
  /** Why cli-mode resolution failed, if it did. */
  resolveError: string | null;
  /** Extra env for cli mode (the assignment's env). */
  env: Record<string, string>;
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: [] };
  }
  // macOS defaults to zsh, most Linux to bash; honor the user's $SHELL.
  return { file: process.env.SHELL ?? '/bin/bash', args: [] };
}

/** Wrap a resolved CLI path for PTY launch, handling Windows shims. Exported for
 * unit testing of the Windows `.cmd`/`.bat` launch path. */
export function buildCliLaunch(resolved: string): { file: string; args: string[] } {
  const ext = path.extname(resolved).toLowerCase();
  if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    // `.cmd`/`.bat` can only be executed by cmd.exe. node-pty quotes each arg,
    // so we pass the path as a normal arg (no manual quoting / no `/s`).
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/c', resolved] };
  }
  // Direct executable (POSIX bins, agy.exe, …). Launch bare = native interactive.
  return { file: resolved, args: [] };
}

/** Resolve a role's assigned CLI to an absolute path (with preset alias fallback). */
export async function resolveAssignment(
  assignment: CliAssignment | null,
): Promise<{ resolved: string | null; error: string | null }> {
  if (!assignment || assignment.command.trim() === '') {
    return { resolved: null, error: 'No CLI assigned to this role.' };
  }
  let resolved = await resolveCommand(assignment.command);
  if (!resolved) {
    const preset = assignment.presetId
      ? CLI_PRESETS.find((p) => p.id === assignment.presetId)
      : undefined;
    for (const alias of preset?.commandAliases ?? []) {
      const aliasPath = await resolveCommand(alias);
      if (aliasPath) {
        resolved = aliasPath;
        break;
      }
    }
  }
  if (!resolved) {
    return { resolved: null, error: `${assignment.command} is not installed.` };
  }
  return { resolved, error: null };
}

function clampDimension(value: number, min: number): number {
  return Number.isFinite(value) && value >= min ? Math.floor(value) : min;
}

export function startTerminal(
  input: TerminalStartInput,
  ctx: StartContext,
  sender: WebContents,
): TerminalStartResult {
  const pty = loadPty();
  if (!pty) {
    return {
      ok: false,
      error: `Terminal runtime unavailable (node-pty failed to load): ${getPtyLoadError() ?? 'unknown error'}`,
    };
  }

  let launch: { file: string; args: string[] };
  if (input.mode === 'shell') {
    launch = defaultShell();
  } else {
    if (!ctx.resolvedCommand) {
      return { ok: false, error: ctx.resolveError ?? 'No CLI assigned to this role.' };
    }
    launch = buildCliLaunch(ctx.resolvedCommand);
  }

  const cols = clampDimension(input.cols, 2);
  const rows = clampDimension(input.rows, 1);
  const title =
    input.mode === 'shell'
      ? path.basename(launch.file).replace(/\.(exe|cmd|bat)$/i, '')
      : ctx.cliName || 'CLI';

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '1',
    ...(input.mode === 'cli' ? ctx.env : {}),
  };

  let proc: PtyType.IPty;
  try {
    proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: ctx.workspacePath,
      env,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const id = randomUUID();
  const descriptor: TerminalSessionDescriptor = {
    id,
    roleId: input.roleId,
    mode: input.mode,
    title,
    command: launch.file,
    cwd: ctx.workspacePath,
    cols,
    rows,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  sessions.set(id, { descriptor, pty: proc, sender, projectId: input.projectId });

  let pushed = 0;
  proc.onData((data) => {
    if (sender.isDestroyed()) {
      return;
    }
    pushed += data.length;
    if (pushed > OUTPUT_BYTE_CAP) {
      return;
    }
    const payload: TerminalDataEvent = { sessionId: id, data };
    sender.send(IpcChannels.terminalData, payload);
  });

  proc.onExit(({ exitCode }) => {
    const s = sessions.get(id);
    if (s) {
      s.descriptor.status = 'exited';
      s.descriptor.exitCode = exitCode;
    }
    if (!sender.isDestroyed()) {
      const payload: TerminalExitEvent = { sessionId: id, exitCode, status: 'exited' };
      sender.send(IpcChannels.terminalExit, payload);
    }
    sessions.delete(id);
  });

  hookSenderCleanup(sender);
  return { ok: true, descriptor };
}

/**
 * Authorize a control verb: the session must exist AND be owned by the calling
 * WebContents. Ownership (not id-secrecy) is the boundary — a second window, a
 * compromised renderer, or DevTools must not drive a session it didn't open.
 */
function ownedSession(sessionId: string, sender: WebContents): Session | null {
  const session = sessions.get(sessionId);
  return session && session.sender === sender ? session : null;
}

export function writeTerminal(sessionId: string, data: string, sender: WebContents): void {
  const session = ownedSession(sessionId, sender);
  if (!session) {
    return;
  }
  try {
    session.pty.write(data);
  } catch {
    /* pty already gone — ignore */
  }
}

export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
  sender: WebContents,
): void {
  const session = ownedSession(sessionId, sender);
  if (!session) {
    return;
  }
  const c = clampDimension(cols, 2);
  const r = clampDimension(rows, 1);
  try {
    session.pty.resize(c, r);
    session.descriptor.cols = c;
    session.descriptor.rows = r;
  } catch {
    /* pty already gone — ignore */
  }
}

export function killTerminal(sessionId: string, sender: WebContents): void {
  const session = ownedSession(sessionId, sender);
  if (!session) {
    return;
  }
  try {
    session.pty.kill();
  } catch {
    /* already gone */
  }
  sessions.delete(sessionId);
}

/** Live descriptors for the calling renderer's sessions in the given project only. */
export function listTerminals(projectId: string, sender: WebContents): TerminalSessionDescriptor[] {
  return Array.from(sessions.values())
    .filter((s) => s.sender === sender && s.projectId === projectId)
    .map((s) => ({ ...s.descriptor }));
}

/** Kill every session owned by a WebContents (called when its window closes). */
function disposeForSender(sender: WebContents): void {
  for (const [id, session] of sessions) {
    if (session.sender === sender) {
      try {
        session.pty.kill();
      } catch {
        /* already gone */
      }
      sessions.delete(id);
    }
  }
}

function hookSenderCleanup(sender: WebContents): void {
  if (hookedSenders.has(sender)) {
    return;
  }
  hookedSenders.add(sender);
  sender.once('destroyed', () => disposeForSender(sender));
}
