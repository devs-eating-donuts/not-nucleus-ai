import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ChatMessage, RoomTurnResult, WorkRequestTurnResult } from '../../shared/room';
import type { NamingMode } from '../../shared/naming';
import { DEFAULT_NAMING_MODE, isNamingMode } from '../../shared/naming';
import type { RoleId } from '../../shared/roles';
import { isRoleId } from '../../shared/roles';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readProjectTeam } from '../services/projectTeamStore';
import { readRoomLog, runRoomKickoff, runRoomTurn } from '../services/roomEngine';
import { readWorkRequestLog, runWorkRequestTurn } from '../services/workRequestEngine';
import { loadIntervention, runInterventionTurn } from '../services/interventionEngine';
import type { InterventionLoadResult } from '../../shared/intervention';

/**
 * Lifecycle-room IPC: persisted, project-scoped conversations with a role's
 * assigned CLI. Reads the project's team from disk (trust boundary), never
 * the renderer's claim.
 */
interface RoomTarget {
  workspacePath: string;
  roleId: RoleId;
}

async function resolveTarget(value: unknown): Promise<RoomTarget> {
  const { id, roleId } = (value ?? {}) as { id?: unknown; roleId?: unknown };
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  if (!isRoleId(roleId)) {
    throw new Error(`Unknown role id: ${String(roleId)}`);
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return { workspacePath: entry.workspacePath, roleId };
}

/** Resolve just the workspace from a { id } payload (rooms with no role, e.g. The Punch List). */
async function resolveWorkspace(value: unknown): Promise<string> {
  const { id } = (value ?? {}) as { id?: unknown };
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return entry.workspacePath;
}

function namingModeOf(value: unknown): NamingMode {
  const nm = ((value ?? {}) as { namingMode?: unknown }).namingMode;
  return isNamingMode(nm) ? nm : DEFAULT_NAMING_MODE;
}

interface InterventionTarget {
  workspacePath: string;
  roleId: RoleId;
  taskId: string;
}

/** Resolve a { id, roleId, taskId } intervention payload (trust boundary: workspace from disk). */
async function resolveInterventionTarget(value: unknown): Promise<InterventionTarget> {
  const { id, roleId, taskId } = (value ?? {}) as {
    id?: unknown;
    roleId?: unknown;
    taskId?: unknown;
  };
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  if (!isRoleId(roleId)) {
    throw new Error(`Unknown role id: ${String(roleId)}`);
  }
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new Error('A task id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return { workspacePath: entry.workspacePath, roleId, taskId };
}

export function registerRoomHandlers(): void {
  ipcMain.handle(IpcChannels.roomGetLog, async (_event, value: unknown): Promise<ChatMessage[]> => {
    const { workspacePath, roleId } = await resolveTarget(value);
    return readRoomLog(workspacePath, roleId);
  });

  ipcMain.handle(IpcChannels.roomSend, async (_event, value: unknown): Promise<RoomTurnResult> => {
    const { workspacePath, roleId } = await resolveTarget(value);
    const messages = ((value ?? {}) as { messages?: ChatMessage[] }).messages ?? [];
    const team = await readProjectTeam(workspacePath);
    return runRoomTurn(workspacePath, roleId, team, messages, namingModeOf(value));
  });

  ipcMain.handle(IpcChannels.roomKickoff, async (_event, value: unknown): Promise<RoomTurnResult> => {
    const { workspacePath, roleId } = await resolveTarget(value);
    const team = await readProjectTeam(workspacePath);
    return runRoomKickoff(workspacePath, roleId, team, namingModeOf(value));
  });

  // The Punch List (Richard's change-intake chat) — its own transcript, distinct
  // from the architect's Whiteboard room; resolved by project id only (no roleId).
  ipcMain.handle(IpcChannels.workRequestGetLog, async (_event, value: unknown): Promise<ChatMessage[]> => {
    const workspacePath = await resolveWorkspace(value);
    return readWorkRequestLog(workspacePath);
  });

  ipcMain.handle(IpcChannels.workRequestSend, async (_event, value: unknown): Promise<WorkRequestTurnResult> => {
    const workspacePath = await resolveWorkspace(value);
    const messages = ((value ?? {}) as { messages?: ChatMessage[] }).messages ?? [];
    const team = await readProjectTeam(workspacePath);
    return runWorkRequestTurn(workspacePath, team, messages, namingModeOf(value));
  });

  // Intervention chat — a human-in-the-loop conversation with a build persona about
  // an escalated task. Its own transcript per (role, task); runs in the workspace cwd.
  ipcMain.handle(IpcChannels.interventionLoad, async (_event, value: unknown): Promise<InterventionLoadResult> => {
    const { workspacePath, roleId, taskId } = await resolveInterventionTarget(value);
    return loadIntervention(workspacePath, roleId, taskId);
  });

  ipcMain.handle(IpcChannels.interventionSend, async (_event, value: unknown): Promise<RoomTurnResult> => {
    const { workspacePath, roleId, taskId } = await resolveInterventionTarget(value);
    const messages = ((value ?? {}) as { messages?: ChatMessage[] }).messages ?? [];
    const team = await readProjectTeam(workspacePath);
    return runInterventionTurn(workspacePath, roleId, taskId, team, messages, namingModeOf(value));
  });
}
