import { CLI_PRESETS, stepDownThinkingLevel } from '../../shared/cli';
import type { ProjectInfo, ProjectTeam } from '../../shared/project';
import type {
  BullpenRunOptions,
  BullpenStepResult,
  SecurityResult,
} from '../../shared/bullpen';
import {
  activePhaseOf,
  bullpenCommitMessage,
  cliErrorEscalationText,
  combineGateAndQaVerdict,
  decideNextAction,
  emptyPhaseProgress,
  gateOutcome,
  reviewIndeterminate,
  parseCriterionVerdicts,
} from '../../shared/bullpenPlan';
import type { PhaseProgressMap, PlanTask } from '../../shared/bullpenPlan';
import { pickBanter } from '../../shared/banter';
import type { NamingMode } from '../../shared/naming';
import {
  extractAcceptanceCriteria,
  incrementTaskIterations,
  setTaskStatus,
} from '../../shared/taskfile';
import type { RoleId } from '../../shared/roles';
import { invokeCli } from './cliInvoker';
import type { CliInvocation } from './cliInvoker';
import { commitWorkspaceStep } from './gitTracker';
import { jianYangTakeoverActive } from './settingsStore';
import { ensureStackUp, stackDown } from './stackManager';
import { formatGateSummary, runGates } from './verificationRunner';
import type { GateReport } from './verificationRunner';
import {
  readMarkdown,
  readProjectInfo,
  writeMarkdown,
} from './markdownWorkspace';
import {
  readPhaseProgress,
  recordTelemetry,
  writeActivity,
  writePhaseProgress,
} from './bullpenTelemetry';
export { readActivity, readTelemetry } from './bullpenTelemetry';
import {
  architectReviewPrompt,
  customRoleBlock,
  devPrompt,
  opsDocsPrompt,
  parseVerdict,
  qaPrompt,
  securityPhasePrompt,
  securityPrompt,
  securityTaskPrompt,
} from './bullpenPrompts';
export { parseVerdict };
import {
  appendTaskToPhase,
  escalateTask,
  handoffSetupTask,
  listTasks,
} from './bullpenTasks';
import type { TaskRef } from './bullpenTasks';
export { appendTaskToPhase };
export { requeueTaskForQa, resolveTask } from './bullpenTasks';
import {
  ADVISORY_PERSONA_IDS,
  banterFor,
  captureLesson,
  roleContextBlocks,
} from './bullpenContext';
import {
  escalateGate,
  gateSkippedStep,
  hasReviewer,
  resolveGateEscalation,
} from './bullpenGates';
import {
  createRemediationTask,
  dispositionedFindingsBlock,
  remediateArchitectFindings,
  remediateSecurityFindings,
  reproBackedFindingsEnabled,
} from './bullpenFindings';
export { remediateSecurityFindings };
export { remediationCapFor } from './bullpenFindings';

/**
 * The Bullpen engine. Invokes role CLIs with autopilot flags, cwd = the project
 * workspace (scopes relative paths; NOT a hard sandbox — the CLIs run with their
 * own permissions). One step per call so the UI can show live progress; the
 * renderer loops until allDone or an escalation.
 */

const DEV_TIMEOUT_MS = 600_000; // 10 min — agents writing code can take a while.

/* ----- agent invocation + telemetry ----- */

/** Run a Bullpen role with autopilot, cwd = the project workspace. */
async function invokeRole(
  workspacePath: string,
  roleId: RoleId,
  team: ProjectTeam,
  prompt: string,
): Promise<CliInvocation> {
  const assignment = team[roleId]?.assignment;
  const opts = {
    prompt,
    cwd: workspacePath,
    timeoutMs: DEV_TIMEOUT_MS,
    autopilot: true,
    surface: 'bullpen' as const,
    role: roleId,
  };
  const first = await invokeCli(assignment, opts);
  if (!first.timedOut || !assignment) {
    return first;
  }
  // Timeout step-down retry: a one-shot Bullpen step that hit the wall at a high
  // thinking level gets ONE automatic retry at the next-lower level (a step that
  // repeatedly times out at the highest level often finishes quickly one level down,
  // so most of the wasted time is avoidable). No lower level (unset/'default'/lowest/
  // non-thinking CLI) → surface the timeout as before. The retry is visible: the result
  // carries a step-down note.
  const preset = assignment.presetId
    ? CLI_PRESETS.find((p) => p.id === assignment.presetId)
    : undefined;
  const lower = stepDownThinkingLevel(preset, assignment.capabilities, assignment.defaultThinkingLevel);
  if (lower === null) {
    return first;
  }
  const retry = await invokeCli({ ...assignment, defaultThinkingLevel: lower }, opts);
  const note =
    `⏱ Timed out at thinking level "${assignment.defaultThinkingLevel}" — ` +
    `automatically retried once at "${lower}".`;
  return {
    ...retry,
    // Prefix the note only when the retry actually produced output. An ok-but-EMPTY
    // retry must stay empty-shaped — the note alone would read as review content and
    // launder a review-that-never-ran past the gates' reviewIndeterminate check.
    output: retry.output.trim() !== '' ? `${note}\n\n${retry.output}` : retry.output,
    error: retry.error ? `${note} ${retry.error}` : retry.error,
  };
}

/* ----- the step machine ----- */

async function projectName(workspacePath: string): Promise<string> {
  const info: ProjectInfo | null = await readProjectInfo(workspacePath);
  return info?.projectName ?? 'this project';
}

function emptyStep(): BullpenStepResult {
  return {
    allDone: true,
    taskId: null,
    taskTitle: null,
    actor: null,
    status: null,
    log: '',
    passed: null,
    escalated: false,
    iterations: null,
    error: null,
  };
}

