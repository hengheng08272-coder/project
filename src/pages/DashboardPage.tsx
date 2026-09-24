import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cloud,
  DownloadCloud,
  Film,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Music2,
  Plus,
  RefreshCw,
  Users,
  Wand2,
  XCircle,
} from 'lucide-react';

import { ActivityChart, type ActivityPoint } from '@/components/ActivityChart';
import { AppLogo, TelegramGlyph } from '@/components/Brand';
import { SupportedSourcesBadge } from '@/components/SupportedSources';
import { supabase } from '@/lib/supabase';
import { useConnectionStatus } from '@/lib/hooks';
import { backendConfigured, listR2Objects, resolvePageUrl, saveUrlItemsToR2 } from '@/lib/backend';
import { useLanguage } from '@/lib/i18n';
import { mediaKindOf, type MediaKind } from '@/lib/media';
import type { SettingsTab } from '@/pages/SettingsPage';
import type {
  Download,
  Episode,
  Group,
  PageKey,
  TelegramSettings,
  Topic,
  UrlList,
  UrlListItem,
} from '@/lib/types';
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

/** One shelf of the media library: how much of a kind exists, and how much of it is saved. */
interface Shelf {
  total: number;
  saved: number;
  bytes: number;
}

const EMPTY_SHELF: Shelf = { total: 0, saved: 0, bytes: 0 };

