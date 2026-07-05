import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ProjectPlan, WhiteboardDraftResult } from '../../shared/whiteboard';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readProjectTeam } from '../services/projectTeamStore';
import { commitWorkspaceStep } from '../services/gitTracker';
import { draftPlan, readProjectPlan, setPlanApproved } from '../services/whiteboardEngine';

/**
 * The Whiteboard IPC: Richard drafts phases & tasks, the app reads them
 * back for review, and the user approves the plan. Project resolved from the
 * registry (trust boundary).
 */
async function workspaceFor(id: unknown): Promise<string> {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return entry.workspacePath;
}

export function registerWhiteboardHandlers(): void {
  ipcMain.handle(
    IpcChannels.whiteboardDraft,
    async (_event, value: unknown): Promise<WhiteboardDraftResult> => {
      const workspacePath = await workspaceFor(value);
      const team = await readProjectTeam(workspacePath);
      return draftPlan(workspacePath, team);
    },
  );

  ipcMain.handle(IpcChannels.whiteboardGetPlan, async (_event, value: unknown): Promise<ProjectPlan> => {
    const workspacePath = await workspaceFor(value);
    return readProjectPlan(workspacePath);
  });

  ipcMain.handle(IpcChannels.whiteboardApprove, async (_event, value: unknown): Promise<ProjectPlan> => {
    if (value === null || typeof value !== 'object') {
      throw new Error('whiteboard:approve expects { id, approved }');
    }
    const { id, approved } = value as { id?: unknown; approved?: unknown };
    const workspacePath = await workspaceFor(id);
    const approve = approved === true;
    await setPlanApproved(workspacePath, approve);
    const plan = await readProjectPlan(workspacePath);
    // On approval, commit the planning artifacts (plan.json, task files, features.md,
    // the design conversations) as a clean "planning complete" checkpoint — otherwise
    // they stay uncommitted until the first Bullpen step sweeps them in. Best-effort
    // and flag-respecting (commitWorkspaceStep no-ops when git tracking is off / no repo).
    if (approve) {
      const phaseCount = new Set(plan.tasks.map((t) => t.feature ?? 'Tasks')).size;
      await commitWorkspaceStep(
        workspacePath,
        `Planning complete: ${plan.tasks.length} task(s) across ${phaseCount} phase(s)`,
      );
    }
    return plan;
  });
}