/**
 * A non-completion ERROR step for the (practically impossible) case where a decided action
 * references a task id that vanished between listTasks and the in-call lookup. emptyStep is
 * allDone:true — returning it here would read as a FALSE "build complete" with unbuilt tasks
 * (review L7). Surface the desync as an error instead.
 */
function taskNotFoundStep(kind: string, taskId?: string): BullpenStepResult {
  return {
    ...emptyStep(),
    allDone: false,
    error: `Internal: task ${taskId ?? '?'} not found for the ${kind} step.`,
  };
}

export async function runNextStep(
  workspacePath: string,
  team: ProjectTeam,
  opts: BullpenRunOptions,
): Promise<BullpenStepResult> {
  try {
    return await runNextStepInner(workspacePath, team, opts);
  } catch (err) {
    // A malformed task file (e.g. missing Iterations) or any unexpected error
    // becomes a surfaced error step rather than crashing the loop.
    return { ...emptyStep(), allDone: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // The step is over — nobody is working until the next call starts one.
    await writeActivity(workspacePath, null, null, null, null);
  }
}

async function runNextStepInner(
  workspacePath: string,
  team: ProjectTeam,
  opts: BullpenRunOptions,
): Promise<BullpenStepResult> {
  const name = await projectName(workspacePath);
  const tasks = await listTasks(workspacePath);
  if (tasks.length === 0) {
    return { ...emptyStep(), allDone: false, error: 'No tasks yet — approve a plan on The Whiteboard first.' };
  }

  const progress = await readPhaseProgress(workspacePath);
  const planTasks: PlanTask[] = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    kind: t.kind,
    phase: t.feature ?? 'Tasks',
  }));
  const action = decideNextAction(
    planTasks, progress, opts.testingCadence, opts.securityCadence, opts.opsCadence,
  );
  if (!action) {
    return emptyStep(); // every phase complete — the build is done.
  }
  const byId = (id?: string): TaskRef | undefined => tasks.find((t) => t.id === id);

  // Engine-managed local stack (#3b): bring a docker-compose stack UP once before the
  // build steps that exercise it — it then stays up (daemon-owned) across all dev/QA/
  // security steps and retries, so QA checks a RUNNING stack instead of cold-booting it
  // each time. Cached, best-effort: no compose file or no docker → '' (no-op).
  let stackNote = '';
  if (
    action.kind === 'dev' ||
    action.kind === 'qa' ||
    action.kind === 'security-task' ||
    action.kind === 'security-phase'
  ) {
    stackNote = await ensureStackUp(workspacePath);
  }

  let result: BullpenStepResult;
  switch (action.kind) {
    case 'dev': {
      const t = byId(action.taskId);
      result = t ? await devStep(workspacePath, team, name, t, opts, action.phase) : taskNotFoundStep('dev', action.taskId);
      break;
    }
    case 'qa': {
      const t = byId(action.taskId);
      if (t && opts.testingCadence === 'off') {
        // QA is off for this build. A task still sitting in 'done' — e.g. dev'd under a
        // QA-on cadence, then the cadence toggled to 'off' mid-build — is accepted as-is and
        // marked verified (mirrors devStep's 'off' branch), never QA'd. Skipping it instead
        // would strand a non-terminal 'done' task and stall the phase.
        result = await acceptTaskWithoutQa(workspacePath, t, action.phase, opts.namingMode);
      } else {
        result = t
          ? await qaStep(workspacePath, team, name, t.relPath, t.id, t.title, t.iterationsUsed, t.iterationBudget, opts.namingMode, action.phase)
          : taskNotFoundStep('qa', action.taskId);
      }
      break;
    }
    case 'security-task': {
      const t = byId(action.taskId);
      result = t ? await securityTaskStep(workspacePath, team, name, t, progress, action.phase, opts.namingMode) : taskNotFoundStep('security-task', action.taskId);
      break;
    }
    case 'security-phase':
      result = await securityPhaseStep(workspacePath, team, name, progress, action.phase, opts.namingMode);
      break;
    case 'architect':
      result = await architectStep(workspacePath, team, name, progress, action.phase, opts.namingMode);
      break;
    case 'ops':
      result = await opsStep(
        workspacePath, team, name, progress, action.phase, opts.namingMode,
        opts.opsCadence === 'endOfProject' ? 'project' : 'phase',
      );
      break;
    case 'celebrate':
      result = await celebrateStep(workspacePath, progress, action.phase, opts.namingMode);
      break;
  }

  // What the loop will do NEXT, computed from the freshly mutated task files +
  // phase progress (also used below so the celebrate teardown can tell a mere
  // phase-end from the END OF THE BUILD).
  const nextKind = await computeNextActionKind(workspacePath, opts);

  // The BUILD is done — spin the local stack down (only if we started it). Best-effort.
  // Only at the FINAL celebrate: tearing down at every phase's celebrate cold-restarted
  // the stack (image pulls, fresh containers) for the next phase's dev/QA steps.
  if (action.kind === 'celebrate' && nextKind === null) {
    const downNote = await stackDown(workspacePath);
    if (downNote) {
      result.log = result.log ? `${result.log}\n\n${downNote}` : downNote;
    }
  }
  // Surface the one-time "stack started/skipped" note on the step that triggered it.
  if (stackNote) {
    result.log = result.log ? `${stackNote}\n\n${result.log}` : stackNote;
  }

  // Version-control whatever this actor just wrote — a commit per step gives a
  // granular, revertible history (and makes the remediation/rollback loops safe).
  // Best-effort and non-blocking: gitTracker no-ops when tracking is off, git is
  // missing, the workspace isn't a repo, or nothing changed. FAILED steps commit
  // too (as an explicit snapshot) — a timed-out review can leave real workspace
  // mutations (its half-written review draft), and skipping the commit meant hours of
  // changes later landed in one unattributable sweep.
  if (result.actor !== null) {
    await commitWorkspaceStep(
      workspacePath,
      result.error
        ? `${bullpenCommitMessage(action, result)} [step failed — snapshot]`
        : bullpenCommitMessage(action, result),
    );
  }

  // Tell the renderer what the loop will do NEXT. One-step mode uses this to
  // auto-fire the phase-end review stages (security-phase → architect → ops →
  // celebrate) once a phase's tasks are done, instead of forcing a click for
  // each, while still pausing between tasks. Best-effort: a read hiccup leaves
  // it undefined and the renderer falls back to its status-based pausing.
  result.nextActionKind = nextKind;
  return result;
}

