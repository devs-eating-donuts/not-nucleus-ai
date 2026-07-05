import { useState } from 'react';
import type { ProjectRegistryEntry } from '../../shared/project';
import { useAppStore } from '../state/appStore';
import { StatusBadge } from '../components/StatusBadge';

export function ProjectsPage() {
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const exportProject = useAppStore((s) => s.exportProject);
  const navigate = useAppStore((s) => s.navigate);
  const beginNewProject = useAppStore((s) => s.beginNewProject);
  const addProjectToVenture = useAppStore((s) => s.addProjectToVenture);

  const [target, setTarget] = useState<ProjectRegistryEntry | null>(null);
  const [alsoFolder, setAlsoFolder] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const onOpen = async (id: string) => {
    await openProject(id);
    navigate('project');
  };

  const openDeleteModal = (entry: ProjectRegistryEntry) => {
    setTarget(entry);
    setAlsoFolder(false);
    setError(null);
    setExportNote(null);
  };

  const closeModal = () => {
    if (!deleting && !exporting) {
      setTarget(null);
      setError(null);
      setExportNote(null);
    }
  };

  const onExport = async () => {
    if (!target) {
      return;
    }
    setExporting(true);
    setExportNote(null);
    try {
      const res = await exportProject(target.id);
      if (res.ok && res.path) {
        setExportNote(`Saved conversations to ${res.path}`);
      } else if (res.error) {
        setExportNote(`Export failed: ${res.error}`);
      }
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!target) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(target.id, alsoFolder);
      setTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  // Group projects under their Venture (a lightweight shared tag); projects with no
  // venture are listed on their own. The registry list is already newest-first, so
  // venture order follows whichever was touched most recently.
  const ventureOrder: string[] = [];
  const ventureGroups = new Map<string, { name: string; projects: ProjectRegistryEntry[] }>();
  const standalone: ProjectRegistryEntry[] = [];
  for (const p of projects) {
    if (p.ventureId && p.ventureName) {
      let group = ventureGroups.get(p.ventureId);
      if (!group) {
        group = { name: p.ventureName, projects: [] };
        ventureGroups.set(p.ventureId, group);
        ventureOrder.push(p.ventureId);
      }
      group.projects.push(p);
    } else {
      standalone.push(p);
    }
  }

  const renderCard = (p: ProjectRegistryEntry) => (
    <div key={p.id} className="card role-card">
      <div className="role-card-top">
        <div className="role-persona">{p.name}</div>
        {p.id === activeProjectId ? (
          <StatusBadge tone="ok" label="Active" />
        ) : (
          <StatusBadge tone="neutral" label="Idle" dot={false} />
        )}
      </div>
      <p className="role-flavor" title={p.workspacePath}>
        <code>{p.workspacePath}</code>
      </p>
      <div className="role-meta">
        <span>Created {p.createdAt.slice(0, 10)}</span>
        <span>Last opened {p.lastOpenedAt.slice(0, 10)}</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button type="button" className="btn primary" onClick={() => void onOpen(p.id)}>
          Open
        </button>
        <button type="button" className="btn danger" onClick={() => openDeleteModal(p)}>
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="section">
      <div className="section-heading">
        <h2>Projects</h2>
        {/* When there are no projects the empty-state panel below already offers the
            CTA — don't double it up here. Show this only once projects exist. */}
        {projects.length > 0 && (
          <button type="button" className="btn primary" onClick={() => beginNewProject()}>
            New Project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No projects yet</div>
          <p>
            Create your first project — Nucleus-AI initializes its workspace, copies your default
            team, and remembers it here so you can run as many as you like side by side.
          </p>
          <button type="button" className="btn primary" onClick={() => beginNewProject()}>
            New Project
          </button>
        </div>
      ) : (
        <>
          {ventureOrder.map((vid) => {
            const group = ventureGroups.get(vid)!;
            return (
              <div key={vid} style={{ marginBottom: 'var(--space-4)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    🚀 {group.name}{' '}
                    <span className="field-tag">
                      Venture · {group.projects.length} project
                      {group.projects.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => addProjectToVenture(vid, group.name)}
                  >
                    + Add a project
                  </button>
                </div>
                <div className="card-grid wide">{group.projects.map(renderCard)}</div>
              </div>
            );
          })}
          {standalone.length > 0 && (
            <div>
              {ventureOrder.length > 0 && (
                <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>
                  Standalone projects
                </div>
              )}
              <div className="card-grid wide">{standalone.map(renderCard)}</div>
            </div>
          )}
        </>
      )}

      {target && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="role-card-top">
              <div className="card-title" style={{ marginBottom: 0 }}>
                Delete “{target.name}”?
              </div>
              <StatusBadge tone="warn" label="Destructive" dot={false} />
            </div>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
              This removes the project from Nucleus-AI and deletes its app data
              (<code>.nucleus</code>: conversations with Erlich, Monica &amp; Richard, the plan, and
              telemetry). By default your workspace files — the generated code and docs — stay on
              disk.
            </p>

            <label
              className="toggle-row"
              style={{ marginTop: 'var(--space-2)', alignItems: 'flex-start', gap: 'var(--space-2)' }}
            >
              <input
                type="checkbox"
                checked={alsoFolder}
                disabled={deleting}
                onChange={(e) => setAlsoFolder(e.target.checked)}
              />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                Also permanently delete the entire project folder and{' '}
                <strong>everything in it, including the generated code</strong>, at{' '}
                <code>{target.workspacePath}</code>. This cannot be undone.
              </span>
            </label>

            <p className="field-hint" style={{ marginTop: 'var(--space-3)' }}>
              Want to keep the conversations? Export them first — the file is saved wherever you
              choose, so it survives the delete.
            </p>

            {exportNote && (
              <p className="validation-note ok" style={{ marginTop: 'var(--space-1)' }}>
                {exportNote}
              </p>
            )}

            {error && (
              <p className="validation-note err" style={{ marginTop: 'var(--space-2)' }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn"
                disabled={deleting || exporting}
                onClick={() => void onExport()}
              >
                {exporting ? 'Exporting…' : 'Export conversations'}
              </button>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn" disabled={deleting || exporting} onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={deleting || exporting}
                  onClick={() => void confirmDelete()}
                >
                  {deleting
                    ? 'Deleting…'
                    : alsoFolder
                      ? 'Delete project & folder'
                      : 'Delete project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
