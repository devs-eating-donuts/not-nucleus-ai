import fs from 'node:fs/promises';
import { META_DIR } from '../../shared/markdown';
import type { ProjectTeam } from '../../shared/project';
import { resolveWorkspacePath } from './markdownWorkspace';
import { sanitizeTeam } from './settingsStore';
import { writeJsonAtomic } from './atomicWrite';
import { fileExists } from './fsUtils';

/**
 * Per-project team config (.nucleus/team.json). Each project carries its
 * own role→CLI roster, independent of the global default. Reuses the
 * settings-store sanitizer so a project team and the global roster are
 * validated identically.
 */
const TEAM_REL = `${META_DIR}/team.json`;

interface TeamFile {
  schemaVersion: 1;
  roles: ProjectTeam;
}

async function writeAtomic(absPath: string, file: TeamFile): Promise<void> {
  await writeJsonAtomic(absPath, file);
}

/** Read a project's team; missing/corrupt file falls back to sane defaults. */
export async function readProjectTeam(workspacePath: string): Promise<ProjectTeam> {
  const absPath = resolveWorkspacePath(workspacePath, TEAM_REL);
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(raw) as { roles?: unknown };
    return sanitizeTeam(parsed.roles);
  } catch {
    return sanitizeTeam(undefined);
  }
}

export async function writeProjectTeam(
  workspacePath: string,
  rolesValue: unknown,
): Promise<ProjectTeam> {
  const roles = sanitizeTeam(rolesValue);
  const absPath = resolveWorkspacePath(workspacePath, TEAM_REL);
  await writeAtomic(absPath, { schemaVersion: 1, roles });
  return roles;
}

/** Seed team.json from the global default roster, only if not present. */
export async function seedProjectTeam(
  workspacePath: string,
  defaultRoster: ProjectTeam,
): Promise<ProjectTeam> {
  const absPath = resolveWorkspacePath(workspacePath, TEAM_REL);
  if (await fileExists(absPath)) {
    return readProjectTeam(workspacePath);
  }
  return writeProjectTeam(workspacePath, defaultRoster);
}
