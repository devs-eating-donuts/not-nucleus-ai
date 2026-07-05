import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallOutcome, ScaffoldOutcome, ScaffoldSpec } from '../../shared/scaffold';
import { resolveCommand, runResolvedCommand } from './cliValidator';
import { resolveWorkspacePath } from './markdownWorkspace';
import { fileExists } from './fsUtils';

/** Generous budget: the FIRST run fetches the scaffolder package over the network. */
const SCAFFOLD_TIMEOUT_MS = 180_000;
/** Installs pull the whole dependency tree over the network — give them longer. */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * Generate a real, runnable base app by invoking the scaffolder CLI non-interactively
 * into a workspace subdir (e.g. `app/`). BEST-EFFORT: a missing tool / failure / timeout
 * degrades to a recorded outcome and NEVER throws, so project creation always completes.
 *
 * Safety: `spec.args` is a FIXED, enumerated flag set from the catalog (no renderer
 * free-text), so the spawn — including the Windows `.cmd` shim path inside
 * runResolvedCommand — can't be argv-injected. The target subdir is re-checked against
 * the workspace boundary as defence-in-depth.
 */
export async function runScaffolder(
  workspacePath: string,
  spec: ScaffoldSpec,
): Promise<ScaffoldOutcome> {
  const base: ScaffoldOutcome = {
    id: spec.id,
    label: spec.label,
    attempted: true,
    ok: false,
    subdir: spec.subdir,
    error: null,
  };
  try {
    // The catalog subdir is a fixed 'app', but re-assert the invariant: it must
    // resolve INSIDE the workspace (throws on traversal).
    resolveWorkspacePath(workspacePath, spec.subdir);
    const resolved = await resolveCommand(spec.tool);
    if (!resolved) {
      return { ...base, error: `${spec.tool} was not found on your PATH` };
    }
    const run = await runResolvedCommand(resolved, spec.args, {
      cwd: workspacePath,
      timeoutMs: SCAFFOLD_TIMEOUT_MS,
      // Fixed env (e.g. NG_CLI_ANALYTICS=false) suppresses a first-run prompt that
      // would otherwise hang under no-TTY; absent for everything else.
      ...(spec.env ? { env: spec.env } : {}),
    });
    if (!run.ok) {
      const why = run.timedOut ? 'timed out' : `exited with code ${run.code ?? 'unknown'}`;
      return { ...base, error: `Scaffold ${why}. ${tailOf(run.output)}` };
    }
    // Exit 0 is NOT proof: create-vite cancels on a non-empty dir and still exits 0,
    // writing nothing. Confirm the marker file actually exists before claiming success,
    // so we never tell the team to build on a base that was never generated. The marker
    // is relative to `subdir` — the scaffolder's physical target, before any flatten.
    const rel = spec.subdir === '.' ? spec.verifyFile : path.posix.join(spec.subdir, spec.verifyFile);
    const marker = resolveWorkspacePath(workspacePath, rel);
    if (!(await fileExists(marker))) {
      return {
        ...base,
        error: 'Scaffold produced no files (the folder may not have been empty).',
      };
    }
    // Named-subdir scaffolders (Angular, oclif) wrote into `subdir`; move it up to the
    // project root so the app IS the project, matching the in-place scaffolders.
    if (spec.flatten) {
      await flattenSubdirToRoot(workspacePath, spec.subdir);
      return { ...base, ok: true, subdir: '.' };
    }
    return { ...base, ok: true };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Move every entry of `subdir` (dotfiles + nested dirs included) up to the workspace root,
 * then remove the now-empty subdir. NEVER clobbers an existing root entry — refuses if a
 * destination already exists (the project root is empty at scaffold time, so a collision
 * means something unexpected, and silently overwriting would be unsafe). Each destination
 * is re-resolved through the workspace-boundary guard as defence-in-depth.
 */
async function flattenSubdirToRoot(workspacePath: string, subdir: string): Promise<void> {
  const from = resolveWorkspacePath(workspacePath, subdir);
  const entries = await fs.readdir(from);
  for (const name of entries) {
    const dest = resolveWorkspacePath(workspacePath, name);
    if (await fileExists(dest)) {
      throw new Error(`cannot flatten ${subdir}/${name}: "${name}" already exists at the project root`);
    }
    await fs.rename(path.join(from, name), dest);
  }
  await fs.rmdir(from);
}

/**
 * Install the scaffolded app's dependencies (`npm install`) as a SEPARATE step after a
 * successful scaffold, so the base app actually runs. BEST-EFFORT: a missing tool /
 * failure / timeout is recorded and NEVER blocks project creation (the app is already
 * scaffolded; the founder can install by hand). Same fixed-argv safety as the scaffold.
 */
export async function runInstall(
  workspacePath: string,
  spec: ScaffoldSpec,
): Promise<InstallOutcome> {
  // runInstall always returns a COMPLETED result (pending: false); the background-running
  // sentinel is set by the create handler, not here.
  const base: InstallOutcome = { attempted: true, ok: false, error: null, pending: false };
  try {
    const resolved = await resolveCommand(spec.install.tool);
    if (!resolved) {
      return { ...base, error: `${spec.install.tool} was not found on your PATH` };
    }
    const run = await runResolvedCommand(resolved, spec.install.args, {
      cwd: workspacePath,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (!run.ok) {
      const why = run.timedOut ? 'timed out' : `exited with code ${run.code ?? 'unknown'}`;
      return { ...base, error: `Dependency install ${why}. ${tailOf(run.output)}` };
    }
    return { ...base, ok: true };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Keep a short tail of the tool output for the error message (never the whole thing). */
function tailOf(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 300 ? `…${trimmed.slice(trimmed.length - 300)}` : trimmed;
}
