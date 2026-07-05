import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { BullpenStepResult } from '../../shared/bullpen';
import type { RunRecord, RunStartInput, RunStatus, RunSummary } from '../../shared/run';
import { isTestingCadence } from '../../shared/bullpen-guards';
import { projectRegistryStore } from '../services/projectRegistryStore';
import {
  appendStep,
  deleteRun,
  finishRun,
  getRun,
  listRuns,
  reconcileInterruptedRuns,
  startRun,
} from '../services/runHistoryStore';

/**
 * Run-history IPC. The renderer drives a Bullpen build session and mirrors each
 * step here; the project is resolved from the registry (trust boundary), and
 * run files live under that project's `.nucleus/runs/`.
 */

interface ResolvedProject {
  workspacePath: string;
  name: string;
}

async function resolveProject(id: unknown): Promise<ResolvedProject> {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return { workspacePath: entry.workspacePath, name: entry.name };
}

function asStatus(value: unknown): RunStatus {
  return value === 'complete' ||
    value === 'escalated' ||
    value === 'stopped' ||
    value === 'running' ||
    value === 'interrupted'
    ? value
    : 'stopped';
}

const str = (v: unknown, cap: number): string | null =>
  typeof v === 'string' ? v.slice(0, cap) : null;

/**
 * Shape-validate the renderer-supplied step before it lands in the git-tracked
 * run record (`.nucleus/runs/*.json`). The renderer is untrusted at this
 * boundary: known keys only, coerced types, capped strings — an arbitrary
 * object can no longer ride into the audit trail verbatim.
 */
function sanitizeStep(value: unknown): BullpenStepResult {
  const v = (value ?? {}) as Partial<BullpenStepResult> & { advisory?: unknown };
  const advisoryRaw = v.advisory as { personaId?: unknown; line?: unknown } | null | undefined;
  return {
    allDone: v.allDone === true,
    taskId: str(v.taskId, 200),
    taskTitle: str(v.taskTitle, 500),
    actor:
      v.actor === 'developer' || v.actor === 'qa' || v.actor === 'security' ||
      v.actor === 'architect' || v.actor === 'ops'
        ? v.actor
        : null,
    status: str(v.status, 100),
    log: str(v.log, 200_000) ?? '',
    passed: typeof v.passed === 'boolean' ? v.passed : null,
    escalated: v.escalated === true,
    iterations: str(v.iterations, 50),
    error: str(v.error, 5000),
    ...(typeof v.banter === 'string' ? { banter: v.banter.slice(0, 1000) } : {}),
    ...(advisoryRaw && typeof advisoryRaw === 'object'
      ? {
          advisory: {
            personaId: str(advisoryRaw.personaId, 100) ?? '',
            line: str(advisoryRaw.line, 1000) ?? '',
          },
        }
      : {}),
    ...(v.phaseName !== undefined ? { phaseName: str(v.phaseName, 500) } : {}),
  };
}

export function registerRunHandlers(): void {
  ipcMain.handle(IpcChannels.runStart, async (_event, value: unknown): Promise<RunRecord> => {
    const raw = (value ?? {}) as Partial<RunStartInput>;
    const { workspacePath, name } = await resolveProject(raw.projectId);
    const cadenceRaw = (raw.cadence ?? {}) as { testing?: unknown; security?: unknown };
    const input: RunStartInput = {
      projectId: raw.projectId as string,
      mode: raw.mode === 'manual' ? 'manual' : 'autopilot',
      cadence: {
        testing: isTestingCadence(cadenceRaw.testing) ? cadenceRaw.testing : 'afterEachTask',
        security: isTestingCadence(cadenceRaw.security) ? cadenceRaw.security : 'endOfPhase',
      },
      resumedFromRunId:
        typeof raw.resumedFromRunId === 'string' ? raw.resumedFromRunId : null,
    };
    return startRun(workspacePath, input, name);
  });

  ipcMain.handle(IpcChannels.runAppendStep, async (_event, value: unknown): Promise<void> => {
    const { projectId, runId, step } = (value ?? {}) as {
      projectId?: unknown;
      runId?: unknown;
      step?: unknown;
    };
    if (typeof runId !== 'string' || !step) {
      return;
    }
    const { workspacePath } = await resolveProject(projectId);
    await appendStep(workspacePath, runId, sanitizeStep(step));
  });

  ipcMain.handle(IpcChannels.runFinish, async (_event, value: unknown): Promise<void> => {
    const { projectId, runId, status } = (value ?? {}) as {
      projectId?: unknown;
      runId?: unknown;
      status?: unknown;
    };
    if (typeof runId !== 'string') {
      return;
    }
    const { workspacePath } = await resolveProject(projectId);
    await finishRun(workspacePath, runId, asStatus(status));
  });

  ipcMain.handle(IpcChannels.runList, async (_event, value: unknown): Promise<RunSummary[]> => {
    const { workspacePath } = await resolveProject(value);
    return listRuns(workspacePath);
  });

  ipcMain.handle(IpcChannels.runGet, async (_event, value: unknown): Promise<RunRecord | null> => {
    const { projectId, runId } = (value ?? {}) as { projectId?: unknown; runId?: unknown };
    if (typeof runId !== 'string') {
      return null;
    }
    const { workspacePath } = await resolveProject(projectId);
    return getRun(workspacePath, runId);
  });

  ipcMain.handle(IpcChannels.runDelete, async (_event, value: unknown): Promise<RunSummary[]> => {
    const { projectId, runId } = (value ?? {}) as { projectId?: unknown; runId?: unknown };
    const { workspacePath } = await resolveProject(projectId);
    if (typeof runId === 'string') {
      await deleteRun(workspacePath, runId);
    }
    return listRuns(workspacePath);
  });

  ipcMain.handle(IpcChannels.runReconcile, async (_event, value: unknown): Promise<RunSummary[]> => {
    const { projectId, exceptRunId } = (value ?? {}) as { projectId?: unknown; exceptRunId?: unknown };
    const { workspacePath } = await resolveProject(projectId);
    return reconcileInterruptedRuns(workspacePath, typeof exceptRunId === 'string' ? exceptRunId : null);
  });
}
