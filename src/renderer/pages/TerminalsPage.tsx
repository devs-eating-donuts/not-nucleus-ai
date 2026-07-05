import { useMemo, useState } from 'react';
import { effectivePersonaName, defaultPersonaForRole } from '../../shared/personas';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import type { TerminalMode } from '../../shared/terminal';
import { PersonaAvatar } from '../components/PersonaAvatar';
import { TerminalView } from '../components/TerminalView';
import { useAppStore } from '../state/appStore';

type Station = { key: string; roleId: RoleId; mode: TerminalMode };
type Status = 'starting' | 'running' | 'exited' | 'failed';

const STATUS_LABEL: Record<Status, string> = {
  starting: 'starting…',
  running: 'live',
  exited: 'exited',
  failed: 'failed',
};

export function TerminalsPage() {
  const activeProject = useAppStore((s) => s.activeProject);
  const namingMode = useAppStore((s) => s.namingMode);
  const themeId = useAppStore((s) => s.theme);
  const navigate = useAppStore((s) => s.navigate);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState<Status>('starting');
  const [detail, setDetail] = useState<string | null>(null);

  const projectId = activeProject?.registry.id;

  // One station per role (its CLI), in chain order, plus a plain shell.
  const stations = useMemo<Station[]>(() => {
    if (!activeProject) {
      return [];
    }
    const roleStations = ALL_ROLE_IDS.filter((roleId) => {
      const cfg = activeProject.team[roleId];
      return cfg && cfg.enabled !== false;
    }).map<Station>((roleId) => ({ key: `cli:${roleId}`, roleId, mode: 'cli' }));
    return [...roleStations, { key: 'shell', roleId: 'developer', mode: 'shell' }];
  }, [activeProject]);

  const selected = stations.find((s) => s.key === selectedKey) ?? stations[0] ?? null;

  if (!activeProject || !projectId) {
    return (
      <div className="section">
        <div className="empty-state">
          <div className="empty-title">No project open</div>
          <p>Open a project to drop into a live terminal with one of its CLIs.</p>
          <button type="button" className="btn primary" onClick={() => navigate('projects')}>
            Projects
          </button>
        </div>
      </div>
    );
  }

  const selectStation = (station: Station): void => {
    if (station.key === selected?.key) {
      return;
    }
    setSelectedKey(station.key);
    setStatus('starting');
    setDetail(null);
  };

  const restart = (): void => {
    setSessionKey((n) => n + 1);
    setStatus('starting');
    setDetail(null);
  };

  const cliAssignedFor = (roleId: RoleId): boolean => {
    const a = activeProject.team[roleId]?.assignment;
    return !!a && a.command.trim() !== '';
  };

  const selectedAssigned =
    selected?.mode === 'shell' || (selected ? cliAssignedFor(selected.roleId) : false);

  return (
    <div className="terminals-page">
      <div className="terminals-stations">
        {stations.map((station) => {
          if (station.mode === 'shell') {
            const active = selected?.key === station.key;
            return (
              <button
                key={station.key}
                type="button"
                className={`terminal-station${active ? ' active' : ''}`}
                onClick={() => selectStation(station)}
              >
                <span className="terminal-station-shell-glyph" aria-hidden="true">
                  ›_
                </span>
                <span className="terminal-station-meta">
                  <span className="terminal-station-name">Shell</span>
                  <span className="terminal-station-cli">OS default shell</span>
                </span>
              </button>
            );
          }
          const cfg = activeProject.team[station.roleId];
          const personaName = effectivePersonaName(
            station.roleId,
            cfg?.personaNameOverride ?? null,
            namingMode,
          );
          const personaId = defaultPersonaForRole(station.roleId)?.id;
          const assigned = cliAssignedFor(station.roleId);
          const active = selected?.key === station.key;
          return (
            <button
              key={station.key}
              type="button"
              className={`terminal-station${active ? ' active' : ''}`}
              onClick={() => selectStation(station)}
              title={`${ROLE_DEFINITIONS[station.roleId].label} — ${personaName}`}
            >
              <PersonaAvatar personaId={personaId} name={personaName} size={26} headFocus />
              <span className="terminal-station-meta">
                <span className="terminal-station-name">{personaName}</span>
                <span className={`terminal-station-cli${assigned ? '' : ' unassigned'}`}>
                  {assigned ? cfg?.assignment?.cliName : 'no CLI assigned'}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="terminals-stage card">
        <div className="terminals-toolbar">
          <span className={`terminal-status-dot ${status}`} aria-hidden="true" />
          <span className="terminal-status-text">
            {selected?.mode === 'shell'
              ? 'Shell'
              : `${ROLE_DEFINITIONS[selected?.roleId ?? 'developer'].label}`}{' '}
            · {STATUS_LABEL[status]}
          </span>
          {detail && <span className="terminal-status-detail">{detail}</span>}
          <span className="terminals-toolbar-spacer" />
          <button type="button" className="btn sm" onClick={restart} disabled={!selectedAssigned}>
            Restart
          </button>
        </div>

        {selected && selectedAssigned ? (
          <TerminalView
            key={`${selected.key}:${sessionKey}`}
            projectId={projectId}
            roleId={selected.roleId}
            mode={selected.mode}
            themeId={themeId}
            sessionKey={sessionKey}
            onStatus={(s, d) => {
              setStatus(s);
              setDetail(d ?? null);
            }}
          />
        ) : (
          <div className="terminal-host terminal-host-empty">
            <p className="field-hint">
              This role has no CLI assigned. Assign one on the project&apos;s team, or use the Shell
              station.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
