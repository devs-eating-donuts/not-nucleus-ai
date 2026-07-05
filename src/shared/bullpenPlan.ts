import type { OpsCadence, SecurityCadence, TestingCadence } from './bullpen';
import { isAuthError } from './diagnostics';

/**
 * The escalation context for a CLI that hard-errored (crash / non-zero exit). When the error
 * looks like an auth failure (signed out / expired token), it tells the founder to
 * RE-AUTHENTICATE rather than retry a dead token — which would just fail the same way and burn
 * minutes on an unattended build. Pure; the raw error is always included. (auth-death recovery)
 */
export function cliErrorEscalationText(
  roleLabel: string,
  cliName: string,
  error: string | null,
): string {
  const base = `The ${roleLabel} CLI (${cliName}) errored: ${error ?? 'unknown error'}`;
  if (!isAuthError(error)) {
    return base;
  }
  return (
    `${base}\n\n` +
    `This looks like an authentication problem — ${cliName} is probably signed out or its token ` +
    `expired. Re-authenticate it on the AI CLIs page (or run its login command in a terminal), then ` +
    `Continue. Retrying without re-authenticating will just fail the same way.`
  );
}

/**
 * Pure decision logic for the Bullpen loop — no I/O, so it's unit-testable.
 * Given the tasks (with phase + status), each phase's progress, and the two
 * cadences, it returns the single next action. The engine executes it and the
 * renderer drives one step at a time.
 *
 * Flow per phase: build all tasks (dev → QA), then security (per cadence),
 * then the architect review (always end-of-phase, non-negotiable), then the
 * phase-end celebration (Jared + a random advisor). Then the next phase.
 */

export interface PlanTask {
  id: string;
  /** TaskState string. */
  status: string;
  kind: 'build' | 'human-setup';
  /** Phase name (feature); normalize null to 'Tasks' before passing in. */
  phase: string;
}

export interface PhaseProgress {
  /** Task ids that have passed their per-task security review (afterEachTask). */
  securedTaskIds: string[];
  /** The one end-of-phase security review ran (endOfPhase cadence). */
  securityDone: boolean;
  /** The end-of-phase architect review ran. */
  architectDone: boolean;
  /**
   * Jared's documentation pass ran. For endOfPhase ops, set per phase; for
   * endOfProject ops, set once on the final phase. Absent on older records →
   * treated as not-done.
   */
  opsDone: boolean;
  /** The phase-end banter (Jared + advisor) fired. */
  celebrated: boolean;
}

export type PhaseProgressMap = Record<string, PhaseProgress>;

export function emptyPhaseProgress(): PhaseProgress {
  return {
    securedTaskIds: [],
    securityDone: false,
    architectDone: false,
    opsDone: false,
    celebrated: false,
  };
}

/**
 * What a review gate (architect / security) should do, given whether a reviewer
 * CLI is assigned and whether it ran successfully:
 *  - 'skip'     — no reviewer assigned: a deliberate config choice; pass the gate
 *                 honestly (it's "no reviewer", not "reviewer says OK").
 *  - 'pass'     — assigned reviewer succeeded: mark the gate done, advance.
 *  - 'escalate' — assigned reviewer failed/unavailable: do NOT mark done; escalate
 *                 and pause. This is the "prove, don't claim" rule — a configured
 *                 gate that errors must block, never silently report success.
 */
export type GateOutcome = 'skip' | 'pass' | 'escalate';

export function gateOutcome(hasReviewer: boolean, cliOk: boolean): GateOutcome {
  if (!hasReviewer) {
    return 'skip';
  }
  return cliOk ? 'pass' : 'escalate';
}

/**
 * An assigned reviewer that exited 0 but produced NO output did not actually
 * review anything — the signed-out / stalled-CLI case QA already escalates on.
 * The gate steps treat this like a reviewer failure ("prove, don't claim"):
 * escalate instead of recording a review that never ran. Null (no reviewer
 * assigned) is not indeterminate — that's the honest 'skip' path.
 */
