import { useEffect, useRef, useState } from 'react';
import type { ProjectCreateResult } from '../../shared/project';
import type { InstallOutcome } from '../../shared/scaffold';
import type { RoleId } from '../../shared/roles';
import { brandName } from '../../shared/naming';
import { defaultPersonaForRole, effectivePersonaName } from '../../shared/personas';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS } from '../../shared/roles';
import { BUILT_IN_TEMPLATES, activeTemplates } from '../../shared/templates';
import { overlaysFor, providedOverlayIds } from '../../shared/blueprints';
import { BuildPrereqsPanel } from '../components/BuildPrereqsPanel';
import { EasterEggSpot } from '../components/EasterEggSpot';
import { MessageText } from '../components/MessageText';
import { PersonaAvatar } from '../components/PersonaAvatar';
import { ReferencesPanel } from '../components/ReferencesPanel';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

interface DraftPitch {
  projectName: string;
  templateId: string;
  overlayIds: string[];
  gitTracking: boolean;
  verificationGates: boolean;
  reproBackedFindings: boolean;
  pitch: string;
  constraints: string;
  workspacePath: string;
}

const EMPTY_DRAFT: DraftPitch = {
  projectName: '',
  templateId: '',
  overlayIds: [],
  gitTracking: true,
  verificationGates: true,
  reproBackedFindings: false,
  pitch: '',
  constraints: '',
  workspacePath: '',
};