/** The kind of the next action after the current step's writes, or null when done. */
async function computeNextActionKind(
  workspacePath: string,
  opts: BullpenRunOptions,
): Promise<BullpenStepResult['nextActionKind']> {
  try {
    const tasks = await listTasks(workspacePath);
    const progress = await readPhaseProgress(workspacePath);
    const planTasks: PlanTask[] = tasks.map((t) => ({
      id: t.id,
      status: t.status,
      kind: t.kind,
      phase: t.feature ?? 'Tasks',
    }));
    const next = decideNextAction(
      planTasks, progress, opts.testingCadence, opts.securityCadence, opts.opsCadence,
    );
    return next ? next.kind : null;
  } catch {
    return undefined;
  }
}

/** Dinesh implements one task (then QA inline if testing is afterEachTask). */
async function devStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  devTask: TaskRef,
  opts: BullpenRunOptions,
  phaseName: string,
): Promise<BullpenStepResult> {
  // Human-setup tasks (cloud auth, accounts, secrets) can't be done by a
  // headless agent — hand them to the human with their checklist and pause.
  if (devTask.kind === 'human-setup') {
    return { ...(await handoffSetupTask(workspacePath, devTask)), phaseName };
  }
  const budgetLabel = `${devTask.iterationsUsed}/${devTask.iterationBudget}`;
  // Budget gate: the dev↔QA loop is exhausted.
  if (devTask.iterationsUsed >= devTask.iterationBudget) {
    await captureLesson(workspacePath, 'iteration-cap-hit', 'developer', devTask.title,
      `Failed QA ${devTask.iterationBudget} times.`);
    // Auto-remediate: a first-time task that burns its budget gets ONE fresh
    // remediation task seeded with its failing criteria, and is parked (blocked,
    // superseded) so the build keeps moving instead of stalling on a human gate.
    // A remediation task that ALSO exhausts its budget escalates to a human —
    // the one-level guard against retrying the same gap forever.
    if (!devTask.isRemediation) {
      // Park the original FIRST (blocked) so a mid-step write failure can't leave it
      // in-progress and re-trigger the budget gate into a DUPLICATE remediation task on the
      // next iteration (review L8). 'blocked' is terminal, so once this write lands the gate
      // won't fire again for it.
      await writeMarkdown(workspacePath, devTask.relPath, setTaskStatus(devTask.content, 'blocked'));
      const criteria = extractAcceptanceCriteria(devTask.content).map((c) => c.text);
      const remId = await createRemediationTask(
        workspacePath,
        phaseName,
        `Fix QA gaps: ${devTask.title}`,
        [
          `${devTask.id} "${devTask.title}" failed QA ${devTask.iterationBudget} times — its acceptance criteria are still not met.`,
          'Re-implement it in the current directory. The previous attempt is in place; read reviews/qa-review.md for the exact criteria Big Head marked as gaps and focus on those.',
        ].join('\n'),
        criteria.length > 0 ? criteria : ['The task\'s acceptance criteria are met'],
      );
      if (remId) {
        return {
          allDone: false, taskId: devTask.id, taskTitle: devTask.title, actor: 'qa',
          status: 'blocked',
          log: `${devTask.title} failed QA ${devTask.iterationBudget} times. Created remediation task ${remId} (fresh budget) with the failing acceptance criteria; parked this one as superseded.`,
          passed: false, escalated: false, iterations: budgetLabel, error: null,
          banter: banterFor('qa', 'disappointed', opts.namingMode), phaseName,
        };
      }
      // Couldn't create the remediation task — fall through to a human escalation.
    }
    const esc = await escalateTask(
      workspacePath, devTask.content, devTask.relPath, devTask.id, devTask.title,
      'qa', 'iteration-cap-hit',
      `${devTask.title} failed QA ${devTask.iterationBudget} times.`,
      'Developer reimplemented; QA still failed.', budgetLabel,
    );
    return { ...esc, banter: banterFor('qa', 'disappointed', opts.namingMode), phaseName };
  }

  // Mark in-progress and run Dinesh. A hard CLI error is its own escalation
  // path — it does NOT burn a QA iteration.
  const inProgress = setTaskStatus(devTask.content, 'in-progress');
  await writeMarkdown(workspacePath, devTask.relPath, inProgress);
  await writeActivity(workspacePath, 'developer', devTask.id, devTask.title, phaseName);
  const dev = await invokeRole(
    workspacePath,
    'developer',
    team,
    devPrompt(name, devTask.content) +
      customRoleBlock(team, 'developer', workspacePath, name, {
        taskId: devTask.id,
        taskTitle: devTask.title,
        phaseName,
      }) +
      (await roleContextBlocks(workspacePath, 'developer')),
  );
  await recordTelemetry(workspacePath, {
    roleId: 'developer', cliName: dev.cliName, command: dev.command, taskId: devTask.id,
    durationMs: dev.durationMs, iterations: devTask.iterationsUsed + 1,
    status: dev.ok || dev.timedOut ? 'in-progress' : 'error', ok: dev.ok, at: new Date().toISOString(),
  });
  // A hard CLI error (crash, not installed, immediate non-zero exit) genuinely
  // needs a human. A TIMEOUT is different: the agent was actively working and
  // almost certainly wrote files (and we now forbid blocking dev servers), so
  // don't throw that work away — count the attempt and let QA judge what landed.
  if (!dev.ok && !dev.timedOut) {
    await captureLesson(workspacePath, 'dev-crash', 'developer', devTask.title, dev.error ?? undefined);
    // An auth failure (signed out / expired token) is a common mid-build dead-end — the
    // escalation now says "re-authenticate" instead of leaving the founder to retry a dead token.
    const esc = await escalateTask(
      workspacePath, inProgress, devTask.relPath, devTask.id, devTask.title,
      'developer', 'other',
      cliErrorEscalationText('developer', dev.cliName, dev.error),
      'Ran the developer agent in autopilot.', null,
    );
    return { ...esc, banter: banterFor('developer', 'disappointed', opts.namingMode), phaseName };
  }

  // Dev succeeded (or ran long and got cut off mid-work) — count this attempt.
  const ranLong = !dev.ok && dev.timedOut;
  const counted = incrementTaskIterations(inProgress);
  await writeMarkdown(workspacePath, devTask.relPath, counted);
  const nextLabel = `${devTask.iterationsUsed + 1}/${devTask.iterationBudget}`;
  const devOutput = ranLong
    ? `${dev.output}\n\n[Dinesh ran long and was cut off; handing off what landed for QA to judge.]`
    : dev.output;

  if (opts.testingCadence === 'off') {
    // QA disabled — Dinesh's work is accepted as-is (no Big Head, no retry loop).
    await writeMarkdown(workspacePath, devTask.relPath, setTaskStatus(counted, 'verified'));
    return {
      allDone: false, taskId: devTask.id, taskTitle: devTask.title, actor: 'developer',
      status: 'verified', log: devOutput, passed: null, escalated: false, iterations: nextLabel, error: null,
      banter: banterFor('developer', 'neutral', opts.namingMode), phaseName,
    };
  }

  // Dinesh's build is its OWN step. Mark the task 'done' and let the QA gate pick
  // it up as a separate step — afterEachTask QAs it immediately (the decision logic
  // QAs a 'done' task before devving the next), endOfPhase batches QA at the end.
  // This keeps Dev, QA, Security, and Architect as distinct rows in the build log.
  await writeMarkdown(workspacePath, devTask.relPath, setTaskStatus(counted, 'done'));
  return {
    allDone: false, taskId: devTask.id, taskTitle: devTask.title, actor: 'developer',
    status: 'done', log: devOutput, passed: null, escalated: false, iterations: nextLabel, error: null,
    banter: banterFor('developer', 'neutral', opts.namingMode), phaseName,
  };
}

