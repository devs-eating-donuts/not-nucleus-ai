import process from 'node:process';
import type { CommandRun, RunOptions } from './cliValidator';
import type * as PtyType from '@homebridge/node-pty-prebuilt-multiarch';
import { getPtyLoadError, loadPty } from './ptyLoader';

/**
 * PTY execution path for CLIs that only emit output to a REAL terminal.
 *
 * Antigravity `agy` is the case this exists for: its `-p/--print` mode silently
 * drops stdout in non-TTY contexts (the model runs, but `text_drip.go` never
 * flushes — antigravity-cli#76/#115). The fix is to give it a real pseudo-
 * terminal: on Windows node-pty uses ConPTY. The binary then flushes its
 * answer, which we strip back to plain text.
 *
 * Through this path, `agy -p "<multi-line prompt>"` returns the model's answer
 * clear of TUI chrome (agy clear-screens then prints only the final text), and a
 * multi-line prompt with quotes survives as one arg.
 *
 * node-pty is a NATIVE module, loaded LAZILY: if its binary can't load (e.g. an
 * Electron-ABI mismatch), PTY-only CLIs fail with a clear message rather than
 * taking down the whole app at startup. This path assumes a native executable
 * (agy is `agy.exe`); .cmd/.bat shims are not expected here.
 */

const PTY_OUTPUT_LIMIT = 65_536;

// Strip terminal control output back to plain text: OSC (window-title) sequences,
// CSI sequences (color/cursor/clear-screen), other single-char escapes, and the
// braille spinner glyphs agy animates with. agy prints its final answer after a
// clear-screen, so what's left is just the model text.
function stripTerminalCodes(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[=>NOABCDEFGHIJKLMP]/g, '')
    .replace(/[⠀-⣿]/g, '')
    .replace(/\r/g, '');
}

/**
 * Run a resolved executable inside a pseudo-terminal, capturing its output and
 * returning the same {@link CommandRun} shape as the plain-spawn path so the
 * invoker can use either interchangeably.
 */
export function runResolvedCommandPty(
  resolvedPath: string,
  args: string[],
  opts: RunOptions = {},
): Promise<CommandRun> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  return new Promise((resolve) => {
    const pty = loadPty();
    if (!pty) {
      resolve({
        ok: false,
        code: null,
        output: `PTY runtime unavailable (node-pty failed to load): ${getPtyLoadError() ?? 'unknown error'}`,
      });
      return;
    }

    let proc: PtyType.IPty;
    try {
      proc = pty.spawn(resolvedPath, args, {
        name: 'xterm-256color',
        cols: 200,
        rows: 50,
        cwd: opts.cwd,
        env: (opts.env ? { ...process.env, ...opts.env } : process.env) as Record<string, string>,
      });
    } catch (err) {
      resolve({ ok: false, code: null, output: err instanceof Error ? err.message : String(err) });
      return;
    }

    let raw = '';
    proc.onData((d) => {
      raw += d;
      // Keep a generous tail (raw is pre-strip; control codes inflate length).
      if (raw.length > PTY_OUTPUT_LIMIT * 2) {
        raw = raw.slice(raw.length - PTY_OUTPUT_LIMIT * 2);
      }
    });

    // Most PTY CLIs take the prompt as an arg, but write stdin too if provided so
    // the runner stays general (best-effort — a closed pty just ignores it).
    if (opts.stdin !== undefined) {
      try {
        proc.write(opts.stdin);
      } catch {
        /* best-effort */
      }
    }

    const finalOutput = (): string => stripTerminalCodes(raw).trim().slice(-PTY_OUTPUT_LIMIT);

    let settled = false;
    const settle = (result: CommandRun): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      settle({ ok: false, code: null, output: `${finalOutput()}\n[timed out]`.trim(), timedOut: true });
    }, timeoutMs);

    proc.onExit(({ exitCode }) => {
      settle({ ok: exitCode === 0, code: exitCode, output: finalOutput() });
    });
  });
}
