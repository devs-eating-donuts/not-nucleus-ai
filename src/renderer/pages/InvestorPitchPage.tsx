import { useEffect } from 'react';
import { effectivePersonaName } from '../../shared/personas';
import { RoomChat } from '../components/RoomChat';
import { useAppStore } from '../state/appStore';

export function InvestorPitchPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const conversations = useAppStore((s) => s.roomConversations);
  const roomSendingRole = useAppStore((s) => s.roomSendingRole);
  const roomError = useAppStore((s) => s.roomError);
  const loadRoom = useAppStore((s) => s.loadRoom);
  const sendRoomMessage = useAppStore((s) => s.sendRoomMessage);
  const retryRoomMessage = useAppStore((s) => s.retryRoomMessage);
  const kickoffRoom = useAppStore((s) => s.kickoffRoom);
  const navigate = useAppStore((s) => s.navigate);

  const projectId = activeProject?.registry.id;
  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await loadRoom('projectLead');
      if (cancelled) {
        return;
      }
      // Monica opens the conversation herself when the room is still empty.
      const monica = useAppStore.getState().activeProject?.team.projectLead;
      const assigned = !!monica?.assignment && monica.assignment.command.trim() !== '';
      const empty = (useAppStore.getState().roomConversations.projectLead ?? []).length === 0;
      if (assigned && empty) {
        await kickoffRoom('projectLead');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadRoom, kickoffRoom]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Pitch a project first — then Monica will meet you here.</p>
          <button type="button" className="btn primary" onClick={() => navigate('new-run')}>
            The Pitch
          </button>
        </div>
      </div>
    );
  }

  const monica = activeProject.team.projectLead;
  const monicaName = effectivePersonaName('projectLead', monica.personaNameOverride, namingMode);
  const monicaAssigned = monica.assignment !== null && monica.assignment.command.trim() !== '';
  const monicaMessages = conversations.projectLead ?? [];
  const monicaSending = roomSendingRole === 'projectLead';
  // "Done" enough to move on once the founder has actually answered her.
  const hasEngaged = monicaMessages.some((m) => m.role === 'user');
  const canContinue = hasEngaged && !monicaSending;

  return (
    <div className="room-page">
      <div className="section-heading">
        <h2>
          {monicaName} · {activeProject.info.projectName}
        </h2>
        <span className="section-note">Investor Pitch</span>
      </div>
      <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
        Work the <strong>product</strong> with {monicaName}: what it is, what it looks like, how it
        functions, and what to expect. (Tech stack, framework, and hosting are Richard&apos;s call
        on The Whiteboard.) When she gets it, continue to Richard.
      </p>
      <RoomChat
        fill
        roleId="projectLead"
        personaName={monicaName}
        messages={monicaMessages}
        sending={monicaSending}
        error={roomError?.roleId === 'projectLead' ? roomError.message : null}
        onSend={(text) => void sendRoomMessage('projectLead', text)}
        onRetry={() => void retryRoomMessage('projectLead')}
        placeholder="e.g. It's a marketing site with a contact form. Here's how it should feel…"
        disabledNote={
          monicaAssigned
            ? undefined
            : `${monicaName} needs a CLI. Assign one to the Project Lead on this project's team (Active Project).`
        }
      />
      <div className="card room-next">
        <button
          type="button"
          className="btn primary"
          disabled={!canContinue}
          onClick={() => navigate('whiteboard')}
        >
          Continue to The Whiteboard →
        </button>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>
            Done with {monicaName}?
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            {canContinue
              ? `Hand the product brief to Richard, the Architect, on The Whiteboard.`
              : `Work through ${monicaName}'s questions first — then continue.`}
          </p>
        </div>
      </div>
    </div>
  );
}
