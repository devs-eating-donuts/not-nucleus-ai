import type { BullpenStepResult } from '../../../shared/bullpen';
import type { RunStatus, RunSummary } from '../../../shared/run';
import type { AppState, StoreCtx } from '../appStoreShared';
import { hasBridge } from '../appStoreShared';

type BullpenSlice = Pick<
  AppState,
  | 'setBullpenCadence'
  | 'setBullpenSecurityCadence'
  | 'setBullpenOpsCadence'
  | 'setBullpenMode'
  | 'stopBullpen'
  | 'handToDinesh'
  | 'resolveSetupTask'
  | 'redoQa'
  | 'startBullpen'
  | 'runBullpenSecurity'
  | 'loadGarageTelemetry'
  | 'loadGarageInvocations'
  | 'hydrateBullpenLog'
  | 'loadRuns'
  | 'loadDashboardStats'
  | 'openRunDetail'
  | 'deleteRunRecord'
  | 'resumeRun'
  | 'reconcileInterruptedRuns'
>;

/** The Bullpen build loop + its cadence/mode controls, plus The Garage (telemetry /
 *  invocations) and Run History, which the loop drives. */
export function createBullpenSlice({ set, get }: StoreCtx): BullpenSlice {
  return {
    setBullpenCadence: (bullpenCadence) => set({ bullpenCadence }),
    setBullpenSecurityCadence: (bullpenSecurityCadence) => set({ bullpenSecurityCadence }),
    setBullpenOpsCadence: (bullpenOpsCadence) => set({ bullpenOpsCadence }),
    setBullpenMode: (bullpenMode) => set({ bullpenMode }),

    stopBullpen: () => set({ bullpenStopRequested: true }),

    handToDinesh: async () => {
      const id = get().activeProject?.registry.id;
      if (!id || !hasBridge()) {
        return { ok: false, taskId: null, error: 'No active project.' };
      }
      // Re-handing off mid-build would delete the task file the running loop is
      // actively working (buildRipItTasks rewrites the plan) — same two-autopilot-
      // writers rule as the E3/intervention guards.
      if (get().bullpenRunning) {
        return {
          ok: false,
          taskId: null,
          error: 'The build is already running — stop The Bullpen before handing off again.',
        };
      }
      const res = await window.nucleus.ripIt.build(id);
      if (!res.ok) {
        return res;
      }
      // Force the express cadences (no QA / security / ops gates) + autopilot, then
      // run the build. The blanked rip-it team makes the review gates skip anyway;
      // the off cadences keep Big Head/Gilfoyle out of the loop entirely.
      set({
        bullpenCadence: 'off',
        bullpenSecurityCadence: 'off',
        bullpenOpsCadence: 'off',
        bullpenMode: 'autopilot',
        bullpenSteps: [],
        bullpenComplete: false,
        bullpenEscalated: false,
        page: 'bullpen',
      });
      void get().startBullpen();
      return res;
    },

    resolveSetupTask: async (taskId, founderNote) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      try {
        const result = await window.nucleus.bullpen.resolveTask(active.registry.id, taskId, founderNote);
        if (!result.ok) {
          // A failed Mark-done used to be a silent no-op — the button looked dead.
          set({ bullpenError: result.error ?? `Could not mark ${taskId} done.` });
          return;
        }
        // Reflect the new status (verified) on the board; clear the pause flag
        // so the banner goes away once the human has handled it.
        await get().loadWhiteboardPlan();
        set({ bullpenEscalated: false, bullpenError: null });
      } catch (err) {
        set({ bullpenError: err instanceof Error ? err.message : String(err) });
      }
    },

    redoQa: async (taskId) => {
      const active = get().activeProject;
      if (!active || !hasBridge() || get().bullpenRunning) {
        return;
      }
      const result = await window.nucleus.bullpen.requeueQa(active.registry.id, taskId);
      if (!result.ok) {
        // e.g. a manual-setup task has nothing for QA to test — surface why.
        set({ bullpenError: result.error ?? 'Could not re-queue QA for this task.' });
        return;
      }
      // The task is back to 'done' (awaiting QA) and its escalation is resolved.
      // Clear the pause flags and run the loop — the decision engine QAs it next.
      set({ bullpenEscalated: false, bullpenError: null });
      await get().loadWhiteboardPlan();
      await get().startBullpen();
    },

    startBullpen: async () => {
      const active = get().activeProject;
      // Don't start the autonomous loop while an intervention chat turn is mid-flight — both
      // run an autopilot CLI in the workspace and would collide (symmetric to the bullpenRunning
      // guard in sendInterventionMessage; narrow because the tabs are mutually exclusive in the UI).
      // Also block while a Punch List turn is in flight (E3 — symmetric to sendWorkRequest's
      // bullpenRunning guard; both allocate task numbers in the same workspace).
      if (
        !active ||
        !hasBridge() ||
        get().bullpenRunning ||
        get().interventionSendingKey !== null ||
        get().workRequestSending
      ) {
        return;
      }
      const manual = get().bullpenMode === 'manual';
      set({
        bullpenRunning: true,
        bullpenStopRequested: false,
        // The build log is the project's durable history (like the room chats) —
        // never wiped on start or resume. New steps append to what's already on
        // screen (hydrated from the per-run records on Bullpen entry), so a resume
        // no longer blanks everything done before it.
        bullpenComplete: false,
        bullpenEscalated: false,
        bullpenStoppedAtCap: false,
        // A fresh start / resume clears the "last build interrupted" banner — this run
        // supersedes it (a resume continues exactly the interrupted build's task state).
        bullpenInterrupted: null,
        bullpenError: null,
        bullpenActivity: null,
        securityResult: null,
        garageTelemetry: null,
      });
      // Rip-it projects seat only Stakeholder + Developer (QA / Security / Ops are blanked),
      // so their cadences MUST be off. Derive that from the project itself — NOT transient
      // store state — so a resumed or re-entered rip-it build doesn't run QA against a blank
      // seat and dead-end on an unresolvable escalation (review M2). handToDinesh also sets
      // these for the first run; this makes every subsequent start (resume, re-enter) correct.
      const isRipIt = active.info?.ripIt === true;
      const cadence = isRipIt ? 'off' : get().bullpenCadence;
      const securityCadence = isRipIt ? 'off' : get().bullpenSecurityCadence;
      const opsCadence = isRipIt ? 'off' : get().bullpenOpsCadence;
      const runProjectId = active.registry.id;
      const runProjectName = active.registry.name;

      // Run history (Step 8): continue an open manual run, else open a fresh
      // record. A pending "Resume" links the new run to the one it continues.
      // History is best-effort — a failure here never blocks the build.
      const resumeFrom = get().resumeFromRunId;
      let runId: string | null = manual && !resumeFrom ? get().currentRunId : null;
      if (!runId) {
        const prior = get().currentRunId;
        if (prior) {
          void window.nucleus.run.finish(runProjectId, prior, 'stopped').catch(() => undefined);
        }
        try {
          const rec = await window.nucleus.run.start({
            projectId: runProjectId,
            mode: get().bullpenMode,
            cadence: { testing: cadence, security: securityCadence },
            resumedFromRunId: resumeFrom,
          });
          runId = rec.id;
        } catch {
          runId = null;
        }
      }
      set({ currentRunId: runId, resumeFromRunId: null });
      // null = the loop paused (manual) and the run stays open for the next
      // click; a non-null value closes the run with that terminal status.
      let finalStatus: RunStatus | null = null;

      // A single step (a dev build) can run for minutes. The engine writes the
      // task's 'in-progress' status to disk at the start of the step, so poll
      // the plan during the run to surface live status on the board instead of
      // only refreshing between steps (where it jumps straight to done).
      const poll = setInterval(() => {
        if (get().activeProjectId === runProjectId) {
          void get().loadWhiteboardPlan();
          // Surface who's working right now (dev / QA / security / architect).
          void window.nucleus.bullpen
            .activity(runProjectId)
            .then((a) => {
              if (get().activeProjectId === runProjectId && get().bullpenRunning) {
                set({ bullpenActivity: a });
              }
            })
            .catch(() => undefined);
        }
      }, 1500);
      try {
        // Autopilot runs to the end (capped to avoid a runaway loop). One-step
        // mode advances ONE TASK per click — but the dev↔QA retry loop for that
        // task runs automatically: a QA fail (the engine returns status
        // 'in-progress', bouncing the task back to Dinesh) keeps going until the
        // task passes, settles, or burns its 5-try budget (which escalates). The
        // 200 cap bounds both modes; the budget escalation ends manual far sooner.
        for (let i = 0; i < 200; i++) {
          if (get().bullpenStopRequested) {
            finalStatus = 'stopped';
            break;
          }
          // Abort if the user switched/removed the project mid-run, so we
          // never drive or write into a different project's state.
          if (get().activeProjectId !== runProjectId) {
            finalStatus = 'stopped';
            break;
          }
          const step = await window.nucleus.bullpen.nextStep(runProjectId, {
            testingCadence: cadence,
            securityCadence,
            opsCadence,
            namingMode: get().namingMode,
          });
          if (get().activeProjectId !== runProjectId) {
            finalStatus = 'stopped';
            break;
          }
          // Skip non-display steps: the content-free terminal (allDone) and any
          // silent step (e.g. a review gate skipped for an unassigned seat). They
          // still drive the control flow below, just not the visible/persisted log.
          if (!step.allDone && !step.silent) {
            set({ bullpenSteps: [...get().bullpenSteps, step] });
            if (runId) {
              void window.nucleus.run.appendStep(runProjectId, runId, step).catch(() => undefined);
            }
          }
          await get().loadWhiteboardPlan();
          if (step.allDone) {
            set({ bullpenComplete: true });
            finalStatus = 'complete';
            // Nudge the founder if they walked away — no-op when the window is focused.
            void window.nucleus.app
              .notifyAttention({ kind: 'complete', projectName: runProjectName })
              .catch(() => undefined);
            break;
          }
          if (step.escalated) {
            set({ bullpenEscalated: true });
            finalStatus = 'escalated';
            // The whole point of autopilot is walking away — ping the founder that the
            // build paused for them (an unattended build can otherwise idle for a long
            // time before anyone notices it stopped).
            void window.nucleus.app
              .notifyAttention({ kind: 'escalated', projectName: runProjectName })
              .catch(() => undefined);
            break;
          }
          if (step.error) {
            // Surface the stop with a top-level banner (not just a collapsed log row),
            // so a corrupted task file / empty plan doesn't read as the spinner silently
            // vanishing (review failure-UX).
            set({ bullpenError: step.error });
            finalStatus = 'stopped';
            void window.nucleus.app
              .notifyAttention({ kind: 'error', projectName: runProjectName })
              .catch(() => undefined);
            break;
          }
          // One-step mode pauses once the current task has settled. The only
          // non-terminal status a step returns is 'in-progress' = QA bounced the
          // task back to dev, so keep auto-retrying on that; pause on anything
          // else (verified/done/review) so the user advances tasks one by one.
          // finalStatus stays null → the run record stays open for the next click.
          // EXCEPTION: with per-task security, a task isn't settled until Gilfoyle
          // has reviewed it — so don't pause on the QA pass; let the security-task
          // step run next (it pauses on that), keeping "one task" = dev→QA→security.
          if (manual && step.status !== 'in-progress') {
            // One advance = one whole task (Dev → QA → per-task Security). Don't
            // pause between those sub-steps:
            //  - Dev just finished ('done') and afterEachTask QA is next → continue.
            //  - The task is verified and per-task security is next → continue.
            // The security-task step (actor 'security') then pauses normally.
            const devDoneAwaitingQa =
              cadence === 'afterEachTask' && step.actor === 'developer' && step.status === 'done';
            const awaitingPerTaskSecurity =
              securityCadence === 'afterEachTask' &&
              step.status === 'verified' &&
              (step.actor === 'qa' || step.actor === 'developer');
            // Phase-end reviews fire automatically once a phase's tasks are done —
            // no extra click. When the NEXT action is a phase-level stage
            // (end-of-phase security → architect → ops → celebrate), keep going so
            // the whole phase wraps up in one advance; pause only when the next
            // action starts a NEW task's development.
            const nextIsPhaseEnd =
              step.nextActionKind === 'security-phase' ||
              step.nextActionKind === 'architect' ||
              step.nextActionKind === 'ops' ||
              step.nextActionKind === 'celebrate';
            if (!devDoneAwaitingQa && !awaitingPerTaskSecurity && !nextIsPhaseEnd) {
              break;
            }
          }
        }
        // Autopilot exited the loop without reaching a terminal state ⇒ it hit the
        // 200-step safety cap. Close the run explicitly (so the record doesn't linger
        // 'running' and currentRunId doesn't dangle) and flag it so the board shows a
        // "paused at the cap" banner instead of a silent dead-stop. The task files are
        // the checkpoint, so Continue resumes from exactly where it left off.
        if (!manual && finalStatus === null) {
          finalStatus = 'stopped';
          set({ bullpenStoppedAtCap: true });
        }
      } catch (err) {
        // A transient IPC failure (e.g. a getPlan rejection) mid-build used to wedge the
        // UI into a clean idle state while the run record stayed open 'running' with no
        // signal. Surface it and close the run cleanly (review failure-UX).
        set({ bullpenError: err instanceof Error ? err.message : String(err) });
        finalStatus = 'stopped';
      } finally {
        clearInterval(poll);
        // The flag reset runs FIRST and unconditionally — a rejected best-effort
        // refresh below must never skip it (an unguarded await here once left
        // bullpenRunning=true forever: every later start/intervention silently
        // refused and the run record dangled 'running' until an app restart).
        set({ bullpenRunning: false, bullpenActivity: null });
        if (runId && finalStatus) {
          void window.nucleus.run
            .finish(runProjectId, runId, finalStatus)
            .catch(() => undefined);
          set({ currentRunId: null });
        }
        await get().loadWhiteboardPlan().catch(() => undefined);
      }
    },

    runBullpenSecurity: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      set({ securityRunning: true });
      try {
        const result = await window.nucleus.bullpen.security(active.registry.id);
        set({ securityResult: result });
        // The manual sweep now creates fix tasks from its findings. If it did, refresh the plan
        // so the new task count shows — but keep the build 'complete' so the result stays on
        // screen; the founder clicks "Build the fix tasks" (which starts the loop) to build them.
        if (/task-\d/i.test(result.remediation ?? '')) {
          await get().loadWhiteboardPlan();
        }
      } finally {
        set({ securityRunning: false });
      }
    },

    loadGarageTelemetry: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      const garageTelemetry = await window.nucleus.bullpen.telemetry(target);
      if (get().activeProjectId !== target) {
        return;
      }
      set({ garageTelemetry });
    },

    loadGarageInvocations: async () => {
      if (!hasBridge()) {
        return;
      }
      // Cross-project log — no active-project guard; the panel shows recent activity
      // across all projects (failures are what matter most).
      const garageInvocations = await window.nucleus.diagnostics.recentInvocations(50);
      set({ garageInvocations });
    },

    hydrateBullpenLog: async () => {
      const active = get().activeProject;
      // Only restore when there's nothing live to show — never stomp an in-flight
      // run or steps already on screen.
      if (!active || !hasBridge() || get().bullpenRunning || get().bullpenSteps.length > 0) {
        return;
      }
      const target = active.registry.id;
      const summaries = await window.nucleus.run.list(target);
      if (summaries.length === 0) {
        return;
      }
      // The build log is the project's FULL history — aggregate every run's steps
      // in chronological order, not just the newest run. A resume opens a fresh run
      // record, so loading the latest run alone would hide everything done before it
      // (the original "lost my logs on resume" bug). Concatenated oldest-run-first;
      // the build-log view reverses to show the newest step on top. Durable across
      // runs and resumes, like the room transcripts.
      const ordered = [...summaries].sort((a, b) =>
        a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
      );
      const records = await Promise.all(
        ordered.map((s) => window.nucleus.run.get(target, s.id)),
      );
      // Re-check guards: the user may have switched project or started a run while
      // we were awaiting, in which case the fresh state must win.
      if (
        get().activeProjectId !== target ||
        get().bullpenRunning ||
        get().bullpenSteps.length > 0
      ) {
        return;
      }
      const steps: BullpenStepResult[] = records.flatMap((record) =>
        record
          ? record.steps.map((s) => ({
              allDone: false,
              taskId: s.taskId,
              taskTitle: s.taskTitle,
              actor: s.actor,
              status: s.status,
              log: s.logExcerpt,
              passed: s.passed,
              escalated: s.escalated,
              iterations: s.iterations,
              error: s.error,
              phaseName: s.phaseName,
            }))
          : [],
      );
      set({ bullpenSteps: steps });
    },

    loadRuns: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        set({ runs: [] });
        return;
      }
      const runProjectId = active.registry.id;
      set({ runsLoading: true });
      try {
        const runs = await window.nucleus.run.list(runProjectId);
        if (get().activeProjectId === runProjectId) {
          set({ runs });
        }
      } finally {
        set({ runsLoading: false });
      }
    },

    loadDashboardStats: async () => {
      if (!hasBridge()) {
        return;
      }
      const projects = get().projects;
      set({ dashboardStatsLoading: true });
      try {
        // Runs live per-project (.nucleus/runs/*); aggregate across the whole registry.
        // A failed read for any one project degrades to [] — never breaks the dashboard.
        const perProject = await Promise.all(
          projects.map((p) => window.nucleus.run.list(p.id).catch(() => [] as RunSummary[])),
        );
        const completedProjects = projects.filter((_p, i) =>
          perProject[i].some((r) => r.status === 'complete'),
        ).length;
        const recentRuns = perProject
          .flat()
          .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
          .slice(0, 10);
        set({ dashboardStats: { completedProjects, recentRuns } });
      } finally {
        set({ dashboardStatsLoading: false });
      }
    },

    openRunDetail: async (runId) => {
      const active = get().activeProject;
      set({ page: 'run-detail', activeRunId: runId, runDetail: null });
      if (!active || !hasBridge()) {
        return;
      }
      set({ runDetailLoading: true });
      try {
        const detail = await window.nucleus.run.get(active.registry.id, runId);
        if (get().activeRunId === runId) {
          set({ runDetail: detail });
        }
      } finally {
        set({ runDetailLoading: false });
      }
    },

    deleteRunRecord: async (runId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const runs = await window.nucleus.run.delete(active.registry.id, runId);
      set({ runs });
    },

    resumeRun: async (runId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      // The task files are the checkpoint — re-entering the Bullpen continues
      // from wherever they left off. Link the new run to the one it resumes.
      set({ resumeFromRunId: runId, bullpenMode: 'autopilot', bullpenInterrupted: null, page: 'bullpen' });
      await get().startBullpen();
    },

    reconcileInterruptedRuns: async () => {
      const active = get().activeProject;
      // Only when no live loop owns a 'running' record in THIS renderer — otherwise the
      // reconcile could flip the build that's running right now.
      if (!active || !hasBridge() || get().bullpenRunning) {
        return;
      }
      const target = active.registry.id;
      // Spare the caller's live run (currentRunId) — null on a fresh entry, so a crashed
      // run left 'running' from a previous session is flipped to 'interrupted'.
      const summaries = await window.nucleus.run.reconcile(target, get().currentRunId);
      if (get().activeProjectId !== target || get().bullpenRunning) {
        return;
      }
      // Surface a Resume banner only when the LATEST run (newest-first) was interrupted and
      // the build isn't otherwise resolved on screen — a clean/complete latest run shows nothing.
      const latest = summaries[0] ?? null;
      const interrupted =
        latest && latest.status === 'interrupted' && !get().bullpenComplete ? latest : null;
      set({ bullpenInterrupted: interrupted, runs: summaries });
    },
  };
}
