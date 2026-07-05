import type { ReactNode } from 'react';
import { ShellLayout } from './components/ShellLayout';
import type { PageId } from './state/appStore';
import { useAppStore } from './state/appStore';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { InvestorPitchPage } from './pages/InvestorPitchPage';
import { WhiteboardPage } from './pages/WhiteboardPage';
import { BullpenPage } from './pages/BullpenPage';
import { PunchListPage } from './pages/PunchListPage';
import { SecretsPage } from './pages/SecretsPage';
import { GaragePage } from './pages/GaragePage';
import { LessonsPage } from './pages/LessonsPage';
import { TerminalsPage } from './pages/TerminalsPage';
import { TeamPage } from './pages/TeamPage';
import { CliToolingPage } from './pages/CliToolingPage';
import { NewBuildPage } from './pages/NewBuildPage';
import { NewRunPage } from './pages/NewRunPage';
import { RipItPage } from './pages/RipItPage';
import { RunHistoryPage } from './pages/RunHistoryPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { AboutPage } from './pages/AboutPage';
import { OnboardingScreen } from './pages/onboarding/OnboardingScreen';

interface PageMeta {
  title: string;
  subtitle: string;
  render: () => ReactNode;
}

const PAGES: Record<PageId, PageMeta> = {
  dashboard: {
    title: 'Hacker Hostel',
    subtitle: 'Where the team builds — readiness, projects, and an investor-safe overview',
    render: () => <DashboardPage />,
  },
  projects: {
    title: 'Projects',
    subtitle: 'Every project you are building, side by side',
    render: () => <ProjectsPage />,
  },
  project: {
    title: 'Active Project',
    subtitle: 'Its team, backlog, and workspace health',
    render: () => <ProjectDetailPage />,
  },
  'investor-pitch': {
    title: 'Investor Pitch',
    subtitle: 'Design the project with Monica',
    render: () => <InvestorPitchPage />,
  },
  whiteboard: {
    title: 'The Whiteboard',
    subtitle: 'Richard drafts phases & tasks for your approval',
    render: () => <WhiteboardPage />,
  },
  bullpen: {
    title: 'The Bullpen',
    subtitle: 'Dinesh builds, Big Head tests, Gilfoyle secures',
    render: () => <BullpenPage />,
  },
  'punch-list': {
    title: 'The Punch List',
    subtitle: 'Bring Richard a mid-build change — he triages and files it',
    render: () => <PunchListPage />,
  },
  vault: {
    title: 'The Vault',
    subtitle: 'The app’s secrets — names only; you push the values yourself',
    render: () => <SecretsPage />,
  },
  garage: {
    title: 'The Garage',
    subtitle: 'Jared keeps the project statistics',
    render: () => <GaragePage />,
  },
  lessons: {
    title: 'The Ledger',
    subtitle: 'What past builds got wrong — injected into future ones once confirmed',
    render: () => <LessonsPage />,
  },
  terminals: {
    title: 'Terminals',
    subtitle: 'Drop into a live session with any role’s CLI',
    render: () => <TerminalsPage />,
  },
  team: {
    title: 'Default Team',
    subtitle: 'The roster new projects start from',
    render: () => <TeamPage />,
  },
  clis: {
    title: 'AI CLIs',
    subtitle: 'Which AI command-line tools are installed, and their versions',
    render: () => <CliToolingPage />,
  },
  'new-build': {
    title: 'New Project',
    subtitle: 'One app, or a whole product built piece by piece?',
    render: () => <NewBuildPage />,
  },
  'new-run': {
    title: 'The Pitch',
    subtitle: 'Pitch Erlich — and your project is in the incubator',
    render: () => <NewRunPage />,
  },
  'rip-it': {
    title: 'Rip it and Ship It',
    subtitle: 'Skip the incubator — chat with Erlich, then Dinesh builds it on the spot',
    render: () => <RipItPage />,
  },
  history: {
    title: 'Run History',
    subtitle: 'Past runs and their outcomes',
    render: () => <RunHistoryPage />,
  },
  'run-detail': {
    title: 'Run Detail',
    subtitle: 'Step timeline, logs, and handoffs',
    render: () => <RunDetailPage />,
  },
  templates: {
    title: 'Templates',
    subtitle: 'Starter shapes for new projects',
    render: () => <TemplatesPage />,
  },
  about: {
    title: 'About',
    subtitle: 'What Nucleus-AI is, the parody behind it, and the runtime underneath',
    render: () => <AboutPage />,
  },
};

export default function App() {
  const page = useAppStore((s) => s.page);
  const hydrated = useAppStore((s) => s.hydrated);
  const bootError = useAppStore((s) => s.bootError);
  const onboarded = useAppStore((s) => s.settings.onboarded);
  const hydrate = useAppStore((s) => s.hydrate);
  const meta = PAGES[page];

  // Wait for hydrate() to load the persisted settings before deciding what to
  // render. Without this gate the first paint uses the default `onboarded: false`
  // and briefly flashes the OnboardingScreen — which mounts an embedded shell
  // TerminalView, spawning a throwaway PTY and throwing an async xterm
  // "dimensions" error — only to unmount it a frame later when the real
  // `onboarded: true` arrives.
  if (!hydrated) {
    return <div className="app-splash" aria-busy="true" />;
  }

  // Boot read FAILED after retries (couldn't reach the main process / read the
  // profile). Show a recoverable error rather than falling through to the
  // OnboardingScreen — re-onboarding over an existing profile would hide the
  // user's projects and is exactly the bug this guards against.
  if (bootError) {
    return (
      <div className="app-splash app-splash--error" role="alert">
        <div className="boot-error-card">
          <h1>Couldn’t load your data</h1>
          <p>
            Nucleus-AI started but couldn’t read your settings and projects from the app
            profile. Your data is safe on disk — this is a load error, not data loss.
          </p>
          <p className="boot-error-detail">{bootError}</p>
          <button type="button" className="btn primary" onClick={() => void hydrate()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // First-run gate: no team can work without a CLI, so onboarding renders
  // outside the normal shell until at least one is set up. completeOnboarding()
  // flips the flag and this re-renders straight into the app.
  if (!onboarded) {
    return <OnboardingScreen />;
  }

  return (
    <ShellLayout title={meta.title} subtitle={meta.subtitle}>
      {meta.render()}
    </ShellLayout>
  );
}