export function reviewIndeterminate(run: { ok: boolean; output: string } | null): boolean {
  return run !== null && run.ok && run.output.trim() === '';
}

/* ----- QA per-criterion verdicts ----- */

export type CriterionVerdict = 'covered' | 'gap' | 'n-a';

/**
 * Parse QA's per-criterion verdicts from its reply — lines that mention an
 * acceptance-criterion id and a verdict, e.g. "AC2: gap", "- AC3 — covered",
 * "AC1 n/a". Tolerant of separators and phrasing; ids are upper-cased.
 */
export function parseCriterionVerdicts(output: string): Record<string, CriterionVerdict> {
  const result: Record<string, CriterionVerdict> = {};
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/\b(AC\d+)\b\s*[:.\-—)]*\s*(covered|gap|not[\s-]?applicable|n[\s/.-]?a)\b/i);
    if (!m) {
      continue;
    }
    const id = m[1].toUpperCase();
    const v = m[2].toLowerCase();
    result[id] = v.startsWith('cov') ? 'covered' : v.startsWith('gap') ? 'gap' : 'n-a';
  }
  return result;
}

/**
 * Combine QA's overall verdict with its per-criterion verdicts. ANY criterion
 * marked 'gap' forces a fail (prove, don't claim — a task isn't done while a
 * criterion is uncovered). With no per-criterion data, the overall verdict
 * stands (so a CLI that doesn't follow the per-criterion format behaves exactly
 * as before).
 */
export function combineQaVerdict(
  overall: 'pass' | 'fail' | 'indeterminate',
  criterionVerdicts: Record<string, CriterionVerdict>,
): { verdict: 'pass' | 'fail' | 'indeterminate'; gaps: string[] } {
  const gaps = Object.entries(criterionVerdicts)
    .filter(([, v]) => v === 'gap')
    .map(([id]) => id);
  if (gaps.length > 0) {
    return { verdict: 'fail', gaps };
  }
  return { verdict: overall, gaps: [] };
}

/**
 * C1 — fold the harness's objective gate report into the model's semantic verdict. The
 * OBJECTIVE floor (typecheck/build/test) is authoritative: any present required gate that
 * failed → `fail`, regardless of what the model said (an exit code can't be talked out of a
 * failure). When the floor is green, defer to `combineQaVerdict` (the model owns the semantic
 * ceiling). When NO gates ran (`!ranAny` — a static site, or the toggle off, or all tools
 * missing) → byte-identical to today's `combineQaVerdict`. Pure — the engine short-circuits
 * on `gatesFailed` (Decision #8) before ever calling the QA CLI. `gatesGreen` tells the engine
 * a green objective floor exists (used for the calmer indeterminate message, Decision #7).
 */
export function combineGateAndQaVerdict(
  report: { ranAny: boolean; allRequiredPassed: boolean },
  overall: 'pass' | 'fail' | 'indeterminate',
  criterionVerdicts: Record<string, CriterionVerdict>,
): { verdict: 'pass' | 'fail' | 'indeterminate'; gaps: string[]; gatesFailed: boolean; gatesGreen: boolean } {
  const base = combineQaVerdict(overall, criterionVerdicts);
  if (!report.ranAny) {
    return { ...base, gatesFailed: false, gatesGreen: false };
  }
  if (!report.allRequiredPassed) {
    // A build that doesn't compile / passes no tests is a fail on objective evidence alone.
    return { verdict: 'fail', gaps: base.gaps, gatesFailed: true, gatesGreen: false };
  }
  return { ...base, gatesFailed: false, gatesGreen: true };
}

/**
 * Whether persisted phase progress should be discarded because it belongs to a
 * SUPERSEDED plan. True when the current plan has a revision id that the stored
 * progress doesn't match (the plan was re-drafted). A legacy plan with no
 * revision id (current === null) never invalidates existing progress.
 */
export function isPhaseProgressStale(
  storedRevisionId: string | null | undefined,
  currentRevisionId: string | null,
): boolean {
  return currentRevisionId !== null && (storedRevisionId ?? null) !== currentRevisionId;
}

