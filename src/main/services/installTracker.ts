import type { InstallOutcome } from '../../shared/scaffold';

/**
 * In-memory state for the BACKGROUND post-scaffold dependency install, keyed by project id.
 * `project:create` returns immediately with a `pending` install and runs `npm install` (or
 * `dotnet restore`) without awaiting; this tracker holds the running → done transition so the
 * renderer can poll `project:install-status`. Process-local and best-effort: an app restart
 * mid-install simply drops the state (the query falls back to "no install in progress").
 */
const states = new Map<string, InstallOutcome>();

export function setInstallState(projectId: string, outcome: InstallOutcome): void {
  states.set(projectId, outcome);
}

export function getInstallState(projectId: string): InstallOutcome | null {
  return states.get(projectId) ?? null;
}

/** Drops a project's tracked install state (e.g. on delete / factory reset). */
export function clearInstallState(projectId: string): void {
  states.delete(projectId);
}
