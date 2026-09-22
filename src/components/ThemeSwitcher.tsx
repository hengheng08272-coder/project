import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';

import { ACCENTS, useTheme, type ThemeMode } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n';

const MODES: { key: ThemeMode; icon: typeof Sun; labelKey: 'theme.dark' | 'theme.light' | 'theme.system' }[] = [
  { key: 'light', icon: Sun, labelKey: 'theme.light' },
  { key: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { key: 'system', icon: Monitor, labelKey: 'theme.system' },
];

/** Theme and accent picker; lives in the header and in Settings › Appearance. */
export function ThemeSwitcher({ variant = 'menu' }: { variant?: 'menu' | 'inline' }) {
  const { mode, setMode, accent, setAccent } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const panel = (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-dark-500">
          {t('theme.appearance')}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {MODES.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[11px] font-medium transition-colors ${
                mode === key
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-400'
                  : 'border-dark-700/60 bg-dark-800/40 text-dark-400 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-dark-500">
          {t('theme.accent')}
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {ACCENTS.map((option) => (
            <button
              key={option.key}
              onClick={() => setAccent(option.key)}
              title={option.label}
              className={`flex h-9 items-center justify-center rounded-lg border transition-colors ${
                accent === option.key
                  ? 'border-primary-500/60 bg-primary-500/10'
                  : 'border-dark-700/60 bg-dark-800/40 hover:border-dark-600'
              }`}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full"
                style={{ backgroundColor: option.swatch }}
              >
                {accent === option.key && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (variant === 'inline') return panel;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('theme.appearance')}
        className="rounded-lg p-2 text-dark-400 transition-colors hover:bg-dark-800 hover:text-white"
      >
        <Palette className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-dark-700 bg-dark-900 p-4 shadow-2xl shadow-black/40 animate-slide-down">
          {panel}
        </div>
      )}
    </div>
  );
}
