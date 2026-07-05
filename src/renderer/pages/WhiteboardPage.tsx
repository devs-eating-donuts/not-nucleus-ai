import { useEffect } from 'react';
import { DEPLOYMENT_POSTURES, POSTURE_LABELS, inferDeploymentPosture } from '../../shared/decisions';
import { effectivePersonaName } from '../../shared/personas';
import { RoomChat } from '../components/RoomChat';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

export function WhiteboardPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const conversations = useAppStore((s) => s.roomConversations);
  const roomSendingRole = useAppStore((s) => s.roomSendingRole);
  const roomError = useAppStore((s) => s.roomError);
  const loadRoom = useAppStore((s) => s.loadRoom);
  const sendRoomMessage = useAppStore((s) => s.sendRoomMessage);
  const retryRoomMessage = useAppStore((s) => s.retryRoomMessage);
  const kickoffRoom = useAppStore((s) => s.kickoffRoom);
  const plan = useAppStore((s) => s.whiteboardPlan);
  const drafting = useAppStore((s) => s.whiteboardDrafting);
  const whiteboardError = useAppStore((s) => s.whiteboardError);
  const loadWhiteboardPlan = useAppStore((s) => s.loadWhiteboardPlan);
  const draftWhiteboardPlan = useAppStore((s) => s.draftWhiteboardPlan);
  const approveWhiteboardPlan = useAppStore((s) => s.approveWhiteboardPlan);
  const setDeploymentPosture = useAppStore((s) => s.setDeploymentPosture);
  const bullpenRunning = useAppStore((s) => s.bullpenRunning);
  const navigate = useAppStore((s) => s.navigate);

  const projectId = activeProject?.registry.id;
  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadWhiteboardPlan();
    let cancelled = false;
    void (async () => {
      await loadRoom('architect');
      if (cancelled) {
        return;
      }
      // Richard opens with the tech discovery once Erlich + Monica are done.
      const richardSeat = useAppStore.getState().activeProject?.team.architect;
      const assigned = !!richardSeat?.assignment && richardSeat.assignment.command.trim() !== '';
      const empty = (useAppStore.getState().roomConversations.architect ?? []).length === 0;
      if (assigned && empty) {
        await kickoffRoom('architect');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadRoom, loadWhiteboardPlan, kickoffRoom]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Pitch a project and work the design with Monica first.</p>
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
  const richardMessages = conversations.architect ?? [];
  const richardSending = roomSendingRole === 'architect';
  const tasks = plan?.tasks ?? [];
  // Don't surface the Draft button until the founder has worked the tech with him.
  const hasEngaged = richardMessages.some((m) => m.role === 'user');
  const showPlanPanel = hasEngaged || tasks.length > 0;
  // The posture the reviewers fall back to when the founder leaves it on "Auto".
  const inferredPosture = inferDeploymentPosture({
    templateId: activeProject.info.templateId,
    ripIt: activeProject.info.ripIt,
  });

  // Group tasks by feature/phase for display.
  const byPhase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.feature ?? 'Ungrouped';
    byPhase.set(key, [...(byPhase.get(key) ?? []), t]);
  }

  return (
    <div className="room-page">
      <div className="section-heading">
        <h2>
          {richardName} · {activeProject.info.projectName}
        </h2>
        {plan?.approved ? (
          <StatusBadge tone="ok" label="Plan approved" />
        ) : (
          <span className="section-note">The Whiteboard</span>
        )}
      </div>
      <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
        Work the <strong>tech</strong> with {richardName}: stack, framework, repo, and hosting. When
        he has what he needs, draft the phases &amp; tasks below and approve them to start the build.
      </p>

      <RoomChat
        fill
        roleId="architect"
        personaName={richardName}
        messages={richardMessages}
        sending={richardSending}
        error={roomError?.roleId === 'architect' ? roomError.message : null}
        onSend={(text) => void sendRoomMessage('architect', text)}
        onRetry={() => void retryRoomMessage('architect')}
        placeholder="e.g. Let's go with Astro and deploy on Cloudflare Pages."
        disabledNote={
          richardAssigned
            ? undefined
            : `${richardName} needs a CLI. Assign one to the Architect on this project's team.`
        }
      />

      <div className="card room-next-block">
        <div className="section-heading" style={{ marginBottom: 'var(--space-2)' }}>
          <h2 style={{ margin: 0 }}>Phases &amp; tasks</h2>
          {tasks.length > 0 && <span className="section-note">{tasks.length} task(s)</span>}
        </div>

        {!showPlanPanel ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Talk through the tech with {richardName} above. When you&apos;re done, the Draft button
            appears here.
          </p>
        ) : (
          <>
            <div className="field" style={{ maxWidth: 480, marginBottom: 'var(--space-3)' }}>
              <label htmlFor="deployment-posture">Deployment posture</label>
              <select
                id="deployment-posture"
                value={activeProject.info.deploymentPosture ?? ''}
                onChange={(e) => void setDeploymentPosture(e.target.value)}
              >
                <option value="">Auto — {POSTURE_LABELS[inferredPosture]} (inferred)</option>
                {DEPLOYMENT_POSTURES.map((p) => (
                  <option key={p} value={p}>
                    {POSTURE_LABELS[p]}
                  </option>
                ))}
              </select>
              <p className="field-hint" style={{ marginTop: 'var(--space-1)' }}>
                Tells {richardName}&apos;s security review what threat model to hold the build to — a
                single-user localhost app won&apos;t be flagged for missing network auth; a public app
                is held to the full bar. Set it before you draft.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                disabled={drafting || !richardAssigned || bullpenRunning}
                onClick={() => void draftWhiteboardPlan()}
              >
                {drafting
                  ? 'Drafting…'
                  : tasks.length > 0
                    ? 'Re-draft phases & tasks'
                    : 'Draft phases & tasks'}
              </button>
              {tasks.length > 0 &&
                (plan?.approved ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={bullpenRunning}
                      onClick={() => void approveWhiteboardPlan(false)}
                    >
                      Send back
                    </button>
                    <button type="button" className="btn primary" onClick={() => navigate('bullpen')}>
                      To The Bullpen →
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      void approveWhiteboardPlan(true).then((ok) => {
                        // Only enter The Bullpen when the approval actually landed — a
                        // failed approve now shows whiteboardError instead of navigating.
                        if (ok) {
                          navigate('bullpen');
                        }
                      })
                    }
                  >
                    Approve plan → The Bullpen
                  </button>
                ))}
              <span className="section-note">
                {bullpenRunning
                  ? 'The build is running — stop The Bullpen before re-drafting or sending back.'
                  : richardAssigned
                    ? `${richardName} reads the vision + your answers and writes the task files.`
                    : `Assign a CLI to the Architect on this project's team first.`}
              </span>
            </div>
            {whiteboardError && (
              <p className="validation-note err" style={{ marginTop: 'var(--space-2)' }}>
                {whiteboardError}
              </p>
            )}
            {[...byPhase.entries()].map(([phase, phaseTasks]) => (
              <div key={phase} style={{ marginTop: 'var(--space-3)' }}>
                <div className="card-title">{phase}</div>
                {phaseTasks.map((t) => (
                  <div key={t.id} className="cli-row" style={{ gridTemplateColumns: '110px 1fr 90px' }}>
                    <code>{t.id}</code>
                    <span>{t.title}</span>
                    <StatusBadge tone="neutral" label={t.status} dot={false} />
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
