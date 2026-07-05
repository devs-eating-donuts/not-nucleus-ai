import type { CliDetection } from '../../../shared/cli';

interface CliDetectionListProps {
  clis: CliDetection[];
  isDetecting: boolean;
}

/**
 * The first-run readout: every known AI CLI with a check mark (installed) or an
 * X (not found), plus its resolved version/command. Pure presentation — the
 * detection itself lives in the store (detectClis).
 */
export function CliDetectionList({ clis, isDetecting }: CliDetectionListProps) {
  return (
    <ul className="onboarding-detect-list">
      {clis.map((c) => (
        <li key={c.id} className={`onboarding-detect-row ${c.installed ? 'found' : 'missing'}`}>
          <span className="onboarding-detect-mark" aria-hidden>
            {c.installed ? '✓' : '✕'}
          </span>
          <span className="onboarding-detect-name">{c.cliName}</span>
          <code className="onboarding-detect-cmd">{c.command}</code>
          <span className="onboarding-detect-status">
            {c.installed ? (c.version ?? 'installed') : 'not found'}
          </span>
        </li>
      ))}
      {clis.length === 0 && (
        <li className="onboarding-detect-row missing">
          <span className="onboarding-detect-name">
            {isDetecting ? 'Checking your system…' : 'No CLIs detected yet.'}
          </span>
        </li>
      )}
    </ul>
  );
}