/**
 * C1 Decision #8 — a required verification gate failed (doesn't compile / tests red): bounce
 * the task back to dev with the machine-readable gate output as feedback, WITHOUT a QA-CLI
 * call. Mirrors a QA-fail bounce (status in-progress), so the dev↔QA budget + remediation loop
 * behave exactly as for a normal fail; the dev reads reviews/qa-review.md for what broke.
 */
async function gateFailStep(
  workspacePath: string,
  relPath: string,
  taskContent: string,
  taskId: string,
  taskTitle: string,
  iterationsUsed: number,
  iterationBudget: number,
  namingMode: NamingMode,
  phaseName: string,
  report: GateReport,
  gateLine: string,
): Promise<BullpenStepResult> {
  const failed = report.results.filter((r) => r.required && !r.skipped && !r.passed);
  const detail = failed
    .map((r) => `### ${r.label}${r.timedOut ? ' (timed out)' : ''}\n${r.outputTail.trim() || '(no output)'}`)
    .join('\n\n');
  const feedback = `Objective verification gates failed — fix these before QA reviews the task:\n\n${detail}`;

  // (Telemetry for this gate run was already recorded by qaStep before the short-circuit.)
  await writeMarkdown(workspacePath, relPath, setTaskStatus(taskContent, 'in-progress'));
  try {
    const prior = await readMarkdown(workspacePath, 'reviews/qa-review.md').catch(() => '# QA Review\n');
    const note = [
      prior.trimEnd(), '',
      `## ${taskId} — attempt ${iterationsUsed}/${iterationBudget} — GATE FAIL`,
      `_${new Date().toISOString()}_`, '',
      gateLine, '', detail, '',
    ].join('\n');
    await writeMarkdown(workspacePath, 'reviews/qa-review.md', note);
  } catch {
    // Diagnostics are best-effort; never let them break the step.
  }
  return {
    allDone: false, taskId, taskTitle, actor: 'qa', status: 'in-progress',
    log: `${gateLine}\n\n${feedback}`, passed: false, escalated: false,
    iterations: `${iterationsUsed}/${iterationBudget}`, error: null,
    banter: banterFor('qa', 'disappointed', namingMode), phaseName,
  };
}

