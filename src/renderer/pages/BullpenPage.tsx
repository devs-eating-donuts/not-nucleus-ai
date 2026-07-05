import { Fragment, useEffect, useState } from 'react';
import type { BullpenActor } from '../../shared/bullpen';
import {
  DEFAULT_PERSONAS,
  defaultPersonaForRole,
  effectivePersonaName,
  personaDisplayName,
} from '../../shared/personas';
import type { NamingMode } from '../../shared/naming';
import type { RoleId } from '../../shared/roles';
import { InterventionTab } from '../components/InterventionTab';
import { PersonaAvatar } from '../components/PersonaAvatar';
import { TerminalView } from '../components/TerminalView';
import { StatusBadge } from '../components/StatusBadge';
import type { BadgeTone } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

function statusTone(status: string | null): BadgeTone {
  if (status === 'verified' || status === 'done') return 'ok';
  if (status === 'human-needed' || status === 'blocked') return 'error';
  if (status === 'in-progress') return 'info';
  return 'neutral';
}

const ACTOR_LABELS: Partial<Record<NonNullable<BullpenActor>, string>> = {
  developer: 'Dev',
  qa: 'QA',
  security: 'Security',
  architect: 'Architect',
  ops: 'Phase',
};

/** Live verb for the "who's working right now" banner. */
const ACTOR_VERB: Partial<Record<NonNullable<BullpenActor>, string>> = {
  developer: 'is building',
  qa: 'is testing',
  security: 'is reviewing security on',
  architect: 'is reviewing the architecture of',
  ops: 'is wrapping up',
};

/** The actor's display name; Jian Yang when he's taken over (canon + awake). */
function actorName(actor: BullpenActor, namingMode: NamingMode, jianYang: boolean): string {
  if (actor === null) return 'Team';
  if (jianYang) return 'Jian Yang';
  return effectivePersonaName(actor as RoleId, null, namingMode);
}

/** Name for an advisory chime-in by persona id. */
function advisorName(personaId: string, namingMode: NamingMode, jianYang: boolean): string {
  if (jianYang) return 'Jian Yang';
  const p = DEFAULT_PERSONAS.find((x) => x.id === personaId);
  return p ? personaDisplayName(p, namingMode) : personaId;
}

