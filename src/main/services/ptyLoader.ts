import type * as PtyType from '@homebridge/node-pty-prebuilt-multiarch';

/**
 * Shared lazy loader for the one native module we ship. node-pty is loaded the
 * first time a PTY is actually needed — if its binary can't load (e.g. an
 * Electron-ABI mismatch), PTY-dependent features fail with a clear message
 * instead of taking down the whole app at startup. Externalized in
 * vite.main.config.ts (never bundled); used by both ptyRunner (one-shot
 * capture) and terminalManager (interactive sessions).
 */

let ptyMod: typeof PtyType | null = null;
let ptyLoadError: string | null = null;

export function loadPty(): typeof PtyType | null {
  if (ptyMod || ptyLoadError) {
    return ptyMod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyMod = require('@homebridge/node-pty-prebuilt-multiarch') as typeof PtyType;
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err);
  }
  return ptyMod;
}

export function getPtyLoadError(): string | null {
  return ptyLoadError;
}