async function qaStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  relPath: string,
  taskId: string,
  taskTitle: string,
  iterationsUsed: number,
  iterationBudget: number,
  namingMode: NamingMode,
  phaseName: string,
): Promise<BullpenStepResult> {
  const taskContent = await readMarkdown(workspacePath, relPath).catch(() => '');
  await writeActivity(workspacePath, 'qa', taskId, taskTitle, phaseName);

  // C1 — the OBJECTIVE verification floor runs FIRST, owned by the harness (not the QA CLI's
  // self-report). The local stack is already up (stackManager ran earlier in runNextStepInner),
  // so build/test gates hit a live DB. Best-effort; byte-identical when the toggle is off or
  // no gate is detectable (ranAny:false).
  const gatesEnabled =
    (await readProjectInfo(workspacePath).catch(() => null))?.verificationGates !== false;
  const report: GateReport = gatesEnabled
    ? await runGates(workspacePath)
    : { results: [], allRequiredPassed: true, ranAny: false, totalDurationMs: 0 };
  const gateLine = formatGateSummary(report);
  // R3 — gate cost is observable: one telemetry entry per gate run (real wall-clock), so
  // The Garage + the ADR §10 questions (which gates fire, what they cost) are answerable.
  if (report.ranAny) {
    await recordTelemetry(workspacePath, {
      roleId: 'qa', cliName: 'gates', command: 'verification-gates', taskId,
      durationMs: report.totalDurationMs, iterations: iterationsUsed,
      status: report.allRequiredPassed ? 'review' : 'in-progress',
      ok: report.allRequiredPassed, at: new Date().toISOString(),
    });
  }

  // Decision #8 — a required gate failed (doesn't compile / tests red): short-circuit straight
  // back to dev with the machine-readable gate output, WITHOUT spending a QA-CLI call reviewing
  // code that can't build. Deterministic + faster; drains the agy-stall class for objective checks.
  if (report.ranAny && !report.allRequiredPassed) {
    return await gateFailStep(
      workspacePath, relPath, taskContent, taskId, taskTitle,
      iterationsUsed, iterationBudget, namingMode, phaseName, report, gateLine,
    );
  }

  const qa = await invokeRole(
    workspacePath,
    'qa',
    team,
    qaPrompt(name, taskContent) +
      customRoleBlock(team, 'qa', workspacePath, name, { taskId, taskTitle, phaseName }) +
      (await roleContextBlocks(workspacePath, 'qa')),
  );
  // A QA-CLI error (or no parseable verdict) means QA COULDN'T VERIFY — treat
  // that as indeterminate, not as a code failure. When QA gives per-criterion
  // verdicts, ANY 'gap' forces a fail even if it claimed an overall PASS (prove,
  // don't claim); with no per-criterion data the overall verdict stands. C1 folds in the
  // objective floor: a green floor is authoritative evidence the code is sound (gatesGreen).
  const overall: 'pass' | 'fail' | 'indeterminate' = qa.ok ? parseVerdict(qa.output) : 'indeterminate';
  const criterionVerdicts = qa.ok ? parseCriterionVerdicts(qa.output) : {};
  const { verdict, gaps, gatesGreen: floorGreen } = combineGateAndQaVerdict(report, overall, criterionVerdicts);
  // A floor where every required gate merely TIMED OUT is not evidence: timed-out
  // gates degrade to advisory for the fail short-circuit (a hang must never read as
  // a FAIL), but the CALMER "objective checks pass" framing needs at least one gate
  // that actually RAN and PASSED — else it claims "Objective checks () PASS".
  const gatesGreen =
    floorGreen && report.results.some((r) => !r.skipped && !r.timedOut && r.passed);
  // Each uncovered criterion is a lesson for the developer — captured even when the task
  // later passes within budget, so a recurring "leaves ACn a gap" pattern can elevate.
  // The lesson key carries the TASK TITLE: bare positional ACn ids collide across
  // unrelated tasks/projects, so three unrelated gaps could confirm a meaningless lesson.
  for (const gapId of gaps) {
    await captureLesson(workspacePath, 'qa-gap', 'developer', `${taskTitle}: ${gapId}`);
  }
  const status = verdict === 'pass' ? 'verified' : verdict === 'fail' ? 'in-progress' : 'human-needed';

  await recordTelemetry(workspacePath, {
    roleId: 'qa', cliName: qa.cliName, command: qa.command, taskId,
    durationMs: qa.durationMs, iterations: iterationsUsed, status,
    ok: qa.ok, at: new Date().toISOString(),
  });
  // Persist Big Head's verdict + reasoning so it's diagnosable from disk (the
  // build-log entry is renderer-only).
  try {
    const prior = await readMarkdown(workspacePath, 'reviews/qa-review.md').catch(() => '# QA Review\n');
    const body = (qa.ok ? qa.output : (qa.error ?? '(no output)')).trim().slice(0, 4000);
    const criteriaTable = Object.entries(criterionVerdicts);
    const note = [
      prior.trimEnd(),
      '',
      `## ${taskId} — attempt ${iterationsUsed}/${iterationBudget} — ${verdict.toUpperCase()}${qa.ok ? '' : ' (CLI error)'}`,
      `_${new Date().toISOString()}_`,
      '',
      ...(gateLine ? [gateLine, ''] : []),
      ...(criteriaTable.length > 0
        ? [
            '| Criterion | Verdict |',
            '| --- | --- |',
            ...criteriaTable.map(([id, v]) => `| ${id} | ${v} |`),
            ...(gaps.length > 0 ? ['', `Gaps: ${gaps.join(', ')}`] : []),
            '',
          ]
        : []),
      body === '' ? '(no output)' : body,
      '',
    ].join('\n');
    await writeMarkdown(workspacePath, 'reviews/qa-review.md', note);
  } catch {
    // Diagnostics are best-effort; never let them break the QA step.
  }

  // Indeterminate = QA ran but gave no usable PASS/FAIL (usually an EMPTY
  // response from a CLI that needs a terminal/PTY, e.g. Antigravity one-shot).
  // This is NOT the code failing — don't silently pass it, and don't burn the
  // dev budget looping on a phantom fail. Pause for the human with a fix.
  if (verdict === 'indeterminate') {
    await captureLesson(workspacePath, 'qa-indeterminate', 'qa', taskTitle);
    const raw = (qa.ok ? qa.output : (qa.error ?? '')).trim();
    const why =
      raw === ''
        ? `${qa.cliName} returned no output — most often the CLI isn't signed in (some print nothing headless when they need a login), isn't installed for this role, or stalled before finishing (e.g. waiting on a long step like a Docker image pull).`
        : `${qa.cliName} ran but never printed a clear PASS/FAIL verdict — it most likely timed out or stopped mid-run before reaching one.`;
    // Decision #7 — when the OBJECTIVE floor is green, downgrade the alarm: there's real
    // evidence the code is sound (it compiles / builds / tests pass); QA just gave no clear
    // SEMANTIC read. Calmer framing, without overclaiming a PASS the model never gave.
    const opener = gatesGreen
      ? `Objective checks (${report.results.filter((r) => !r.skipped && r.passed).map((r) => r.label).join(', ')}) PASS, but QA gave no clear semantic read. ${why}`
      : `QA couldn't verify this task. ${why}`;
    const context = [
      opener,
      '',
      "This is NOT a confirmed test failure — QA just produced no usable result. Three ways forward:",
      '  • Redo QA — re-run the QA agent on this task (best if it was a transient stall).',
      "  • Verify it yourself against the task's Acceptance Criteria below, then Mark done.",
      '  • Read reviews/qa-review.md for exactly what QA output.',
    ].join('\n');
    const esc = await escalateTask(
      workspacePath, taskContent, relPath, taskId, taskTitle,
      'qa', 'other', context, 'Ran the QA agent; got no usable verdict.', null,
    );
    // Surface what QA actually said in the build log (not only in qa-review.md),
    // plus the acceptance criteria the human needs to confirm by hand.
    const criteria = extractAcceptanceCriteria(taskContent)
      .map((c) => `  [${c.id}] ${c.text}`)
      .join('\n');
    const tail = raw === '' ? '' : `\n\n--- What QA actually output (tail) ---\n${raw.slice(-1500)}`;
    const acList = criteria === '' ? '' : `\n\n--- Acceptance Criteria to confirm ---\n${criteria}`;
    return {
      ...esc,
      log: `${gateLine ? `${gateLine}\n\n` : ''}${context}${acList}${tail}`,
      banter: banterFor('qa', 'neutral', namingMode),
      phaseName,
    };
  }

  const passed = verdict === 'pass';
  await writeMarkdown(workspacePath, relPath, setTaskStatus(taskContent, status));
  // Dinesh's build is its own prior step, so QA's log is just its own output —
  // with the objective gate summary prepended when gates ran.
  return {
    allDone: false, taskId, taskTitle, actor: 'qa', status,
    log: gateLine ? `${gateLine}\n\n${qa.output}` : qa.output,
    passed, escalated: false, iterations: `${iterationsUsed}/${iterationBudget}`,
    error: null,
    banter: banterFor('qa', passed ? 'good' : 'disappointed', namingMode), phaseName,
  };
}