export function BullpenPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const jianYang = useAppStore((s) => s.settings.jianYangAwake);
  const plan = useAppStore((s) => s.whiteboardPlan);
  const loadWhiteboardPlan = useAppStore((s) => s.loadWhiteboardPlan);
  const cadence = useAppStore((s) => s.bullpenCadence);
  const setBullpenCadence = useAppStore((s) => s.setBullpenCadence);
  const securityCadence = useAppStore((s) => s.bullpenSecurityCadence);
  const setSecurityCadence = useAppStore((s) => s.setBullpenSecurityCadence);
  const opsCadence = useAppStore((s) => s.bullpenOpsCadence);
  const setOpsCadence = useAppStore((s) => s.setBullpenOpsCadence);
  const mode = useAppStore((s) => s.bullpenMode);
  const setMode = useAppStore((s) => s.setBullpenMode);
  const running = useAppStore((s) => s.bullpenRunning);
  const stopRequested = useAppStore((s) => s.bullpenStopRequested);
  const steps = useAppStore((s) => s.bullpenSteps);
  const complete = useAppStore((s) => s.bullpenComplete);
  const escalated = useAppStore((s) => s.bullpenEscalated);
  const stoppedAtCap = useAppStore((s) => s.bullpenStoppedAtCap);
  const interruptedRun = useAppStore((s) => s.bullpenInterrupted);
  const bullpenError = useAppStore((s) => s.bullpenError);
  const activity = useAppStore((s) => s.bullpenActivity);
  const startBullpen = useAppStore((s) => s.startBullpen);
  const resumeRun = useAppStore((s) => s.resumeRun);
  const stopBullpen = useAppStore((s) => s.stopBullpen);
  const resolveSetupTask = useAppStore((s) => s.resolveSetupTask);
  const redoQa = useAppStore((s) => s.redoQa);
  const securityResult = useAppStore((s) => s.securityResult);
  const securityRunning = useAppStore((s) => s.securityRunning);
  const runBullpenSecurity = useAppStore((s) => s.runBullpenSecurity);
  const navigate = useAppStore((s) => s.navigate);
  const beginRipItProject = useAppStore((s) => s.beginRipItProject);

  const hydrateBullpenLog = useAppStore((s) => s.hydrateBullpenLog);
  const reconcileInterruptedRuns = useAppStore((s) => s.reconcileInterruptedRuns);
  const projectId = activeProject?.registry.id;
  useEffect(() => {
    if (projectId) {
      void loadWhiteboardPlan();
      // Restore the prior build log (e.g. after an app restart) so returning to
      // the Bullpen shows what was already completed and its status.
      void hydrateBullpenLog();
      // Flip any run left 'running' by a crash/close to 'interrupted' (so Run History is
      // honest) and surface a Resume banner if the last build was interrupted.
      void reconcileInterruptedRuns();
    }
  }, [projectId, loadWhiteboardPlan, hydrateBullpenLog, reconcileInterruptedRuns]);

  const [activeTab, setActiveTab] = useState<'bullpen' | RoleId>('bullpen');
  // The shared workspace terminal under the intervention tabs — mounted once (stable
  // key) so it survives persona-tab switches; the Restart button bumps the key.
  const terminalTheme = useAppStore((s) => s.theme);
  const [termKey, setTermKey] = useState(0);
  // Mark-done founder note: which task's inline note input is open, and its draft.
  const [markDoneFor, setMarkDoneFor] = useState<string | null>(null);
  const [markDoneNote, setMarkDoneNote] = useState('');
  // Arm the terminal only once the user opens a persona tab — so its first mount is
  // visible (fit() sizes correctly, not against a hidden 0-box) and no shell PTY spawns
  // for an escalation the user never engages. Stays armed across tab switches; reset
  // when the task resolves (below) so the PTY is torn down.
  const [termArmed, setTermArmed] = useState(false);

  // When the escalated task is no longer stuck, snap back to the Bullpen tab (so a LATER
  // escalation opens on the Bullpen, not a stale persona tab) and disarm the terminal (so
  // its PTY is torn down). Recompute the stuck-check inline — the full role/name derivation
  // needs the guards below. Functional setState keeps activeTab out of the deps.
  useEffect(() => {
    const esc = [...steps].reverse().find((s) => s.escalated && s.taskId);
    const t = esc ? (plan?.tasks ?? []).find((x) => x.id === esc.taskId) : undefined;
    const stuck = !!t && (t.status === 'human-needed' || t.status === 'blocked');
    if (!stuck) {
      setActiveTab('bullpen');
      setTermArmed(false);
    }
  }, [steps, plan]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <button type="button" className="btn primary" onClick={() => navigate('new-run')}>
            The Pitch
          </button>
        </div>
      </div>
    );
  }

  const dineshName = effectivePersonaName(
    'developer',
    activeProject.team.developer.personaNameOverride,
    namingMode,
  );
  const bigHeadName = effectivePersonaName(
    'qa',
    activeProject.team.qa.personaNameOverride,
    namingMode,
  );
  const gilfoyleName = effectivePersonaName(
    'security',
    activeProject.team.security.personaNameOverride,
    namingMode,
  );
  const richardName = effectivePersonaName(
    'architect',
    activeProject.team.architect.personaNameOverride,
    namingMode,
  );
  const jaredName = effectivePersonaName(
    'ops',
    activeProject.team.ops.personaNameOverride,
    namingMode,
  );
  const approved = plan?.approved === true;
  const tasks = plan?.tasks ?? [];

  // Group tasks by phase/feature for the live board.
  const byPhase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.feature ?? 'Tasks';
    byPhase.set(key, [...(byPhase.get(key) ?? []), t]);
  }

  if (!approved) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No approved plan</div>
          <p>Draft and approve a plan on The Whiteboard before the team starts building.</p>
          <button type="button" className="btn primary" onClick={() => navigate('whiteboard')}>
            Go to The Whiteboard
          </button>
        </div>
      </div>
    );
  }

  // The most-recently escalated task is the subject of the intervention tabs. The build
  // log is append-only, so keying off s.escalated ALONE would leave the tabs up forever
  // after the task is resolved (and resurrect them on restart). Gate on the task's LIVE
  // plan status so they clear the moment Redo QA / Mark done moves it off a stuck status.
  const escalatedStep = [...steps].reverse().find((s) => s.escalated && s.taskId);
  const escalatedTask = escalatedStep
    ? tasks.find((t) => t.id === escalatedStep.taskId)
    : undefined;
  const interventionTaskId =
    escalatedTask && (escalatedTask.status === 'human-needed' || escalatedTask.status === 'blocked')
      ? (escalatedStep?.taskId ?? null)
      : null;
  // One tab per ASSIGNED build seat — talk to whoever can unblock the stuck task. Badge
  // the persona whose step actually escalated it.
  const interventionRoles: { roleId: RoleId; name: string }[] = interventionTaskId
    ? (
        [
          { roleId: 'developer' as RoleId, name: dineshName },
          { roleId: 'qa' as RoleId, name: bigHeadName },
          { roleId: 'security' as RoleId, name: gilfoyleName },
        ] as { roleId: RoleId; name: string }[]
      ).filter((r) => (activeProject.team[r.roleId].assignment?.command ?? '').trim() !== '')
    : [];
  const showTabs = interventionRoles.length > 0;
  const activePersona =
    showTabs && activeTab !== 'bullpen'
      ? interventionRoles.find((r) => r.roleId === activeTab)
      : undefined;

  return (
    <>
      {showTabs && (
        <div className="bullpen-tabs">
          <button
            type="button"
            className={`bullpen-tab${!activePersona ? ' active' : ''}`}
            onClick={() => setActiveTab('bullpen')}
          >
            The Bullpen
          </button>
          {interventionRoles.map((r) => (
            <button
              key={r.roleId}
              type="button"
              className={`bullpen-tab${activeTab === r.roleId ? ' active' : ''}`}
              onClick={() => {
                setActiveTab(r.roleId);
                setTermArmed(true);
              }}
            >
              {r.name}
              {escalatedStep?.actor === r.roleId && (
                <span className="tab-badge" title="This step escalated — needs your help">
                  needs you
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {activePersona && interventionTaskId ? (
        <InterventionTab
          roleId={activePersona.roleId}
          taskId={interventionTaskId}
          personaName={activePersona.name}
          qaRunning={running}
          onResumeQa={() => {
            void redoQa(interventionTaskId);
            setActiveTab('bullpen');
          }}
        />
      ) : (
      <>
      <div className="section">
        <div className="section-heading">
          <h2>The Bullpen · {activeProject.info.projectName}</h2>
          <span className="section-note">{tasks.length} task(s) in the plan</span>
        </div>

        <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
          {dineshName} builds each task, {bigHeadName} tests it, and {gilfoyleName} reviews its
          security — at the cadence you choose below. The live banner shows who&apos;s working right now.
          Need a change mid-build?{' '}
          <button
            type="button"
            onClick={() => navigate('punch-list')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Take it to The Punch List
          </button>{' '}
          — {richardName} files it as a task.
        </p>

        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            ⚠ The Bullpen runs {dineshName} and the team with auto-approve, using your project
            folder as their working directory — in both autopilot and one-step mode. They create
            and edit files, and because the CLIs run with their own permissions, this is{' '}
            <strong>not a hard sandbox</strong>. Point it at a folder you trust.
          </p>
        </div>

        <div className="card" style={{ marginTop: 'var(--space-3)' }}>
          <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
            <label>Run mode</label>
            <div className="role-checkboxes">
              <label className="toggle-row">
                <input
                  type="radio"
                  name="bullpenMode"
                  checked={mode === 'autopilot'}
                  disabled={running}
                  onChange={() => setMode('autopilot')}
                />
                Autopilot — run the whole build
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="bullpenMode"
                  checked={mode === 'manual'}
                  disabled={running}
                  onChange={() => setMode('manual')}
                />
                One task at a time — you advance each task; its dev↔QA retry loop runs automatically
              </label>
            </div>
          </div>
          {/* Rip-it builds run developer-only (QA / Security / Ops seats are blanked and the
              cadences are forced off in startBullpen), so these controls don't apply — hide them
              rather than imply a review will run. */}
          {!activeProject.info.ripIt && (
            <>
          <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
            <label>Testing cadence</label>
            <div className="role-checkboxes">
              <label className="toggle-row">
                <input
                  type="radio"
                  name="cadence"
                  checked={cadence === 'afterEachTask'}
                  disabled={running}
                  onChange={() => setBullpenCadence('afterEachTask')}
                />
                QA after each task
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="cadence"
                  checked={cadence === 'endOfPhase'}
                  disabled={running}
                  onChange={() => setBullpenCadence('endOfPhase')}
                />
                QA at end of phase (faster, fewer tokens)
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="cadence"
                  checked={cadence === 'off'}
                  disabled={running}
                  onChange={() => setBullpenCadence('off')}
                />
                No QA — {dineshName} builds only (no {bigHeadName}, no retry loop)
              </label>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
            <label>Security cadence</label>
            <div className="role-checkboxes">
              <label className="toggle-row">
                <input
                  type="radio"
                  name="securityCadence"
                  checked={securityCadence === 'afterEachTask'}
                  disabled={running}
                  onChange={() => setSecurityCadence('afterEachTask')}
                />
                {gilfoyleName} reviews after each task
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="securityCadence"
                  checked={securityCadence === 'endOfPhase'}
                  disabled={running}
                  onChange={() => setSecurityCadence('endOfPhase')}
                />
                {gilfoyleName} reviews at end of phase
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="securityCadence"
                  checked={securityCadence === 'off'}
                  disabled={running}
                  onChange={() => setSecurityCadence('off')}
                />
                No security review
              </label>
            </div>
            <span className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
              Richard&apos;s architecture review always runs at the end of each phase.
            </span>
          </div>
          <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
            <label>Documentation ({jaredName})</label>
            <div className="role-checkboxes">
              <label className="toggle-row">
                <input
                  type="radio"
                  name="opsCadence"
                  checked={opsCadence === 'endOfProject'}
                  disabled={running}
                  onChange={() => setOpsCadence('endOfProject')}
                />
                {jaredName} documents the whole project at the end
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="opsCadence"
                  checked={opsCadence === 'endOfPhase'}
                  disabled={running}
                  onChange={() => setOpsCadence('endOfPhase')}
                />
                {jaredName} documents after each phase
              </label>
              <label className="toggle-row">
                <input
                  type="radio"
                  name="opsCadence"
                  checked={opsCadence === 'off'}
                  disabled={running}
                  onChange={() => setOpsCadence('off')}
                />
                No documentation pass
              </label>
            </div>
            <span className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
              {jaredName} writes/updates the README, setup instructions, and an ops runbook. Needs a
              CLI on the Ops seat (this project&apos;s team).
            </span>
          </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            {mode === 'manual' ? (
              <button
                type="button"
                className="btn primary"
                disabled={running || complete}
                onClick={() => void startBullpen()}
              >
                {running
                  ? 'Running task…'
                  : complete
                    ? 'Build complete'
                    : steps.length > 0
                      ? 'Run next task'
                      : 'Run first task'}
              </button>
            ) : running ? (
              <button
                type="button"
                className="btn"
                disabled={stopRequested}
                onClick={() => stopBullpen()}
              >
                {stopRequested ? 'Stopping…' : 'Stop after current step'}
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={() => void startBullpen()}>
                {steps.length > 0 ? 'Resume build' : 'Start build'}
              </button>
            )}
            {complete && !escalated && (
              <StatusBadge tone="ok" label="Build complete" />
            )}
            {escalated && <StatusBadge tone="error" label="Escalated — needs you" />}
            {running && (
              <span className="section-note">
                {stopRequested
                  ? 'Will stop once the current step finishes — a build step can take a few minutes.'
                  : 'Working… each step can take a few minutes.'}
              </span>
            )}
          </div>
        </div>
      </div>

      {activeProject.info.ripIt && complete && !escalated && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--ok, var(--accent))' }}>
            <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>
              Ripped it. Shipped it. 🎉
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              {dineshName} built <strong>{activeProject.info.projectName}</strong>. Open{' '}
              <code>HOW_TO_TEST.md</code> in the project folder for how to run and test it — his run
              steps are in the build log below too:
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
              <code>{activeProject.info.workspacePath}</code>
            </p>
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" onClick={() => beginRipItProject()}>
                Rip another →
              </button>
              <button type="button" className="btn" onClick={() => navigate('projects')}>
                View in Projects
              </button>
            </div>
          </div>
        </div>
      )}

      {running && activity && activity.actor && (
        <div className="section">
          <div
            className="card"
            style={{
              borderColor: 'var(--accent)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
            }}
          >
            <PersonaAvatar
              personaId={defaultPersonaForRole(activity.actor as RoleId)?.id}
              name={actorName(activity.actor, namingMode, jianYang)}
              size={32}
              headFocus
            />
            <StatusBadge tone="info" label={ACTOR_LABELS[activity.actor] ?? 'Working'} dot />
            <span style={{ fontWeight: 'var(--font-weight-bold)' }}>
              {actorName(activity.actor, namingMode, jianYang)}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {ACTOR_VERB[activity.actor] ?? 'is working on'}
              {activity.taskId ? ` ${activity.taskId}` : activity.phaseName ? ` ${activity.phaseName}` : ''}
              {activity.taskTitle ? ` — ${activity.taskTitle}` : ''}…
            </span>
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="section">
          <div className="section-heading">
            <h2>Phases & tasks</h2>
            <span className="section-note">
              {tasks.filter((t) => t.status === 'verified' || t.status === 'done').length}/
              {tasks.length} done · dev → QA per task
            </span>
          </div>
          {[...byPhase.entries()].map(([phase, phaseTasks]) => (
            <div key={phase} className="card" style={{ marginBottom: 'var(--space-2)' }}>
              <div className="card-title">{phase}</div>
              {phaseTasks.map((t) => (
                <Fragment key={t.id}>
                  <div className="cli-row" style={{ gridTemplateColumns: '110px 1fr auto' }}>
                    <code>{t.id}</code>
                    <span>{t.title}</span>
                    <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      {t.status === 'human-needed' && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 10px', fontSize: 'var(--font-size-sm)' }}
                            disabled={running}
                            title="Re-run QA on this task (use this if QA stalled rather than truly failed)"
                            onClick={() => void redoQa(t.id)}
                          >
                            Redo QA
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 10px', fontSize: 'var(--font-size-sm)' }}
                            disabled={running}
                            title="Mark this task done yourself after verifying its acceptance criteria"
                            onClick={() => {
                              setMarkDoneFor(markDoneFor === t.id ? null : t.id);
                              setMarkDoneNote('');
                            }}
                          >
                            Mark done
                          </button>
                        </>
                      )}
                      <StatusBadge tone={statusTone(t.status)} label={t.status} dot={false} />
                    </span>
                  </div>
                  {markDoneFor === t.id && (
                    // The founder's outcome must land in the WORKSPACE (the task file),
                    // not just the click — QA and later tasks can only trust what's
                    // recorded. Optional, but "no issues found" IS a result worth saying.
                    <div className="cli-row" style={{ gridTemplateColumns: '110px 1fr auto' }}>
                      <span />
                      <input
                        autoFocus
                        placeholder='Optional note for the record — e.g. "ran every step, no issues found"'
                        value={markDoneNote}
                        onChange={(e) => setMarkDoneNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void resolveSetupTask(t.id, markDoneNote.trim() || undefined);
                            setMarkDoneFor(null);
                          }
                          if (e.key === 'Escape') {
                            setMarkDoneFor(null);
                          }
                        }}
                      />
                      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                          type="button"
                          className="btn primary"
                          style={{ padding: '2px 10px', fontSize: 'var(--font-size-sm)' }}
                          onClick={() => {
                            void resolveSetupTask(t.id, markDoneNote.trim() || undefined);
                            setMarkDoneFor(null);
                          }}
                        >
                          Confirm done
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '2px 10px', fontSize: 'var(--font-size-sm)' }}
                          onClick={() => setMarkDoneFor(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      )}

      {escalated && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--error)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              A task needs you — see the build log below (it now shows what QA actually output and
              the acceptance criteria to confirm) and ESCALATIONS.md in the workspace. On the task in{' '}
              <strong>Phases &amp; tasks</strong> you can either <strong>Redo QA</strong> (re-run the
              QA agent — best when it just stalled, e.g. waiting on a Docker pull) or verify it
              yourself against its acceptance criteria and click <strong>Mark done</strong>. A
              hands-on setup step (cloud login, accounts, secrets) is always <strong>Mark done</strong>.
            </p>
          </div>
        </div>
      )}

      {bullpenError && !running && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--error)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              The build stopped on an error: <strong>{bullpenError}</strong> — see the build log
              below (and ESCALATIONS.md / the task files in the workspace). Fix what's needed, then
              click <strong>Continue</strong> to resume.
            </p>
          </div>
        </div>
      )}

      {stoppedAtCap && !running && !complete && !escalated && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              Paused at the per-run step cap to keep autopilot from running away — the build isn't
              finished. Your work is saved (the task files are the checkpoint), so click{' '}
              <strong>Continue</strong> to pick up exactly where it left off.
            </p>
          </div>
        </div>
      )}

      {interruptedRun && !running && !complete && !escalated && !stoppedAtCap && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              Your last build didn't finish cleanly — it was interrupted (the app closed or reloaded
              mid-run). Nothing is lost: the task files are the checkpoint, so you can pick up exactly
              where it left off.
            </p>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => void resumeRun(interruptedRun.id)}
              >
                Resume build
              </button>
            </div>
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div className="section">
          <div className="section-heading">
            <h2>Build log</h2>
            <span className="section-note">{steps.length} step(s)</span>
          </div>
          {steps
            .map((step, i) => ({ step, i }))
            .reverse()
            .map(({ step, i }) => {
              const roleId: RoleId | null = step.actor === null ? null : (step.actor as RoleId);
              const personaId = roleId ? defaultPersonaForRole(roleId)?.id : undefined;
              const speaker = actorName(step.actor, namingMode, jianYang);
              return (
                <details key={i} className="card" style={{ marginBottom: 'var(--space-2)' }}>
                  <summary style={{ cursor: 'pointer', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <StatusBadge
                      tone={step.passed === true ? 'ok' : step.passed === false ? 'warn' : statusTone(step.status)}
                      label={(step.actor && ACTOR_LABELS[step.actor]) ?? 'Step'}
                      dot={false}
                    />
                    <span style={{ fontWeight: 'var(--font-weight-bold)' }}>{step.taskId ?? step.phaseName ?? '—'}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{step.taskTitle ?? ''}</span>
                    <span className="role-panel-spacer" style={{ flex: 1 }} />
                    {step.iterations && (
                      <code title="Dev→QA attempts used / budget before this task escalates to you">
                        attempt {step.iterations}
                      </code>
                    )}
                    {step.status && (
                      // An ESCALATED step (QA gave no usable verdict, a gate failed, a CLI
                      // crashed) is stuck for the human — never a QA "fail". Check escalation
                      // FIRST so it doesn't read as "FAIL — back to dev". A real QA fail bounces
                      // to dev with status 'in-progress' (orange); a budget-exhausted task is
                      // 'blocked', not a bounce, so it keeps its status.
                      <StatusBadge
                        tone={
                          step.escalated
                            ? 'error'
                            : step.actor === 'qa' && step.passed === false && step.status === 'in-progress'
                              ? 'warn'
                              : statusTone(step.status)
                        }
                        label={
                          step.escalated
                            ? 'Escalated — needs you'
                            : step.actor === 'qa' && step.passed === false && step.status === 'in-progress'
                              ? 'FAIL — back to dev'
                              : step.status
                        }
                        dot={false}
                      />
                    )}
                  </summary>
                  {step.banter && roleId && (
                    <div className="bullpen-banter">
                      <PersonaAvatar personaId={personaId} name={speaker} size={24} headFocus />
                      <span className="pitch-who">{speaker}</span>
                      <span className="pitch-text">{step.banter}</span>
                    </div>
                  )}
                  {step.advisory && (
                    <div className="bullpen-banter">
                      <PersonaAvatar
                        personaId={step.advisory.personaId}
                        name={advisorName(step.advisory.personaId, namingMode, jianYang)}
                        size={24}
                        headFocus
                      />
                      <span className="pitch-who">{advisorName(step.advisory.personaId, namingMode, jianYang)}</span>
                      <span className="pitch-text">{step.advisory.line}</span>
                    </div>
                  )}
                  {step.error && <p className="validation-note err">{step.error}</p>}
                  {step.log && <pre className="cli-update-output">{step.log}</pre>}
                </details>
              );
            })}
        </div>
      )}

      {complete && !escalated && (
        <div className="section">
          <div className="section-heading">
            <h2>Security pass</h2>
            <span className="section-note">Gilfoyle reviews trust boundaries</span>
          </div>
          <div className="card">
            <p className="field-hint" style={{ marginTop: 0 }}>
              Runs Gilfoyle over the finished build. Any real findings become fix tasks (the same
              remediation as the build&apos;s own security gate) — not just a printout.
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={securityRunning}
              onClick={() => void runBullpenSecurity()}
            >
              {securityRunning ? 'Reviewing…' : 'Run security review'}
            </button>
            {securityResult && (
              <pre className={`cli-update-output ${securityResult.ok ? 'ok' : 'err'}`} style={{ marginTop: 'var(--space-2)' }}>
                {securityResult.ok ? securityResult.log : securityResult.error ?? 'Failed.'}
              </pre>
            )}
            {securityResult?.remediation && securityResult.remediation.trim() !== '' && (
              <div className="validation-note ok" style={{ marginTop: 'var(--space-2)' }}>
                ⚠ {securityResult.remediation}
                {/task-\d/i.test(securityResult.remediation) && (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={running}
                      onClick={() => void startBullpen()}
                    >
                      Build the fix tasks →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

      {showTabs && termArmed && (
        <div className={`section intervention-terminal${activePersona ? '' : ' is-hidden'}`}>
          <div className="intervention-terminal-head">
            <span className="section-note">
              Workspace terminal — run the commands the team suggests (e.g. <code>docker compose up</code>,{' '}
              <code>npm test</code>). It stays alive as you switch tabs.
            </span>
            <button type="button" className="btn sm" onClick={() => setTermKey((k) => k + 1)}>
              Restart
            </button>
          </div>
          <TerminalView
            key={`intervention-term:${termKey}`}
            projectId={activeProject.registry.id}
            roleId="developer"
            mode="shell"
            themeId={terminalTheme}
            sessionKey={termKey}
          />
        </div>
      )}
    </>
  );
}