/* ----- security findings → remediation ----- */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * The finding's impact TYPE (orthogonal to severity). Severity alone cannot separate
 * defect from opinion: in practice a large share of the remediation tail is
 * refactor-taste / doc-hygiene at medium/low, each buying a full dev→QA→commit cycle.
 * `defect` (it misbehaves/will bite a user) and `hardening` (a missing control) become
 * remediation tasks; `refactor` (structure/taste) and `docs` (documentation hygiene) route
 * to the findings backlog for founder triage — recorded, visible, never a silent drop.
 */
export type FindingImpact = 'defect' | 'hardening' | 'refactor' | 'docs';

export interface SecurityFinding {
  severity: FindingSeverity;
  description: string;
  /**
   * B4 — the finding names a missing CAPABILITY/feature (a real auth provider with an issuer,
   * multi-tenancy) that needs DESIGN + new tasks, not a one-file dev patch. Routed to the
   * design backlog instead of Dinesh (who would otherwise fake-satisfy it, e.g. task-023's
   * paste-a-JWT "login" with no issuer). Absent/false for an ordinary code-fix finding.
   */
  requiresDesign?: boolean;
  /** R1 impact type. Absent (untagged) is treated as remediate — never a drop. */
  impact?: FindingImpact;
  /**
   * P1 — a workspace-relative path to a failing test the reviewer wrote to demonstrate a
   * `defect` (`[repro-test: <path>]` on the FINDING line). The engine runs it: fails =
   * confirmed → build the fix; passes = refuted → backlog. Absent for findings with no repro.
   */
  reproTest?: string;
}

/**
 * Parse Gilfoyle's structured finding lines from a security review reply. The
 * prompt asks him to emit, per finding, a line of exactly:
 *   `FINDING [severity]: description`   (severity = critical|high|medium|low)
 * Tolerant of [..]/(..) brackets, separators, and surrounding markdown/bullets.
 * Free-prose mentions of "critical" elsewhere are ignored — only FINDING lines
 * count, so the build never spawns fix tasks off a stray adjective.
 */
export function parseSecurityFindings(output: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const line of output.split(/\r?\n/)) {
    // Optional parenthetical tag after the severity bracket: `(requires-design)` (a
    // capability gap → design backlog) or an impact type `(defect|hardening|refactor|docs)`
    // (refactor/docs route to the findings backlog, not a dev task). The tag is tolerated
    // BEFORE OR AFTER a leading separator, so both `FINDING [low] (refactor): x` and the common
    // `FINDING [low]: (refactor): x` parse identically — otherwise the second form lost the tag
    // AND polluted the description, breaking dedup with its well-formed twin.
    const m = line.match(
      /\bFINDING\b\s*[[(]\s*(critical|high|medium|low)\s*[\])]\s*[:.\-—]*\s*(?:\((requires-design|defect|hardening|refactor|docs)\)\s*[:.\-—]*\s*)?([^\s:.\-—].*?)\s*$/i,
    );
    if (!m) {
      continue;
    }
    let description = m[3].trim();
    if (description === '') {
      continue;
    }
    // P1: a `[repro-test: <path>]` marker names the failing test the reviewer wrote to
    // demonstrate a defect. Pull it onto `reproTest` and strip it (with any dangling
    // separator) so the fingerprint + the file:line citation stay stable whether or not a
    // repro was attached — a re-review of the same finding still dedups to one entry.
    let reproTest: string | undefined;
    const reproM = description.match(/\[\s*repro-test\s*:\s*([^\]]+?)\s*\]/i);
    if (reproM) {
      reproTest = reproM[1].trim();
      description = description.replace(reproM[0], '').replace(/\s*[—–-]\s*$/, '').trim();
      if (description === '') {
        continue;
      }
    }
    const finding: SecurityFinding = {
      severity: m[1].toLowerCase() as FindingSeverity,
      description,
    };
    // Only set tag fields when present, so an ordinary finding stays `{severity, description}`.
    const tag = m[2]?.toLowerCase();
    if (tag === 'requires-design') {
      finding.requiresDesign = true;
    } else if (tag) {
      finding.impact = tag as FindingImpact;
    }
    if (reproTest) {
      finding.reproTest = reproTest;
    }
    findings.push(finding);
  }
  return findings;
}

