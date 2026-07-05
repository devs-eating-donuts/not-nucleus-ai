import { useEffect, useRef, useState } from 'react';
import {
  ENV_VAR_RE,
  SECRET_DESTINATIONS,
  SECRET_DESTINATION_LABELS,
  SECRET_STAGES,
  humanizeEnvVar,
  type SecretDestination,
  type SecretEntry,
  type SecretStage,
} from '../../shared/secrets';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../state/appStore';

/**
 * The Vault — the founder's view of the built app's secrets. NAMES ONLY: you never
 * type a secret value here. The team derives the names from the blueprint during
 * planning; here you refine which store each pushes to, then generate a script you
 * run yourself to set the values (they go straight to the store, never through the
 * app). Talks to window.nucleus.secrets directly (no value ever crosses this UI).
 */

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function SecretsPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const isWindows = useAppStore((s) => s.appInfo?.platform) === 'win32';
  const projectId = activeProject?.registry.id ?? null;

  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scriptPath, setScriptPath] = useState<string | null>(null);
  const [newEnv, setNewEnv] = useState('');
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const target = projectId;
    loadedFor.current = target;
    // Clear transient banners so a notice/error from the previous project can't
    // linger and misattribute to this one.
    setError(null);
    setNotice(null);
    setScriptPath(null);
    void (async () => {
      try {
        const m = await window.nucleus.secrets.getManifest(target);
        if (loadedFor.current !== target) {
          return; // a newer project switch superseded this load — drop the stale result
        }
        setSecrets(m.secrets);
        setDirty(false);
      } catch (err) {
        if (loadedFor.current !== target) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [projectId]);

  if (!activeProject || !projectId) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No active project</div>
          <p>Open a project first — its secrets are derived from what the team is building.</p>
        </div>
      </div>
    );
  }

  const patch = (i: number, p: Partial<SecretEntry>) => {
    setSecrets((s) => s.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
    setDirty(true);
    setNotice(null);
  };
  const removeAt = (i: number) => {
    setSecrets((s) => s.filter((_, idx) => idx !== i));
    setDirty(true);
    setNotice(null);
  };
  const addSecret = () => {
    const env = newEnv.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!ENV_VAR_RE.test(env)) {
      setError('Enter a valid env-var name (UPPER_SNAKE, e.g. STRIPE_SECRET_KEY).');
      return;
    }
    if (secrets.some((s) => s.envVar === env)) {
      setError(`${env} is already in the list.`);
      return;
    }
    setError(null);
    setSecrets((s) => [
      ...s,
      { name: humanizeEnvVar(env), envVar: env, stages: ['production'], destinations: [], required: true },
    ]);
    setNewEnv('');
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await window.nucleus.secrets.setManifest(projectId, secrets);
      setSecrets(res.manifest.secrets);
      setDirty(false);
      setNotice(
        res.rejected.length > 0
          ? `Saved. Dropped (couldn't be stored): ${res.rejected.join(', ')}`
          : 'Saved.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rederive = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const m = await window.nucleus.secrets.deriveFromBlueprint(projectId);
      setSecrets(m.secrets);
      setDirty(false);
      setNotice('Re-derived names from the blueprint (your edits were kept).');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (dirty) {
        const res = await window.nucleus.secrets.setManifest(projectId, secrets);
        setSecrets(res.manifest.secrets);
        setDirty(false);
        if (res.rejected.length > 0) {
          // Surface dropped entries before the success panel, same as save().
          setNotice(`Dropped (couldn't be stored): ${res.rejected.join(', ')}`);
        }
      }
      const { scriptPath: p } = await window.nucleus.secrets.generatePushScript(projectId);
      setScriptPath(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="role-card-top">
            <div className="card-title" style={{ marginBottom: 0 }}>
              The app&apos;s secrets — names only
            </div>
            <StatusBadge tone="ok" label="Values never touch this app" />
          </div>
          <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
            These are the env-var <strong>names</strong> the built app needs — never the values.
            The team derives them from what you&apos;re building; set which store each one pushes to,
            then generate a script you run yourself. You type the real values into that script&apos;s
            private prompt; they go straight to the store over stdin and are never seen, logged, or
            committed by the app or the AI.
          </p>
        </div>
      </div>

      <div className="section">
        {secrets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No secrets yet</div>
            <p>
              This project&apos;s blueprint declares no secrets, or none have been added. Add one
              below, or &quot;Re-derive from blueprint&quot; once a template/capabilities are chosen.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {secrets.map((s, i) => (
              <div key={s.envVar} className="card">
                <div className="role-card-top">
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    <code>{s.envVar}</code>
                  </div>
                  <button type="button" className="btn" onClick={() => removeAt(i)}>
                    Remove
                  </button>
                </div>

                <div className="field" style={{ marginTop: 'var(--space-2)' }}>
                  <label>Destinations (where the production/preview value is pushed)</label>
                  <div className="role-checkboxes">
                    {SECRET_DESTINATIONS.map((d: SecretDestination) => (
                      <label key={d} className="toggle-row" title={d}>
                        <input
                          type="checkbox"
                          checked={s.destinations.includes(d)}
                          onChange={() => patch(i, { destinations: toggle(s.destinations, d) })}
                        />
                        {SECRET_DESTINATION_LABELS[d]}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>Stages</label>
                  <div className="role-checkboxes">
                    {SECRET_STAGES.map((st: SecretStage) => (
                      <label key={st} className="toggle-row">
                        <input
                          type="checkbox"
                          checked={s.stages.includes(st)}
                          onChange={() => patch(i, { stages: toggle(s.stages, st) })}
                        />
                        {st}
                      </label>
                    ))}
                    <label className="toggle-row" title="The app won't run without it">
                      <input
                        type="checkbox"
                        checked={s.required}
                        onChange={() => patch(i, { required: !s.required })}
                      />
                      required
                    </label>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`acq-${s.envVar}`}>Where to get the value (optional — never the value)</label>
                  <input
                    id={`acq-${s.envVar}`}
                    value={s.acquireHint ?? ''}
                    placeholder="e.g. Stripe dashboard → Developers → API keys"
                    maxLength={200}
                    onChange={(e) => patch(i, { acquireHint: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="card">
          <div className="field">
            <label htmlFor="new-secret">Add a secret (env-var name)</label>
            <div className="folder-row">
              <input
                id="new-secret"
                value={newEnv}
                placeholder="STRIPE_SECRET_KEY"
                onChange={(e) => setNewEnv(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSecret();
                  }
                }}
              />
              <button type="button" className="btn" onClick={addSecret}>
                Add
              </button>
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Working…' : dirty ? 'Save changes' : 'Saved'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void rederive()}>
              Re-derive from blueprint
            </button>
            <button type="button" className="btn" disabled={busy || secrets.length === 0} onClick={() => void generate()}>
              Generate push script
            </button>
          </div>

          {notice && (
            <p className="field-hint" style={{ marginTop: 'var(--space-3)' }}>
              {notice}
            </p>
          )}
          {error && <p className="validation-note err">{error}</p>}

          {scriptPath && (
            <div
              style={{
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>
                Script written — you run it
              </div>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Wrote <code>{scriptPath}</code> (names only, committed). Run it in a terminal from the
                project folder; it prompts you privately for each value and pipes it to the store —
                the app never sees it. Make sure the store CLI (<code>gh</code> / <code>doppler</code> / …)
                is installed and you&apos;re logged in first.
              </p>
              <pre
                style={{
                  background: 'var(--surface-2, rgba(0,0,0,0.2))',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 'var(--space-2) var(--space-3)',
                  overflowX: 'auto',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                <code>{`bash ${scriptPath}`}</code>
              </pre>
              {isWindows && (
                <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
                  The script is a POSIX shell script — on Windows run it from <strong>Git Bash</strong>{' '}
                  or <strong>WSL</strong> (it reads each value privately via <code>read -s</code>, which
                  cmd.exe / PowerShell don&apos;t provide). A native PowerShell version is a planned
                  follow-up.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
