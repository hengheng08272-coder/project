import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'blue' | 'violet' | 'emerald' | 'amber' | 'sky';

const MODE_KEY = 'tg-downloader-theme';
const ACCENT_KEY = 'tg-downloader-accent';

export const ACCENTS: { key: AccentColor; label: string; swatch: string }[] = [
  { key: 'blue', label: 'Ocean', swatch: '#3b82f6' },
  { key: 'violet', label: 'Nebula', swatch: '#8b5cf6' },
  { key: 'emerald', label: 'Forest', swatch: '#10b981' },
  { key: 'amber', label: 'Sunset', swatch: '#f59e0b' },
  { key: 'sky', label: 'Telegram', swatch: '#229ed9' },
];

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  /** What the page actually renders as right now, after resolving 'system'. */
  resolved: 'dark' | 'light';
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const saved = window.localStorage.getItem(key);
  return allowed.includes(saved as T) ? (saved as T) : fallback;
}

function prefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readStored(MODE_KEY, ['dark', 'light', 'system'] as const, 'dark')
  );
  const [accent, setAccentState] = useState<AccentColor>(() =>
    readStored(ACCENT_KEY, ['blue', 'violet', 'emerald', 'amber', 'sky'] as const, 'blue')
  );
  const [systemIsLight, setSystemIsLight] = useState(prefersLight);

  // Follow the OS while the mode is 'system'.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemIsLight(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'dark' | 'light' =
    mode === 'system' ? (systemIsLight ? 'light' : 'dark') : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-light', resolved === 'light');
    root.classList.toggle('theme-dark', resolved === 'dark');
    for (const option of ACCENTS) {
      root.classList.toggle(`accent-${option.key}`, option.key === accent);
    }
    window.localStorage.setItem(MODE_KEY, mode);
    window.localStorage.setItem(ACCENT_KEY, accent);
  }, [mode, accent, resolved]);

  const value = useMemo(
    () => ({
      mode,
      setMode: setModeState,
      accent,
      setAccent: setAccentState,
      resolved,
    }),
    [mode, accent, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
