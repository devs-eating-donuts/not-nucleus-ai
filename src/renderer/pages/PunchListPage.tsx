import { useEffect, useState } from 'react';
import { effectivePersonaName } from '../../shared/personas';
import { RoomChat } from '../components/RoomChat';
import { useAppStore } from '../state/appStore';

/**
 * The Punch List — a terse 1-on-1 with Richard for ad-hoc change requests during
 * (or after) a build. He triages each ask: pushes back / asks for detail, or
 * accepts and files a task in the most plausible phase, which the Bullpen then
 * picks up. Replaces the old fire-and-forget "Add a work item" box.
 */
export function PunchListPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const plan = useAppStore((s) => s.whiteboardPlan);
  const loadWhiteboardPlan = useAppStore((s) => s.loadWhiteboardPlan);
  const messages = useAppStore((s) => s.workRequestMessages);
  const sending = useAppStore((s) => s.workRequestSending);
  const error = useAppStore((s) => s.workRequestError);
  const loadWorkRequest = useAppStore((s) => s.loadWorkRequest);
  const sendWorkRequest = useAppStore((s) => s.sendWorkRequest);
  const retryWorkRequest = useAppStore((s) => s.retryWorkRequest);
  const navigate = useAppStore((s) => s.navigate);

  const projectId = activeProject?.registry.id;
  // The findings backlog (review findings the build recorded instead of auto-building) — the
  // engine's surface messages say "triage via The Punch List", so surface it right here.
  const [findingsBacklog, setFindingsBacklog] = useState<string | null>(null);
  useEffect(() => {
    if (projectId && typeof window.nucleus !== 'undefined') {
      void loadWhiteboardPlan();
      void loadWorkRequest();
      void window.nucleus.project
        .readDoc(projectId, 'findings-backlog')
        .then(setFindingsBacklog)
        .catch(() => setFindingsBacklog(null));
    }
  }, [projectId, loadWhiteboardPlan, loadWorkRequest]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Open a project first — then bring change requests to Richard here.</p>
          <button type="button" className="btn primary" onClick={() => navigate('new-run')}>
            The Pitch
          </button>
        </div>
      </div>
    );
  }

  const richard = activeProject.team.architect;
  const richardName = effectivePersonaName('architect', richard.personaNameOverride, namingMode);
  const richardAssigned = richard.assignment !== null && richard.assignment.command.trim() !== '';
  const approved = plan?.approved === true;

  if (!approved) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No approved plan yet</div>
          <p>
            The Punch List files changes against the plan&apos;s phases. Draft and approve a plan on
            The Whiteboard first — then bring {richardName} your tweaks here.
          </p>
          <button type="button" className="btn primary" onClick={() => navigate('whiteboard')}>
            Go to The Whiteboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page">
      <div className="section-heading">
        <h2>
          {richardName} · {activeProject.info.projectName}
        </h2>
        <span className="section-note">The Punch List</span>
      </div>
      <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
        Tell {richardName} what you need changed — a UI tweak, a look/feel fix, one more small thing.
        He keeps it short: he&apos;ll push back if it&apos;s vague or too big, or accept it and file a
        task in the most plausible phase. The Bullpen picks it up like any other task. No re-drafting
        the plan.
      </p>
      {findingsBacklog && findingsBacklog.trim() !== '' && (
        <details className="card" style={{ marginBottom: 'var(--space-3)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 'var(--font-weight-bold)' }}>
            Findings backlog — review findings the build recorded for you to triage
          </summary>
          <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
            These are findings the build logged instead of auto-building them (advisory / needs-design /
            refactor-docs / capped overflow / uncited). Nothing was silently dropped — bring any you want
            addressed to {richardName} below and he&apos;ll file them as tasks.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 340,
              overflow: 'auto',
              fontSize: 'var(--font-size-xs)',
              margin: 0,
            }}
          >
            {findingsBacklog}
          </pre>
        </details>
      )}
      <RoomChat
        fill
        roleId="architect"
        personaName={richardName}
        messages={messages}
        sending={sending}
        error={error}
        onSend={(text) => void sendWorkRequest(text)}
        onRetry={() => void retryWorkRequest()}
        placeholder="e.g. The contact form button should be full-width on mobile."
        disabledNote={
          richardAssigned
            ? undefined
            : `${richardName} needs a CLI. Assign one to the Architect on this project's team (Project Team).`
        }
      />
      <div className="card room-next">
        <button type="button" className="btn primary" onClick={() => navigate('bullpen')}>
          Back to The Bullpen →
        </button>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>
            Filed a change?
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            Anything {richardName} accepts shows up as a new task on The Bullpen and builds in turn.
          </p>
        </div>
      </div>
    </div>
  );
}
