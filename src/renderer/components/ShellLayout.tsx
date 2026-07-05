import type { ReactNode } from 'react';
import { huntComplete } from '../../shared/easterEggs';
import { effectivePersonaName } from '../../shared/personas';
import { useAppStore } from '../state/appStore';
import { HotDog } from './EggRewardArt';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface ShellLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function ShellLayout({ title, subtitle, children }: ShellLayoutProps) {
  const appInfo = useAppStore((s) => s.appInfo);
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const opsOverride = useAppStore((s) => s.settings.roles.ops.personaNameOverride);
  const crackedEggs = useAppStore((s) => s.settings.crackedEggs);
  const jianYangAwake = useAppStore((s) => s.settings.jianYangAwake);
  const setJianYangAwake = useAppStore((s) => s.setJianYangAwake);
  // Once the whole hunt is cracked, the company can change hands: Jian Yang
  // runs operations too (and everything else — see PersonaAvatar).
  const opsName = jianYangAwake
    ? 'Jian Yang'
    : effectivePersonaName('ops', opsOverride, namingMode);

  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Header title={title} subtitle={subtitle} />
        <main className="shell-content">{children}</main>
      </div>
      <footer className="statusbar">
        <div className="statusbar-section">
          <span>Operational Stability by {opsName}</span>
          {/* The hunt's real prize: after all three cracks, this hot dog hands
              the whole company to Jian Yang (and back). No dialog. Just power. */}
          {huntComplete(crackedEggs) && (
            <button
              type="button"
              className="statusbar-egg"
              aria-label="Change of management"
              onClick={() => setJianYangAwake(!jianYangAwake)}
            >
              <HotDog width={22} />
            </button>
          )}
        </div>
        <div className="statusbar-section">
          <span title={activeProject?.info.workspacePath}>
            {activeProject ? `Project: ${activeProject.info.projectName}` : 'No active project'}
          </span>
          <span>
            {appInfo
              ? `v${appInfo.appVersion} · ${appInfo.platform}-${appInfo.arch}`
              : '…'}
          </span>
        </div>
      </footer>
    </div>
  );
}
