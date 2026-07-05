import { useEffect, useState } from 'react';
import { ALL_ROLE_IDS } from '../../shared/roles';
import { ReferencesPanel } from '../components/ReferencesPanel';
import { RoleConfigCard } from '../components/RoleConfigCard';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

export function ProjectDetailPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const updateProjectRoleConfig = useAppStore((s) => s.updateProjectRoleConfig);
  const projectValidationResults = useAppStore((s) => s.projectValidationResults);
  const validateActiveProjectTeam = useAppStore((s) => s.validateActiveProjectTeam);
  const validateActiveProjectRole = useAppStore((s) => s.validateActiveProjectRole);
  const isValidatingProject = useAppStore((s) => s.isValidatingProject);
  const addBacklogItem = useAppStore((s) => s.addBacklogItem);
  const navigate = useAppStore((s) => s.navigate);

  const [backlogText, setBacklogText] = useState('');
  const [backlogNote, setBacklogNote] = useState<string | null>(null);
  // Show what's actually IN the backlog — the "Add to backlog" form was write-only until now.
  const [backlogDoc, setBacklogDoc] = useState<string | null>(null);
  const projectId = activeProject?.registry.id;
  const fetchBacklog = () => {
    if (projectId && typeof window.nucleus !== 'undefined') {
      void window.nucleus.project
        .readDoc(projectId, 'project-backlog')
        .then(setBacklogDoc)
        .catch(() => setBacklogDoc(null));
    }
  };
  useEffect(fetchBacklog, [projectId]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Open a project to see its team, backlog, and workspace health.</p>
          <button type="button" className="btn primary" onClick={() => navigate('projects')}>
            Go to Projects
          </button>
        </div>
      </div>
    );
  }

  const { info, team, validation } = activeProject;

  const onAddBacklog = async () => {
    const text = backlogText.trim();
    if (text === '') {
      return;
    }
    await addBacklogItem(text);
    setBacklogText('');
    setBacklogNote(`Added to backlog: "${text}"`);
    fetchBacklog(); // reflect the new item immediately
  };

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="role-card-top">
            <div>
              <div className="role-persona">{info.projectName}</div>
              <p className="role-flavor" title={info.workspacePath}>
                <code>{info.workspacePath}</code>
              </p>
            </div>
            {validation.ok ? (
              <StatusBadge tone="ok" label="Workspace healthy" />
            ) : (
              <StatusBadge tone="error" label={`${validation.errorCount} workspace error(s)`} />
            )}
          </div>
          <div className="role-meta" style={{ marginTop: 'var(--space-2)' }}>
            <span>Created {info.createdAt.slice(0, 10)}</span>
            <span>
              {validation.taskCount} task(s) · {validation.openEscalations} open escalation(s)
            </span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Reference material</h2>
          <span className="section-note">Screenshots, specs, brand assets — the team reads these when building</span>
        </div>
        <div className="card">
          <ReferencesPanel projectId={activeProject.registry.id} />
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Add to backlog</h2>
          <span className="section-note">New work for this project — a library, tests, a feature</span>
        </div>
        <div className="card">
          <div className="folder-row">
            <input
              value={backlogText}
              placeholder="e.g. Add a shared validation library with unit tests"
              onChange={(e) => {
                setBacklogText(e.target.value);
                setBacklogNote(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void onAddBacklog();
                }
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={backlogText.trim() === ''}
              onClick={() => void onAddBacklog()}
            >
              Add
            </button>
          </div>
          {backlogNote && (
            <span className="validation-note ok" style={{ marginTop: 'var(--space-2)' }}>
              {backlogNote} — the Architect will plan it into tasks on the next run.
            </span>
          )}
          {(backlogDoc ?? '').split('\n').some((l) => /^\s*[-*]\s+\S/.test(l)) && (
            <details className="card" style={{ marginTop: 'var(--space-3)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'var(--font-weight-bold)' }}>
                Current backlog
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 280,
                  overflow: 'auto',
                  fontSize: 'var(--font-size-xs)',
                  margin: 'var(--space-2) 0 0',
                }}
              >
                {backlogDoc}
              </pre>
            </details>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Project team</h2>
          <span className="section-note">Independent of your default template</span>
        </div>
        <div className="team-toolbar">
          <button
            type="button"
            className="btn primary"
            disabled={isValidatingProject}
            onClick={() => void validateActiveProjectTeam()}
          >
            {isValidatingProject ? 'Validating…' : 'Validate Team'}
          </button>
          <button
            type="button"
            className="btn"
            title="Open The Bullpen to run the build"
            onClick={() => navigate('bullpen')}
          >
            Open The Bullpen
          </button>
        </div>
        <div className="role-panel-list">
          {ALL_ROLE_IDS.map((roleId) => (
            <RoleConfigCard
              key={roleId}
              config={team[roleId]}
              onPatch={(patch) => updateProjectRoleConfig(roleId, patch)}
              validation={projectValidationResults[roleId]}
              onValidate={() => void validateActiveProjectRole(roleId)}
              isValidating={isValidatingProject}
            />
          ))}
        </div>
      </div>
    </>
  );
}
