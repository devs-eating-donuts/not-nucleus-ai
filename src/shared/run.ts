import type { BullpenActor, SecurityCadence, TestingCadence } from './bullpen';

/**
 * Run history. A "run" is one Bullpen build session: the renderer drives the
 * step loop, and each step is appended to a run record under
 * `.nucleus/runs/<id>.json`. Because task state lives in the task files (the
 * source of truth), a run that ended 'stopped' or 'escalated' is RESUMABLE —
 * re-entering the Bullpen continues from wherever the task files left off.
 */

// 'interrupted' = a run left 'running' by a crash / window close / reload — the loop's
// finally never fired, so it never reached a terminal status. Reconciled on next open so
// Run History is honest and the build can be resumed (the task files are the checkpoint).
export type RunStatus = 'running' | 'complete' | 'escalated' | 'stopped' | 'interrupted';

export type RunMode = 'autopilot' | 'manual';

/** A condensed Bullpen step, persisted for the run timeline. */
export interface RunStepRecord {
  index: number;
  at: string;
  actor: BullpenActor;
  taskId: string | null;
  taskTitle: string | null;
  status: string | null;
  passed: boolean | null;
  escalated: boolean;
  iterations: string | null;
  phaseName: string | null;
  error: string | null;
  /** Truncated step log (full logs live in reviews/*). */
  logExcerpt: string;
}

export interface RunSummaryCounts {
  steps: number;
  tasksWorked: number;
  passes: number;
  fails: number;
  escalations: number;
}

export interface RunRecord {
  id: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  mode: RunMode;
  cadence: { testing: TestingCadence; security: SecurityCadence };
  /** When this run continues a prior stopped/escalated run. */
  resumedFromRunId: string | null;
  steps: RunStepRecord[];
  summary: RunSummaryCounts;
}

/** List view: a run without its step array. */
export interface RunSummary {
  id: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  mode: RunMode;
  cadence: { testing: TestingCadence; security: SecurityCadence };
  resumedFromRunId: string | null;
  summary: RunSummaryCounts;
  /** Last phase touched, for the list label. */
  lastPhase: string | null;
}

/** Renderer → main: open a new run record. */
export interface RunStartInput {
  projectId: string;
  mode: RunMode;
  cadence: { testing: TestingCadence; security: SecurityCadence };
  resumedFromRunId?: string | null;
}

/** True for runs that can be continued in the Bullpen. */
export function isResumable(status: RunStatus): boolean {
  return status === 'stopped' || status === 'escalated' || status === 'interrupted';
}