/**
 * A stable identity for a finding — its description normalized (lowercased, whitespace
 * collapsed). Used both to dedup a merge AND to remember which findings were already
 * remediated across the build, so a cumulative append-only review file doesn't re-create a
 * fix task for a finding handled in an earlier review. Pure.
 */
export function findingFingerprint(f: SecurityFinding): string {
  return f.description.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Merge two finding lists, deduped by fingerprint, first occurrence wins. Used to union a
 * reviewer's terse stdout reply with the richer FINDING lines it wrote to its review FILE,
 * so an under-emitted reply doesn't silently drop findings the file actually holds (D1b). Pure.
 */
export function mergeFindings(a: SecurityFinding[], b: SecurityFinding[]): SecurityFinding[] {
  const seen = new Set<string>();
  const out: SecurityFinding[] = [];
  for (const f of [...a, ...b]) {
    const key = findingFingerprint(f);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Extract a `path:line` code citation from a finding's description (the evidence the FINDING
 * format appends, e.g. "… — src/auth.ts:42"). Returns the LAST citation (evidence sits at
 * the end) or null. Requires a real file extension before the colon so clock times ("10:30")
 * and versions ("v1:2") don't match. Pure — drives D1's citation validation.
 */
export function findingCitation(description: string): { file: string; line: number } | null {
  const re = /([A-Za-z0-9_][\w./-]*\.[A-Za-z][A-Za-z0-9]{0,5}):(\d{1,6})\b/g;
  let last: { file: string; line: number } | null = null;
  for (const m of description.matchAll(re)) {
    last = { file: m[1], line: Number.parseInt(m[2], 10) };
  }
  return last;
}

/** A group of findings that share a source file — one "harden this module" remediation task. */
export interface FindingCluster {
  /** The file the findings share, or null for uncited findings (each its own cluster). */
  file: string | null;
  findings: SecurityFinding[];
}

/**
 * D2 — group findings by the file they cite so a module with many findings becomes ONE
 * "harden this file" task (each finding an acceptance criterion) instead of N separate
 * dev↔QA tasks, cutting the remediation explosion. Findings sharing a file are chunked at
 * `maxPerCluster` (so one task can't carry an unbounded criteria list); findings with no
 * citation each stay their own single-finding cluster (they can't be grouped by module).
 * Deterministic (first-seen file order). Pure.
 */
const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Order clusters worst-severity-first before the per-review cap slice, so hitting the
 * cap defers the LEAST severe clusters to the backlog instead of whatever the reviewer
 * happened to emit last (otherwise the cap only backlogs the right clusters by
 * emission-order luck). Stable: equal-severity clusters keep emission order. Pure.
 */
export function sortClustersBySeverity(clusters: FindingCluster[]): FindingCluster[] {
  const rank = (c: FindingCluster): number =>
    Math.min(...c.findings.map((f) => SEVERITY_RANK[f.severity]));
  return [...clusters].sort((a, b) => rank(a) - rank(b));
}

export function clusterFindings(findings: SecurityFinding[], maxPerCluster: number): FindingCluster[] {
  const byFile = new Map<string, SecurityFinding[]>();
  const uncited: SecurityFinding[] = [];
  for (const f of findings) {
    const cite = findingCitation(f.description);
    if (cite) {
      const arr = byFile.get(cite.file) ?? [];
      arr.push(f);
      byFile.set(cite.file, arr);
    } else {
      uncited.push(f);
    }
  }
  const clusters: FindingCluster[] = [];
  for (const [file, fs] of byFile) {
    for (let i = 0; i < fs.length; i += Math.max(1, maxPerCluster)) {
      clusters.push({ file, findings: fs.slice(i, i + Math.max(1, maxPerCluster)) });
    }
  }
  for (const f of uncited) {
    clusters.push({ file: null, findings: [f] });
  }
  return clusters;
}

export type PhaseActionKind =
  | 'dev'
  | 'qa'
  | 'security-task'
  | 'security-phase'
  | 'architect'
  | 'ops'
  | 'celebrate';

export interface NextAction {
  phase: string;
  kind: PhaseActionKind;
  /** Set for dev / qa / security-task. */
  taskId?: string;
}

/** The fields of a settled Bullpen step that shape its git commit message. */
export interface StepCommitInfo {
  taskId: string | null;
  iterations: string | null;
  passed: boolean | null;
  escalated: boolean;
  phaseName?: string | null;
}

/**
 * Structured one-line commit message for a Bullpen actor's step, so the git history
 * reads like the build log (e.g. "task-003: dev (attempt 2/5)", "task-003: QA PASS",
 * "Security review: Auth", "Phase complete: Auth"). Pure — unit tested.
 */
export function bullpenCommitMessage(action: NextAction, info: StepCommitInfo): string {
  const id = info.taskId ?? action.taskId ?? 'task';
  const phase = info.phaseName ?? action.phase;
  // Any escalation pauses the build for a human — say exactly that, without
  // overclaiming a cause. (Budget-exhaustion escalates from devStep under
  // action.kind 'dev', and an indeterminate QA verdict from qaStep under 'qa';
  // the precise reason is in ESCALATIONS.md / qa-review.md, which this commit captures.)
  if (info.escalated) {
    return `${id}: escalated to human — build paused`;
  }
  switch (action.kind) {
    case 'dev':
      return `${id}: dev${info.iterations ? ` (attempt ${info.iterations})` : ''}`;
    case 'qa':
      return `${id}: QA ${info.passed ? 'PASS' : 'FAIL → back to dev'}`;
    case 'security-task':
      return `${id}: security review`;
    case 'security-phase':
      return `Security review: ${phase}`;
    case 'architect':
      return `Architecture review: ${phase}`;
    case 'ops':
      return `Docs pass: ${phase}`;
    case 'celebrate':
      return `Phase complete: ${phase}`;
  }
}

export function isParkedStatus(status: string): boolean {
  // 'awaiting-review' is a human-gate state the autonomous loop must not act on
  // (and the engine never sets it). Treating it as parked keeps a phase from
  // deadlocking if it ever appears — it's terminal for the loop, pending a human.
  return status === 'human-needed' || status === 'blocked' || status === 'awaiting-review';
}

/** A task no longer needs dev/QA work: it's verified, or parked for a human. */
export function isPhaseTaskTerminal(status: string): boolean {
  return status === 'verified' || isParkedStatus(status);
}

/**
 * The phase an ad-hoc work item should join: the first phase still being built
 * (has a non-terminal task). If every task is terminal (build done / in review),
 * the last phase is returned so injected work reopens it. null when there are no
 * tasks at all. Cadence-independent — works whether the build is running or idle.
 */
export function activePhaseOf(tasks: PlanTask[]): string | null {
  const phases = phaseOrderOf(tasks);
  if (phases.length === 0) {
    return null;
  }
  const building = phases.find((ph) =>
    tasks.filter((t) => t.phase === ph).some((t) => !isPhaseTaskTerminal(t.status)),
  );
  return building ?? phases[phases.length - 1];
}

/** Phase order = the order features first appear in the task list. */
export function phaseOrderOf(tasks: PlanTask[]): string[] {
  const order: string[] = [];
  for (const t of tasks) {
    if (!order.includes(t.phase)) {
      order.push(t.phase);
    }
  }
  return order;
}

function securitySatisfied(
  phaseTasks: PlanTask[],
  prog: PhaseProgress,
  securityCadence: SecurityCadence,
): boolean {
  if (securityCadence === 'off') {
    return true;
  }
  if (securityCadence === 'endOfPhase') {
    return prog.securityDone;
  }
  // afterEachTask: every verified task has had its security review.
  return phaseTasks
    .filter((t) => t.status === 'verified')
    .every((t) => prog.securedTaskIds.includes(t.id));
}

/** A phase is fully done: tasks terminal, security satisfied, reviewed, celebrated. */
export function isPhaseComplete(
  phaseTasks: PlanTask[],
  prog: PhaseProgress,
  securityCadence: SecurityCadence,
  opsCadence: OpsCadence = 'off',
): boolean {
  const tasksDone = phaseTasks.every((t) => isPhaseTaskTerminal(t.status));
  if (!tasksDone) {
    return false;
  }
  // A phase with no verified work (everything parked) skips the review stages.
  if (!phaseTasks.some((t) => t.status === 'verified')) {
    return true;
  }
  // Per-phase ops gates the phase; end-of-project ops runs after ALL phases, so
  // it doesn't hold an individual phase open here.
  const opsSatisfied = opsCadence !== 'endOfPhase' || prog.opsDone;
  return (
    securitySatisfied(phaseTasks, prog, securityCadence) &&
    prog.architectDone &&
    opsSatisfied &&
    prog.celebrated
  );
}

/**
 * The next action across the whole plan, or null when every phase is complete
 * (the build is finished).
 */
export function decideNextAction(
  tasks: PlanTask[],
  progress: PhaseProgressMap,
  testingCadence: TestingCadence,
  securityCadence: SecurityCadence,
  opsCadence: OpsCadence = 'off',
): NextAction | null {
  for (const phase of phaseOrderOf(tasks)) {
    const phaseTasks = tasks.filter((t) => t.phase === phase);
    const prog = progress[phase] ?? emptyPhaseProgress();
    if (isPhaseComplete(phaseTasks, prog, securityCadence, opsCadence)) {
      continue;
    }

    // 1) afterEachTask security: review each verified task before moving on,
    //    so it interleaves per task (highest priority on a verified task).
    if (securityCadence === 'afterEachTask') {
      const t = phaseTasks.find(
        (x) => x.status === 'verified' && !prog.securedTaskIds.includes(x.id),
      );
      if (t) {
        return { phase, kind: 'security-task', taskId: t.id };
      }
    }

    // 2) Build / test the in-flight work. afterEachTask QAs a finished ('done')
    //    task BEFORE devving the next, so Dev → QA → Security interleave per task.
    //    endOfPhase (and off) build the whole phase first; any QA batches after.
    const devTask = phaseTasks.find((t) => t.status === 'todo' || t.status === 'in-progress');
    const qaTask = phaseTasks.find((t) => t.status === 'done');
    if (testingCadence === 'afterEachTask') {
      if (qaTask) {
        return { phase, kind: 'qa', taskId: qaTask.id };
      }
      if (devTask) {
        return { phase, kind: 'dev', taskId: devTask.id };
      }
    } else {
      if (devTask) {
        return { phase, kind: 'dev', taskId: devTask.id };
      }
      if (qaTask) {
        return { phase, kind: 'qa', taskId: qaTask.id };
      }
    }

    // 4) Phase-level stages, in order: end-of-phase security, architect review,
    //    then the phase-end celebration.
    if (securityCadence === 'endOfPhase' && !prog.securityDone) {
      return { phase, kind: 'security-phase' };
    }
    if (!prog.architectDone) {
      return { phase, kind: 'architect' };
    }
    // Per-phase documentation pass (Jared), before the phase-end celebration.
    if (opsCadence === 'endOfPhase' && !prog.opsDone) {
      return { phase, kind: 'ops' };
    }
    if (!prog.celebrated) {
      return { phase, kind: 'celebrate' };
    }
  }

  // End-of-project documentation pass: every phase is otherwise complete, so
  // Jared documents the whole build once. Tracked on the final phase's progress.
  if (opsCadence === 'endOfProject') {
    const phases = phaseOrderOf(tasks);
    const lastPhase = phases[phases.length - 1];
    if (lastPhase !== undefined && tasks.some((t) => t.status === 'verified')) {
      const lastProg = progress[lastPhase] ?? emptyPhaseProgress();
      if (!lastProg.opsDone) {
        return { phase: lastPhase, kind: 'ops' };
      }
    }
  }
  return null;
}
