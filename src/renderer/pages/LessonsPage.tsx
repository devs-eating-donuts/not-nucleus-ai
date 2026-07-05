import { useEffect, useState } from 'react';
import { ELEVATION_THRESHOLD } from '../../shared/lessons';
import type { Lesson, LessonSignal, LessonStatus } from '../../shared/lessons';

/**
 * The Ledger — a quiet, read-only view of what past builds got wrong (very Jared).
 * Cross-project, so it reads the store directly (no active project needed). Confirmed
 * lessons inject into matching future builds; candidates never do. The one control is
 * Mute — the curation escape hatch when an auto-derived rule turns out wrong.
 */

const SIGNAL_LABELS: Record<LessonSignal, string> = {
  'iteration-cap-hit': 'iteration cap',
  'qa-gap': 'QA gap',
  'gate-failure': 'gate failure',
  'dev-crash': 'dev crash',
  'qa-indeterminate': 'no verdict',
  manual: 'manual',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (typeof window.nucleus === 'undefined') {
      setLessons([]);
      return;
    }
    void window.nucleus.lessons.list().then((rows) => {
      if (alive) setLessons(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setStatus = async (id: string, status: LessonStatus): Promise<void> => {
    setBusyId(id);
    try {
      const updated = await window.nucleus.lessons.setStatus(id, status);
      if (updated) {
        setLessons((prev) => (prev ? prev.map((l) => (l.id === id ? updated : l)) : prev));
      }
    } finally {
      setBusyId(null);
    }
  };

  if (lessons === null) {
    return (
      <div className="section">
        <p className="field-hint">Loading the ledger…</p>
      </div>
    );
  }

  const confirmed = lessons.filter((l) => l.status === 'confirmed').length;
  const candidates = lessons.filter((l) => l.status === 'candidate').length;
  const muted = lessons.filter((l) => l.status === 'muted').length;

  return (
    <>
      <div className="section">
        <div className="section-heading">
          <h2>The Ledger</h2>
          <span className="section-note">learned across past builds</span>
        </div>
        <p className="field-hint" style={{ marginTop: 0 }}>
          When a build fails the same way <strong>{ELEVATION_THRESHOLD} times</strong> (same signal,
          archetype, and role), the lesson is <em>confirmed</em> and its rule is injected into matching
          future builds. Candidates are still accumulating and never inject. Mute one if it&apos;s wrong.
        </p>

        {lessons.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">Nothing learned yet</div>
            <p>Run builds in The Bullpen. Recurring failures get recorded here and, once confirmed, steer future builds away from the same mistakes.</p>
          </div>
        ) : (
          <div className="stat-row">
            <div className="card stat-card">
              <div className="stat-value">{confirmed}</div>
              <div className="stat-label">Confirmed (injecting)</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{candidates}</div>
              <div className="stat-label">Candidates</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{muted}</div>
              <div className="stat-label">Muted</div>
            </div>
          </div>
        )}
      </div>

      {lessons.map((l) => (
        <div className="section" key={l.id}>
          <div className="card" style={{ opacity: l.status === 'muted' ? 0.6 : 1 }}>
            <div className="section-heading" style={{ marginBottom: 'var(--space-1)' }}>
              <h2 style={{ fontSize: 'var(--text-base, 1rem)' }}>{l.summary}</h2>
              <span className="badge">{l.status}</span>
            </div>
            <p style={{ margin: 'var(--space-1) 0' }}>{l.rule}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
              <span className="badge">{SIGNAL_LABELS[l.signal]}</span>
              {l.techTags.map((t) => (
                <span className="badge" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <p className="field-hint" style={{ marginTop: 'var(--space-1)', marginBottom: 0 }}>
              seen {l.occurrences}× · last {fmtDate(l.lastSeen)}
              {l.exampleProjectIds.length > 0 ? ` · ${l.exampleProjectIds.length} project(s)` : ''}
            </p>
            <div style={{ marginTop: 'var(--space-2)' }}>
              {l.status === 'muted' ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === l.id}
                  onClick={() =>
                    void setStatus(l.id, l.occurrences >= ELEVATION_THRESHOLD ? 'confirmed' : 'candidate')
                  }
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === l.id}
                  onClick={() => void setStatus(l.id, 'muted')}
                  title="Exclude this lesson from future builds"
                >
                  Mute
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
