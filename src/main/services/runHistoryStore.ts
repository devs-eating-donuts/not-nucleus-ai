import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { META_DIR } from '../../shared/markdown';
import type { BullpenStepResult } from '../../shared/bullpen';
import type {
  RunMode,
  RunRecord,
  RunStartInput,
  RunStatus,
  RunStepRecord,
  RunSummary,
  RunSummaryCounts,
} from '../../shared/run';
import { resolveWorkspacePath } from './markdownWorkspace';
import { writeJsonAtomic } from './atomicWrite';
import { redactSecrets } from '../../shared/secrets';

/**
 * Persists Bullpen runs under `.nucleus/runs/<id>.json` — one file per run so a
 * long run doesn't rewrite a single growing file each step. Atomic writes
 * (temp-then-rename); every path goes through resolveWorkspacePath.
 */

const RUNS_DIR = `${META_DIR}/runs`;
const LOG_EXCERPT_LIMIT = 4000;
const RUN_ID_RE = /^run-[a-z0-9-]+$/i;

function runsDirAbs(workspacePath: string): string {
  return resolveWorkspacePath(workspacePath, RUNS_DIR);
}

function runFileAbs(workspacePath: string, runId: string): string {
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return resolveWorkspacePath(workspacePath, `${RUNS_DIR}/${runId}.json`);
}

async function writeRun(workspacePath: string, record: RunRecord): Promise<void> {
  const abs = runFileAbs(workspacePath, record.id);
  await writeJsonAtomic(abs, { schemaVersion: 1, run: record });
}

// Serialize read-modify-write ops on a single run file. The renderer drives the
// Bullpen loop and fires appendStep / finishRun WITHOUT awaiting (best-effort, so a
// history hiccup never blocks the build), so a terminal finishRun can otherwise race
// the last appendStep — both read-modify-write the whole record, last-writer-wins,
// dropping the final step or clobbering the terminal status. Chaining per run makes
// each op atomic w.r.t. the others (and removes the shared `.tmp` collision for same-run
// writes). Best-effort: a failed op never wedges the next; the lock entry drops when idle.
const runLocks = new Map<string, Promise<unknown>>();

function withRunLock<T>(workspacePath: string, runId: string, work: () => Promise<T>): Promise<T> {
  const key = `${path.resolve(workspacePath)}|${runId}`;
  const prev = runLocks.get(key) ?? Promise.resolve();
  // Run `work` whether the prior link resolved or rejected (don't let one failure stall the chain).
  const run = prev.then(work, work);
  const tail = run.catch(() => undefined);
  runLocks.set(key, tail);
  void tail.then(() => {
    if (runLocks.get(key) === tail) {
      runLocks.delete(key);
    }
  });
  return run;
}

export async function getRun(workspacePath: string, runId: string): Promise<RunRecord | null> {
  try {
    const raw = await fs.readFile(runFileAbs(workspacePath, runId), 'utf8');
    return (JSON.parse(raw) as { run?: RunRecord }).run ?? null;
  } catch {
    return null;
  }
}

function emptyCounts(): RunSummaryCounts {
  return { steps: 0, tasksWorked: 0, passes: 0, fails: 0, escalations: 0 };
}