/**
 * Accept a task without running QA — used only when testingCadence is 'off' and a task is still
 * in 'done' (e.g. it was dev'd under a QA-on cadence, then the cadence was toggled to 'off'
 * mid-build). Marks it verified as-is, mirroring devStep's 'off' branch, so the phase can complete
 * instead of stranding a non-terminal 'done' task. Byte-identical to devStep's 'off' outcome.
 */
async function acceptTaskWithoutQa(
  workspacePath: string,
  task: TaskRef,
  phaseName: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  await writeMarkdown(workspacePath, task.relPath, setTaskStatus(task.content, 'verified'));
  return {
    allDone: false, taskId: task.id, taskTitle: task.title, actor: 'developer',
    status: 'verified',
    log: 'QA is off for this build — accepted as-is (no test run).',
    passed: null, escalated: false, iterations: null, error: null,
    banter: banterFor('developer', 'neutral', namingMode), phaseName,
  };
}

/** Gilfoyle reviews one task (afterEachTask security cadence). */
async function securityTaskStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  task: TaskRef,
  progress: PhaseProgressMap,
  phaseName: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  const reviewer = hasReviewer(team, 'security');
  let sec: CliInvocation | null = null;
  if (reviewer) {
    await writeActivity(workspacePath, 'security', task.id, task.title, phaseName);
    sec = await invokeRole(
      workspacePath,
      'security',
      team,
      securityTaskPrompt(name, task.content, await reproBackedFindingsEnabled(workspacePath)) +
        customRoleBlock(team, 'security', workspacePath, name, {
          taskId: task.id,
          taskTitle: task.title,
          phaseName,
        }) +
        (await roleContextBlocks(workspacePath, 'security')) +
        (await dispositionedFindingsBlock(workspacePath)),
    );
    await recordTelemetry(workspacePath, {
      roleId: 'security', cliName: sec.cliName, command: sec.command, taskId: task.id,
      durationMs: sec.durationMs, iterations: null, status: 'review', ok: sec.ok, at: new Date().toISOString(),
    });
  }
  const taskTitle = `Security · ${task.title}`;
  // Configured reviewer that failed → escalate + pause; never mark secured.
  if (gateOutcome(reviewer, sec?.ok ?? false) === 'escalate') {
    return escalateGate(
      workspacePath, 'security', phaseName, taskTitle,
      sec?.error ?? 'the security CLI failed', namingMode,
    );
  }
  // Exit-0 with an EMPTY reply = the review never actually ran (a signed-out or
  // stalled CLI) — escalate rather than record a pass with nothing to prove it.
  if (reviewIndeterminate(sec)) {
    return escalateGate(
      workspacePath, 'security', phaseName, taskTitle,
      'the security review produced no output — treated as not run (likely a signed-out or stalled CLI)',
      namingMode,
    );
  }
  // pass (reviewed OK) or skip (no reviewer assigned) → record + advance.
  const prog = progress[phaseName] ?? emptyPhaseProgress();
  if (!prog.securedTaskIds.includes(task.id)) {
    prog.securedTaskIds.push(task.id);
  }
  progress[phaseName] = prog;
  await writePhaseProgress(workspacePath, progress);
  // A passing per-task review resolves any open gate escalation for this phase
  // (mirrors the three phase-level gates — without this, an escalation this step
  // opened earlier lingered 'open' in ESCALATIONS.md forever after recovery).
  await resolveGateEscalation(workspacePath, 'security', phaseName);
  if (!reviewer) {
    return { ...gateSkippedStep('security', phaseName, taskTitle), taskId: task.id };
  }
  // High/critical findings → remediation tasks the loop picks up. Skip when the
  // reviewed task is ITSELF a remediation task (one-level guard, no fix loops).
  const surface =
    sec?.ok && !task.isRemediation
      ? await remediateSecurityFindings(workspacePath, phaseName, sec.output, `task ${task.id} (${task.title})`)
      : '';
  return {
    allDone: false, taskId: task.id, taskTitle, actor: 'security',
    status: 'verified', log: (sec?.output ?? '') + surface, passed: true, escalated: false,
    iterations: null, error: null, banter: banterFor('security', 'good', namingMode), phaseName,
  };
}

