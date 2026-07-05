import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { CLI_PRESETS } from '../../shared/cli';
import type { RoleId } from '../../shared/roles';
import type { RoleConfiguration } from '../../shared/settings';
import type { RoleValidationResult, ValidationStatus } from '../../shared/validation';

/**
 * CLI validation: does the configured executable exist, and does it run?
 *
 * Execution safety: probes use spawn(file, args) with no shell. The single
 * exception is Windows .cmd/.bat shims (how npm installs CLIs like
 * `claude`), which can only be executed by cmd.exe — those run through an
 * explicit cmd.exe invocation with a quoted path, never a user-composed
 * shell string.
 */

const PROBE_TIMEOUT_MS = 4000;
const PROBE_OUTPUT_LIMIT = 4096;

/* ----- command resolution ----- */

const WINDOWS_DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function executableExtensions(): string[] {
  if (process.platform !== 'win32') {
    return [];
  }
  return (process.env.PATHEXT ?? WINDOWS_DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.startsWith('.'));
}

async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      await fs.access(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate file names for a command. On Windows an extensionless file is
 * not executable (CreateProcess needs a PATHEXT extension), so a bare name
 * like "npm" must resolve to npm.cmd — never to the extensionless POSIX
 * script that sits next to it.
 */
function candidatesFor(base: string): string[] {
  const exts = executableExtensions();
  if (exts.length === 0) {
    return [base];
  }
  const lower = base.toLowerCase();
  if (exts.some((ext) => lower.endsWith(ext))) {
    return [base];
  }
  return exts.map((ext) => base + ext);
}

/**
 * Resolve a configured command to an absolute file path. Commands with a
 * path separator are checked directly; bare names are searched on PATH.
 */
export async function resolveCommand(command: string): Promise<string | null> {
  const hasSeparator =
    command.includes('/') || command.includes('\\') || path.isAbsolute(command);

  if (hasSeparator) {
    for (const candidate of candidatesFor(path.resolve(command))) {
      if (await isExistingFile(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const candidate of candidatesFor(path.join(dir, command))) {
      if (await isExistingFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/** A Windows script shim (.cmd/.bat) — runnable only by handing a command LINE
 * to cmd.exe, never by passing an argv array. Always false off Windows. */
export function isWindowsShim(filePath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

export interface NativeResolution {
  /** Absolute path to a directly-spawnable native executable, if one was found. */
  nativePath: string | null;
  /**
   * True when the ONLY thing on PATH for this command is a Windows .cmd/.bat
   * shim — so the caller can tell "not installed" from "installed, but unsafe
   * for argument delivery". Always false off Windows.
   */
  shimOnly: boolean;
}

/**
 * Resolve a command but ONLY to a directly-spawnable native executable — never a
 * Windows .cmd/.bat shim.
 *
 * For prompt-as-argument CLIs (copilot, agy) the untrusted prompt is placed in
 * argv. A native .exe takes argv straight through CreateProcess, so the prompt is
 * inert. A .cmd/.bat shim can only run via a cmd.exe command LINE, where argv is
 * re-parsed by the command processor and arbitrary prompt text can't be safely
 * escaped (the `"`→`""` doubling is the C-runtime convention, not cmd.exe's —
 * the CVE-2024-24576 / "BatBadBut" class). So those CLIs must resolve to a native
 * binary or not run at all.
 *
 * Unlike {@link resolveCommand} (which stops at the first PATH dir holding ANY
 * candidate), this keeps scanning past a shim to find a native binary in a later
 * dir — an npm `.cmd` shim in an early PATH entry won't shadow a WinGet `.exe`.
 * Off Windows there is no cmd.exe layer, so every executable is "native" and this
 * defers to {@link resolveCommand}.
 */
export async function resolveNativeExecutable(command: string): Promise<NativeResolution> {
  if (process.platform !== 'win32') {
    return { nativePath: await resolveCommand(command), shimOnly: false };
  }

  let sawShim = false;
  // Returns a native hit, or null after recording whether the file was a shim.
  const consider = async (candidate: string): Promise<string | null> => {
    if (!(await isExistingFile(candidate))) {
      return null;
    }
    if (isWindowsShim(candidate)) {
      sawShim = true;
      return null;
    }
    return candidate;
  };

  const hasSeparator =
    command.includes('/') || command.includes('\\') || path.isAbsolute(command);

  if (hasSeparator) {
    for (const candidate of candidatesFor(path.resolve(command))) {
      const hit = await consider(candidate);
      if (hit) {
        return { nativePath: hit, shimOnly: false };
      }
    }
    return { nativePath: null, shimOnly: sawShim };
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const candidate of candidatesFor(path.join(dir, command))) {
      const hit = await consider(candidate);
      if (hit) {
        return { nativePath: hit, shimOnly: false };
      }
    }
  }
  return { nativePath: null, shimOnly: sawShim };
}

/* ----- runnability probe ----- */

interface ProbeResult {
  runnable: boolean;
  version?: string;
}

/**
 * Spawn `<executable> --version` and watch what happens. Spawning
 * successfully is the signal that matters; a non-zero exit (CLIs disagree
 * about --version) or a probe timeout still count as runnable.
 */
function probeExecutable(resolvedPath: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const ext = path.extname(resolvedPath).toLowerCase();
    let child: ReturnType<typeof spawn>;
    try {
      if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
        child = spawn('cmd.exe', ['/d', '/s', '/c', `"${resolvedPath}" --version`], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
          windowsVerbatimArguments: true,
        });
      } else {
        child = spawn(resolvedPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
      }
    } catch {
      resolve({ runnable: false });
      return;
    }

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < PROBE_OUTPUT_LIMIT) {
        stdout += chunk.toString('utf8');
      }
    });

    let settled = false;
    const settle = (result: ProbeResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      // It spawned and kept running — that is runnable enough.
      settle({ runnable: true });
    }, PROBE_TIMEOUT_MS);

    child.once('error', () => settle({ runnable: false }));
    child.once('close', (code) => {
      const firstLine = stdout.split(/\r?\n/, 1)[0]?.trim();
      settle({
        runnable: true,
        version: code === 0 && firstLine ? firstLine : undefined,
      });
    });
  });
}

