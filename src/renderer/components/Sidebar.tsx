import { useState } from 'react';
import type { ReactNode } from 'react';
import { brandName } from '../../shared/naming';
import type { PageId } from '../state/appStore';
import { useAppStore } from '../state/appStore';
import {
  IconBullpen,
  IconClis,
  IconDefaultTeam,
  IconFolder,
  IconGarage,
  IconHistory,
  IconHome,
  IconInfo,
  IconLedger,
  IconPresentation,
  IconPunchList,
  IconRipIt,
  IconRocket,
  IconTeam,
  IconTemplates,
  IconTerminal,
  IconVault,
  IconWhiteboard,
} from './icons';

interface NavEntry {
  page: PageId;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  id: string;
  label: string;
  entries: NavEntry[];
}

/** Top-level entries, shown above the groups. */
const HOME: NavEntry = { page: 'dashboard', label: 'Hacker Hostel', icon: <IconHome /> };
/** The express lane — an alternative to the full lifecycle, kept prominent. */
const RIP_IT: NavEntry = { page: 'rip-it', label: 'Rip it and Ship It', icon: <IconRipIt /> };

const GROUPS: NavGroup[] = [
  {
    id: 'incubator',
    label: 'The Incubator',
    // The project lifecycle, in run order. "Project Team" is the ACTIVE project's
    // team (the `project` page) — set it up first; without a team the app is inert.
    // Each entry has its OWN glyph so the lifecycle reads at a glance.
    entries: [
      { page: 'project', label: 'Project Team', icon: <IconTeam /> },
      { page: 'new-run', label: 'The Pitch', icon: <IconRocket /> },
      { page: 'investor-pitch', label: 'Investor Pitch', icon: <IconPresentation /> },
      { page: 'whiteboard', label: 'The Whiteboard', icon: <IconWhiteboard /> },
      { page: 'bullpen', label: 'The Bullpen', icon: <IconBullpen /> },
      { page: 'punch-list', label: 'The Punch List', icon: <IconPunchList /> },
      { page: 'vault', label: 'The Vault', icon: <IconVault /> },
      { page: 'garage', label: 'The Garage', icon: <IconGarage /> },
      { page: 'history', label: 'Run History', icon: <IconHistory /> },
      { page: 'lessons', label: 'The Ledger', icon: <IconLedger /> },
      { page: 'terminals', label: 'Terminals', icon: <IconTerminal /> },
    ],
  },
  {
    id: 'workshop',
    label: 'Workshop',
    // Global setup + reference: cross-project things new projects start from.
    entries: [
      { page: 'projects', label: 'Projects', icon: <IconFolder /> },
      { page: 'team', label: 'Default Team', icon: <IconDefaultTeam /> },
      { page: 'clis', label: 'AI CLIs', icon: <IconClis /> },
      { page: 'templates', label: 'Templates', icon: <IconTemplates /> },
      { page: 'about', label: 'About', icon: <IconInfo /> },
    ],
  },
];

export function Sidebar() {
  const page = useAppStore((s) => s.page);
  const navigate = useAppStore((s) => s.navigate);
  const namingMode = useAppStore((s) => s.namingMode);
  const activeProject = useAppStore((s) => s.activeProject);
  const beginNewProject = useAppStore((s) => s.beginNewProject);
  // The active project's build is paused for the human — badge The Bullpen from any page.
  const bullpenEscalated = useAppStore((s) => s.bullpenEscalated);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const renderEntry = (entry: NavEntry) => (
    <button
      key={entry.page}
      type="button"
      className={`nav-item${page === entry.page ? ' active' : ''}`}
      onClick={() => {
        // "The Pitch" with NO active project is a fresh-create path — route it
        // through beginNewProject so the Default-Team readiness gate applies
        // (a bare navigate could create a project with dead seats). With an
        // active project it keeps its job: restoring that project's review.
        if (entry.page === 'new-run' && !activeProject) {
          beginNewProject();
          return;
        }
        navigate(entry.page);
      }}
    >
      {entry.icon}
      {entry.label}
      {entry.page === 'bullpen' && bullpenEscalated && (
        <span className="nav-badge" title="The build paused — it needs you">
          needs you
        </span>
      )}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div>
          <div className="brand-wordmark">
            NUCLEUS<span className="brand-ai">-AI</span>
          </div>
          <div className="brand-sub">Making the world a better place</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {renderEntry(HOME)}
        {renderEntry(RIP_IT)}

        {GROUPS.map((group) => {
          const isCollapsed = collapsed[group.id] ?? false;
          return (
            <div key={group.id} className="nav-group">
              <button
                type="button"
                className="nav-group-header"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))
                }
              >
                <span className="nav-group-label">{group.label}</span>
                <span className="nav-group-chevron" aria-hidden>
                  {isCollapsed ? '▸' : '▾'}
                </span>
              </button>
              {!isCollapsed && (
                <div className="nav-group-items">{group.entries.map(renderEntry)}</div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        Powered by {brandName('poweredBy', namingMode)}
        <br />
        Created by {brandName('createdBy', namingMode)}
      </div>
    </aside>
  );
}
