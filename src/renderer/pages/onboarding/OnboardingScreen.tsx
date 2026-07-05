import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { NucleusMark } from '../../components/NucleusMark';
import { CliDetectionList } from './CliDetectionList';
import { CliInstallPanel } from './CliInstallPanel';

/**
 * First-run gate. The whole app drives local AI CLIs, so we don't let the user
 * in until at least one is installed. Detect what's present, help install + log
 * in to one, then either auto-assign it across the team (exactly one) or send
 * them to the Default Team to choose (more than one).
 */
export function OnboardingScreen() {
  const clis = useAppStore((s) => s.clis);
  const isDetecting = useAppStore((s) => s.isDetectingClis);
  const detectClis = useAppStore((s) => s.detectClis);
  const appInfo = useAppStore((s) => s.appInfo);
  const theme = useAppStore((s) => s.theme);
  const seedRosterWithCli = useAppStore((s) => s.seedRosterWithCli);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const finishOnboardingToTeam = useAppStore((s) => s.finishOnboardingToTeam);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [verifiedIds, setVerifiedIds] = useState<string[]>([]);

  // Detect on first mount so the readout populates without a click.
  useEffect(() => {
    if (clis.length === 0) {
      void detectClis();
    }
  }, [clis.length, detectClis]);

  const platform = appInfo?.platform ?? 'darwin';
  const installed = clis.filter((c) => c.installed);
  // A CLI counts as READY only once it RESPONDS to a real test prompt — "installed" on PATH
  // is not "logged in", and a half-set-up CLI seeded into every seat fails the first pitch.
  const ready = installed.filter((c) => verifiedIds.includes(c.id));
  const detecting = isDetecting && clis.length === 0;

  const handleContinue = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      // Always land on the Default Team so the founder SEES and controls the roster — never
      // silently auto-assign one CLI to every seat and skip to the dashboard. When exactly one
      // CLI is verified, pre-seed it as a starting point (still editable there) so they aren't
      // assigning seven seats by hand; with several verified, leave the seats to pick per role.
      if (ready.length === 1 && !(await seedRosterWithCli(ready[0].id))) {
        setFinishError('Could not save your team roster — check disk space and permissions, then try again.');
        return;
      }
      // A failed settings write means `onboarded` wouldn't survive a restart — stay
      // here with an error instead of silently re-onboarding next launch.
      if (!(await completeOnboarding())) {
        setFinishError('Could not save your settings — check disk space and permissions, then try again.');
        return;
      }
      finishOnboardingToTeam();
    } finally {
      setFinishing(false);
    }
  };

  const handleSkip = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      if (!(await completeOnboarding())) {
        setFinishError('Could not save your settings — check disk space and permissions, then try again.');
        return;
      }
      finishOnboardingToTeam();
    } finally {
      setFinishing(false);
    }
  };

  const handleTested = (id: string, ok: boolean) =>
    setVerifiedIds((prev) =>
      ok ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );

  // Always "set up your team" — Continue routes to the Default Team, never a silent auto-assign.
  const continueLabel = 'Continue — set up your team';

  return (
    <div className="onboarding-screen">
      <div className="onboarding-inner">
        <header className="onboarding-header">
          <NucleusMark size={40} />
          <div>
            <h1>Let’s get you a co-founder</h1>
            <p>
              Nucleus runs your team on locally installed AI CLIs. You need at least one
              before the incubator opens — let’s find or install one.
            </p>
          </div>
        </header>

        <section className="card onboarding-detect-card">
          <div className="onboarding-detect-head">
            <h2>{detecting ? 'Looking for installed AI CLIs…' : 'AI CLIs on this machine'}</h2>
            <button
              type="button"
              className="btn sm"
              disabled={isDetecting}
              onClick={() => void detectClis()}
            >
              {isDetecting ? 'Checking…' : 'Re-check'}
            </button>
          </div>
          <CliDetectionList clis={clis} isDetecting={isDetecting} />
        </section>

        <CliInstallPanel
          clis={clis}
          platform={platform}
          theme={theme}
          isDetecting={isDetecting}
          onRecheck={() => void detectClis()}
          onTested={handleTested}
        />

        <div className="onboarding-footer">
          {ready.length === 0 ? (
            <span className="onboarding-hint">
              {installed.length === 0
                ? 'Install and log in to at least one CLI above, then re-check.'
                : 'Almost there — hit Test to confirm a CLI is logged in, then continue.'}
            </span>
          ) : (
            <span className="onboarding-hint">
              {ready.length === 1
                ? `${ready[0].cliName} works — it’ll be assigned to every team seat (you can change it later).`
                : `${ready.length} CLIs verified — you’ll pick which each role uses next.`}
            </span>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={ready.length === 0 || finishing}
            onClick={() => void handleContinue()}
          >
            {finishing ? 'Setting up…' : continueLabel}
          </button>
          {ready.length === 0 && (
            // The escape hatch: a user without one of the preset CLIs (or who can't
            // log in right now) must not be hard-blocked at first run. The Default-Team
            // gate still keeps New Project closed until a CLI is actually assigned.
            <button
              type="button"
              className="btn"
              disabled={finishing}
              onClick={() => void handleSkip()}
            >
              Skip for now — I&apos;ll set up a CLI later
            </button>
          )}
          {finishError && <p className="validation-note err">{finishError}</p>}
        </div>
      </div>
    </div>
  );
}
