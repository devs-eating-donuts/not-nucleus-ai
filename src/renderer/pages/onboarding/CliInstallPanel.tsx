import { useMemo, useState } from 'react';
import type { CliDetection, CliTestResult } from '../../../shared/cli';
import { CLI_PRESETS } from '../../../shared/cli';
import { installCommandFor, installGuideFor } from '../../../shared/cliInstall';
import type { ThemeId } from '../../../shared/theme';
import { StatusBadge } from '../../components/StatusBadge';
import { TerminalView } from '../../components/TerminalView';

interface CliInstallPanelProps {
  clis: CliDetection[];
  platform: string;
  theme: ThemeId;
  isDetecting: boolean;
  onRecheck: () => void;
  /** Reports each test outcome so onboarding can gate Continue on a CLI that actually responds. */
  onTested?: (cliId: string, ok: boolean) => void;
}

const SELECTABLE = CLI_PRESETS.filter((p) => p.id !== 'custom');

/**
 * The first-run "set up a CLI" workbench: pick a CLI, see the OS-specific install
 * + login commands, run them in an embedded shell, and confirm it actually
 * responds with the Test button (which calls cli:test → a real one-shot prompt).
 */
export function CliInstallPanel({
  clis,
  platform,
  theme,
  isDetecting,
  onRecheck,
  onTested,
}: CliInstallPanelProps) {
  // Default the selection to the first installed CLI, else the first preset.
  const firstInstalled = clis.find((c) => c.installed)?.id;
  const [chosenId, setChosenId] = useState<string>(firstInstalled ?? SELECTABLE[0].id);
  const [sessionKey, setSessionKey] = useState(0);
  const [showTerminal, setShowTerminal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CliTestResult | null>(null);

  const guide = installGuideFor(chosenId);
  const installCmd = useMemo(() => installCommandFor(chosenId, platform), [chosenId, platform]);
  const detection = clis.find((c) => c.id === chosenId);
  const installed = detection?.installed ?? false;
  const chosenName = SELECTABLE.find((p) => p.id === chosenId)?.cliName ?? chosenId;

  const runTest = async () => {
    if (typeof window.nucleus === 'undefined') {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.nucleus.cli.test(chosenId);
      setTestResult(res);
      onTested?.(chosenId, res.ok);
    } catch (err) {
      setTestResult({
        id: chosenId,
        ok: false,
        output: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
      onTested?.(chosenId, false);
    } finally {
      setTesting(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <div className="card onboarding-install">
      <div className="onboarding-install-head">
        <label className="onboarding-field">
          <span>Set up</span>
          <select
            value={chosenId}
            onChange={(e) => {
              setChosenId(e.target.value);
              setTestResult(null);
            }}
          >
            {SELECTABLE.map((p) => {
              const isOn = clis.find((c) => c.id === p.id)?.installed;
              return (
                <option key={p.id} value={p.id}>
                  {p.cliName}
                  {isOn ? ' ✓' : ''}
                </option>
              );
            })}
          </select>
        </label>
        {installed ? (
          <StatusBadge tone="ok" label="Installed" />
        ) : (
          <StatusBadge tone="warn" label="Not installed" />
        )}
      </div>

      {!installed && installCmd && (
        <div className="onboarding-cmd-block">
          <span className="onboarding-cmd-label">1. Install ({platform})</span>
          <div className="onboarding-cmd-row">
            <code>{installCmd}</code>
            <button type="button" className="btn sm" onClick={() => copy(installCmd)}>
              Copy
            </button>
          </div>
        </div>
      )}
      {!installed && !installCmd && (
        <p className="onboarding-note">
          No canned install command for this CLI on {platform}. See the CLI's own docs.
        </p>
      )}

      {guide?.login && (
        <div className="onboarding-cmd-block">
          <span className="onboarding-cmd-label">{installed ? '' : '2. '}Log in</span>
          <div className="onboarding-cmd-row">
            <code>{guide.login}</code>
            <button type="button" className="btn sm" onClick={() => copy(guide.login!)}>
              Copy
            </button>
          </div>
        </div>
      )}
      {guide?.note && <p className="onboarding-note">{guide.note}</p>}

      <div className="onboarding-terminal-wrap">
        <div className="onboarding-terminal-bar">
          <span>Terminal — run the install &amp; login commands here</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => (showTerminal ? setSessionKey((k) => k + 1) : setShowTerminal(true))}
          >
            {showTerminal ? 'Restart' : 'Open a terminal here'}
          </button>
        </div>
        {showTerminal && (
          <div className="onboarding-terminal">
            <TerminalView
              projectId=""
              roleId="developer"
              mode="shell"
              themeId={theme}
              sessionKey={sessionKey}
            />
          </div>
        )}
      </div>

      <div className="onboarding-install-actions">
        <button type="button" className="btn" disabled={isDetecting} onClick={onRecheck}>
          {isDetecting ? 'Re-checking…' : 'Re-check installed'}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!installed || testing}
          title={installed ? `Run a quick prompt through ${chosenName}` : 'Install it first'}
          onClick={() => void runTest()}
        >
          {testing ? 'Testing…' : `Test ${chosenName}`}
        </button>
      </div>

      {testResult && (
        <div className={`onboarding-test-result ${testResult.ok ? 'ok' : 'err'}`}>
          <strong>{testResult.ok ? '✓ It works' : '✕ No response'}</strong>
          <pre>{testResult.output}</pre>
        </div>
      )}
    </div>
  );
}
