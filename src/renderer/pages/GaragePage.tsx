import { useEffect } from 'react';
import { effectivePersonaName } from '../../shared/personas';
import { ROLE_DEFINITIONS, isRoleId } from '../../shared/roles';
import { useAppStore } from '../state/appStore';

function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const OUTCOME_LABEL: Record<string, string> = { ok: 'ok', error: 'error', timeout: 'timed out' };

const roleLabel = (roleId: string): string =>
  isRoleId(roleId) ? ROLE_DEFINITIONS[roleId].label : roleId;

export function GaragePage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const telemetry = useAppStore((s) => s.garageTelemetry);
  const loadGarageTelemetry = useAppStore((s) => s.loadGarageTelemetry);
  const invocations = useAppStore((s) => s.garageInvocations);
  const loadGarageInvocations = useAppStore((s) => s.loadGarageInvocations);
  const navigate = useAppStore((s) => s.navigate);

  const projectId = activeProject?.registry.id;
  useEffect(() => {
    // The invocation log is cross-project — load it even with no project open, so
    // pitch / cli-test failures (which carry no project id) are still visible here.
    void loadGarageInvocations();
    if (projectId) {
      void loadGarageTelemetry();
    }
  }, [projectId, loadGarageTelemetry, loadGarageInvocations]);

  // Cross-project "Recent CLI activity" panel — rendered regardless of an active
  // project (failures are exactly what you come here to diagnose).
  const activityPanel = (
    <div className="section">
      <div className="section-heading">
        <h2>Recent CLI activity</h2>
        <span className="section-note">every CLI call, newest first · failures highlighted</span>
      </div>
      {invocations.length === 0 ? (
        <div className="card">
          <p className="field-hint" style={{ margin: 0 }}>
            No CLI calls logged yet. Pitches, room chats, plan drafts, and builds all show up
            here once they run.
          </p>
        </div>
      ) : (
        <div className="card">
          <table className="kv-table diag-table">
            <tbody>
              {invocations.map((inv, i) => {
                const failed = inv.outcome !== 'ok';
                return (
                  <tr key={`${inv.timestamp}-${i}`} className={failed ? 'diag-row-fail' : undefined}>
                    <td>
                      <div className="diag-head">
                        <span className={`diag-outcome diag-${inv.outcome}`}>
                          {OUTCOME_LABEL[inv.outcome] ?? inv.outcome}
                        </span>
                        <span className="diag-meta">
                          {inv.surface}
                          {inv.role ? ` · ${roleLabel(inv.role)}` : ''} · {inv.cliName || '(no CLI)'} ·{' '}
                          {fmtDuration(inv.durationMs)}
                          {inv.thinkingLevel ? ` · ${inv.thinkingLevel}` : ''}
                        </span>
                        <span className="diag-time">{fmtTime(inv.timestamp)}</span>
                      </div>
                      {failed && inv.error && <div className="diag-error-msg">{inv.error}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (!activeProject) {
    return (
      <>
        <div className="section">
          <div className="empty-state">
            <div className="empty-title">No project open</div>
            <p>Open a project for build telemetry — recent CLI activity is shown below.</p>
            <button type="button" className="btn primary" onClick={() => navigate('new-run')}>
              The Pitch
            </button>
          </div>
        </div>
        {activityPanel}
      </>
    );
  }

  const jaredName = effectivePersonaName('ops', activeProject.team.ops.personaNameOverride, namingMode);
  const entries = telemetry?.entries ?? [];

  // Per-task rollup: runs, time, max iteration.
  const byTask = new Map<string, { runs: number; durationMs: number; iterations: number; status: string }>();
  for (const e of entries) {
    if (!e.taskId) continue;
    const cur = byTask.get(e.taskId) ?? { runs: 0, durationMs: 0, iterations: 0, status: e.status };
    cur.runs += 1;
    cur.durationMs += e.durationMs;
    cur.iterations = Math.max(cur.iterations, e.iterations ?? 0);
    cur.status = e.status;
    byTask.set(e.taskId, cur);
  }

  return (
    <>
      <div className="section">
        <div className="section-heading">
          <h2>The Garage · {activeProject.info.projectName}</h2>
          <span className="section-note">{jaredName} keeps the numbers</span>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No telemetry yet</div>
            <p>Run a build in The Bullpen and the stats will show up here.</p>
            <button type="button" className="btn primary" onClick={() => navigate('bullpen')}>
              Go to The Bullpen
            </button>
          </div>
        ) : (
          <div className="stat-row">
            <div className="card stat-card">
              <div className="stat-value">{fmtDuration(telemetry?.totalDurationMs ?? 0)}</div>
              <div className="stat-label">Total agent time</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{entries.length}</div>
              <div className="stat-label">Agent runs</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{byTask.size}</div>
              <div className="stat-label">Tasks worked</div>
            </div>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <>
          <div className="section">
            <div className="section-heading">
              <h2>By CLI</h2>
            </div>
            <div className="card">
              <table className="kv-table">
                <tbody>
                  {(telemetry?.byCli ?? []).map((c) => (
                    <tr key={c.cliName}>
                      <td>{c.cliName || '(none)'}</td>
                      <td>
                        {c.runs} run(s) · {fmtDuration(c.durationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <div className="section-heading">
              <h2>By role</h2>
            </div>
            <div className="card">
              <table className="kv-table">
                <tbody>
                  {(telemetry?.byRole ?? []).map((r) => (
                    <tr key={r.roleId}>
                      <td>{roleLabel(r.roleId)}</td>
                      <td>
                        {r.runs} run(s) · {fmtDuration(r.durationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <div className="section-heading">
              <h2>By task</h2>
              <span className="section-note">iterations out of the budget of 5</span>
            </div>
            <div className="card">
              <table className="kv-table">
                <tbody>
                  {[...byTask.entries()].sort().map(([taskId, t]) => (
                    <tr key={taskId}>
                      <td>
                        <code>{taskId}</code>
                      </td>
                      <td>
                        {t.runs} run(s) · {fmtDuration(t.durationMs)} · {t.iterations}/5 iteration(s) ·{' '}
                        {t.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
            Token counts aren&apos;t captured yet — most CLIs don&apos;t report them in a uniform
            way. Time, runs, and iterations are tracked per agent.
          </p>
        </>
      )}

      {activityPanel}
    </>
  );
}
