import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BullpenStepResult } from '../../shared/bullpen';
import {
  appendStep,
  finishRun,
  getRun,
  reconcileInterruptedRuns,
  startRun,
} from './runHistoryStore';

/**
 * Run-history writes are fire-and-forget from the renderer's Bullpen loop, and each
 * op is a read-modify-write of the whole run file. These tests prove the per-run
 * serialization (withRunLock) makes concurrent writes safe: no lost steps, and a
 * finish racing the last append doesn't clobber either.
 */

const made: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-runtest-'));
  made.push(dir);
  return dir;
}

function step(taskId: string): BullpenStepResult {
  return {
    allDone: false,
    taskId,
    taskTitle: `Task ${taskId}`,
    actor: 'developer',
    status: 'in-progress',
    log: 'work',
    passed: null,
    escalated: false,
    iterations: '1/5',
    error: null,
  };
}

afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('runHistoryStore concurrency', () => {
  it('keeps every step when many appends fire concurrently (no read-modify-write loss)', async () => {
    const ws = await makeWorkspace();
    const run = await startRun(
      ws,
      { projectId: 'p1', mode: 'autopilot', cadence: { testing: 'afterEachTask', security: 'endOfPhase' } },
      'P1',
    );

    const N = 25;
    await Promise.all(Array.from({ length: N }, (_, i) => appendStep(ws, run.id, step(`task-${i}`))));

    const after = await getRun(ws, run.id);
    expect(after?.steps).toHaveLength(N);
    // Indices are assigned from the current length at write time — serialized writes
    // produce a contiguous 0..N-1 with no duplicates (a race would collide/drop them).
    expect(after?.steps.map((s) => s.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
    expect(after?.summary.steps).toBe(N);
  });

  it('a finish racing the final append preserves the step AND the terminal status', async () => {
    const ws = await makeWorkspace();
    const run = await startRun(
      ws,
      { projectId: 'p2', mode: 'autopilot', cadence: { testing: 'endOfPhase', security: 'endOfPhase' } },
      'P2',
    );
    await appendStep(ws, run.id, step('task-0'));

    // Fire the last append and the finish together — the lock serializes them.
    await Promise.all([appendStep(ws, run.id, step('task-1')), finishRun(ws, run.id, 'complete')]);

    const after = await getRun(ws, run.id);
    expect(after?.status).toBe('complete');
    expect(after?.endedAt).not.toBeNull();
    expect(after?.steps).toHaveLength(2); // neither write clobbered the other
  });
});

// Crash recovery: a run left 'running' by a crash/close is reconciled to 'interrupted' on the
// next open, EXCEPT the caller's live run (exceptRunId), so Run History is honest + resumable.
describe('reconcileInterruptedRuns', () => {
  const cadence = { testing: 'afterEachTask', security: 'endOfPhase' } as const;

  it("flips a stale 'running' record to 'interrupted' and stamps endedAt", async () => {
    const ws = await makeWorkspace();
    const run = await startRun(ws, { projectId: 'p', mode: 'autopilot', cadence }, 'P'); // stays 'running'

    const summaries = await reconcileInterruptedRuns(ws);

    expect(summaries.find((s) => s.id === run.id)?.status).toBe('interrupted');
    const record = await getRun(ws, run.id);
    expect(record?.status).toBe('interrupted');
    expect(record?.endedAt).not.toBeNull();
  });

  it('spares the caller\'s live run (exceptRunId) and never touches an already-terminal run', async () => {
    const ws = await makeWorkspace();
    const live = await startRun(ws, { projectId: 'p', mode: 'autopilot', cadence }, 'P');
    const done = await startRun(ws, { projectId: 'p', mode: 'autopilot', cadence }, 'P');
    await finishRun(ws, done.id, 'complete');
    const crashed = await startRun(ws, { projectId: 'p', mode: 'autopilot', cadence }, 'P');

    await reconcileInterruptedRuns(ws, live.id);

    expect((await getRun(ws, live.id))?.status).toBe('running'); // spared — it's the live loop
    expect((await getRun(ws, done.id))?.status).toBe('complete'); // untouched
    expect((await getRun(ws, crashed.id))?.status).toBe('interrupted'); // reconciled
  });

  it('returns [] when the project has no runs directory', async () => {
    const ws = await makeWorkspace();
    expect(await reconcileInterruptedRuns(ws)).toEqual([]);
  });
});
