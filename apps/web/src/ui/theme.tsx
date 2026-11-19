import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'theme';

const prefersDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Day or Night as chosen on this device; until someone chooses, the device setting decides. */
export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return prefersDark() ? 'dark' : 'light';
}

const EVENT = 'themechange';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Every switch on the page (side menu, phone top bar) shows the same choice.
  window.dispatchEvent(new Event(EVENT));
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice lasts until the page is closed.
  }
}

/** Day / Night switch. The choice is kept on this device. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  // Follow the device while nothing has been chosen.
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener(EVENT, sync);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const follow = () => {
      if (!document.documentElement.dataset.theme) sync();
    };
    media?.addEventListener?.('change', follow);
    return () => {
      window.removeEventListener(EVENT, sync);
      media?.removeEventListener?.('change', follow);
    };
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      aria-label={next === 'dark' ? 'Switch to night mode' : 'Switch to day mode'}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
      {theme === 'dark' ? 'Night' : 'Day'}
    </button>
  );
}
