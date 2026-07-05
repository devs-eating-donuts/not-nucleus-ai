import { NAMING_MODES, isLockedNamingMode } from '../../shared/naming';
import type { NamingMode } from '../../shared/naming';
import { useAppStore } from '../state/appStore';

/**
 * Switches the character set app-wide — the affectionate joke at the heart of
 * this fan tribute. Persisted in local settings like the theme. The locked
 * tiers stay hidden until their Pipey trivia clue is cracked
 * (shared/easterEggs.ts); a soft gate by design.
 */
export function NamingModeSwitcher() {
  const namingMode = useAppStore((s) => s.namingMode);
  const setNamingMode = useAppStore((s) => s.setNamingMode);
  const crackedEggs = useAppStore((s) => s.settings.crackedEggs);

  const visible = NAMING_MODES.filter(
    (m) => !isLockedNamingMode(m.id) || crackedEggs.includes(m.id) || m.id === namingMode,
  );

  return (
    <div className="theme-switcher">
      <select
        aria-label="Naming mode"
        value={namingMode}
        onChange={(e) => setNamingMode(e.target.value as NamingMode)}
        title={NAMING_MODES.find((m) => m.id === namingMode)?.tagline}
      >
        {visible.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
