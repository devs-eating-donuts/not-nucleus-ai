import { useEffect, useState } from 'react';
import type { BuildToolStatus } from '../../shared/buildTools';
import { StatusBadge } from './StatusBadge';
import { CopyButton } from './CopyButton';

/**
 * Shows the local build-prerequisite tools the chosen template + overlays need —
 * which are installed, which are missing (with a copyable OS install command),
 * and which need an interactive login (those become human-setup tasks in the
 * plan, so this panel just flags them). Renders nothing for a template that
 * declares no build tools (e.g. a from-scratch project). Re-detects when the
 * template or overlays change.
 */
export function BuildPrereqsPanel({
  templateId,
  overlayIds,
}: {
  templateId: string | null;
  overlayIds: string[];
}) {
  const [tools, setTools] = useState<BuildToolStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const overlayKey = [...overlayIds].sort().join(',');

  useEffect(() => {
    if (!templateId) {
      setTools([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.nucleus.buildTools
      .detect(templateId, overlayIds)
      .then((res) => {
        if (!cancelled) setTools(res);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // overlayKey captures overlayIds content without depending on a new array identity each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, overlayKey]);

  // Nothing to show for a from-scratch project or a template with no declared tools.
  if (!templateId || (tools !== null && tools.length === 0)) {
    return null;
  }

  const missing = (tools ?? []).filter((t) => !t.present);

  return (
    <div className="field span-2">
      <label>Build prerequisites</label>
      <p className="section-note" style={{ marginTop: 0 }}>
        Local tools the team needs to build, run, and test this app. Install what’s missing before
        you build; interactive logins (e.g. <code>supabase login</code>) become setup tasks in the
        plan.
      </p>
      {loading && tools === null ? (
        <p className="muted">Checking your machine…</p>
      ) : (
        <div className="prereq-list">
          {(tools ?? []).map((t) => (
            <div key={t.id} className="prereq-row" title={t.note}>
              <div className="prereq-head">
                <StatusBadge
                  tone={t.present ? 'ok' : 'warn'}
                  label={t.present ? 'Installed' : 'Missing'}
                />
                <span className="prereq-name">{t.name}</span>
                {t.login && <span className="prereq-login">needs login</span>}
              </div>
              {!t.present && t.installCommand && (
                <div className="prereq-cmd">
                  <code>{t.installCommand}</code>
                  <CopyButton text={t.installCommand} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {missing.length === 0 && tools !== null && !loading && (
        <p className="muted" style={{ marginTop: 6 }}>
          All set — every required tool is installed.
        </p>
      )}
    </div>
  );
}
