import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  META_DIR,
  META_FILES,
  WORKSPACE_DIRS,
  WORKSPACE_FILES,
  WORKSPACE_MARKER_KIND,
} from '../../shared/markdown';

/**
 * Project-deletion SAFETY GUARD. The actual removal (OS trash + native confirm)
 * lives in the Electron handler; this module is the pure, Electron-free decision
 * layer so the guards can be exercised by a unit test / throwaway harness.
 *
 * Two delete levels exist (both performed by the handler):
 *  - data only: trash the workspace's `.nucleus/` dir; user files stay.
 *  - whole folder: trash the entire workspace — gated behind explicit user
 *    approval, a native confirmation, AND this guard.
 */

/** Root-level entries Nucleus itself creates — anything else is user content. */
const ROOT_MANAGED = new Set<string>([
  ...WORKSPACE_DIRS,
  path.basename(WORKSPACE_FILES.currentState),
  path.basename(WORKSPACE_FILES.handoff),
  path.basename(WORKSPACE_FILES.doneLog),
  path.basename(WORKSPACE_FILES.escalations),
  // Git tracking (default on) inits a repo + seeds a .gitignore at the workspace
  // root, so both are app-created — the no-marker conservative path must still
  // recognize an otherwise-clean, never-built workspace as managed-only.
  '.git',
  '.gitignore',
]);

/** The app-created marker id, or null when absent/malformed. */
async function readMarkerId(resolved: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(resolved, META_FILES.marker), 'utf8');
    const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    return parsed.kind === WORKSPACE_MARKER_KIND && typeof parsed.id === 'string' && parsed.id.trim() !== ''
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}

/** Workspace entries that Nucleus did NOT create (user code, dependencies, …). */
async function nonNucleusEntries(resolved: string): Promise<string[]> {
  const entries = await fs.readdir(resolved).catch(() => [] as string[]);
  return entries.filter((e) => !ROOT_MANAGED.has(e));
}

/**
 * True when `child` is equal to, or nested inside, `parent` (case-insensitive, so it
 * holds on NTFS where path casing isn't significant). Exported so the export /
 * factory-reset destination guards share ONE tested containment check rather than
 * re-deriving a case-sensitive `startsWith` that a differently-cased path can slip.
 */
export function within(parent: string, child: string): boolean {
  const a = path.resolve(parent).toLowerCase();
  const b = path.resolve(child).toLowerCase();
  if (a === b) {
    return true;
  }
  const rel = path.relative(a, b);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Throws unless `workspacePath` is safe to delete in full. Refuses drive roots,
 * the home/appData/temp trees, and system directories; requires the folder to
 * look like a Nucleus project (`.nucleus/`); and — the new proof-of-origin
 * guard — unless the app-created marker is present (and matches `expectedId`
 * when given), refuses any folder that still holds user content Nucleus didn't
 * create. So a stray `.nucleus` planted in someone's Documents can't authorize
 * trashing the surrounding files.
 */
export async function assertSafeToDeleteFolder(
  workspacePath: string,
  expectedId?: string,
): Promise<void> {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    throw new Error('No workspace path to delete.');
  }
  const resolved = path.resolve(workspacePath);

  // 1. Never a filesystem/drive root.
  if (path.parse(resolved).root === resolved) {
    throw new Error(`Refusing to delete a drive root: ${resolved}`);
  }

  // 2. Deleting this folder must not wipe out a protected user location.
  const wouldWipe = [
    os.homedir(),
    process.env.USERPROFILE,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.env.HOME,
    os.tmpdir(),
  ].filter((p): p is string => !!p && p.trim() !== '');
  for (const p of wouldWipe) {
    if (within(resolved, p)) {
      throw new Error(`Refusing to delete ${resolved}: it contains a protected location (${path.resolve(p)}).`);
    }
  }

  // 3. The folder must not live inside a system directory.
  const systemDirs = [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
  ].filter((p): p is string => !!p && p.trim() !== '');
  for (const s of systemDirs) {
    if (within(s, resolved)) {
      throw new Error(`Refusing to delete ${resolved}: it is inside a system directory (${path.resolve(s)}).`);
    }
  }

  // 4. Must actually be a Nucleus workspace (has a .nucleus directory).
  const meta = await fs.stat(path.join(resolved, META_DIR)).catch(() => null);
  if (!meta?.isDirectory()) {
    throw new Error(
      `Refusing to delete ${resolved}: it does not look like a Nucleus project (no ${META_DIR}/ folder). Delete it manually if you're sure.`,
    );
  }

  // 5. Proof of origin. If we can prove the app created this workspace (a valid
  //    marker, matching the expected id when supplied), trust it — it WILL hold
  //    generated code by design. Otherwise (legacy/no marker) be conservative:
  //    refuse the moment the folder holds anything Nucleus didn't create.
  const markerId = await readMarkerId(resolved);
  const appCreated = markerId !== null && (expectedId === undefined || markerId === expectedId);
  if (!appCreated) {
    const userEntries = await nonNucleusEntries(resolved);
    if (userEntries.length > 0) {
      const sample = userEntries.slice(0, 5).join(', ') + (userEntries.length > 5 ? ', …' : '');
      throw new Error(
        `Refusing to delete ${resolved}: it has files Nucleus didn't create (${sample}) and no valid project marker. Delete just the .nucleus app data, or remove the folder yourself.`,
      );
    }
  }
}
