import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { BullpenActivity, BullpenStepResult, SecurityResult, TelemetrySummary } from '../../shared/bullpen';
import { isOpsCadence, isTestingCadence } from '../../shared/bullpen-guards';
import { DEFAULT_NAMING_MODE, isNamingMode } from '../../shared/naming';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readProjectTeam } from '../services/projectTeamStore';
import {
  readActivity,
  readTelemetry,
  requeueTaskForQa,
  resolveTask,
  runNextStep,
  runSecurity,
} from '../services/bullpenEngine';

/**
 * The Bullpen IPC: one build step at a time (dev → QA loop), the final
 * security pass, and telemetry read-back (The Garage). The renderer drives
 * the loop; the project is resolved from the registry (trust boundary).
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

// The task files ARE the build's state machine — two concurrent runNextStep calls
// against one workspace would race its read-decide-write cycle (double-driving a
// step, or resurrecting a status another call just advanced). The renderer loop is
// sequential by construction, but the IPC boundary must not TRUST that: serialize
// per workspace, so a duplicated/racing call simply runs after the current step.
const stepLocks = new Map<string, Promise<unknown>>();
function withStepLock<T>(workspacePath: string, work: () => Promise<T>): Promise<T> {
  const prev = stepLocks.get(workspacePath) ?? Promise.resolve();
  const run = prev.then(work, work);
  const tail = run.catch(() => undefined);
  stepLocks.set(workspacePath, tail);
  void tail.then(() => {
    if (stepLocks.get(workspacePath) === tail) {
      stepLocks.delete(workspacePath);
    }
  });
  return run;
}

export function registerBullpenHandlers(): void {
  ipcMain.handle(IpcChannels.bullpenNextStep, async (_event, value: unknown): Promise<BullpenStepResult> => {
    if (value === null || typeof value !== 'object') {
      throw new Error('bullpen:next-step expects { id, testingCadence, securityCadence, namingMode }');
    }
    const { id, testingCadence, securityCadence, opsCadence, namingMode } = value as Record<string, unknown>;
    const workspacePath = await workspaceFor(id);
    return withStepLock(workspacePath, async () => {
      const team = await readProjectTeam(workspacePath);
      return runNextStep(workspacePath, team, {
        testingCadence: isTestingCadence(testingCadence) ? testingCadence : 'afterEachTask',
        securityCadence: isTestingCadence(securityCadence) ? securityCadence : 'endOfPhase',
        opsCadence: isOpsCadence(opsCadence) ? opsCadence : 'off',
        namingMode: isNamingMode(namingMode) ? namingMode : DEFAULT_NAMING_MODE,
      });
    });
  });

  ipcMain.handle(IpcChannels.bullpenActivity, async (_event, value: unknown): Promise<BullpenActivity | null> => {
    const workspacePath = await workspaceFor(value);
    return readActivity(workspacePath);
  });

  ipcMain.handle(IpcChannels.bullpenResolveTask, async (_event, value: unknown): Promise<{ ok: boolean; error: string | null }> => {
    if (value === null || typeof value !== 'object') {
      throw new Error('bullpen:resolve-task expects { id, taskId }');
    }
    const { id, taskId, founderNote } = value as { id?: unknown; taskId?: unknown; founderNote?: unknown };
    if (typeof taskId !== 'string') {
      throw new Error('A taskId is required');
    }
    const workspacePath = await workspaceFor(id);
    // The optional founder note is untrusted renderer text bound for a Markdown
    // file — cap it and keep it single-block (newlines allowed; it's free prose).
    const note = typeof founderNote === 'string' ? founderNote.slice(0, 2000) : undefined;
    return resolveTask(workspacePath, taskId, note);
  });

  ipcMain.handle(IpcChannels.bullpenRequeueQa, async (_event, value: unknown): Promise<{ ok: boolean; error: string | null }> => {
    if (value === null || typeof value !== 'object') {
      throw new Error('bullpen:requeue-qa expects { id, taskId }');
    }
    const { id, taskId } = value as { id?: unknown; taskId?: unknown };
    if (typeof taskId !== 'string') {
      throw new Error('A taskId is required');
    }
    const workspacePath = await workspaceFor(id);
    return requeueTaskForQa(workspacePath, taskId);
  });

  ipcMain.handle(IpcChannels.bullpenSecurity, async (_event, value: unknown): Promise<SecurityResult> => {
    const workspacePath = await workspaceFor(value);
    const team = await readProjectTeam(workspacePath);
    return runSecurity(workspacePath, team);
  });

  ipcMain.handle(IpcChannels.bullpenTelemetry, async (_event, value: unknown): Promise<TelemetrySummary> => {
    const workspacePath = await workspaceFor(value);
    return readTelemetry(workspacePath);
  });
}
