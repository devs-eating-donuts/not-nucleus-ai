import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCommand, runResolvedCommand } from './cliValidator';

/**
 * Engine-managed local-stack lifecycle (#3b). A docker-compose stack started
 * DETACHED (`docker compose up -d`) is owned by the Docker daemon, not by any one
 * Bullpen step — so once it's up it stays up across every dev/QA/security step and
 * every dev↔QA retry, with no per-task cold boot. This module brings it up before
 * the build steps that need it and tears it down at completion.
 *
 * Best-effort throughout: no compose file → no-op; `docker` not on PATH → skip with
 * a note; a daemon-down or slow-pull `up -d` is captured and logged, NEVER thrown (a
 * missing/dead Docker must never break a build). Safe-spawn only (array args).
 *
 * Caching: we cache ONLY the success state (stack is up). We deliberately do NOT
 * cache "no compose file yet" (it appears once the early setup task writes it, so we
 * must re-check on later steps) nor a transient `up -d` failure (so a later step
 * retries — `up -d` is idempotent, and the daemon may finish a cold image pull in the
 * background). A `notedOnce` set keeps the build log from repeating the same skip note.
 *
 * Teardown: at completion we `docker compose down` the workspace's OWN stack if we
 * ever saw it up this build — intentional ("spin down when the build's done"), and
 * safe: `compose down` stops containers but PRESERVES named volumes, so no data loss,
 * even if an earlier setup task (not us) first ran `up -d` on it.
 *
 * Scope: docker-compose stacks (the blueprints' recommended local-dev path). A
 * supabase-CLI-only or host-installed stack isn't auto-managed here — the plan task
 * + the embedded terminal cover those.
 */

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** Workspaces whose stack we've confirmed UP this build → composeDir (cwd for down). */
const stackUp = new Map<string, string>();
/** Workspaces we've already logged a skip/failure note for (suppress repeats). */
const notedOnce = new Set<string>();

async function findComposeDir(workspacePath: string): Promise<string | null> {
  for (const name of COMPOSE_FILES) {
    try {
      await fs.access(path.join(workspacePath, name));
      return workspacePath;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Emit `note` only the first time per workspace; '' on repeats (no log spam). */
function noteOnce(workspacePath: string, note: string): string {
  if (notedOnce.has(workspacePath)) {
    return '';
  }
  notedOnce.add(workspacePath);
  return note;
}

/**
 * Bring the local docker-compose stack up (detached) so it stays running for the
 * whole build. Idempotent + best-effort. Returns a one-time build-log note ('' when
 * nothing to say, when no compose file exists yet, or on a repeated skip).
 */
export async function ensureStackUp(workspacePath: string): Promise<string> {
  if (stackUp.has(workspacePath)) {
    return ''; // already up this build — nothing to do
  }
  const composeDir = await findComposeDir(workspacePath);
  if (!composeDir) {
    return ''; // no stack (yet) — re-check on a later step once the setup task writes it
  }
  const docker = await resolveCommand('docker');
  if (!docker) {
    return noteOnce(
      workspacePath,
      '🐳 Local stack: a docker-compose file is present but `docker` isn’t on PATH — skipping auto-start (QA runs without it).',
    );
  }
  const run = await runResolvedCommand(docker, ['compose', 'up', '-d'], {
    cwd: composeDir,
    timeoutMs: 600_000, // a first-run cold image pull can be slow; the invoker's max
  });
  if (run.ok) {
    stackUp.set(workspacePath, composeDir);
    notedOnce.delete(workspacePath);
    return '🐳 Local stack started (docker compose up -d) — it stays up for dev, QA, and security this build.';
  }
  // Not cached → a later step retries (idempotent; the daemon may finish a cold pull).
  return noteOnce(
    workspacePath,
    run.timedOut
      ? '🐳 Local stack: `docker compose up -d` is still pulling images (>10 min) — QA may run against a partial stack; it will retry on the next step.'
      : `🐳 Local stack: \`docker compose up -d\` failed (is Docker running?) — QA runs without it; will retry on the next step. ${(run.output || '').slice(-200)}`,
  );
}

/**
 * Tear the stack down at build completion. No-op when we never got it up this build.
 * `compose down` preserves named volumes (no data loss). Clears the per-build cache.
 */
export async function stackDown(workspacePath: string): Promise<string | null> {
  const composeDir = stackUp.get(workspacePath);
  stackUp.delete(workspacePath);
  notedOnce.delete(workspacePath);
  if (!composeDir) {
    return null;
  }
  const docker = await resolveCommand('docker');
  if (!docker) {
    return null;
  }
  const run = await runResolvedCommand(docker, ['compose', 'down'], {
    cwd: composeDir,
    timeoutMs: 60_000,
  });
  return run.ok ? '🐳 Local stack stopped (docker compose down).' : null;
}