export function NewRunPage() {
  const settings = useAppStore((s) => s.settings);
  const namingMode = useAppStore((s) => s.namingMode);
  const createProject = useAppStore((s) => s.createProject);
  const sendRoomMessage = useAppStore((s) => s.sendRoomMessage);
  const retryRoomMessage = useAppStore((s) => s.retryRoomMessage);
  const loadRoom = useAppStore((s) => s.loadRoom);
  const conversations = useAppStore((s) => s.roomConversations);
  const roomSendingRole = useAppStore((s) => s.roomSendingRole);
  const roomError = useAppStore((s) => s.roomError);
  const activeProject = useAppStore((s) => s.activeProject);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const navigate = useAppStore((s) => s.navigate);

  const erlichName = effectivePersonaName(
    'stakeholder',
    settings.roles.stakeholder.personaNameOverride,
    namingMode,
  );
  const erlichGlobal = settings.roles.stakeholder.assignment;
  const erlichReady = erlichGlobal !== null && erlichGlobal.command.trim() !== '';
  const exampleProjectName = `${brandName('createdBy', namingMode)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-but-legal`;

  const [draft, setDraft] = useState<DraftPitch>(EMPTY_DRAFT);
  const [enabledRoles, setEnabledRoles] = useState<RoleId[]>(() => [...ALL_ROLE_IDS]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ProjectCreateResult | null>(null);
  // Live status of the BACKGROUND dependency install (create returns before it finishes);
  // null = use report.install as-is. Polled while pending — see the effect below.
  const [liveInstall, setLiveInstall] = useState<InstallOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set by "Pitch another project" to force a blank, editable form even when a
  // project is already active (which otherwise shows the read-only review).
  const [pitchingNew, setPitchingNew] = useState(false);
  // The Venture this fresh pitch belongs to — CAPTURED once when the fresh pitch
  // starts (the way startFreshPitch is consumed), so a stale store `pendingVenture`
  // from an abandoned flow can never leak its banner/tag onto an unrelated project
  // reached by plain navigation (sidebar "The Pitch", room "go pitch" CTAs, etc.).
  const [ventureTag, setVentureTag] = useState<{ id: string; name: string } | null>(null);
  // The starter-code scaffolder for THIS pitch — captured once like the venture tag.
  const [scaffoldId, setScaffoldId] = useState<string | null>(null);
  // StrictMode invokes effects TWICE on mount. The mount effect consumes the
  // one-shot startFreshPitch flag, so without this guard run 2 (seeing it already
  // cleared) would fall through and restore the active project's review — re-locking
  // the "New Project" form with the last project's data. Key by activeProjectId so a
  // genuine project switch still re-initializes; a real remount gets a fresh ref.
  const initedFor = useRef<string | null>(null);

  // On entry / when the active project changes: if a project is already active,
  // restore its pitch read-only for review (name/folder/template from the record,
  // the pitch text from the saved Stakeholder room) so nothing is lost on revisit.
  // Skipped while a pitch is in flight so it can't clobber the optimistic
  // transcript mid-creation.
  useEffect(() => {
    if (busy) {
      return;
    }
    const key = activeProjectId ?? '';
    if (initedFor.current === key) {
      return; // StrictMode's second invoke (or a re-render) — already initialized.
    }
    initedFor.current = key;
    setReport(null);
    setEnabledRoles([...ALL_ROLE_IDS]);
    // "New Project" (dashboard / Projects) asked for a fresh pitch — show a blank,
    // editable form even if a project is active, and skip the read-only restore.
    if (useAppStore.getState().startFreshPitch) {
      useAppStore.getState().setStartFreshPitch(false);
      setPitchingNew(true);
      // Capture the chosen Venture + scaffolder for THIS pitch only (consume-once).
      setVentureTag(useAppStore.getState().pendingVenture);
      setScaffoldId(useAppStore.getState().pendingScaffoldId);
      // Pre-apply the starting point chosen on the "Define your project" step: the
      // template seeds the pitch text + the lean role set (null = describe-it-myself).
      const presetTemplateId = useAppStore.getState().pendingTemplateId;
      // Overlays chosen in the wizard's Features step — pre-fill the pitch's selection.
      const presetOverlays = useAppStore.getState().pendingOverlayIds;
      const template = presetTemplateId
        ? BUILT_IN_TEMPLATES.find((t) => t.id === presetTemplateId)
        : undefined;
      if (template) {
        setDraft({
          ...EMPTY_DRAFT,
          templateId: template.id,
          pitch: template.promptStarter,
          overlayIds: presetOverlays,
        });
        setEnabledRoles([...template.defaultEnabledRoles]);
      } else {
        setDraft({ ...EMPTY_DRAFT, overlayIds: presetOverlays });
      }
      return;
    }
    setPitchingNew(false);
    // Not a fresh venture pitch — never show a venture banner / tag in review mode.
    setVentureTag(null);
    setScaffoldId(null);
    const info = useAppStore.getState().activeProject?.info;
    if (activeProjectId && info) {
      setDraft({
        projectName: info.projectName,
        templateId: info.templateId ?? '',
        overlayIds: info.overlayIds ?? [],
        gitTracking: info.gitTracking ?? true,
        verificationGates: info.verificationGates ?? true,
        reproBackedFindings: info.reproBackedFindings ?? false,
        pitch: '',
        constraints: '',
        workspacePath: info.workspacePath,
      });
      // Reflect the project's actual team when reviewing it (the form defaults to all
      // roles, but a created project — e.g. a POC — may have a leaner set).
      const team = useAppStore.getState().activeProject?.team;
      if (team) {
        setEnabledRoles(ALL_ROLE_IDS.filter((r) => team[r]?.enabled));
      }
      void (async () => {
        await loadRoom('stakeholder');
        const msgs = useAppStore.getState().roomConversations.stakeholder ?? [];
        const firstUser = msgs.find((m) => m.role === 'user');
        if (firstUser) {
          setDraft((d) => ({ ...d, pitch: firstUser.text }));
        }
      })();
    } else {
      setDraft(EMPTY_DRAFT);
    }
    // Intentionally keyed only on the active project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // The dependency install runs in the BACKGROUND after create returns. While it's
  // pending, poll its status so the post-create note flips from "Installing…" to ✓/✗
  // without blocking the pitch. Polls only while pending; stops on the first terminal
  // status, on unmount, or when a new project is pitched (the id changes).
  useEffect(() => {
    setLiveInstall(null);
    const id = report?.registry.id;
    if (!id || !report?.install.pending) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async (): Promise<void> => {
      try {
        const status = await window.nucleus.project.installStatus(id);
        if (cancelled) return;
        setLiveInstall(status);
        if (status.pending) timer = setTimeout(tick, 2500);
      } catch {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };
    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [report?.registry.id, report?.install.pending]);

  const update = (patch: Partial<DraftPitch>) => setDraft((d) => ({ ...d, ...patch }));

  const applyTemplate = (templateId: string) => {
    const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
    // Drop any selected overlays that don't apply to the newly chosen archetype.
    const stillApplicable = new Set(overlaysFor(templateId || null).map((o) => o.id));
    const provided = new Set(providedOverlayIds(templateId || null));
    update({
      templateId,
      // Keep applicable overlays, minus the ones this template already bakes in.
      overlayIds: draft.overlayIds.filter((id) => stillApplicable.has(id) && !provided.has(id)),
      pitch: template && draft.pitch.trim() === '' ? template.promptStarter : draft.pitch,
    });
    // Align the team with the template's recommended roles so a lean template (e.g. POC)
    // actually runs lean. Picking a template seeds its defaultEnabledRoles; "None — start
    // from scratch" falls back to the full roster.
    setEnabledRoles(template ? [...template.defaultEnabledRoles] : [...ALL_ROLE_IDS]);
  };

  const availableOverlays = overlaysFor(draft.templateId || null);
  const providedOverlays = new Set(providedOverlayIds(draft.templateId || null));
  const toggleOverlay = (overlayId: string) =>
    update({
      overlayIds: draft.overlayIds.includes(overlayId)
        ? draft.overlayIds.filter((id) => id !== overlayId)
        : [...draft.overlayIds, overlayId],
    });

  const toggleRole = (roleId: RoleId) =>
    setEnabledRoles((roles) =>
      roles.includes(roleId) ? roles.filter((r) => r !== roleId) : [...roles, roleId],
    );

  const browseFolder = async () => {
    const folder = await window.nucleus.project.selectFolder();
    if (folder) {
      update({ workspacePath: folder });
    }
  };

  // Revisiting an already-pitched project is read-only review: the pitch + folder
  // can't change after creation. "Pitch another project" returns to a fresh form.
  const reviewMode = activeProject !== null && report === null && !pitchingNew;
  const formLocked = report !== null || reviewMode;
  // Reference uploads attach to THIS project, so only once it exists — right after
  // a pitch (report set) or when reviewing an existing one. Never during a blank
  // fresh-pitch (where `activeProject` is still the previous project).
  const showReferences = activeProject !== null && (report !== null || reviewMode);

  // A lean template (e.g. POC) disables the Project Lead seat — skip Monica's design room
  // and send the founder from Erlich straight to Richard's Whiteboard.
  const projectLeadEnabled = activeProject?.team?.projectLead?.enabled ?? true;
  const afterPitchPage = projectLeadEnabled ? 'investor-pitch' : 'whiteboard';
  const afterPitchLabel = projectLeadEnabled
    ? 'Continue to Investor Pitch →'
    : 'Continue to The Whiteboard →';

  const startNewPitch = () => {
    setPitchingNew(true);
    setReport(null);
    setDraft(EMPTY_DRAFT);
    setEnabledRoles([...ALL_ROLE_IDS]);
    // "Pitch another project" is a fresh STANDALONE pitch — drop any captured venture
    // + scaffolder so the next created project isn't silently filed under them.
    setVentureTag(null);
    setScaffoldId(null);
  };

  const canPitch =
    draft.projectName.trim() !== '' &&
    draft.pitch.trim() !== '' &&
    draft.workspacePath.trim() !== '' &&
    enabledRoles.length > 0 &&
    !busy &&
    report === null &&
    !reviewMode;

  const onPitch = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createProject({
        projectName: draft.projectName.trim(),
        productIdea: draft.pitch.trim(),
        // Platform + stack are decided later by Richard, not here.
        targetPlatform: '',
        targetStack: '',
        constraints: draft.constraints.trim(),
        workspacePath: draft.workspacePath.trim(),
        enabledRoles,
        templateId: draft.templateId || null,
        overlayIds: draft.overlayIds,
        gitTracking: draft.gitTracking,
        verificationGates: draft.verificationGates,
        reproBackedFindings: draft.reproBackedFindings,
        ventureId: ventureTag?.id,
        ventureName: ventureTag?.name,
        scaffoldId: scaffoldId ?? undefined,
      });
      setReport(result);
      // Erlich reacts to the pitch — saved with the project for review.
      await sendRoomMessage('stakeholder', draft.pitch.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const erlichReply = (conversations.stakeholder ?? []).find((m) => m.role === 'persona');
  const erlichSending = roomSendingRole === 'stakeholder';
  const hasErlichReply = erlichReply !== undefined;
  // The shared roomError, scoped to Erlich's seat — a failure in another room must
  // not unlock this gate or render under the pitch.
  const erlichError = roomError?.roleId === 'stakeholder' ? roomError.message : null;
  // Continue stays locked only during an in-flight FRESH pitch — i.e. the project
  // was just created (report set) and we're waiting for Erlich's first reply. If his
  // pitch turn failed (erlichError, e.g. no CLI), open the gate anyway — the project
  // already exists. When reviewing/resuming an existing project (report === null),
  // the gate is never locked: the single Continue button lives in Erlich's panel now,
  // so a resumed project without a saved reply must still be able to move forward.
  const continueLocked = report !== null && !hasErlichReply && erlichError === null;
  // Show the Erlich panel after a fresh pitch OR when resuming a saved one.
  const showErlichPanel = report !== null || hasErlichReply || erlichSending;
  const resuming = report === null && hasErlichReply && activeProject !== null;

  return (
    <>
      <div className="section">
        {ventureTag && (
          <div
            className="card"
            style={{ marginBottom: 'var(--space-3)', borderLeft: '3px solid var(--accent)' }}
          >
            <strong>Venture: {ventureTag.name}</strong>
            <p className="field-hint" style={{ marginTop: 'var(--space-1)' }}>
              This is the first piece of your venture. Build it, then add the next piece from the
              Projects page — your product grows one project at a time.
            </p>
          </div>
        )}
        {report?.scaffold?.attempted && (
          <div
            className="card"
            style={{
              marginBottom: 'var(--space-3)',
              borderLeft: `3px solid ${report.scaffold.ok ? 'var(--accent)' : 'var(--warn)'}`,
            }}
          >
            {report.scaffold.ok ? (
              <>
                <div>
                  ✓ Generated a <strong>{report.scaffold.label}</strong> starter app at the project
                  root — the team builds on it instead of an empty folder.
                </div>
                {(() => {
                  // Show the live background-install status (falls back to the create result).
                  const inst = liveInstall ?? report.install;
                  if (!inst.attempted) return null;
                  return (
                    <div style={{ marginTop: 'var(--space-1)' }}>
                      {inst.pending ? (
                        <span className="field-hint">
                          ⏳ Installing dependencies in the background — you can keep pitching; it’ll
                          be ready by the time the team builds.
                        </span>
                      ) : inst.ok ? (
                        '✓ Installed its dependencies.'
                      ) : (
                        <span style={{ color: 'var(--warn)' }}>
                          ⚠ Dependencies didn’t install
                          {inst.error ? `: ${inst.error}` : ''} — run <code>npm install</code> in the
                          project folder.
                        </span>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <span>
                ⚠ Couldn’t generate the starter app
                {report.scaffold.error ? `: ${report.scaffold.error}` : ''}. The project was still
                created — the team will build from scratch.
              </span>
            )}
          </div>
        )}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
            {reviewMode ? 'Your pitch (review)' : activeProject ? 'Pitch a new project' : 'Pitch your project'}
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="np-name">Project name</label>
              <input
                id="np-name"
                value={draft.projectName}
                disabled={formLocked}
                placeholder={`e.g. ${exampleProjectName}`}
                onChange={(e) => update({ projectName: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="np-template">Template</label>
              <select
                id="np-template"
                value={draft.templateId}
                disabled={formLocked}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">None — start from scratch</option>
                {activeTemplates().map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field span-2">
              <label>Capabilities (optional)</label>
              <div className="role-checkboxes">
                {/* Git is always available — it's a per-project version-control choice,
                    not a blueprint overlay. It leads the list, then the applicable overlays. */}
                <label
                  className="toggle-row"
                  title="Version-control this project: git init at setup + a commit after every Bullpen step."
                >
                  <input
                    type="checkbox"
                    checked={draft.gitTracking}
                    disabled={formLocked}
                    onChange={(e) => setDraft({ ...draft, gitTracking: e.target.checked })}
                  />
                  Git tracking
                </label>
                <label
                  className="toggle-row"
                  title="Run objective checks (typecheck / build / tests / secret-scan) at QA time and feed the real exit codes into the verdict. No-op when the project has no such scripts."
                >
                  <input
                    type="checkbox"
                    checked={draft.verificationGates}
                    disabled={formLocked}
                    onChange={(e) => setDraft({ ...draft, verificationGates: e.target.checked })}
                  />
                  Verification gates
                </label>
                <label
                  className="toggle-row"
                  title="A security/architect 'defect' finding auto-creates a fix task only if the reviewer ships a failing test that reproduces it (the engine runs it). Defects without a confirmed repro are logged for triage instead of building. Opt-in; off by default."
                >
                  <input
                    type="checkbox"
                    checked={draft.reproBackedFindings}
                    disabled={formLocked}
                    onChange={(e) => setDraft({ ...draft, reproBackedFindings: e.target.checked })}
                  />
                  Repro-backed findings
                </label>
                {availableOverlays.map((overlay) => {
                  const included = providedOverlays.has(overlay.id);
                  return (
                    <label
                      key={overlay.id}
                      className="toggle-row"
                      title={
                        included
                          ? `Already included in this template — ${overlay.description}`
                          : overlay.description
                      }
                    >
                      <input
                        type="checkbox"
                        checked={included || draft.overlayIds.includes(overlay.id)}
                        disabled={formLocked || included}
                        onChange={() => toggleOverlay(overlay.id)}
                      />
                      {overlay.name}
                      {included ? ' · included' : ''}
                    </label>
                  );
                })}
              </div>
              <span className="field-hint">
                Pre-answer the build: git version-control, plus capabilities the team designs and builds
                in (database, sign-in, email, payments). Greyed-out ones are already part of the chosen
                template.
              </span>
            </div>

            <BuildPrereqsPanel templateId={draft.templateId || null} overlayIds={draft.overlayIds} />

            <div className="field span-2">
              <label htmlFor="np-pitch">Your pitch</label>
              <textarea
                id="np-pitch"
                value={draft.pitch}
                disabled={formLocked}
                placeholder="Pitch the idea — what are you building, and why is it inevitable?"
                onChange={(e) => update({ pitch: e.target.value })}
              />
            </div>

            <div className="field span-2">
              <label htmlFor="np-constraints">Constraints (optional)</label>
              <textarea
                id="np-constraints"
                value={draft.constraints}
                disabled={formLocked}
                placeholder="Anything the team must respect: licensing, offline-first, no external services…"
                onChange={(e) => update({ constraints: e.target.value })}
              />
            </div>

            <div className="field span-2">
              <label htmlFor="np-folder">Project folder</label>
              <div className="folder-row">
                <input
                  id="np-folder"
                  value={draft.workspacePath}
                  disabled={formLocked}
                  placeholder="Select the folder that will hold this project"
                  onChange={(e) => update({ workspacePath: e.target.value })}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={formLocked}
                  onClick={() => void browseFolder()}
                >
                  Browse…
                </button>
              </div>
              <span className="field-hint">
                The team works in this folder. Autopilot runs real CLIs here with their own
                permissions — it&apos;s their working directory, not a hard sandbox, so pick a folder
                you trust.
              </span>
            </div>

            {showReferences && activeProject && (
              <div className="field span-2">
                <label>
                  Reference material{' '}
                  <span className="field-hint" style={{ fontWeight: 'normal' }}>
                    — optional, and it helps the whole team build
                  </span>
                </label>
                <ReferencesPanel
                  projectId={activeProject.registry.id}
                  blurb={`Hand the team what's in your head: screenshots of the look you want, a wireframe, a spec, brand colors. ${erlichName}, Monica, and the build crew all read these — add a one-line note on each so they know what it is.`}
                />
              </div>
            )}

            <div className="field span-2">
              <label>Enabled roles</label>
              <div className="role-checkboxes">
                {ALL_ROLE_IDS.map((roleId) => (
                  <label key={roleId} className="toggle-row">
                    <input
                      type="checkbox"
                      checked={enabledRoles.includes(roleId)}
                      disabled={formLocked}
                      onChange={() => toggleRole(roleId)}
                    />
                    {effectivePersonaName(
                      roleId,
                      settings.roles[roleId].personaNameOverride,
                      namingMode,
                    )}{' '}
                    · {ROLE_DEFINITIONS[roleId].label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {!erlichReady && report === null && (
            <p className="field-hint" style={{ marginTop: 'var(--space-3)', color: 'var(--warn)' }}>
              {erlichName} has no CLI, so he can&apos;t react yet — assign one to the Stakeholder on
              Default Team. (You can still pitch; the project gets created either way.)
            </p>
          )}

          {/* The form's action row. "Continue to Investor Pitch" lives ONLY in
              Erlich's verdict panel below — here we keep just the submit action and
              the review-mode escape, so there's a single Continue on the page. */}
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {reviewMode ? (
              <>
                <button type="button" className="btn" onClick={startNewPitch}>
                  Pitch another project
                </button>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                  This pitch is locked — review only. {erlichName}&apos;s take and the next step are below.
                </span>
              </>
            ) : report === null ? (
              <>
                <button type="button" className="btn primary" disabled={!canPitch} onClick={() => void onPitch()}>
                  {busy
                    ? scaffoldId
                      ? 'Generating starter app…'
                      : 'Pitching…'
                    : `Pitch to ${erlichName}`}
                </button>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                  {scaffoldId
                    ? `Generates your starter app, then creates the project and pitches it to ${erlichName}. Its dependencies install in the background while you pitch.`
                    : `Creates the project and pitches it to ${erlichName}.`}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                {continueLocked
                  ? `${erlichName} is sizing up your pitch — his verdict appears below.`
                  : `Project created. ${erlichName}'s verdict and the next step are below.`}
              </span>
            )}
          </div>
        </div>
      </div>

      {(showErlichPanel || reviewMode) && (
        <div className="section">
          <div className="section-heading">
            <h2>
              {erlichName}&apos;s {resuming ? 'take' : 'verdict'}
            </h2>
            <StatusBadge
              tone="ok"
              label={resuming ? `Resuming: ${activeProject?.info.projectName ?? 'project'}` : 'In the incubator'}
            />
          </div>
          <div className="card">
            {erlichSending && <p className="field-hint">{erlichName} is sizing you up…</p>}
            {erlichReply && (
              <div className="pitch-msg erlich" style={{ maxWidth: '100%' }}>
                <span className="pitch-who-row">
                  <PersonaAvatar
                    personaId={defaultPersonaForRole('stakeholder')?.id}
                    name={erlichName}
                    size={22}
                    headFocus
                  />
                  <span className="pitch-who">{erlichName}</span>
                </span>
                <MessageText text={erlichReply.text} />
              </div>
            )}
            {erlichError && !erlichReply && (
              <div>
                <p className="validation-note err">{erlichError}</p>
                {/* The pitch is the first CLI interaction; a timed-out turn shouldn't dead-end.
                    Retry re-sends the pitch (still saved in the transcript) to get Erlich's read
                    — the project already exists either way, so Continue stays available too. */}
                <button
                  type="button"
                  className="btn sm"
                  disabled={erlichSending}
                  onClick={() => void retryRoomMessage('stakeholder')}
                >
                  {erlichSending ? 'Retrying…' : `Retry — get ${erlichName}'s read`}
                </button>
              </div>
            )}
            {(report?.project.workspacePath ?? activeProject?.info.workspacePath) && (
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
                <code>{report?.project.workspacePath ?? activeProject?.info.workspacePath}</code>
              </p>
            )}
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="btn primary"
                disabled={continueLocked}
                onClick={() => navigate(afterPitchPage)}
              >
                {continueLocked ? `Waiting for ${erlichName}…` : afterPitchLabel}
              </button>
              <button
                type="button"
                className="btn"
                disabled={continueLocked}
                onClick={() => navigate('project')}
              >
                Project Detail
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="section">
          <div className="card" style={{ borderColor: 'var(--error)' }}>
            <div className="role-card-top">
              <div className="card-title" style={{ marginBottom: 0 }}>
                Pitch failed
              </div>
              <StatusBadge tone="error" label="Error" />
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 8 }}>
              {error}
            </p>
          </div>
        </div>
      )}

      {/* The lei — hunt trigger #2, hung in Erlich's incubator once the first
          clue cracks (Bachmanity was his company; shared/easterEggs.ts). */}
      <EasterEggSpot trigger="lei" />
    </>
  );
}
