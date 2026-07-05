import os from 'node:os';
import path from 'node:path';
import { OVERLAYS } from '../../shared/blueprints';
import { isDeploymentPosture } from '../../shared/decisions';
import type { NamingMode } from '../../shared/naming';
import { DEFAULT_NAMING_MODE, isNamingMode } from '../../shared/naming';
import type { NewProjectInput } from '../../shared/project';
import type { RoleId } from '../../shared/roles';
import { isRoleId } from '../../shared/roles';
import { isScaffolderId } from '../../shared/scaffold';

/**
 * Pure input validators for the project IPC handlers — the trust boundary between the
 * untrusted renderer and the privileged main process. Kept in their own Electron-free
 * module so they are unit-testable (the handlers themselves import `electron` and can't
 * be loaded under vitest). The handlers call these BEFORE any value reaches the filesystem
 * or a spawn; a renderer payload that fails validation throws and never touches disk.
 */

/** Require a non-empty trimmed string within a length cap, or throw with the field name. */
export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}

/** Coerce to a trimmed string clamped to a cap; non-strings become ''. */
export function optionalString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
}

/** A project id must be a non-empty string (it is a registry KEY, never a path segment). */
export function requireProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A project id is required');
  }
  return value;
}

/** Clamp an arbitrary value to a known naming mode (defaults to the shipped default). */
export function sanitizeNamingMode(value: unknown): NamingMode {
  return isNamingMode(value) ? value : DEFAULT_NAMING_MODE;
}

/**
 * The read-only workspace docs a renderer panel may fetch by KEY (project:read-doc). A fixed
 * allow-list — the renderer never supplies a PATH, only a key, so nothing arbitrary can be read.
 */
export const READABLE_DOCS = {
  'findings-backlog': 'reviews/findings-backlog.md',
  'project-backlog': 'planning/backlog.md',
} as const;

/** The fixed workspace-relative path for a known doc key, or null (unknown key → nothing read). */
export function docPathForKey(key: unknown): string | null {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(READABLE_DOCS, key)
    ? READABLE_DOCS[key as keyof typeof READABLE_DOCS]
    : null;
}

/**
 * Refuse catastrophic workspace ROOTS at create time. A project workspace becomes a
 * git repo whose per-step commits `git add -A` EVERYTHING under it — pointing it at
 * the home directory (or a parent of it, or a catch-all like Documents itself) would
 * sweep the user's whole life into the audit trail. Subfolders of these are fine;
 * only the containers themselves are refused. Case-insensitive on win32/darwin.
 * `homeDir` is injectable for tests.
 */
export function assertSafeWorkspaceRoot(workspacePath: string, homeDir = os.homedir()): void {
  const fold = (p: string): string =>
    process.platform === 'win32' || process.platform === 'darwin'
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  const norm = fold(workspacePath);
  const home = fold(homeDir);
  const refuse = (why: string): never => {
    throw new Error(`Project folder is not usable: ${why}. Pick a dedicated subfolder instead.`);
  };
  if (path.parse(norm).root === norm) {
    refuse('it is the filesystem root');
  }
  if (norm === home) {
    refuse('it is your home directory');
  }
  // A PARENT of home (/, /Users, C:\Users) contains every account on the machine.
  const relHomeToNorm = path.relative(norm, home);
  if (relHomeToNorm !== '' && !relHomeToNorm.startsWith('..') && !path.isAbsolute(relHomeToNorm)) {
    refuse('it contains your home directory');
  }
  for (const container of ['Desktop', 'Documents', 'Downloads']) {
    if (norm === fold(path.join(homeDir, container))) {
      refuse(`it is your ${container} folder itself`);
    }
  }
}

/**
 * Validate + normalize a renderer-supplied new-project payload. Rejects a non-object,
 * a missing/oversized name/idea, a non-absolute workspace path, and a catastrophic
 * workspace root (home / root / Documents itself — see assertSafeWorkspaceRoot);
 * filters enabledRoles to known RoleIds and overlayIds to the known catalog (rejecting
 * junk and bounding the count for free); defaults gitTracking ON and ripIt OFF.
 */
export function sanitizeNewProjectInput(value: unknown): NewProjectInput {
  if (value === null || typeof value !== 'object') {
    throw new Error('project:create expects a project input object');
  }
  const v = value as Partial<NewProjectInput>;
  const workspacePath = requireString(v.workspacePath, 'Project folder', 1024);
  if (!path.isAbsolute(workspacePath)) {
    throw new Error('Project folder must be an absolute path');
  }
  assertSafeWorkspaceRoot(workspacePath);
  const enabledRoles: RoleId[] = Array.isArray(v.enabledRoles)
    ? [...new Set(v.enabledRoles.filter(isRoleId))]
    : [];
  // Keep only ids in the known overlay catalog — this rejects junk and bounds the
  // count for free (same rigor as enabledRoles filtering through isRoleId).
  // OWN-property check, not `in`: prototype-chain keys ('toString'/'constructor')
  // pass `in` and then crash composeBlueprint downstream, wedging the project.
  const overlayIds: string[] = Array.isArray(v.overlayIds)
    ? [
        ...new Set(
          v.overlayIds.filter(
            (o): o is string =>
              typeof o === 'string' && Object.prototype.hasOwnProperty.call(OVERLAYS, o),
          ),
        ),
      ]
    : [];
  // Venture grouping is a lightweight tag: keep it only when BOTH the id and name
  // survive sanitization, so a project can never carry a half-set venture.
  const ventureId = optionalString(v.ventureId, 80);
  const ventureName = optionalString(v.ventureName, 120);
  const hasVenture = ventureId !== '' && ventureName !== '';
  return {
    projectName: requireString(v.projectName, 'Project name', 120),
    productIdea: requireString(v.productIdea, 'Product idea', 8000),
    targetPlatform: optionalString(v.targetPlatform, 200),
    targetStack: optionalString(v.targetStack, 500),
    constraints: optionalString(v.constraints, 8000),
    workspacePath,
    enabledRoles,
    templateId: optionalString(v.templateId, 80) || null,
    overlayIds,
    gitTracking: v.gitTracking !== false, // default ON
    verificationGates: v.verificationGates !== false, // default ON
    reproBackedFindings: v.reproBackedFindings === true, // default OFF (opt-in)
    ripIt: v.ripIt === true,
    ventureId: hasVenture ? ventureId : undefined,
    ventureName: hasVenture ? ventureName : undefined,
    // Only ids in the known scaffolder catalog survive — the renderer can never
    // supply an arbitrary tool/command, only pick a known starter.
    scaffoldId: isScaffolderId(v.scaffoldId) ? v.scaffoldId : undefined,
    // Clamp to a known deployment posture; junk / out-of-enum → undefined (the team then
    // infers a strict default). Never trust the renderer to widen the enum.
    deploymentPosture: isDeploymentPosture(v.deploymentPosture) ? v.deploymentPosture : undefined,
  };
}
