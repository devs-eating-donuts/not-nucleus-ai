import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { InvocationLogRecord } from '../../shared/diagnostics';

/**
 * Best-effort diagnostic log for CLI invocations. `invokeCli` is the single choke
 * point every surface (pitch / rooms / whiteboard / Bullpen / Punch List) runs
 * through, so logging there covers them all. Records append as JSONL to a rotated
 * file under userData/logs/; The Garage reads recent ones back.
 *
 * HARD RULE: logging must NEVER break an invocation. Every export is wrapped so a
 * missing dir, a full disk, or an unavailable Electron `app` degrades to a no-op
 * (or an empty read), never a throw. Prompts are never written here — the caller
 * passes only a length + hash + first line (see shared/diagnostics).
 */

const LOG_DIR = 'logs';
const LOG_FILE = 'invocations.jsonl';
const BACKUP_FILE = 'invocations.1.jsonl';
/** Rotate the current file once it passes this size; one backup generation is kept. */
const MAX_BYTES = 1_000_000;

// The userData dir is injected at startup (initInvocationLog) rather than imported
// from `electron` here, so this module stays free of an Electron dependency — vitest
// can import it (the dir is simply never set → every op is a silent no-op) and the
// main bundle never relies on a runtime dynamic import resolving the external module.
let userDataDir: string | null = null;

/** Wire the diagnostics log to the app's userData dir. Call once at startup (main). */
export function initInvocationLog(userData: string): void {
  userDataDir = userData;
}

/** The logs dir, or null when not yet initialized (tests / pre-startup) → no-op. */
function logDir(): string | null {
  return userDataDir ? path.join(userDataDir, LOG_DIR) : null;
}

/** Erase the diagnostics log directory (factory reset). Best-effort; never throws. */
export async function clearInvocationLog(): Promise<void> {
  const dir = logDir();
  if (!dir) {
    return;
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Short, stable hash of a prompt — correlates identical prompts without storing them. */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 12);
}

// Serialize appends through a single in-process chain so concurrent invocations
// (e.g. a room turn overlapping a Bullpen step) can't interleave partial lines.
let writeChain: Promise<void> = Promise.resolve();

/** Append one record to the JSONL log. Best-effort; never throws, never blocks the caller. */
export async function logInvocation(record: InvocationLogRecord): Promise<void> {
  const run = writeChain.then(async () => {
    try {
      const dir = logDir();
      if (!dir) {
        return;
      }
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, LOG_FILE);
      // Rotate when the current file grows past the cap (keep one backup).
      try {
        const stat = await fs.stat(file);
        if (stat.size >= MAX_BYTES) {
          await fs.rename(file, path.join(dir, BACKUP_FILE)).catch(() => undefined);
        }
      } catch {
        /* no file yet — nothing to rotate */
      }
      await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      /* logging is best-effort — swallow everything */
    }
  });
  // Keep the chain alive even if this link rejected (it can't, but be defensive).
  writeChain = run.catch(() => undefined);
  return writeChain;
}

/** Parse a JSONL file's lines into records, skipping any that don't parse. */
async function readFileRecords(file: string): Promise<InvocationLogRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: InvocationLogRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      out.push(JSON.parse(line) as InvocationLogRecord);
    } catch {
      /* skip a torn/partial line */
    }
  }
  return out;
}

/**
 * The most recent invocations, newest first, capped at `limit`. Reads the current
 * file and falls back to the rotated backup only if needed to fill the limit.
 * Best-effort — returns [] on any failure.
 */
export async function readRecentInvocations(limit = 100): Promise<InvocationLogRecord[]> {
  try {
    const dir = logDir();
    if (!dir) {
      return [];
    }
    let records = await readFileRecords(path.join(dir, LOG_FILE));
    if (records.length < limit) {
      const backup = await readFileRecords(path.join(dir, BACKUP_FILE));
      records = [...backup, ...records];
    }
    // Appended chronologically → newest is last; reverse and cap.
    return records.slice(-limit).reverse();
  } catch {
    return [];
  }
}