/** Gilfoyle reviews the whole phase (endOfPhase security cadence). */
async function securityPhaseStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  progress: PhaseProgressMap,
  phaseName: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  const reviewer = hasReviewer(team, 'security');
  let sec: CliInvocation | null = null;
  if (reviewer) {
    await writeActivity(workspacePath, 'security', null, null, phaseName);
    sec = await invokeRole(
      workspacePath,
      'security',
      team,
      securityPhasePrompt(name, phaseName, await reproBackedFindingsEnabled(workspacePath)) +
        customRoleBlock(team, 'security', workspacePath, name, { phaseName }) +
        (await roleContextBlocks(workspacePath, 'security')) +
        (await dispositionedFindingsBlock(workspacePath)),
    );
    await recordTelemetry(workspacePath, {
      roleId: 'security', cliName: sec.cliName, command: sec.command, taskId: null,
      durationMs: sec.durationMs, iterations: null, status: 'review', ok: sec.ok, at: new Date().toISOString(),
    });
  }
  const taskTitle = `Security review · ${phaseName}`;
  if (gateOutcome(reviewer, sec?.ok ?? false) === 'escalate') {
    return escalateGate(
      workspacePath, 'security', phaseName, taskTitle,
      sec?.error ?? 'the security CLI failed', namingMode,
    );
  }
  // An ok-but-EMPTY reply is a review that never ran — never mark securityDone on it.
  if (reviewIndeterminate(sec)) {
    return escalateGate(
      workspacePath, 'security', phaseName, taskTitle,
      'the security review produced no output — treated as not run (likely a signed-out or stalled CLI)',
      namingMode,
    );
  }
  const prog = progress[phaseName] ?? emptyPhaseProgress();
  prog.securityDone = true;
  progress[phaseName] = prog;
  await writePhaseProgress(workspacePath, progress);
  await resolveGateEscalation(workspacePath, 'security', phaseName);
  if (!reviewer) {
    return gateSkippedStep('security', phaseName, taskTitle);
  }
  // High/critical findings → remediation tasks. The phase review runs once
  // (securityDone is now set), so the fix tasks build before the architect gate
  // and the loop can't re-spawn from the same findings.
  const surface = sec?.ok
    ? await remediateSecurityFindings(workspacePath, phaseName, sec.output, `phase "${phaseName}"`)
    : '';
  return {
    allDone: false, taskId: null, taskTitle, actor: 'security',
    status: 'review', log: (sec?.output ?? '') + surface, passed: true, escalated: false,
    iterations: null, error: null, banter: banterFor('security', 'good', namingMode), phaseName,
  };
}

/** Richard reviews the phase's design (always end-of-phase, non-negotiable). */
async function architectStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  progress: PhaseProgressMap,
  phaseName: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  const reviewer = hasReviewer(team, 'architect');
  let arch: CliInvocation | null = null;
  if (reviewer) {
    await writeActivity(workspacePath, 'architect', null, null, phaseName);
    arch = await invokeRole(
      workspacePath,
      'architect',
      team,
      architectReviewPrompt(name, phaseName, await reproBackedFindingsEnabled(workspacePath)) +
        customRoleBlock(team, 'architect', workspacePath, name, { phaseName }) +
        (await roleContextBlocks(workspacePath, 'architect')) +
        (await dispositionedFindingsBlock(workspacePath)),
    );
    await recordTelemetry(workspacePath, {
      roleId: 'architect', cliName: arch.cliName, command: arch.command, taskId: null,
      durationMs: arch.durationMs, iterations: null, status: 'review', ok: arch.ok, at: new Date().toISOString(),
    });
  }
  const taskTitle = `Architecture review · ${phaseName}`;
  if (gateOutcome(reviewer, arch?.ok ?? false) === 'escalate') {
    return escalateGate(
      workspacePath, 'architect', phaseName, taskTitle,
      arch?.error ?? 'the architect CLI failed', namingMode,
    );
  }
  // An ok-but-EMPTY reply is a review that never ran — never mark architectDone on it.
  if (reviewIndeterminate(arch)) {
    return escalateGate(
      workspacePath, 'architect', phaseName, taskTitle,
      'the architecture review produced no output — treated as not run (likely a signed-out or stalled CLI)',
      namingMode,
    );
  }
  const prog = progress[phaseName] ?? emptyPhaseProgress();
  prog.architectDone = true;
  progress[phaseName] = prog;
  await writePhaseProgress(workspacePath, progress);
  await resolveGateEscalation(workspacePath, 'architect', phaseName);
  if (!reviewer) {
    return gateSkippedStep('architect', phaseName, taskTitle);
  }
  // Every finding Richard wants addressed → a follow-up task in this phase, so none
  // slip through. The decision engine builds them (they're todo) before the phase
  // closes; architectDone is set, so the gate won't re-run and can't loop.
  const surface = arch?.ok
    ? await remediateArchitectFindings(workspacePath, phaseName, arch.output, `phase "${phaseName}"`)
    : '';
  return {
    allDone: false, taskId: null, taskTitle, actor: 'architect',
    status: 'review', log: (arch?.output ?? '') + surface, passed: true, escalated: false,
    iterations: null, error: null, phaseName,
  };
}

