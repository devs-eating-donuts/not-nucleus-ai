import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Atomic file write: write a UNIQUE temp file, then rename it onto the destination —
 * with a Windows fallback. On Windows, renaming onto an existing, momentarily-locked
 * target (antivirus, indexer, cloud sync) can fail with EPERM/EEXIST. The lock is almost
 * always transient, so we RETRY the rename a few times with a short backoff before
 * resorting to a direct write — keeping the write atomic (rename) in the common case
 * rather than falling straight to a torn direct write that a concurrent reader could see
 * half-written, or a crash could leave corrupt (review L4). The direct write is the last
 * resort only when a persistent lock outlasts every retry.
 *
 * This was previously hand-copied in ~8 stores, but ONLY the project registry carried the
 * Windows fallback — every other store (telemetry, runs, team, phase progress, plan flag,
 * the Markdown writer) could silently fail to persist the same way. Routing them all
 * through here propagates the fix.
 */
export async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  // A unique temp name so two writers to the same destination can't clobber each other's temp.
  const tmp = `${absPath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rename(tmp, absPath);
        return; // atomic success — the common path
      } catch (err) {
        lastErr = err;
        await delay(20 * (attempt + 1)); // 20/40/60/80/100ms — ride out a transient lock
      }
    }
    // Every rename failed (a persistent lock): write the destination directly. This is the
    // one non-atomic path, bounded to that rare case.
    void lastErr;
    await fs.writeFile(absPath, content, 'utf8');
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Atomically write a value as pretty-printed JSON. */
export async function writeJsonAtomic(absPath: string, value: unknown): Promise<void> {
  await writeFileAtomic(absPath, JSON.stringify(value, null, 2));
}
