import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cloud,
  DownloadCloud,
  Film,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Users,
  Wand2,
  XCircle,
} from 'lucide-react';

import { ActivityChart, type ActivityPoint } from '@/components/ActivityChart';
import { AppLogo, TelegramGlyph } from '@/components/Brand';
import { supabase } from '@/lib/supabase';
import { useConnectionStatus } from '@/lib/hooks';
import { backendConfigured, resolvePageUrl, saveUrlItemsToR2 } from '@/lib/backend';
import type { SettingsTab } from '@/pages/SettingsPage';
import type { Download, Episode, Group, PageKey, TelegramSettings, Topic } from '@/lib/types';
import { formatBytes, formatTimeAgo, getStatusColor } from '@/lib/utils';

const ACTIVITY_DAYS = 14;

interface Stats {
  groups: number;
  topics: number;
  episodes: number;
  downloaded: number;
  queued: number;
  failed: number;
  storage: number;
}

export function DashboardPage({
  onNavigate,
  onNavigateSettings,
}: {
  onNavigate: (page: PageKey) => void;
  onNavigateSettings: (tab: SettingsTab) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [recent, setRecent] = useState<(Download & { episode?: Episode })[]>([]);
  const [topGroups, setTopGroups] = useState<{ group: Group; count: number; bytes: number }[]>([]);
  const [account, setAccount] = useState<TelegramSettings | null>(null);
  const status = useConnectionStatus();

  const load = useCallback(async () => {
    const [dlRes, epRes, groupRes, topicRes, recentRes, tgRes] = await Promise.all([
      supabase.from('downloads').select('id, status, completed_at'),
      supabase.from('episodes').select('id, group_id, status, file_size, r2_key'),
      supabase.from('groups').select('*'),
      supabase.from('topics').select('id'),
      supabase
        .from('downloads')
        .select('*, episode:episodes(*)')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('telegram_settings').select('*').maybeSingle(),
    ]);

    const downloads = (dlRes.data as Pick<Download, 'id' | 'status' | 'completed_at'>[]) || [];
    const episodes = (epRes.data as Episode[]) || [];
    const groups = (groupRes.data as Group[]) || [];

    setStats({
      groups: groups.length,
      topics: ((topicRes.data as Topic[]) || []).length,
      episodes: episodes.length,
      downloaded: episodes.filter((e) => e.status === 'completed').length,
      queued: downloads.filter((d) => d.status === 'queued' || d.status === 'downloading').length,
      failed: downloads.filter((d) => d.status === 'failed').length,
      storage: episodes.filter((e) => e.r2_key).reduce((sum, e) => sum + (e.file_size || 0), 0),
    });

    setActivity(buildActivity(downloads));
    setRecent((recentRes.data as (Download & { episode?: Episode })[]) || []);
    setAccount((tgRes.data as TelegramSettings) || null);

    setTopGroups(
      groups
        .map((group) => {
          const own = episodes.filter((e) => e.group_id === group.id);
          return {
            group,
            count: own.length,
            bytes: own.reduce((sum, e) => sum + (e.file_size || 0), 0),
          };
        })
        .filter((row) => row.count > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5)
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountName = [account?.account_first_name, account?.account_last_name]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-dark-800 bg-gradient-to-br from-dark-900 via-dark-900 to-primary-950/40 p-6">
        <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-accent-500/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center gap-4">
          <AppLogo size={52} className="glow" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold tracking-tight text-white">KH Telegram Download</h2>
            <p className="text-xs text-dark-400">
              {account?.connected && accountName ? (
                <>
                  Signed in as <span className="text-primary-400">{accountName}</span>
                  {account.account_username && (
                    <span className="text-dark-500"> · @{account.account_username}</span>
                  )}
                </>
              ) : (
                'Connect your Telegram account to start scanning groups'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip
              label="Telegram"
              ok={status.telegram}
              icon={<TelegramGlyph className="h-3 w-3" />}
              onClick={() => onNavigateSettings('telegram')}
            />
            <StatusChip
              label="R2"
              ok={status.r2}
              icon={<Cloud className="h-3 w-3" />}
              onClick={() => onNavigateSettings('r2')}
            />
            <StatusChip
              label="Service"
              ok={status.backend === true}
              unknown={status.backend === null}
              icon={<Activity className="h-3 w-3" />}
              onClick={() => onNavigate('guide')}
            />
          </div>
        </div>

        {!backendConfigured && (
          <p className="relative mt-4 rounded-lg border border-warning-500/20 bg-warning-500/10 px-3 py-2 text-[11px] text-warning-300">
            No userbot service is configured yet — scanning and downloading stay idle.
            See <button onClick={() => onNavigate('guide')} className="underline">How to use</button>.
          </p>
        )}

        {/* Quick actions */}
        <div className="relative mt-5 flex flex-wrap gap-2">
          <QuickAction icon={<Plus className="h-3.5 w-3.5" />} label="Add a group" onClick={() => onNavigate('groups')} primary />
          <QuickAction icon={<DownloadCloud className="h-3.5 w-3.5" />} label="Download queue" onClick={() => onNavigate('downloads')} />
        </div>
      </section>

      {/* Quick Download -- paste one link and go, no list/group/topic/EP to
          set up first. Lands in a "Quick Downloads" URL list, created the
          first time this is used. */}
      <QuickDownloadCard />

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          icon={<Film className="h-4 w-4" />}
          label="Videos found"
          value={stats?.episodes}
          sub={`${stats?.groups ?? 0} groups · ${stats?.topics ?? 0} topics`}
          tone="primary"
          onClick={() => onNavigate('groups')}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Downloaded"
          value={stats?.downloaded}
          sub={stats ? `${percent(stats.downloaded, stats.episodes)} of all videos` : ''}
          tone="success"
          onClick={() => onNavigate('downloads')}
        />
        <KpiCard
          icon={<HardDrive className="h-4 w-4" />}
          label="Stored in R2"
          value={stats ? formatBytes(stats.storage) : undefined}
          sub={stats?.failed ? `${stats.failed} failed downloads` : 'no failures'}
          tone={stats?.failed ? 'warning' : 'muted'}
          onClick={() => onNavigateSettings('r2')}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Activity */}
        <section className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Downloads completed</h3>
              <p className="text-[11px] text-dark-500">Last {ACTIVITY_DAYS} days</p>
            </div>
            <button
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg bg-dark-800 px-2.5 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          <ActivityChart data={activity} label={`${ACTIVITY_DAYS} days`} />
        </section>

        {/* Storage + queue */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Layers className="h-4 w-4 text-accent-400" /> Library progress
            </h3>
            <p className="text-2xl font-bold tabular-nums text-white">
              {stats ? `${stats.downloaded}/${stats.episodes}` : '—'}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-dark-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all"
                style={{ width: stats ? `${ratio(stats.downloaded, stats.episodes)}%` : '0%' }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-dark-500">
              {stats ? `${formatBytes(stats.storage)} uploaded to R2` : ''}
            </p>
            {(stats?.queued ?? 0) > 0 && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-2.5 py-1.5 text-[11px] text-primary-300">
                <Activity className="h-3 w-3" /> {stats?.queued} in the queue right now
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-primary-400" /> Biggest groups
            </h3>
            {topGroups.length === 0 ? (
              <p className="py-4 text-center text-xs text-dark-600">Nothing scanned yet</p>
            ) : (
              <div className="space-y-2.5">
                {topGroups.map(({ group, count, bytes }) => {
                  const widest = topGroups[0].bytes || 1;
                  return (
                    <button
                      key={group.id}
                      onClick={() => onNavigate('groups')}
                      className="block w-full text-left"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs text-dark-300">{group.title}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-dark-500">
                          {count} · {formatBytes(bytes)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-dark-800">
                        <div
                          className="h-full rounded-full bg-primary-500/70"
                          style={{ width: `${Math.max((bytes / widest) * 100, 2)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent downloads</h3>
          <button
            onClick={() => onNavigate('downloads')}
            className="flex items-center gap-1 text-[11px] text-dark-400 transition-colors hover:text-white"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="py-10 text-center">
            <DownloadCloud className="mx-auto mb-3 h-10 w-10 text-dark-700" />
            <p className="text-sm text-dark-500">No downloads yet</p>
            <p className="mt-1 text-xs text-dark-600">
              Open a group, pick a topic, and queue a few videos
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((download) => (
              <div
                key={download.id}
                className="flex items-center gap-3 rounded-lg bg-dark-800/30 p-3 transition-colors hover:bg-dark-800/60"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dark-800">
                  {download.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4 text-success-400" />
                  ) : download.status === 'failed' ? (
                    <XCircle className="h-4 w-4 text-error-400" />
                  ) : (
                    <DownloadCloud className="h-4 w-4 text-primary-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {download.episode?.title || download.episode?.file_name || 'Untitled video'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-dark-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${getStatusColor(download.status)}`}>
                      {download.status}
                    </span>
                    <span>{formatTimeAgo(download.completed_at || download.queued_at)}</span>
                    {download.episode?.file_size ? <span>{formatBytes(download.episode.file_size)}</span> : null}
                  </div>
                </div>
                {download.status === 'downloading' && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-primary-400">
                    {download.progress}%
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Paste one link and go -- no group/topic/list/EP number to set up first.
 * A page link is auto-resolved to its real video URL (same extraction the
 * URL Lists page's "Find the video link" button uses); a direct file link
 * is used as typed either way. Lands in a "Quick Downloads" URL list,
 * created automatically the first time this is used, so it's still visible
 * later under URL Lists if someone wants to organize it properly.
 */
function QuickDownloadCard() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleDownload = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setIsError(false);
    setMessage(backendConfigured ? 'Looking for the video link…' : 'Saving the link…');

    try {
      let list = (
        await supabase.from('url_lists').select('id').eq('title', 'Quick Downloads').maybeSingle()
      ).data as { id: string } | null;
      if (!list) {
        const created = await supabase
          .from('url_lists')
          .insert({ title: 'Quick Downloads', description: 'Added from the Dashboard quick-download box' })
          .select('id')
          .single();
        if (created.error || !created.data) throw new Error(created.error?.message || 'Could not create the Quick Downloads list.');
        list = created.data as { id: string };
      }

      let finalUrl = trimmed;
      let referer = '';
      let label = '';
      const looksLikeDirectFile = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg|m3u8)(\?|$)/i.test(trimmed);
      if (backendConfigured && !looksLikeDirectFile) {
        try {
          const resolved = await resolvePageUrl(trimmed);
          finalUrl = resolved.url;
          referer = resolved.referer;
          label = resolved.title || '';
        } catch {
          // Fall back to the raw pasted link -- still worth a try at download time.
        }
      }

      const inserted = await supabase
        .from('url_list_items')
        .insert({ url_list_id: list.id, url: finalUrl, label: label || null, referer: referer || null })
        .select('id')
        .single();
      if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || 'Could not save that link.');

      if (backendConfigured) {
        setMessage('Saving to R2…');
        await saveUrlItemsToR2([(inserted.data as { id: string }).id]);
        setMessage('Started! Follow its progress under URL Lists → Quick Downloads.');
      } else {
        setMessage('Saved to URL Lists → Quick Downloads (no backend configured to fetch it yet).');
      }
      setUrl('');
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : 'Could not start the download.');
    }
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Wand2 className="h-4 w-4 text-primary-400" /> Quick Download
      </h3>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDownload(); }}
          placeholder="Paste any video or webpage link here…"
          disabled={busy}
          className="flex-1 rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-dark-500 outline-none transition-colors focus:border-primary-500 disabled:opacity-60"
        />
        <button
          onClick={handleDownload}
          disabled={!url.trim() || busy}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
          Download
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${isError ? 'text-error-400' : 'text-dark-400'}`}>{message}</p>
      )}
    </section>
  );
}

/** Buckets completed downloads into one point per day, oldest first. */
function buildActivity(downloads: Pick<Download, 'status' | 'completed_at'>[]): ActivityPoint[] {
  const counts = new Map<string, number>();
  const today = new Date();

  for (let i = ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    counts.set(day.toISOString().slice(0, 10), 0);
  }

  for (const download of downloads) {
    if (download.status !== 'completed' || !download.completed_at) continue;
    const key = download.completed_at.slice(0, 10);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].map(([date, value]) => ({ date, value }));
}

const ratio = (part: number, whole: number) => (whole > 0 ? Math.min((part / whole) * 100, 100) : 0);
const percent = (part: number, whole: number) => `${Math.round(ratio(part, whole))}%`;

const TONES: Record<string, string> = {
  primary: 'text-primary-400 bg-primary-500/10 border-primary-500/20',
  success: 'text-success-400 bg-success-500/10 border-success-500/20',
  accent: 'text-accent-400 bg-accent-500/10 border-accent-500/20',
  warning: 'text-warning-400 bg-warning-500/10 border-warning-500/20',
  muted: 'text-dark-400 bg-dark-800/50 border-dark-700/50',
};

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string | undefined;
  sub: string;
  tone: keyof typeof TONES;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card-hover rounded-2xl border border-dark-800 bg-dark-900/60 p-4 text-left transition-colors hover:border-dark-700"
    >
      <div className={`mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${TONES[tone]}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold tabular-nums text-white">{value ?? '—'}</p>
      <p className="mt-0.5 text-xs font-medium text-dark-300">{label}</p>
      <p className="mt-0.5 truncate text-[10px] text-dark-500">{sub}</p>
    </button>
  );
}

function StatusChip({
  label,
  ok,
  unknown,
  icon,
  onClick,
}: {
  label: string;
  ok: boolean;
  unknown?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        unknown
          ? 'border-dark-700/60 bg-dark-800/50 text-dark-500'
          : ok
          ? 'border-success-500/25 bg-success-500/10 text-success-400'
          : 'border-warning-500/25 bg-warning-500/10 text-warning-400'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        primary
          ? 'bg-primary-500 text-white hover:bg-primary-600'
          : 'bg-dark-800/70 text-dark-300 hover:bg-dark-700 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
