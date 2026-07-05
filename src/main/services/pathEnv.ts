import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Restores the user's real PATH for a packaged macOS/Linux GUI launch.
 *
 * When the app is launched from Finder / the Dock / a .desktop entry (not a terminal),
 * the process inherits a MINIMAL PATH (launchd gives `/usr/bin:/bin:/usr/sbin:/sbin`)
 * that omits Homebrew, npm/bun global bins, and ~/.local/bin — exactly where the local
 * AI CLIs (claude, codex, cursor-agent, agy, copilot) install. cliValidator.resolveCommand
 * splits `process.env.PATH`, so without this every CLI reads as "not installed" and the
 * whole app silently fails. This is invisible from `npm start` (terminal launch inherits
 * the full PATH), which is why it would ship undetected. Windows is unaffected — GUI
 * processes inherit the registry PATH.
 */

const WELL_KNOWN_POSIX_DIRS = [
  '/opt/homebrew/bin', // Apple-silicon Homebrew
  '/opt/homebrew/sbin',
  '/usr/local/bin', // Intel Homebrew / common installs
  '/usr/local/sbin',
];

/** Merge `additions` into a PATH string, appending only entries not already present. Pure. */
export function mergePath(current: string, additions: string[], sep: string = path.delimiter): string {
  const have = new Set(current.split(sep).filter((p) => p !== ''));
  const extra: string[] = [];
  for (const p of additions) {
    if (p !== '' && !have.has(p)) {
      have.add(p);
      extra.push(p);
    }
  }
  if (extra.length === 0) {
    return current;
  }
  return current === '' ? extra.join(sep) : `${current}${sep}${extra.join(sep)}`;
}

/** Resolve the user's login-shell PATH (best-effort, time-bounded). Returns '' on any failure. */
function loginShellPath(shell: string): Promise<string> {
  // fish expands "$PATH" SPACE-joined (its PATH is a list), which would merge as one
  // garbage entry and silently degrade CLI discovery — join it explicitly there.
  const printPath = shell.split('/').pop() === 'fish' ? 'string join : $PATH' : 'printf %s "$PATH"';
  return new Promise((resolve) => {
    try {
      // Login shell (-l) so the profile that sets Homebrew/npm PATH is sourced; -c to run
      // one command. windowsHide + a hard timeout so a misbehaving rc file can't hang startup.
      execFile(
        shell,
        ['-lc', printPath],
        { timeout: 5000, windowsHide: true },
        (err, stdout) => resolve(err ? '' : String(stdout).trim()),
      );
    } catch {
      resolve('');
    }
  });
}

/**
 * Merge the user's real PATH (login-shell PATH + well-known install dirs) into
 * process.env.PATH, so CLI discovery works in a packaged GUI launch. Best-effort and
 * never throws. No-op on Windows (registry PATH is inherited) and when not packaged
 * (a terminal launch already has the full PATH). Call ONCE at startup, before any CLI
 * resolution.
 */
export async function ensureUserPathEnv(opts: {
  packaged: boolean;
  platform: NodeJS.Platform;
  homeDir?: string;
}): Promise<void> {
  if (!opts.packaged || opts.platform === 'win32') {
    return;
  }
  try {
    const additions: string[] = [];
    const shell =
      process.env.SHELL && process.env.SHELL.trim() !== ''
        ? process.env.SHELL
        : opts.platform === 'darwin'
          ? '/bin/zsh'
          : '/bin/bash';
    const shellPath = await loginShellPath(shell);
    if (shellPath !== '') {
      additions.push(...shellPath.split(path.delimiter));
    }
    additions.push(...WELL_KNOWN_POSIX_DIRS);
    const home = opts.homeDir ?? os.homedir();
    if (home) {
      additions.push(path.join(home, '.local', 'bin'));
      additions.push(path.join(home, 'bin'));
    }
    process.env.PATH = mergePath(process.env.PATH ?? '', additions);
  } catch {
    /* best-effort — never block startup over PATH resolution */
  }
}
