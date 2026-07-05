import fs from 'node:fs/promises';

/* Small main-process filesystem helpers shared across the workspace services. */

/** True if a path exists (any access error — missing, permission — reads as false). */
export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** Read a file as UTF-8, or null if it doesn't exist (other errors propagate). */
export async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