/* ----- catalog detection + command execution (AI CLIs page) ----- */

export interface CommandInspection {
  installed: boolean;
  resolvedPath: string | null;
  version: string | null;
}

/** Resolve a command (with alias fallback) and probe its version. */
export async function inspectCommand(
  command: string,
  aliases: string[] = [],
): Promise<CommandInspection> {
  let resolved = command.trim() !== '' ? await resolveCommand(command) : null;
  if (!resolved) {
    for (const alias of aliases) {
      const aliasPath = await resolveCommand(alias);
      if (aliasPath) {
        resolved = aliasPath;
        break;
      }
    }
  }
  if (!resolved) {
    return { installed: false, resolvedPath: null, version: null };
  }
  const probe = await probeExecutable(resolved);
  return { installed: probe.runnable, resolvedPath: resolved, version: probe.version ?? null };
}

const RUN_OUTPUT_LIMIT = 65_536;
const UPDATE_TIMEOUT_MS = 120_000;

export interface CommandRun {
  ok: boolean;
  code: number | null;
  output: string;
  /** True when the run was killed by its timeout rather than exiting on its own. */
  timedOut?: boolean;
}

/**
 * Kill a child AND everything it spawned. child.kill() on Windows terminates
 * only the direct child (here, cmd.exe) — the real CLI and anything it launched
 * (npm → node → a vite/astro dev server, say) survive as orphans holding ports.
 * On Windows we use `taskkill /T` to walk the whole tree while its root is still
 * alive; elsewhere we SIGKILL the child (POSIX server-orphans are out of scope).
 */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      child.kill();
    }
  } else {
    child.kill('SIGKILL');
  }
}

