import { useEffect, useRef, useState } from 'react';
import { effectivePersonaName } from '../../shared/personas';
import { RoomChat } from '../components/RoomChat';
import { ReferencesPanel } from '../components/ReferencesPanel';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

/**
 * Rip it and Ship It — the express lane. Name the project, chat with Erlich
 * (who rejects it from his incubator but lends you Dinesh), drop in any
 * reference files, then hand it straight to Dinesh to build. No Monica, no
 * Richard, no QA/security gates — one chat, one build.
 */
export function RipItPage() {
  const settings = useAppStore((s) => s.settings);
  const namingMode = useAppStore((s) => s.namingMode);
  const activeProject = useAppStore((s) => s.activeProject);
  const createProject = useAppStore((s) => s.createProject);
  const conversations = useAppStore((s) => s.roomConversations);
  const roomSendingRole = useAppStore((s) => s.roomSendingRole);
  const roomError = useAppStore((s) => s.roomError);
  const loadRoom = useAppStore((s) => s.loadRoom);
  const sendRoomMessage = useAppStore((s) => s.sendRoomMessage);
  const retryRoomMessage = useAppStore((s) => s.retryRoomMessage);
  const kickoffRoom = useAppStore((s) => s.kickoffRoom);
  const handToDinesh = useAppStore((s) => s.handToDinesh);
  const bullpenRunning = useAppStore((s) => s.bullpenRunning);
  const navigate = useAppStore((s) => s.navigate);

  const erlichName = effectivePersonaName(
    'stakeholder',
    settings.roles.stakeholder.personaNameOverride,
    namingMode,
  );
  const dineshName = effectivePersonaName(
    'developer',
    settings.roles.developer.personaNameOverride,
    namingMode,
  );

  // 'form' = name + folder; 'chat' = Erlich + references + hand-off. A fresh
  // "Rip it and Ship It" click forces the form even if a rip-it project is active.
  const [mode, setMode] = useState<'form' | 'chat'>('form');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  // Guard against StrictMode's double effect-invoke consuming the one-shot
  // startRipItFresh flag (run 1 consumes it → 'form'; run 2 would then drop into the
  // active rip-it project's chat). Keyed by project id so a real switch re-initializes.
  const initedFor = useRef<string | null>(null);

  useEffect(() => {
    const key = activeProject?.registry.id ?? '';
    if (initedFor.current === key) {
      return; // StrictMode's second invoke (or a re-render) — already initialized.
    }
    initedFor.current = key;
    if (useAppStore.getState().startRipItFresh) {
      useAppStore.getState().setStartRipItFresh(false);
      setMode('form');
      setName('');
      setFolder('');
      setError(null);
      return;
    }
    // Revisiting with an active rip-it project drops straight into its chat.
    setMode(useAppStore.getState().activeProject?.info.ripIt ? 'chat' : 'form');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.registry.id]);

  // In chat mode, load Erlich's transcript and let him open the express lane.
  const projectId = activeProject?.registry.id;
  useEffect(() => {
    if (mode !== 'chat' || !projectId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await loadRoom('stakeholder');
      if (cancelled) {
        return;
      }
      const erlich = useAppStore.getState().activeProject?.team.stakeholder;
      const assigned = !!erlich?.assignment && erlich.assignment.command.trim() !== '';
      const empty = (useAppStore.getState().roomConversations.stakeholder ?? []).length === 0;
      if (assigned && empty) {
        await kickoffRoom('stakeholder');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, projectId, loadRoom, kickoffRoom]);

  const browseFolder = async () => {
    const picked = await window.nucleus.project.selectFolder();
    if (picked) {
      setFolder(picked);
    }
  };

  const canCreate = name.trim() !== '' && folder.trim() !== '' && !busy;

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      await createProject({
        projectName: name.trim(),
        // The "pitch" happens in the chat; productIdea is required, so seed a marker.
        productIdea: 'Rip it and Ship It — an express build. See the chat with the Stakeholder and the reference files.',
        targetPlatform: '',
        targetStack: '',
        constraints: '',
        workspacePath: folder.trim(),
        enabledRoles: ['stakeholder', 'developer'],
        templateId: null,
        overlayIds: [],
        gitTracking: true,
        ripIt: true,
      });
      setMode('chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onHandToDinesh = async () => {
    setBuilding(true);
    setError(null);
    const res = await handToDinesh();
    if (!res.ok) {
      setError(res.error ?? 'Could not start the build.');
      setBuilding(false);
    }
    // On success the store navigates to The Bullpen and starts the build.
  };

  /* ----- create form ----- */
  // mode is driven by the mount effect: 'form' when a fresh express build was
  // requested (startRipItFresh) or no rip-it project is active; 'chat' otherwise.
  if (mode === 'form') {
    return (
      <div className="section">
        <div className="section-heading">
          <h2>Rip it and Ship It</h2>
          <StatusBadge tone="warn" label="Express lane" />
        </div>
        <div className="card">
          <p className="field-hint" style={{ marginTop: 0 }}>
            The fast lane: name it, tell {erlichName} what you want and drop in any reference files,
            and he&apos;ll lend you {dineshName} to build it on the spot. No design sessions, no review
            gates — just the build. You test it yourself when it&apos;s done.
          </p>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="ripit-name">Project name</label>
              <input
                id="ripit-name"
                value={name}
                placeholder="e.g. quick-landing-page"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="ripit-folder">Project folder</label>
              <div className="folder-row">
                <input
                  id="ripit-folder"
                  value={folder}
                  placeholder="Select the folder that will hold this project"
                  onChange={(e) => setFolder(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => void browseFolder()}>
                  Browse…
                </button>
              </div>
              <span className="field-hint">
                {dineshName} builds here in autopilot with real CLI permissions — pick a folder you
                trust.
              </span>
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn primary" disabled={!canCreate} onClick={() => void onCreate()}>
              {busy ? 'Setting up…' : `Take it to ${erlichName} →`}
            </button>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              Creates the project, then opens the chat with {erlichName}.
            </span>
          </div>
          {error && <p className="validation-note err" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  /* ----- chat + references + hand-off ----- */
  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <button type="button" className="btn primary" onClick={() => navigate('rip-it')}>
            Start Rip it and Ship It
          </button>
        </div>
      </div>
    );
  }

  const erlich = activeProject.team.stakeholder;
  const erlichAssigned = erlich.assignment !== null && erlich.assignment.command.trim() !== '';
  const dinesh = activeProject.team.developer;
  const dineshAssigned = dinesh.assignment !== null && dinesh.assignment.command.trim() !== '';
  const messages = conversations.stakeholder ?? [];
  const sending = roomSendingRole === 'stakeholder';
  // The engine is the gate for WHAT was provided: it accepts a chat brief OR a
  // references-only build and refuses cleanly when both are missing (the error
  // surfaces below) — so the button no longer demands a chat turn when Erlich has
  // a CLI, which made the references-only path the hint copy promises unreachable.
  // Never while a build is already running — re-handing off would rewrite the task
  // files under the live loop (the store guard is the backstop; this disables the button).
  const canBuild = dineshAssigned && !building && !bullpenRunning;

  return (
    <div className="room-page">
      <div className="section-heading">
        <h2>
          {erlichName} · {activeProject.info.projectName}
        </h2>
        <span className="section-note">Rip it and Ship It</span>
      </div>
      <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
        Tell {erlichName} what you&apos;re building and drop in any references (screenshots, a spec,
        brand assets). When you&apos;re ready, hand it to {dineshName} — he builds the whole thing in
        one pass, then tells you how to test it.
      </p>
      <RoomChat
        roleId="stakeholder"
        personaName={erlichName}
        messages={messages}
        sending={sending}
        error={roomError?.roleId === 'stakeholder' ? roomError.message : null}
        onSend={(text) => void sendRoomMessage('stakeholder', text)}
        onRetry={() => void retryRoomMessage('stakeholder')}
        placeholder="e.g. A one-page landing site for my app, dark theme, with an email signup."
        disabledNote={
          erlichAssigned
            ? undefined
            : `${erlichName} needs a CLI to chat. Assign one to the Stakeholder on Default Team — or just add reference files and hand it to ${dineshName}.`
        }
      />

      <div className="card" style={{ marginTop: 'var(--space-3)' }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>
          Reference material
        </div>
        <ReferencesPanel
          projectId={activeProject.registry.id}
          blurb={`Drop in screenshots, a wireframe, a spec, or brand assets. ${dineshName} reads these when he builds — a one-line note on each tells him what it is.`}
        />
      </div>

      <div className="card room-next">
        <button type="button" className="btn primary" disabled={!canBuild} onClick={() => void onHandToDinesh()}>
          {building ? 'Handing off…' : `Hand it to ${dineshName} →`}
        </button>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>
            Ready to build?
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            {!dineshAssigned
              ? `${dineshName} needs a CLI. Assign one to the Developer on Default Team first.`
              : canBuild
                ? `Tell ${erlichName} what to build (or just add references) — ${dineshName} builds it in one pass, then writes how to test it.`
                : `The build is running — let it finish before handing off again.`}
          </p>
        </div>
      </div>
      {error && <p className="validation-note err" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