export async function startRun(
  workspacePath: string,
  input: RunStartInput,
  projectName: string,
): Promise<RunRecord> {
  const record: RunRecord = {
    id: `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    projectName,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    mode: input.mode,
    cadence: input.cadence,
    resumedFromRunId: input.resumedFromRunId ?? null,
    steps: [],
    summary: emptyCounts(),
  };
  return withRunLock(workspacePath, record.id, async () => {
    await writeRun(workspacePath, record);
    return record;
  });
}

function recomputeSummary(steps: RunStepRecord[]): RunSummaryCounts {
  const tasks = new Set<string>();
  let passes = 0;
  let fails = 0;
  let escalations = 0;
  for (const s of steps) {
    if (s.taskId) {
      tasks.add(s.taskId);
    }
    if (s.actor === 'qa' && s.passed === true) {
      passes += 1;
    }
    if (s.actor === 'qa' && s.passed === false) {
      fails += 1;
    }
    if (s.escalated) {
      escalations += 1;
    }
  }
  return { steps: steps.length, tasksWorked: tasks.size, passes, fails, escalations };
}

export async function appendStep(
  workspacePath: string,
  runId: string,
  step: BullpenStepResult,
): Promise<void> {
  return withRunLock(workspacePath, runId, async () => {
    const record = await getRun(workspacePath, runId);
    if (!record) {
      return;
    }
    const stepRecord: RunStepRecord = {
      index: record.steps.length,
      at: new Date().toISOString(),
      actor: step.actor,
      taskId: step.taskId,
      taskTitle: step.taskTitle,
      status: step.status,
      passed: step.passed,
      escalated: step.escalated,
      iterations: step.iterations,
      phaseName: step.phaseName ?? null,
      // Redact secret-shaped tokens before this record is persisted AND git-committed
      // (the run history is part of the tracked audit trail). Mirrors the invocation-log
      // redaction so an autopilot CLI that echoes a value never lands it raw on disk / in git.
      error: step.error == null ? step.error : redactSecrets(step.error),
      logExcerpt: redactSecrets((step.log ?? '').slice(-LOG_EXCERPT_LIMIT)),
    };
    record.steps.push(stepRecord);
    record.summary = recomputeSummary(record.steps);
    await writeRun(workspacePath, record);
  });
}

export async function finishRun(
  workspacePath: string,
  runId: string,
  status: RunStatus,
): Promise<void> {
  return withRunLock(workspacePath, runId, async () => {
    const record = await getRun(workspacePath, runId);
    if (!record) {
      return;
    }
    record.status = status;
    record.endedAt = new Date().toISOString();
    await writeRun(workspacePath, record);
  });
}

/**
 * Reconcile stale 'running' records to 'interrupted'. A run stays 'running' forever if the
 * app crashed / closed / reloaded mid-build (the renderer loop's finally never fired finishRun).
 * Called on project open, when no live loop owns a record: every 'running' record EXCEPT the
 * caller's live one (`exceptRunId`) is stale, so flip it to 'interrupted' (a resumable terminal
 * state) with an endedAt. Best-effort; returns the fresh summary list (newest first).
 */
export async function reconcileInterruptedRuns(
  workspacePath: string,
  exceptRunId?: string | null,
): Promise<RunSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(runsDirAbs(workspacePath));
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.endsWith('.tmp')) {
      continue;
    }
    const runId = entry.replace(/\.json$/, '');
    if (runId === exceptRunId) {
      continue;
    }
    const record = await getRun(workspacePath, runId);
    if (record?.status === 'running') {
      // finishRun re-reads under the lock and only writes if the record still exists; a
      // record that raced to a real terminal status in the meantime is left as-is.
      await withRunLock(workspacePath, runId, async () => {
        const fresh = await getRun(workspacePath, runId);
        if (fresh?.status === 'running') {
          fresh.status = 'interrupted';
          fresh.endedAt = new Date().toISOString();
          await writeRun(workspacePath, fresh);
        }
      });
    }
  }
  return listRuns(workspacePath);
}

function toSummary(record: RunRecord): RunSummary {
  const lastPhase =
    [...record.steps].reverse().find((s) => s.phaseName)?.phaseName ?? null;
  return {
    id: record.id,
    projectId: record.projectId,
    projectName: record.projectName,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    status: record.status,
    mode: record.mode as RunMode,
    cadence: record.cadence,
    resumedFromRunId: record.resumedFromRunId,
    summary: record.summary,
    lastPhase,
  };
}

export async function listRuns(workspacePath: string): Promise<RunSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(runsDirAbs(workspacePath));
  } catch {
    return [];
  }
  const summaries: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.endsWith('.tmp')) {
      continue;
    }
    const runId = entry.replace(/\.json$/, '');
    const record = await getRun(workspacePath, runId);
    if (record) {
      summaries.push(toSummary(record));
    }
  }
  // Newest first.
  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries;
}

export async function deleteRun(workspacePath: string, runId: string): Promise<void> {
  try {
    await fs.rm(runFileAbs(workspacePath, runId), { force: true });
  } catch {
    /* nothing to delete */
  }
}
