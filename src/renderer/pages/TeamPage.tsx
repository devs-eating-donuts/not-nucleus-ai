import { ALL_ROLE_IDS, ROLE_DEFINITIONS } from '../../shared/roles';
import { DEFAULT_PERSONAS, personaDisplayName } from '../../shared/personas';
import { isDefaultTeamReady, unassignedChainRoles } from '../../shared/settings';
import type { SettingsSaveState } from '../state/appStore';
import { useAppStore } from '../state/appStore';
import { PersonaAvatar } from '../components/PersonaAvatar';
import { RoleConfigCard } from '../components/RoleConfigCard';
import { StatusBadge } from '../components/StatusBadge';

const SAVE_STATE_TEXT: Record<SettingsSaveState, string> = {
  idle: 'Changes save automatically',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Save failed — settings could not be written',
};

export function TeamPage() {
  const settings = useAppStore((s) => s.settings);
  const saveState = useAppStore((s) => s.settingsSaveState);
  const resetSettings = useAppStore((s) => s.resetSettings);
  const validateTeam = useAppStore((s) => s.validateTeam);
  const validateRole = useAppStore((s) => s.validateRole);
  const updateRoleConfig = useAppStore((s) => s.updateRoleConfig);
  const isValidating = useAppStore((s) => s.isValidating);
  const namingMode = useAppStore((s) => s.namingMode);
  const validationResults = useAppStore((s) => s.validationResults);
  const pendingNewProject = useAppStore((s) => s.pendingNewProject);
  const beginNewProject = useAppStore((s) => s.beginNewProject);
  const justOnboarded = useAppStore((s) => s.justOnboarded);
  const navigate = useAppStore((s) => s.navigate);
  const flavorOnly = DEFAULT_PERSONAS.filter((p) => p.flavorOnly);

  // When the user arrived here because "New Project" was blocked by dead seats, show
  // a Continue CTA — enabled once every lifecycle-chain role has a CLI assigned.
  const teamReady = isDefaultTeamReady(settings.roles);
  const missingChain = unassignedChainRoles(settings.roles);

  const results = Object.values(validationResults).filter(
    (r): r is NonNullable<typeof r> => r !== undefined,
  );
  const readyCount = results.filter((r) => r.status === 'ready').length;
  const problemCount = results.filter(
    (r) => r.status === 'missing' || r.status === 'invalid' || r.status === 'error',
  ).length;
  const unassignedCount = results.filter((r) => r.status === 'unverified').length;
  const summary =
    results.length === 0
      ? 'Not validated yet'
      : `${readyCount} ready · ${problemCount} need attention · ${unassignedCount} unassigned`;

  const onReset = () => {
    if (window.confirm('Reset all team configuration to defaults? CLI assignments will be removed.')) {
      void resetSettings();
    }
  };

  return (
    <>
      {pendingNewProject && (
        <div className="card pitch-gate-banner">
          <div className="pitch-gate-text">
            <strong>Set up your team before pitching</strong>
            <p>
              A new project copies this roster, so every lifecycle role needs a CLI — assign them
              below (and <em>Validate Team</em> to be sure they run), then continue to your pitch.
            </p>
            {!teamReady && (
              <p className="validation-note err" style={{ margin: 0 }}>
                Still needs a CLI: {missingChain.map((r) => ROLE_DEFINITIONS[r].label).join(', ')}.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={!teamReady}
            onClick={() => beginNewProject()}
            title={teamReady ? undefined : 'Assign a CLI to every lifecycle role first'}
          >
            Continue to New Project →
          </button>
        </div>
      )}

      {justOnboarded && !pendingNewProject && (
        <div className="card pitch-gate-banner">
          <div className="pitch-gate-text">
            <strong>You’re in — now set up your team</strong>
            <p>
              Assign a CLI to each role in the build chain (one CLI can cover them all),
              then head to your home base.
            </p>
            {!teamReady && (
              <p className="validation-note err" style={{ margin: 0 }}>
                Still needs a CLI: {missingChain.map((r) => ROLE_DEFINITIONS[r].label).join(', ')}.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={!teamReady}
            onClick={() => navigate('dashboard')}
            title={teamReady ? undefined : 'Assign a CLI to every lifecycle role first'}
          >
            Continue to Hacker Hostel →
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          This is your <strong>default team template</strong>. New projects copy it at
          creation, then each project can tweak its own roster independently on its Project page.
        </span>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Core roles</h2>
          <span className="section-note" role="status">
            {SAVE_STATE_TEXT[saveState]}
          </span>
        </div>
        <div className="team-toolbar">
          <button
            type="button"
            className="btn primary"
            disabled={isValidating}
            onClick={() => void validateTeam()}
          >
            {isValidating ? 'Validating…' : 'Validate Team'}
          </button>
          <span className="section-note" role="status">
            {isValidating ? 'Interrogating executables…' : summary}
          </span>
        </div>
        <div className="role-panel-list">
          {ALL_ROLE_IDS.map((roleId) => (
            <RoleConfigCard
              key={roleId}
              config={settings.roles[roleId]}
              onPatch={(patch) => updateRoleConfig(roleId, patch)}
              validation={validationResults[roleId]}
              onValidate={() => void validateRole(roleId)}
              isValidating={isValidating}
            />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Advisory board</h2>
          <span className="section-note">Flavor only. They do not run CLIs. They barely run meetings.</span>
        </div>
        <div className="card-grid">
          {flavorOnly.map((p) => (
            <div key={p.id} className="card role-card">
              <div className="role-card-top">
                <div className="persona-id-row">
                  <PersonaAvatar personaId={p.id} name={personaDisplayName(p, namingMode)} size={64} headFocus />
                  <div>
                    <div className="role-persona">{personaDisplayName(p, namingMode)}</div>
                    <div className="role-title">{p.title}</div>
                  </div>
                </div>
                <StatusBadge tone="neutral" label="Advisory" dot={false} />
              </div>
              <p className="role-flavor">{p.flavor}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Danger zone</h2>
        </div>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn" onClick={onReset}>
            Reset team to defaults
          </button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            Removes all CLI assignments and persona renames. The advisory board, regrettably,
            survives.
          </span>
        </div>
      </div>
    </>
  );
}
