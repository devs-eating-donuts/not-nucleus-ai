import { useState } from 'react';
import { brandName } from '../../shared/naming';
import { effectivePersonaName } from '../../shared/personas';
import { useAppStore } from '../state/appStore';
import { NucleusMark } from '../components/NucleusMark';
import { StatusBadge } from '../components/StatusBadge';
import { EasterEggSpot } from '../components/EasterEggSpot';

export function AboutPage() {
  const appInfo = useAppStore((s) => s.appInfo);
  const namingMode = useAppStore((s) => s.namingMode);
  const opsOverride = useAppStore((s) => s.settings.roles.ops.personaNameOverride);
  const opsName = effectivePersonaName('ops', opsOverride, namingMode);
  const projects = useAppStore((s) => s.projects);
  const factoryReset = useAppStore((s) => s.factoryReset);

  const [showReset, setShowReset] = useState(false);
  const [exportSel, setExportSel] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);

  const openReset = () => {
    setExportSel(new Set());
    setResetError(null);
    setResetNote(null);
    setShowReset(true);
  };
  const closeReset = () => {
    if (!resetting) {
      setShowReset(false);
    }
  };
  const toggleExport = (id: string) =>
    setExportSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const onReset = async () => {
    setResetting(true);
    setResetError(null);
    setResetNote(null);
    try {
      const res = await factoryReset([...exportSel]);
      // On success the store re-hydrates into the onboarding screen, unmounting this.
      if (!res.ok && !res.cancelled) {
        setResetError(res.error ?? 'Factory reset failed.');
      } else if (res.cancelled) {
        // The export-folder pick or the native confirm was dismissed — make the no-op legible.
        setResetNote('Cancelled — nothing was exported or reset.');
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <div className="about-hero">
        <NucleusMark size={88} />
        <div className="about-wordmark">
          NUCLEUS<span className="brand-ai">-AI</span>
        </div>
        <p className="about-tagline">Making the world a better place</p>
        <div className="about-credits">
          Powered by {brandName('poweredBy', namingMode)} · Created by{' '}
          {brandName('createdBy', namingMode)}
          <br />
          Operational Stability by {opsName}
        </div>
        <p className="about-disclaimer">
          An unofficial, non-commercial parody and fan tribute. Not affiliated with, endorsed
          by, or sponsored by Warner Bros. Discovery, HBO, or the creators of the series
          &ldquo;Silicon Valley.&rdquo; Names shown in &ldquo;No Lawyers Present&rdquo; mode
          belong to their respective owners and are used here purely as affectionate homage.
        </p>
      </div>

      <div className="section" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="card">
          <div className="card-title">Runtime</div>
          <table className="kv-table">
            <tbody>
              <tr>
                <td>App version</td>
                <td>{appInfo?.appVersion ?? '—'}</td>
              </tr>
              <tr>
                <td>Electron</td>
                <td>{appInfo?.electronVersion ?? '—'}</td>
              </tr>
              <tr>
                <td>Chromium</td>
                <td>{appInfo?.chromeVersion ?? '—'}</td>
              </tr>
              <tr>
                <td>Node.js</td>
                <td>{appInfo?.nodeVersion ?? '—'}</td>
              </tr>
              <tr>
                <td>Platform</td>
                <td>{appInfo ? `${appInfo.platform} (${appInfo.arch})` : '—'}</td>
              </tr>
              <tr>
                <td>Packaged</td>
                <td>{appInfo ? String(appInfo.packaged) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginTop: 'var(--space-lg)', borderColor: 'var(--error)' }}>
          <div className="card-title">Danger zone</div>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
            <strong>Factory reset</strong> moves every project folder to the Trash and erases all
            Nucleus history and settings (your Default Team included) — back to a fresh install.
            You can export any projects first.
          </p>
          <button
            type="button"
            className="btn danger"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={openReset}
          >
            Factory reset…
          </button>
        </div>
      </div>

      {showReset && (
        <div className="modal-overlay" onClick={closeReset}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="role-card-top">
              <div className="card-title" style={{ marginBottom: 0 }}>
                Factory reset Nucleus-AI
              </div>
              <StatusBadge tone="error" label="Nuclear" dot={false} />
            </div>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
              This moves all {projects.length} project folder(s) to the Trash (recoverable) and
              erases all Nucleus history and settings, returning to a fresh install. You&apos;ll
              re-onboard afterward. A final system confirmation will appear.
            </p>

            {projects.length > 0 && (
              <>
                <div className="section-heading" style={{ marginTop: 'var(--space-3)' }}>
                  <h2 style={{ fontSize: 'var(--font-size-md)' }}>Export before resetting?</h2>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={resetting}
                    onClick={() =>
                      setExportSel((prev) =>
                        prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)),
                      )
                    }
                  >
                    {exportSel.size === projects.length ? 'Select none' : 'Select all'}
                  </button>
                </div>
                <p className="field-hint">
                  Pick which projects&apos; conversations to save first — you&apos;ll choose one
                  folder for the exports.
                </p>
                <div className="role-panel-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {projects.map((p) => (
                    <label key={p.id} className="toggle-row" style={{ gap: 'var(--space-2)' }}>
                      <input
                        type="checkbox"
                        checked={exportSel.has(p.id)}
                        disabled={resetting}
                        onChange={() => toggleExport(p.id)}
                      />
                      <span style={{ fontSize: 'var(--font-size-sm)' }}>{p.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {resetNote && (
              <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
                {resetNote}
              </p>
            )}

            {resetError && (
              <p className="validation-note err" style={{ marginTop: 'var(--space-2)' }}>
                {resetError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" disabled={resetting} onClick={closeReset}>
                Cancel
              </button>
              <button type="button" className="btn danger" disabled={resetting} onClick={() => void onReset()}>
                {resetting
                  ? 'Resetting…'
                  : exportSel.size > 0
                    ? `Export ${exportSel.size} & factory reset`
                    : 'Factory reset everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pipey — the hunt's first trigger (shared/easterEggs.ts). Lives on the
          About page like a proper easter egg: findable, never advertised. */}
      <EasterEggSpot trigger="pipey" />
    </>
  );
}