export function DashboardPage({
  onNavigate,
  onNavigateSettings,
}: {
  onNavigate: (page: PageKey) => void;
  onNavigateSettings: (tab: SettingsTab) => void;
}) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [recent, setRecent] = useState<(Download & { episode?: Episode })[]>([]);
  const [topGroups, setTopGroups] = useState<{ group: Group; count: number; bytes: number }[]>([]);
  const [account, setAccount] = useState<TelegramSettings | null>(null);
  const [shelves, setShelves] = useState<Record<MediaKind, Shelf>>({
    video: EMPTY_SHELF,
    audio: EMPTY_SHELF,
    image: EMPTY_SHELF,
  });
  const [linkStats, setLinkStats] = useState({ lists: 0, urls: 0, done: 0, bytes: 0 });
  const status = useConnectionStatus();

  const load = useCallback(async () => {
    const [dlRes, epRes, groupRes, topicRes, recentRes, tgRes, listRes, itemRes] = await Promise.all([
      supabase.from('downloads').select('id, status, completed_at'),
      supabase.from('episodes').select('id, group_id, status, file_size, r2_key, media_type, file_name, mime_type'),
      supabase.from('groups').select('*'),
      supabase.from('topics').select('id'),
      supabase
        .from('downloads')
        .select('*, episode:episodes(*)')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('telegram_settings').select('*').maybeSingle(),
      supabase.from('url_lists').select('id'),
      supabase.from('url_list_items').select('id, url, status, file_size, r2_key, quality_pref'),
    ]);

    const downloads = (dlRes.data as Pick<Download, 'id' | 'status' | 'completed_at'>[]) || [];
    const episodes = (epRes.data as Episode[]) || [];
    const groups = (groupRes.data as Group[]) || [];
    const lists = (listRes.data as UrlList[]) || [];
    const items = (itemRes.data as UrlListItem[]) || [];

    setStats({
      groups: groups.length,
      topics: ((topicRes.data as Topic[]) || []).length,
      episodes: episodes.length,
      downloaded: episodes.filter((e) => e.status === 'completed').length,
      queued: downloads.filter((d) => d.status === 'queued' || d.status === 'downloading').length,
      failed: downloads.filter((d) => d.status === 'failed').length,
      storage: episodes.filter((e) => e.r2_key).reduce((sum, e) => sum + (e.file_size || 0), 0),
    });

    setLinkStats({
      lists: lists.length,
      urls: items.length,
      done: items.filter((i) => i.status === 'completed').length,
      bytes: items.reduce((sum, i) => sum + (i.file_size || 0), 0),
    });

    setShelves(buildShelves(episodes, items));
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

  // Pictures never come from a Telegram scan (scanner.js skips photos), so the
  // Images shelf would always read zero off the database alone. The bucket is
  // where uploads actually land, so it is asked directly -- best effort, since
  // this needs both a backend and a connected R2 and must never break the page.
  useEffect(() => {
    if (!backendConfigured || !status.r2) return;
    let cancelled = false;
    listR2Objects('', 1000)
      .then(({ objects }) => {
        if (cancelled) return;
        const images = objects.filter((o) => mediaKindOf(o.key) === 'image');
        if (images.length === 0) return;
        setShelves((prev) => ({
          ...prev,
          image: {
            total: prev.image.total + images.length,
            saved: prev.image.saved + images.length,
            bytes: prev.image.bytes + images.reduce((sum, o) => sum + (o.size || 0), 0),
          },
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status.r2]);

  const accountName = [account?.account_first_name, account?.account_last_name]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero -- who you are signed in as, whether the three services are up,
          and the numbers that used to need a whole KPI row of their own. */}
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
                  {t('dash.hero.signedInAs')} <span className="text-primary-400">{accountName}</span>
                  {account.account_username && (
                    <span className="text-dark-500"> · @{account.account_username}</span>
                  )}
                </>
              ) : (
                t('dash.hero.connectPrompt')
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
            {t('dash.noBackend')}{' '}
            <button onClick={() => onNavigate('guide')} className="underline">
              {t('dash.noBackendLink')}
            </button>
          </p>
        )}

        {/* One compact strip instead of the old three big KPI tiles -- the
            headline counts now live on the media shelves below, so these are
            only the numbers that have nowhere else to be. */}
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <MiniStat icon={<Users className="h-3.5 w-3.5" />} value={stats?.groups} label={t('dash.stat.groups')} onClick={() => onNavigate('groups')} />
          <MiniStat icon={<Layers className="h-3.5 w-3.5" />} value={stats?.topics} label={t('dash.stat.topics')} onClick={() => onNavigate('groups')} />
          <MiniStat icon={<DownloadCloud className="h-3.5 w-3.5" />} value={stats?.queued} label={t('dash.stat.queue')} tone={stats?.queued ? 'primary' : undefined} onClick={() => onNavigate('downloads')} />
          <MiniStat icon={<XCircle className="h-3.5 w-3.5" />} value={stats?.failed} label={t('dash.stat.failed')} tone={stats?.failed ? 'error' : undefined} onClick={() => onNavigate('downloads')} />
          <MiniStat icon={<HardDrive className="h-3.5 w-3.5" />} value={stats ? formatBytes(stats.storage) : undefined} label={t('dash.stat.stored')} onClick={() => onNavigateSettings('r2')} />
        </div>

        <div className="relative mt-4 flex flex-wrap gap-2">
          <QuickAction icon={<Plus className="h-3.5 w-3.5" />} label={t('dash.hero.addGroup')} onClick={() => onNavigate('groups')} primary />
          <QuickAction icon={<DownloadCloud className="h-3.5 w-3.5" />} label={t('dash.hero.queue')} onClick={() => onNavigate('downloads')} />
          <QuickAction icon={<Link2 className="h-3.5 w-3.5" />} label={t('dash.hero.linkLists')} onClick={() => onNavigate('urllists')} />
        </div>
      </section>

      {/* Quick Download, 2-in-1: the downloader banner that used to sit at the
          top of the Link Lists page (supported sources, list counters) and the
          paste box are one card here, so there is a single place to paste a
          link instead of two that looked alike and behaved differently. */}
      <QuickDownloadCard stats={linkStats} onOpenLists={() => onNavigate('urllists')} />

      {/* Media library -- videos, music and pictures counted apart instead of
          one undifferentiated "videos found" number. */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{t('dash.library.title')}</h3>
          <p className="truncate text-[11px] text-dark-500">{t('dash.library.subtitle')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ShelfCard
            icon={<Film className="h-5 w-5" />}
            label={t('dash.kind.videos')}
            shelf={shelves.video}
            gradient="from-primary-500 to-primary-600"
            bar="bg-primary-500"
            savedLabel={t('dash.kind.saved')}
            emptyLabel={t('dash.kind.empty')}
            onClick={() => onNavigate('groups')}
          />
          <ShelfCard
            icon={<Music2 className="h-5 w-5" />}
            label={t('dash.kind.music')}
            shelf={shelves.audio}
            gradient="from-accent-500 to-accent-600"
            bar="bg-accent-500"
            savedLabel={t('dash.kind.saved')}
            emptyLabel={t('dash.kind.empty')}
            onClick={() => onNavigate('urllists')}
          />
          <ShelfCard
            icon={<ImageIcon className="h-5 w-5" />}
            label={t('dash.kind.images')}
            shelf={shelves.image}
            gradient="from-warning-500 to-warning-600"
            bar="bg-warning-500"
            savedLabel={t('dash.kind.saved')}
            emptyLabel={t('dash.kind.empty')}
            onClick={() => onNavigateSettings('r2')}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Activity */}
        <section className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">{t('dash.activity.title')}</h3>
              <p className="text-[11px] text-dark-500">{t('dash.activity.range').replace('{n}', String(ACTIVITY_DAYS))}</p>
            </div>
            <button
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg bg-dark-800 px-2.5 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" /> {t('dash.refresh')}
            </button>
          </div>
          <ActivityChart data={activity} label={`${ACTIVITY_DAYS} days`} />
        </section>

        {/* Storage + queue */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Layers className="h-4 w-4 text-accent-400" /> {t('dash.progress.title')}
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
              {stats ? t('dash.progress.uploaded').replace('{size}', formatBytes(stats.storage)) : ''}
            </p>
            {(stats?.queued ?? 0) > 0 && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-2.5 py-1.5 text-[11px] text-primary-300">
                <Activity className="h-3 w-3" /> {t('dash.progress.inQueue').replace('{n}', String(stats?.queued))}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-primary-400" /> {t('dash.groups.title')}
            </h3>
            {topGroups.length === 0 ? (
              <p className="py-4 text-center text-xs text-dark-600">{t('dash.groups.empty')}</p>
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
          <h3 className="text-sm font-semibold text-white">{t('dash.recent.title')}</h3>
          <button
            onClick={() => onNavigate('downloads')}
            className="flex items-center gap-1 text-[11px] text-dark-400 transition-colors hover:text-white"
          >
            {t('dash.recent.viewAll')} <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="py-10 text-center">
            <DownloadCloud className="mx-auto mb-3 h-10 w-10 text-dark-700" />
            <p className="text-sm text-dark-500">{t('dash.recent.empty')}</p>
            <p className="mt-1 text-xs text-dark-600">{t('dash.recent.emptyHint')}</p>
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
 * Link Lists page's "Find the video link" button uses); a direct file link
 * is used as typed either way. Lands in a "Quick Downloads" list, created
 * automatically the first time this is used, so it's still visible later
 * under Link Lists if someone wants to organize it properly.
 *
 * This is the only paste box in the app now: how to fetch (auto / yt-dlp /
 * direct) and what quality (including audio-only, for pulling a song out of
 * a video) used to be available solely on the Link Lists page's own copy of
 * this box, which is why they moved here with it.
 */
function QuickDownloadCard({
  stats,
  onOpenLists,
}: {
  stats: { lists: number; urls: number; done: number; bytes: number };
  onOpenLists: () => void;
}) {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [mode, setMode] = useState<'auto' | 'ytdlp' | 'direct'>('auto');
  const [quality, setQuality] = useState<'best' | '720p' | '1080p' | 'audio_only'>('best');

  const handleDownload = async (urlOverride?: string) => {
    const trimmed = (urlOverride ?? url).trim();
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
      const looksLikeDirectFile = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg|m3u8|jpg|jpeg|png|gif|webp)(\?|$)/i.test(trimmed);
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
        .insert({
          url_list_id: list.id,
          url: finalUrl,
          label: label || null,
          referer: referer || null,
          download_mode: mode,
          quality_pref: quality,
        })
        .select('id')
        .single();
      if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || 'Could not save that link.');

      if (backendConfigured) {
        setMessage('Saving to R2…');
        await saveUrlItemsToR2([(inserted.data as { id: string }).id]);
        setMessage('Started! Follow its progress under Link Lists → Quick Downloads.');
      } else {
        setMessage('Saved to Link Lists → Quick Downloads (no backend configured to fetch it yet).');
      }
      setUrl('');
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : 'Could not start the download.');
    }
    setBusy(false);
  };

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary-500/25 bg-gradient-to-br from-primary-500/10 via-dark-900/70 to-accent-500/10 p-5">
      <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-primary-500/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 shadow-lg shadow-primary-500/20">
            <Wand2 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">{t('dash.quick.title')}</h3>
            <p className="mb-2 text-[11px] text-dark-400">{t('dash.quick.subtitle')}</p>
            <SupportedSourcesBadge />
          </div>
        </div>
        <button
          onClick={onOpenLists}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dark-700 bg-dark-800/70 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
        >
          <Link2 className="h-3.5 w-3.5" /> {t('dash.quick.manageLists')}
        </button>
      </div>

      <div className="relative mt-4 flex flex-col gap-2 rounded-xl border border-dark-700 bg-dark-900/70 p-2 sm:flex-row sm:items-center">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDownload(); }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').trim();
            if (!pasted || /[\r\n]/.test(pasted) || !/^https?:\/\//i.test(pasted)) return;
            setUrl(pasted);
            setTimeout(() => handleDownload(pasted), 0);
          }}
          placeholder={t('dash.quick.placeholder')}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder-dark-500 outline-none disabled:opacity-60"
        />
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'auto' | 'ytdlp' | 'direct')}
            className="shrink-0 rounded-lg border border-dark-700 bg-dark-800 px-2 py-1.5 text-[11px] text-dark-200 outline-none focus:border-primary-500"
          >
            <option value="auto">{t('dash.mode.auto')}</option>
            <option value="ytdlp">{t('dash.mode.ytdlp')}</option>
            <option value="direct">{t('dash.mode.direct')}</option>
          </select>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as 'best' | '720p' | '1080p' | 'audio_only')}
            className="shrink-0 rounded-lg border border-dark-700 bg-dark-800 px-2 py-1.5 text-[11px] text-dark-200 outline-none focus:border-primary-500"
          >
            <option value="best">{t('dash.quality.best')}</option>
            <option value="1080p">{t('dash.quality.1080')}</option>
            <option value="720p">{t('dash.quality.720')}</option>
            <option value="audio_only">{t('dash.quality.audio')}</option>
          </select>
          <button
            onClick={() => handleDownload()}
            disabled={!url.trim() || busy}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
            {t('dash.quick.add')}
          </button>
        </div>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-[11px] ${isError ? 'text-error-400' : 'text-dark-400'}`}>
          {message || (
            <>
              {t('dash.quick.savedTo')} <span className="font-medium text-dark-300">Quick Downloads</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <TinyStat value={stats.lists} label={t('dash.quick.lists')} />
          <TinyStat value={stats.urls} label={t('dash.quick.urls')} />
          <TinyStat value={stats.done} label={t('dash.quick.done')} />
          <TinyStat value={formatBytes(stats.bytes)} label={t('dash.quick.saved')} />
        </div>
      </div>
    </section>
  );
}

/**
 * Splits everything collected into the three shelves the Dashboard shows.
 * Telegram episodes carry a real media_type from the scanner; a saved link
 * has only its URL to go on, plus quality_pref, which is an explicit "rip the
 * audio out of this" whatever the URL looks like.
 */
function buildShelves(episodes: Episode[], items: UrlListItem[]): Record<MediaKind, Shelf> {
  const shelves: Record<MediaKind, Shelf> = {
    video: { ...EMPTY_SHELF },
    audio: { ...EMPTY_SHELF },
    image: { ...EMPTY_SHELF },
  };

  for (const episode of episodes) {
    const kind: MediaKind = episode.media_type === 'audio' ? 'audio' : 'video';
    shelves[kind].total += 1;
    if (episode.r2_key) {
      shelves[kind].saved += 1;
      shelves[kind].bytes += episode.file_size || 0;
    }
  }

  for (const item of items) {
    const kind = item.quality_pref === 'audio_only' ? 'audio' : mediaKindOf(item.url);
    shelves[kind].total += 1;
    if (item.r2_key) {
      shelves[kind].saved += 1;
      shelves[kind].bytes += item.file_size || 0;
    }
  }

  return shelves;
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

function ShelfCard({
  icon,
  label,
  shelf,
  gradient,
  bar,
  savedLabel,
  emptyLabel,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shelf: Shelf;
  gradient: string;
  bar: string;
  savedLabel: string;
  emptyLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card-hover rounded-2xl border border-dark-800 bg-dark-900/60 p-4 text-left transition-colors hover:border-dark-700"
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg shadow-black/20`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-tight tabular-nums text-white">{shelf.total}</p>
          <p className="text-xs font-medium text-dark-300">{label}</p>
        </div>
      </div>
      {shelf.total === 0 ? (
        <p className="mt-3 text-[11px] text-dark-600">{emptyLabel}</p>
      ) : (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dark-800">
            <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${ratio(shelf.saved, shelf.total)}%` }} />
          </div>
          <p className="mt-1.5 text-[10px] tabular-nums text-dark-500">
            {shelf.saved} {savedLabel} · {formatBytes(shelf.bytes)}
          </p>
        </>
      )}
    </button>
  );
}

function TinyStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <span className="flex items-baseline gap-1 rounded-lg border border-dark-700/60 bg-dark-900/60 px-2 py-1">
      <span className="text-[11px] font-bold tabular-nums text-white">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-dark-500">{label}</span>
    </span>
  );
}

const MINI_TONES: Record<string, string> = {
  primary: 'text-primary-300 border-primary-500/25 bg-primary-500/10',
  error: 'text-error-300 border-error-500/25 bg-error-500/10',
};

function MiniStat({
  icon,
  value,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  value: number | string | undefined;
  label: string;
  tone?: keyof typeof MINI_TONES;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${
        tone ? MINI_TONES[tone] : 'border-dark-700/60 bg-dark-900/50 text-dark-300 hover:border-dark-600'
      }`}
    >
      <span className="opacity-70">{icon}</span>
      <span className="text-left">
        <span className="block text-sm font-bold leading-tight tabular-nums text-white">{value ?? '—'}</span>
        <span className="block text-[9px] uppercase tracking-wide text-dark-500">{label}</span>
      </span>
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
