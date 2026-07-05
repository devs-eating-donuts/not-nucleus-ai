/**
 * The Bullpen (Dinesh · Big Head · Gilfoyle): the autonomous build loop.
 * Dinesh implements tasks (auto-approve, in the workspace), Big Head tests,
 * failures loop back to Dinesh up to the iteration budget, then Gilfoyle
 * does the security pass. The renderer drives the loop one step at a time.
 */

import type { NamingMode } from './naming';
import type { PhaseActionKind } from './bullpenPlan';

export type TestingCadence = 'afterEachTask' | 'endOfPhase' | 'off';

/** When Gilfoyle's security review runs — same options as testing, plus off. */
export type SecurityCadence = 'afterEachTask' | 'endOfPhase' | 'off';

/** When Jared's documentation pass runs (per phase, once at the end, or never). */
export type OpsCadence = 'endOfPhase' | 'endOfProject' | 'off';

/** Everything a Bullpen step needs from the renderer each call. */
export interface BullpenRunOptions {
  testingCadence: TestingCadence;
  securityCadence: SecurityCadence;
  /** When Jared (Ops) does his documentation pass. */
  opsCadence: OpsCadence;
  /** Active naming mode — drives the Jian Yang takeover (canon + awake). */
  namingMode: NamingMode;
}

/** Who acted on a step. 'ops' = Jared's phase-end note. */
export type BullpenActor = 'developer' | 'qa' | 'security' | 'architect' | 'ops' | null;

export interface BullpenStepResult {
  /** True when there is no further work (the whole build is complete). */
  allDone: boolean;
  taskId: string | null;
  taskTitle: string | null;
  /** Which agent acted this step. */
  actor: BullpenActor;
  /** Resulting task status after this step. */
  status: string | null;
  log: string;
  /** QA verdict when QA ran this step. */
  passed: boolean | null;
  /** True when the iteration budget was exhausted and it escalated. */
  escalated: boolean;
  /** e.g. "3/5". */
  iterations: string | null;
  error: string | null;
  /** Canned in-character one-liner for the actor (Jian Yang when he's taken over). */
  banter?: string;
  /** Phase-end chime-in from a random advisory-board member. */
  advisory?: { personaId: string; line: string } | null;
  /** The phase this step belongs to, for the build log. */
  phaseName?: string | null;
  /**
   * What the loop will do NEXT, computed after this step settled (null = build
   * complete; undefined when not computed, e.g. an error/empty step). The
   * renderer uses this to auto-fire the phase-end review stages (security-phase /
   * architect / ops / celebrate) in one-step mode instead of forcing a click for
   * each, while still pausing between tasks.
   */
  nextActionKind?: PhaseActionKind | null;
  /**
   * True for steps the build log should NOT display or persist — non-events that
   * still drive the loop's control flow (e.g. a review gate skipped because its
   * seat is unassigned). The loop processes the step's other fields but never
   * shows it, so an empty roster (rip-it) doesn't litter the log with skips.
   */
  silent?: boolean;
}

/**
 * A live "who's working right now" marker the engine writes to disk at the
 * start of each CLI sub-step and clears when the step ends. The renderer polls
 * it during a run so the board can show "Dinesh is building / Big Head is
 * testing / Gilfoyle is reviewing" instead of a bare "in-progress".
 */
export interface BullpenActivity {
  actor: BullpenActor;
  taskId: string | null;
  taskTitle: string | null;
  phaseName: string | null;
  startedAt: string;
}

export interface SecurityResult {
  ok: boolean;
  log: string;
  error: string | null;
  /**
   * The remediation surface — a one-line summary of the fix tasks the manual security sweep
   * created from its findings ('' when none / it errored). The manual run now routes findings
   * through the same remediation pipeline as the gated security, so its findings become real
   * tasks instead of vanishing into a display-only report.
   */
  remediation: string;
}

/** One recorded agent invocation, for The Garage. */
export interface TelemetryEntry {
  roleId: string;
  cliName: string;
  command: string;
  taskId: string | null;
  durationMs: number;
  iterations: number | null;
  status: string;
  ok: boolean;
  at: string;
}

export interface TelemetrySummary {
  entries: TelemetryEntry[];
  totalDurationMs: number;
  byCli: Array<{ cliName: string; runs: number; durationMs: number }>;
  byRole: Array<{ roleId: string; runs: number; durationMs: number }>;
}
