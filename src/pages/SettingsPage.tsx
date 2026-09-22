import { useState } from 'react';
import { Database, Palette, Server, SlidersHorizontal } from 'lucide-react';

import { Tabs } from '@/components/Tabs';
import { TelegramGlyph } from '@/components/Brand';
import { ProGate } from '@/components/ProGate';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { DownloadPreferences } from '@/pages/DownloadPreferences';
import { R2Page } from '@/pages/R2Page';
import { S3SourcePage } from '@/pages/S3SourcePage';
import { TelegramPage } from '@/pages/TelegramPage';
import { ACCENTS, useTheme } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n';
import type { Capability } from '@/lib/types';

export type SettingsTab = 'telegram' | 'r2' | 's3source' | 'downloads' | 'appearance';

/**
 * Telegram, R2 and download preferences used to be three sidebar entries that
 * were all "settings". They are tabs of one page now.
 *
 * `capability` decides which tabs a Basic subscriber can actually use:
 * connecting your own Telegram account and your own storage (R2/S3 source)
 * is Pro-only -- a Basic subscriber uses the app's shared userbot and shared
 * storage transparently, with nothing of their own to configure there.
 *
 * `initialTab` lets a caller (the Dashboard's connection chips) deep-link
 * straight to the tab for the account it's about, instead of always
 * landing on Telegram and making the person click again to find R2.
 */
export function SettingsPage({ capability, initialTab }: { capability: Capability; initialTab?: SettingsTab }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'telegram');

  return (
    <div className="space-y-4">
      <Tabs
        active={tab}
        onChange={(key) => setTab(key as SettingsTab)}
        tabs={[
          { key: 'telegram', label: t('tab.telegram'), icon: <TelegramGlyph className="h-3.5 w-3.5" /> },
          { key: 'r2', label: t('tab.r2'), icon: <Database className="h-3.5 w-3.5" /> },
          { key: 's3source', label: t('tab.s3source'), icon: <Server className="h-3.5 w-3.5" /> },
          { key: 'downloads', label: t('tab.downloads'), icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
          { key: 'appearance', label: t('tab.appearance'), icon: <Palette className="h-3.5 w-3.5" /> },
        ]}
      />

      {tab === 'telegram' && (
        <ProGate capability={capability}>
          <TelegramPage />
        </ProGate>
      )}
      {tab === 'r2' && (
        <ProGate capability={capability}>
          <R2Page />
        </ProGate>
      )}
      {tab === 's3source' && (
        <ProGate capability={capability}>
          <S3SourcePage />
        </ProGate>
      )}
      {tab === 'downloads' && <DownloadPreferences />}
      {tab === 'appearance' && <AppearanceSettings />}
    </div>
  );
}

function AppearanceSettings() {
  const { t } = useLanguage();
  const { accent, resolved } = useTheme();
  const accentName = ACCENTS.find((a) => a.key === accent)?.label ?? accent;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <Palette className="h-4 w-4 text-primary-400" /> {t('theme.appearance')}
        </h3>
        <ThemeSwitcher variant="inline" />
        <p className="mt-4 text-[11px] text-dark-500">
          Currently rendering in <span className="text-dark-300">{resolved}</span> with the{' '}
          <span className="text-primary-400">{accentName}</span> accent. The choice is remembered in
          this browser.
        </p>
      </div>

      {/* A live sample so the accent choice can be judged before leaving the page. */}
      <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Preview</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button className="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white">
              Primary
            </button>
            <button className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white">
              Accent
            </button>
            <button className="rounded-lg bg-dark-800 px-3 py-1.5 text-xs font-medium text-dark-300">
              Muted
            </button>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-dark-800">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-primary-500 to-accent-500" />
          </div>
          <div className="rounded-lg border border-dark-800 bg-dark-800/40 p-3">
            <p className="text-sm font-medium text-white">Card heading</p>
            <p className="text-xs text-dark-400">Secondary text on a card surface</p>
            <div className="mt-2 flex gap-2 text-[10px]">
              <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-success-400">completed</span>
              <span className="rounded-full bg-warning-500/10 px-2 py-0.5 text-warning-400">queued</span>
              <span className="rounded-full bg-error-500/10 px-2 py-0.5 text-error-400">failed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
