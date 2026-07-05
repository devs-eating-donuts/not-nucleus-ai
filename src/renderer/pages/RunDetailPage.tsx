import { useEffect } from 'react';
import { effectivePersonaName } from '../../shared/personas';
import { isResumable } from '../../shared/run';
import type { RunStatus, RunStepRecord } from '../../shared/run';
import type { BullpenActor } from '../../shared/bullpen';
import type { RoleId } from '../../shared/roles';
import { useAppStore } from '../state/appStore';

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'In progress',
  complete: 'Complete',
  escalated: 'Escalated',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
};

const ACTOR_ROLE: Record<Exclude<BullpenActor, null>, RoleId> = {
  developer: 'developer',
  qa: 'qa',
  security: 'security',
  architect: 'architect',
  ops: 'ops',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StepRow({ step }: { step: RunStepRecord }) {
  const namingMode = useAppStore((s) => s.namingMode);
  const settings = useAppStore((s) => s.settings);
  const role = step.actor ? ACTOR_ROLE[step.actor] : null;
  const who = role
    ? effectivePersonaName(role, settings.roles[role]?.personaNameOverride ?? null, namingMode)
    : 'System';

  const verdict =
    step.actor === 'qa' && step.passed === true
      ? 'pass'
      : step.actor === 'qa' && step.passed === false
        ? 'fail'
        : null;

  return (
    <div className={`run-step${step.escalated ? ' escalated' : ''}`}>
      <div className="run-step-head">
        <span className={`run-step-actor actor-${step.actor ?? 'system'}`}>{who}</span>
        {step.taskTitle && <span className="run-step-task">{step.taskTitle}</span>}
        {verdict && <span className={`run-step-verdict ${verdict}`}>{verdict.toUpperCase()}</span>}
        {step.iterations && <span className="run-step-iter">{step.iterations}</span>}
        {step.escalated && <span className="run-step-esc">escalated</span>}
        <span className="run-step-time">{fmtTime(step.at)}</span>
      </div>
      {step.error && <p className="validation-note err run-step-error">{step.error}</p>}
      {step.logExcerpt.trim() !== '' && (
        <details className="run-step-log-wrap">
          <summary>log</summary>
          <pre className="run-step-log">{step.logExcerpt}</pre>
        </details>
      )}
    </div>
  );
}

export function RunDetailPage() {
  const activeRunId = useAppStore((s) => s.activeRunId);
  const runDetail = useAppStore((s) => s.runDetail);
  const runDetailLoading = useAppStore((s) => s.runDetailLoading);
  const openRunDetail = useAppStore((s) => s.openRunDetail);
  const resumeRun = useAppStore((s) => s.resumeRun);
  const navigate = useAppStore((s) => s.navigate);

  // Reload if we landed here with an id but no (matching) detail loaded.
  useEffect(() => {
    if (activeRunId && runDetail?.id !== activeRunId && !runDetailLoading) {
      void openRunDetail(activeRunId);
    }
  }, [activeRunId, runDetail, runDetailLoading, openRunDetail]);

  if (!activeRunId) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No run selected</div>
          <button type="button" className="btn" onClick={() => navigate('history')}>
            Back to Run History
          </button>
        </div>
      </div>
    );
  }

  if (!runDetail) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">{runDetailLoading ? 'Loading run…' : 'Run not found'}</div>
          <button type="button" className="btn" onClick={() => navigate('history')}>
            Back to Run History
          </button>
        </div>
      </div>
    );
  }

  const run = runDetail;
  return (
    <div className="section">
      <div className="run-detail-head">
        <button type="button" className="btn sm" onClick={() => navigate('history')}>
          ← History
        </button>
        <span className={`run-status ${run.status}`}>{STATUS_LABEL[run.status]}</span>
        {isResumable(run.status) && (
          <button type="button" className="btn sm primary" onClick={() => void resumeRun(run.id)}>
            Resume in The Bullpen
          </button>
        )}
      </div>

      <div className="run-detail-meta card">
        <div>
          <div className="card-title">{run.projectName}</div>
          <p className="field-hint" style={{ margin: 0 }}>
            {run.mode === 'autopilot' ? 'Autopilot' : 'One-step'} · testing {run.cadence.testing} ·
            security {run.cadence.security}
            {run.resumedFromRunId ? ' · resumed a prior run' : ''}
          </p>
        </div>
        <div className="run-detail-counts">
          <span>{run.summary.tasksWorked} tasks</span>
          <span className="run-stat-pass">{run.summary.passes}✓</span>
          <span className="run-stat-fail">{run.summary.fails}✗</span>
          {run.summary.escalations > 0 && (
            <span className="run-stat-esc">{run.summary.escalations} escalated</span>
          )}
        </div>
      </div>

      <div className="section-heading" style={{ marginTop: 'var(--space-4)' }}>
        <h2>Timeline</h2>
        <span className="section-note">{run.steps.length} steps</span>
      </div>
      {run.steps.length === 0 ? (
        <p className="field-hint">No steps were recorded for this run.</p>
      ) : (
        <div className="run-steps">
          {run.steps.map((step) => (
            <StepRow key={step.index} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
