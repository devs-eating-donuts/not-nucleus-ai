import { NamingModeSwitcher } from './NamingModeSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { UiScaleControl } from './UiScaleControl';

interface HeaderProps {
  title: string;
  subtitle: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-titles">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        <NamingModeSwitcher />
        <UiScaleControl />
        <ThemeSwitcher />
      </div>
    </header>
  );
}
