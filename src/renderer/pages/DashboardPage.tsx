import { useEffect } from 'react';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS, defaultChainRoles } from '../../shared/roles';
import type { RunStatus } from '../../shared/run';
import { useAppStore } from '../state/appStore';
import { EasterEggSpot } from '../components/EasterEggSpot';
import { StatusBadge } from '../components/StatusBadge';

const RUN_STATUS_BADGE: Record<RunStatus, { tone: 'ok' | 'info' | 'warn' | 'neutral'; label: string }> = {
  complete: { tone: 'ok', label: 'Complete' },
  running: { tone: 'info', label: 'Running' },
  escalated: { tone: 'warn', label: 'Escalated' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  interrupted: { tone: 'warn', label: 'Interrupted' },
};

const DEFAULT_CHAIN_LABEL = defaultChainRoles()
  .map((id) => ROLE_DEFINITIONS[id].label)
  .join(' → ');

export function DashboardPage() {
  const settings = useAppStore((s) => s.settings);
  const navigate = useAppStore((s) => s.navigate);
  const beginNewProject = useAppStore((s) => s.beginNewProject);
  const beginRipItProject = useAppStore((s) => s.beginRipItProject);
  const projects = useAppStore((s) => s.projects);
  const dashboardStats = useAppStore((s) => s.dashboardStats);
  const loadDashboardStats = useAppStore((s) => s.loadDashboardStats);

  // Aggregate run history across every project for the completed-count + recent-runs.
  useEffect(() => {
    void loadDashboardStats();
  }, [loadDashboardStats]);

  // The canonical build chain (now includes Jared/Ops at the end) — the count and
  // readiness track this, not the per-role enabled flags, so the label and the
  // number always agree.
  const chainRoles = defaultChainRoles().map((id) => settings.roles[id]);
  const enabledCount = chainRoles.length;
  const assignedCount = ALL_ROLE_IDS.filter((id) => settings.roles[id].assignment !== null).length;
  const chainAssignedCount = chainRoles.filter((r) => r.assignment !== null).length;
  const unstaffed = Math.max(0, enabledCount - chainAssignedCount);
  const teamReady = enabledCount > 0 && unstaffed === 0;
  const activeProjectCount = projects.length;
  const completedProjectCount = dashboardStats?.completedProjects ?? 0;
  const recentRuns = dashboardStats?.recentRuns ?? [];

  return (
    <>
      <div className="stat-row">
        <div className="card stat-card">
          <div className="stat-value">{enabledCount}</div>
          <div className="stat-label">Roles in the build chain</div>
          <div className="stat-note">{DEFAULT_CHAIN_LABEL}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{assignedCount}</div>
          <div className="stat-label">Roles with a CLI assigned</div>
          <div className="stat-note">
            {assignedCount === 0
              ? 'The team is currently unstaffed. Bold strategy.'
              : unstaffed === 0
                ? 'Every build-chain seat has a CLI.'
                : `${unstaffed} build-chain seat(s) still need a CLI.`}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{completedProjectCount}</div>
          <div className="stat-label">Projects completed</div>
          <div className="stat-note">
            {activeProjectCount} active in the incubator
            {completedProjectCount === 0 && ' · completion tracks once runs land'}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Readiness</h2>
          <span className="section-note">Investor-Safe Summary</span>
        </div>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {teamReady ? (
            <StatusBadge tone="ok" label="Team staffed" />
          ) : (
            <StatusBadge tone="warn" label="Team not fully staffed" />
          )}
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {teamReady
              ? 'Every role in the build chain has a CLI assigned. Scaling confidence appropriately.'
              : 'Assign a local AI CLI to each role in the build chain before starting a run.'}
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Quick actions</h2>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={() => beginNewProject()}>
            New Project
          </button>
          <button
            type="button"
            className="btn"
            title="Skip the incubator — chat with Erlich, then Dinesh builds it on the spot."
            onClick={() => beginRipItProject()}
          >
            Rip it and Ship It
          </button>
          <button
            type="button"
            className="btn"
            title="Open one of your existing projects. Nucleus starts fresh each launch — pick up where you left off here."
            onClick={() => navigate('projects')}
          >
            Load a project{activeProjectCount > 0 ? ` (${activeProjectCount})` : ''}
          </button>
          <button type="button" className="btn" onClick={() => navigate('team')}>
            Configure Team
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Recent runs</h2>
          {recentRuns.length > 0 && (
            <span className="section-note">Last {recentRuns.length} across all projects</span>
          )}
        </div>
        {recentRuns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No runs yet</div>
            <p>Start a run and this space becomes a timeline of who built what, and who reviewed it with appropriate hostility.</p>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            {recentRuns.map((run, i) => (
              <div
                key={run.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i === 0 ? undefined : '1px solid var(--border)',
                }}
              >
                <StatusBadge {...RUN_STATUS_BADGE[run.status]} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{run.projectName}</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                    {run.lastPhase ?? 'Build'} · {run.summary.tasksWorked} task(s) ·{' '}
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The hot dog — the hunt's final trigger, asleep in the Hostel the whole
          time (shared/easterEggs.ts). Deliberately faint: this one is meant to
          be genuinely hard to spot. */}
      <EasterEggSpot trigger="hotdog" />
    </>
  );
}
