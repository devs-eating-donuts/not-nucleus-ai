import { useEffect } from 'react';
import { isResumable } from '../../shared/run';
import type { RunStatus, RunSummary } from '../../shared/run';
import { useAppStore } from '../state/appStore';

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'In progress',
  complete: 'Complete',
  escalated: 'Escalated',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) {
    return '—';
  }
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) {
    return '<1s';
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function RunRow({ run }: { run: RunSummary }) {
  const openRunDetail = useAppStore((s) => s.openRunDetail);
  const resumeRun = useAppStore((s) => s.resumeRun);
  const deleteRunRecord = useAppStore((s) => s.deleteRunRecord);

  return (
    <div className="run-row card" onClick={() => void openRunDetail(run.id)}>
      <div className="run-row-main">
        <span className={`run-status ${run.status}`}>{STATUS_LABEL[run.status]}</span>
        <div className="run-row-meta">
          <div className="run-row-title">
            {run.lastPhase ?? 'Build'} · {fmtDate(run.startedAt)}
          </div>
          <div className="run-row-sub">
            {run.mode === 'autopilot' ? 'Autopilot' : 'One-step'} · {fmtDuration(run.startedAt, run.endedAt)}
            {run.resumedFromRunId ? ' · resumed' : ''}
          </div>
        </div>
      </div>
      <div className="run-row-stats">
        <span title="Tasks worked">{run.summary.tasksWorked} tasks</span>
        <span className="run-stat-pass" title="QA passes">
          {run.summary.passes}✓
        </span>
        <span className="run-stat-fail" title="QA fails">
          {run.summary.fails}✗
        </span>
        {run.summary.escalations > 0 && (
          <span className="run-stat-esc" title="Escalations">
            {run.summary.escalations}!
          </span>
        )}
      </div>
      <div className="run-row-actions" onClick={(e) => e.stopPropagation()}>
        {isResumable(run.status) && (
          <button type="button" className="btn sm primary" onClick={() => void resumeRun(run.id)}>
            Resume
          </button>
        )}
        <button type="button" className="btn sm" onClick={() => void openRunDetail(run.id)}>
          Open
        </button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => void deleteRunRecord(run.id)}
          title="Delete this run record"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function RunHistoryPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const runs = useAppStore((s) => s.runs);
  const runsLoading = useAppStore((s) => s.runsLoading);
  const loadRuns = useAppStore((s) => s.loadRuns);
  const navigate = useAppStore((s) => s.navigate);

  const projectId = activeProject?.registry.id;
  useEffect(() => {
    void loadRuns();
  }, [projectId, loadRuns]);

  if (!activeProject) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Open a project to see its build runs — timelines, outcomes, and resume points.</p>
          <button type="button" className="btn primary" onClick={() => navigate('projects')}>
            Projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-heading">
        <h2>Synergy Output Archive</h2>
        <span className="section-note">
          {activeProject.info.projectName} · every Bullpen run, preserved for the retrospective
        </span>
      </div>
      {runs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">{runsLoading ? 'Loading runs…' : 'No runs recorded'}</div>
          <p>
            Run the Bullpen to build a phase. Each session is captured here with its step timeline,
            role outcomes, and a resume point if it stops or escalates.
          </p>
          <button type="button" className="btn primary" onClick={() => navigate('bullpen')}>
            The Bullpen
          </button>
        </div>
      ) : (
        <div className="run-list">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
