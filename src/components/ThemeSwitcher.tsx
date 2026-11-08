import { useEffect, useState } from 'react';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Icon, type IconName } from './ui/Icon.tsx';
import styles from './ThemeSwitcher.module.css';

export type Theme = 'system' | 'light' | 'dark';

/** Must match the inline script in index.html, which applies the theme before first paint. */
const KEY = 'inspo-theme';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

const OPTIONS: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System theme', icon: 'monitor' },
  { value: 'light', label: 'Light theme', icon: 'sun' },
  { value: 'dark', label: 'Dark theme', icon: 'moon' },
];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <ToggleGroup
      className={styles.group}
      aria-label="Theme"
      value={[theme]}
      onValueChange={(v) => v[0] && setTheme(v[0] as Theme)}
    >
      {OPTIONS.map((o) => (
        <Toggle key={o.value} value={o.value} className={styles.option} aria-label={o.label} title={o.label}>
          <Icon name={o.icon} />
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
