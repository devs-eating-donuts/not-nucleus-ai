import { THEMES } from '../../shared/theme';
import type { ThemeId } from '../../shared/theme';
import { useAppStore } from '../state/appStore';

export function ThemeSwitcher() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div className="theme-switcher">
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        title={THEMES.find((t) => t.id === theme)?.tagline}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
