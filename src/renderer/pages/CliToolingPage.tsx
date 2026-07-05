import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import { StatusBadge } from '../components/StatusBadge';
import { CopyButton } from '../components/CopyButton';
import { installCommandFor, installGuideFor, updateCommandFor } from '../../shared/cliInstall';

export function CliToolingPage() {
  const clis = useAppStore((s) => s.clis);
  const isDetectingClis = useAppStore((s) => s.isDetectingClis);
  const detectClis = useAppStore((s) => s.detectClis);
  const runCliUpdate = useAppStore((s) => s.runCliUpdate);
  const cliUpdatingId = useAppStore((s) => s.cliUpdatingId);
  const cliUpdateOutputs = useAppStore((s) => s.cliUpdateOutputs);
  const appInfo = useAppStore((s) => s.appInfo);
  const platform = appInfo?.platform ?? 'darwin';

  // Detect on first visit so the page is populated without a manual click.
  useEffect(() => {
    if (clis.length === 0) {
      void detectClis();
    }
  }, [clis.length, detectClis]);

  const installedCount = clis.filter((c) => c.installed).length;

  return (
    <div className="section">
      <div className="section-heading">
        <h2 className="preserve-case">AI CLIs</h2>
        <button
          type="button"
          className="btn"
          disabled={isDetectingClis}
          onClick={() => void detectClis()}
        >
          {isDetectingClis ? 'Checking…' : 'Re-check all'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {isDetectingClis
            ? 'Interrogating your PATH…'
            : `${installedCount} of ${clis.length} known CLIs installed. Not installed? Copy its install command below and run it in a terminal. "Check for updates" runs an installed CLI's own updater.`}
        </span>
      </div>

      <div className="cli-table">
        <div className="cli-row cli-head">
          <span>Active</span>
          <span>CLI</span>
          <span>Command</span>
          <span>Version</span>
          <span>Status</span>
          <span />
        </div>
        {clis.map((c) => {
          const updating = cliUpdatingId === c.id;
          const output = cliUpdateOutputs[c.id];
          const guide = installGuideFor(c.id);
          const installCmd = installCommandFor(c.id, platform);
          const updateCmd = updateCommandFor(c.id, platform);
          // Show setup commands only for a CLI we can actually help install.
          const showInstall = !c.installed && (installCmd !== null || !!guide?.login);
          return (
            <div key={c.id}>
              <div className="cli-row">
                <span>
                  <input type="checkbox" checked={c.installed} readOnly aria-label="Installed" />
                </span>
                <span className="cli-name">{c.cliName}</span>
                <span>
                  <code>{c.command}</code>
                </span>
                <span>{c.version ?? '—'}</span>
                <span>
                  {c.installed ? (
                    <StatusBadge tone="ok" label="Active" />
                  ) : (
                    <StatusBadge tone="warn" label="Not found" />
                  )}
                </span>
                <span>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!c.installed || !c.canUpdate || updating || cliUpdatingId !== null}
                    title={
                      !c.canUpdate
                        ? 'No update command configured'
                        : 'Runs the CLI updater; installs if a newer version is available'
                    }
                    onClick={() => void runCliUpdate(c.id)}
                  >
                    {updating ? 'Checking…' : 'Check for updates'}
                  </button>
                </span>
              </div>
              {showInstall && (
                <div className="cli-install-block">
                  {installCmd ? (
                    <div>
                      <span className="cli-install-label">Install ({platform})</span>
                      <div className="cli-install-row">
                        <code>{installCmd}</code>
                        <CopyButton text={installCmd} />
                      </div>
                    </div>
                  ) : (
                    <p className="cli-install-note">
                      No canned install command for {platform}. See {c.cliName}&apos;s own docs.
                    </p>
                  )}
                  {guide?.login && (
                    <div>
                      <span className="cli-install-label">Then log in</span>
                      <div className="cli-install-row">
                        <code>{guide.login}</code>
                        <CopyButton text={guide.login} />
                      </div>
                    </div>
                  )}
                  {guide?.note && <p className="cli-install-note">{guide.note}</p>}
                </div>
              )}
              {output && (
                <div className={`cli-update-result ${output.ok ? 'ok' : 'err'}`}>
                  <div className="cli-update-result-bar">
                    <span>{output.ok ? 'Result' : 'Update error'}</span>
                    <CopyButton text={output.output} />
                  </div>
                  <pre>{output.output}</pre>
                  {updateCmd && (
                    <div className="cli-update-manual">
                      <span className="cli-install-label">Update command ({platform})</span>
                      <div className="cli-install-row">
                        <code>{updateCmd}</code>
                        <CopyButton text={updateCmd} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {clis.length === 0 && !isDetectingClis && (
          <div className="empty-state" style={{ marginTop: 'var(--space-md)' }}>
            <div className="empty-title">No CLIs detected</div>
            <p>Re-check, or install one of the supported CLIs and try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}