/**
 * Jared's documentation pass. Per-phase (endOfPhase) documents that phase; the
 * end-of-project pass documents the whole build (tracked on the final phase).
 * Same gate model as the other reviewers: skip if no Ops CLI, escalate on failure.
 */
async function opsStep(
  workspacePath: string,
  team: ProjectTeam,
  name: string,
  progress: PhaseProgressMap,
  phaseName: string,
  namingMode: NamingMode,
  scope: 'phase' | 'project',
): Promise<BullpenStepResult> {
  const reviewer = hasReviewer(team, 'ops');
  let ops: CliInvocation | null = null;
  if (reviewer) {
    await writeActivity(workspacePath, 'ops', null, null, phaseName);
    ops = await invokeRole(
      workspacePath,
      'ops',
      team,
      opsDocsPrompt(name, phaseName, scope) +
        customRoleBlock(team, 'ops', workspacePath, name, { phaseName }) +
        (await roleContextBlocks(workspacePath, 'ops')),
    );
    await recordTelemetry(workspacePath, {
      roleId: 'ops', cliName: ops.cliName, command: ops.command, taskId: null,
      durationMs: ops.durationMs, iterations: null, status: 'review', ok: ops.ok, at: new Date().toISOString(),
    });
  }
  const taskTitle = scope === 'project' ? `Documentation · ${name}` : `Documentation · ${phaseName}`;
  if (gateOutcome(reviewer, ops?.ok ?? false) === 'escalate') {
    return escalateGate(
      workspacePath, 'ops', phaseName, taskTitle,
      ops?.error ?? 'the ops CLI failed', namingMode,
    );
  }
  // An ok-but-EMPTY reply is a docs pass that never ran — never mark opsDone on it.
  if (reviewIndeterminate(ops)) {
    return escalateGate(
      workspacePath, 'ops', phaseName, taskTitle,
      'the documentation pass produced no output — treated as not run (likely a signed-out or stalled CLI)',
      namingMode,
    );
  }
  const prog = progress[phaseName] ?? emptyPhaseProgress();
  prog.opsDone = true;
  progress[phaseName] = prog;
  await writePhaseProgress(workspacePath, progress);
  await resolveGateEscalation(workspacePath, 'ops', phaseName);
  if (!reviewer) {
    return gateSkippedStep('ops', phaseName, taskTitle);
  }
  return {
    allDone: false, taskId: null, taskTitle, actor: 'ops',
    status: 'review', log: ops?.output ?? '', passed: true, escalated: false,
    iterations: null, error: null, banter: banterFor('ops', 'good', namingMode), phaseName,
  };
}

/** Phase done: Jared pipes in, and a random advisor chimes in (both canned). */
async function celebrateStep(
  workspacePath: string,
  progress: PhaseProgressMap,
  phaseName: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  const prog = progress[phaseName] ?? emptyPhaseProgress();
  prog.celebrated = true;
  progress[phaseName] = prog;
  await writePhaseProgress(workspacePath, progress);
  // When Jian Yang has taken over the company, he is the advisor too.
  const advisoryId =
    jianYangTakeoverActive()
      ? 'jian-yang'
      : ADVISORY_PERSONA_IDS[Math.floor(Math.random() * ADVISORY_PERSONA_IDS.length)] ?? '';
  return {
    allDone: false, taskId: null, taskTitle: `Phase complete · ${phaseName}`, actor: 'ops',
    status: 'verified', log: '', passed: true, escalated: false, iterations: null, error: null,
    banter: banterFor('ops', 'good', namingMode),
    advisory: advisoryId ? { personaId: advisoryId, line: pickBanter(advisoryId, 'good') } : null,
    phaseName,
  };
}

export async function runSecurity(
  workspacePath: string,
  team: ProjectTeam,
): Promise<SecurityResult> {
  const name = await projectName(workspacePath);
  // Honor the project's repro-backed-findings flag so the prompt's FINDING contract matches
  // what the remediation gate will do with the findings.
  const reproBacked = (await readProjectInfo(workspacePath).catch(() => null))?.reproBackedFindings === true;
  const sec = await invokeRole(
    workspacePath,
    'security',
    team,
    securityPrompt(name, reproBacked) +
      customRoleBlock(team, 'security', workspacePath, name) +
      (await roleContextBlocks(workspacePath, 'security')),
  );
  await recordTelemetry(workspacePath, {
    roleId: 'security',
    cliName: sec.cliName,
    command: sec.command,
    taskId: null,
    durationMs: sec.durationMs,
    iterations: null,
    status: 'review',
    ok: sec.ok,
    at: new Date().toISOString(),
  });
  // Route the findings through the SAME remediation pipeline the gated security uses — so a
  // manual sweep's findings become real fix tasks (scope-gated, deduped, never-drop) instead of
  // vanishing into a display-only report. Post-completion, so they land in the
  // active/last phase (activePhaseOf reopens it). Best-effort — never break the manual run.
  let remediation = '';
  if (sec.ok) {
    try {
      const tasks = await listTasks(workspacePath);
      const planTasks: PlanTask[] = tasks.map((t) => ({
        id: t.id,
        status: t.status,
        kind: t.kind,
        phase: t.feature ?? 'Tasks',
      }));
      const phase = activePhaseOf(planTasks) ?? 'Tasks';
      remediation = await remediateSecurityFindings(
        workspacePath,
        phase,
        sec.output,
        'the manual security review',
      );
    } catch {
      /* best-effort — a remediation failure never breaks the manual sweep */
    }
  }
  return { ok: sec.ok, log: sec.output, error: sec.error, remediation };
}