export interface RunOptions {
  timeoutMs?: number;
  /** Working directory for the child (isolates agentic CLIs from this repo). */
  cwd?: string;
  /**
   * Text piped to the child's stdin. Prompts MUST be passed this way (never
   * on the command line) so arbitrary content — quotes, newlines, shell
   * metacharacters — can't break the cmd.exe line or inject commands.
   * `args` should then contain only fixed, trusted flags.
   */
  stdin?: string;
  /** Extra environment variables, merged over the parent process env. */
  env?: Record<string, string>;
}

/**
 * Run an already-resolved executable with fixed, trusted args, capturing
 * stdout+stderr. Dynamic prompt text goes through opts.stdin, never argv —
 * so the Windows cmd.exe path only ever quotes constant flags.
 */
export function runResolvedCommand(
  resolvedPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<CommandRun> {
  const timeoutMs = opts.timeoutMs ?? UPDATE_TIMEOUT_MS;
  const stdinMode = opts.stdin !== undefined ? 'pipe' : 'ignore';
  const env = opts.env ? { ...process.env, ...opts.env } : undefined;
  return new Promise((resolve) => {
    const ext = path.extname(resolvedPath).toLowerCase();
    let child: ReturnType<typeof spawn>;
    try {
      if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
        // SAFETY: `args` here is only ever fixed, trusted flags — the untrusted
        // prompt reaches a .cmd/.bat shim NEVER on argv (it's on stdin, or for
        // arg-delivery CLIs the invoker has already refused the shim and resolved
        // a native .exe; see resolveNativeExecutable). The `"`→`""` doubling below
        // is NOT a safe general escape for cmd.exe (CVE-2024-24576); it holds only
        // because the inputs are a constant flag set.
        const quoted = args.map((a) => `"${a.replace(/"/g, '""')}"`);
        // cmd.exe `/s` strips the FIRST and LAST quote of the command tail. With
        // multiple quoted args the tail both starts and ends with a quote, so /s
        // strips them and mangles the path ("X" is not recognized). Wrap the whole
        // command in an EXTRA outer quote pair so /s strips that and the real
        // "path" "arg"… survive intact. (The single-arg probe avoids this only
        // because its `--version` is unquoted, so the tail doesn't end in a quote.)
        const line = `"${[`"${resolvedPath}"`, ...quoted].join(' ')}"`;
        child = spawn('cmd.exe', ['/d', '/s', '/c', line], {
          stdio: [stdinMode, 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: true,
          cwd: opts.cwd,
          env,
        });
      } else {
        child = spawn(resolvedPath, args, {
          stdio: [stdinMode, 'pipe', 'pipe'],
          windowsHide: true,
          cwd: opts.cwd,
          env,
        });
      }
    } catch (err) {
      resolve({ ok: false, code: null, output: err instanceof Error ? err.message : String(err) });
      return;
    }

    if (opts.stdin !== undefined && child.stdin) {
      // Swallow EPIPE if the child exits before reading all of stdin.
      child.stdin.on('error', () => undefined);
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    let output = '';
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      // Keep the TAIL, not the head. Agentic CLIs print banners/reasoning first,
      // and the bits we actually parse — QA's `VERDICT:` line, review summaries —
      // come LAST. A head-capped buffer drops exactly what we need (a chatty QA
      // run >limit would lose its verdict → false "indeterminate" → spurious
      // human-needed escalation). Slide to the last RUN_OUTPUT_LIMIT chars.
      if (output.length > RUN_OUTPUT_LIMIT) {
        output = output.slice(output.length - RUN_OUTPUT_LIMIT);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let settled = false;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      clearTimeout(timer);
      if (drain) {
        clearTimeout(drain);
      }
      // Release our ends of the child's pipes once we've stopped waiting. If a
      // detached grandchild outlived the child and still holds the inherited
      // stdout/stderr write end — e.g. codex's persistent `app-server`, the very
      // case the 'exit' settle below handles — dropping our read end means it
      // can't stall on a pipe we're no longer draining, and we stop buffering
      // output nobody reads. We deliberately do NOT kill it here: the child's
      // PID is already gone on the exit path (targeting it risks killing a
      // reused PID), and daemons like codex's are meant to persist across runs.
      // The timeout path still reaps the whole tree — there the child is alive.
      child.stdout?.removeListener('data', onData);
      child.stderr?.removeListener('data', onData);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      child.unref();
    };
    const settle = (result: CommandRun): void => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      settle({ ok: false, code: null, output: `${output}\n[timed out]`.trim(), timedOut: true });
    }, timeoutMs);

    child.once('error', (err) => settle({ ok: false, code: null, output: err.message }));
    child.once('close', (code) => settle({ ok: code === 0, code, output: output.trim() }));
    // Settle on process EXIT too — never depend solely on 'close'. When a child
    // spawns a detached grandchild that inherits (and holds open) the stdout/
    // stderr pipes — e.g. codex's `exec` client handing off to a persistent
    // `app-server` — 'close' never fires even though the process is long gone,
    // which would stall the whole step until the timeout (or wedge it). A short
    // grace period lets any final output drain before we resolve.
    child.once('exit', (code) => {
      drain = setTimeout(() => settle({ ok: code === 0, code, output: output.trim() }), 150);
    });
  });
}

/* ----- persona-voiced messages ----- */

const READY_MESSAGES: Record<RoleId, (name: string) => string> = {
  stakeholder: (n) => `${n} is ready to align the vision.`,
  architect: (n) => `${n} is ready to architect.`,
  developer: (n) => `${n} is ready to ship.`,
  qa: (n) => `${n} is ready to find what others missed.`,
  security: (n) => `${n} reluctantly trusts this executable.`,
  projectLead: (n) => `${n} is ready to keep this on the rails.`,
  ops: (n) => `${n} confirms operational stability.`,
};

function missingMessage(roleId: RoleId, personaName: string): string {
  if (roleId === 'security') {
    return `${personaName} distrusts this path configuration.`;
  }
  return `${personaName} cannot locate the selected executable.`;
}

/* ----- validation entry point ----- */

export async function validateRoleConfiguration(
  config: RoleConfiguration,
  /** Resolved persona name for the active naming mode (caller supplies it). */
  displayName: string,
): Promise<RoleValidationResult> {
  const assignment = config.assignment;
  const base = {
    roleId: config.roleId,
    personaName: displayName,
    cliId: assignment ? (assignment.presetId ?? 'custom') : null,
    executable: assignment?.command ?? '',
  };
  const finish = (
    status: ValidationStatus,
    message: string,
    extra?: { resolvedPath?: string; version?: string },
  ): RoleValidationResult => ({
    ...base,
    status,
    message,
    checkedAt: new Date().toISOString(),
    ...extra,
  });

  try {
    if (!assignment) {
      return finish('unverified', `${displayName} has no CLI assigned.`);
    }
    if (assignment.command.trim() === '') {
      return finish(
        'missing',
        `${displayName} has a CLI assigned but no executable configured.`,
      );
    }

    let resolvedPath = await resolveCommand(assignment.command);
    if (!resolvedPath) {
      // Fall back to the preset's known alternate command names (e.g.
      // Cursor installs as both `cursor-agent` and `agent`).
      const preset = assignment.presetId
        ? CLI_PRESETS.find((p) => p.id === assignment.presetId)
        : undefined;
      for (const alias of preset?.commandAliases ?? []) {
        const aliasPath = await resolveCommand(alias);
        if (aliasPath) {
          resolvedPath = aliasPath;
          break;
        }
      }
    }
    if (!resolvedPath) {
      return finish('missing', missingMessage(config.roleId, displayName));
    }

    const probe = await probeExecutable(resolvedPath);
    if (!probe.runnable) {
      return finish(
        'invalid',
        `${displayName} found the executable, but it does not appear runnable.`,
        { resolvedPath },
      );
    }

    return finish('ready', READY_MESSAGES[config.roleId](displayName), {
      resolvedPath,
      version: probe.version,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return finish('error', `Validation hit an unexpected error: ${detail}`);
  }
}
