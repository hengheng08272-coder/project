import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Users,
  Film,
  Music,
  RefreshCw,
  Trash2,
  Download,
  Search,
  CheckCircle2,
  Loader2,
  Layers,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  Send,
  MessagesSquare,
  Cloud,
  AlertTriangle,
  X,
  HardDrive,
  Copy as CopyIcon,
  ExternalLink,
  Link2,
  Info,
  Sparkles,
  Video,
  PlayCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { backendConfigured, callBackend, r2DownloadUrl, telegramStorageDownloadUrl } from '@/lib/backend';
import { useLanguage, type TranslationKey } from '@/lib/i18n';
import type { Episode, Group, Topic } from '@/lib/types';
import { formatBytes, formatTimeAgo, getStatusColor } from '@/lib/utils';
import { AddGroupModal, type NewGroupInput } from '@/components/AddGroupModal';
import { ForwardModal } from '@/components/ForwardModal';
import { MirrorModal } from '@/components/MirrorModal';

/** The synthetic topic id used for videos that sit outside any forum topic. */
const NO_TOPIC = '__none__';

/**
 * True for a "group" that isn't a real Telegram chat at all -- library.js
 * files every URL-list save and manual R2 upload under a synthetic group
 * (chat_id "manual:<show title>") so it shows up next to real Telegram
 * groups in Downloads/episode counts. Scan/Mirror/storage-backend all
 * assume a real Telegram chat behind chat_id, so they're hidden here rather
 * than left to fail confusingly against a chat_id that was never one.
 */
/**
 * A distinct, colorful gradient per group -- deterministic from the group's
 * own id, so the same group always lands on the same pair and a page full
 * of monogram avatars doesn't read as one flat color the way the old
 * primary/accent-only palette did.
 */
const AVATAR_GRADIENTS: [string, string][] = [
  ['#6366f1', '#8b5cf6'],
  ['#06b6d4', '#3b82f6'],
  ['#f43f5e', '#ec4899'],
  ['#f59e0b', '#f97316'],
  ['#10b981', '#14b8a6'],
  ['#8b5cf6', '#d946ef'],
  ['#0ea5e9', '#22d3ee'],
  ['#ef4444', '#f59e0b'],
];

function groupGradient(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function isManualGroup(group: Group): boolean {
  return group.chat_id.startsWith('manual:');
}

/** The quick filters over a topic's videos, beyond the search and EP range. */
type EpisodeFilter = 'all' | 'pending' | 'downloading' | 'completed' | 'failed' | 'in_r2' | 'not_in_r2';

const EPISODE_FILTER_KEYS: { key: EpisodeFilter; labelKey: TranslationKey }[] = [
  { key: 'all', labelKey: 'groups.filter.all' },
  { key: 'pending', labelKey: 'groups.filter.pending' },
  { key: 'downloading', labelKey: 'groups.filter.downloading' },
  { key: 'completed', labelKey: 'groups.filter.completed' },
  { key: 'failed', labelKey: 'groups.filter.failed' },
  { key: 'in_r2', labelKey: 'groups.filter.inR2' },
  { key: 'not_in_r2', labelKey: 'groups.filter.notInR2' },
];

function matchesFilter(ep: Episode, filter: EpisodeFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'pending': return ep.status === 'pending' || ep.status === 'queued';
    case 'downloading': return ep.status === 'downloading';
    case 'completed': return ep.status === 'completed';
    case 'failed': return ep.status === 'failed';
    case 'in_r2': return Boolean(ep.r2_key || ep.tg_storage_chat_id);
    case 'not_in_r2': return !ep.r2_key && !ep.tg_storage_chat_id;
  }
}

interface ForwardRequest {
  group: Group;
  topic: Topic | null;
  episodes: Episode[];
  mode: 'selected' | 'topic';
}

export function GroupsPage() {
  const { t } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [r2Connected, setR2Connected] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [forwardRequest, setForwardRequest] = useState<ForwardRequest | null>(null);
  const [mirroring, setMirroring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EpisodeFilter>('all');
  const [epFrom, setEpFrom] = useState('');
  const [epTo, setEpTo] = useState('');
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set());
  // Where the last tick landed, so Shift+click knows what range to fill.
  const lastToggledId = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    const [gRes, tRes, eRes, r2Res] = await Promise.all([
      supabase.from('groups').select('*').order('created_at', { ascending: false }),
      supabase.from('topics').select('*').order('title', { ascending: true }),
      supabase.from('episodes').select('*').order('ep_number', { ascending: true }),
      supabase.from('r2_settings').select('connected').maybeSingle(),
    ]);
    setGroups((gRes.data as Group[]) || []);
    setTopics((tRes.data as Topic[]) || []);
    setEpisodes((eRes.data as Episode[]) || []);
    setR2Connected(Boolean((r2Res.data as { connected?: boolean } | null)?.connected));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;
  const selectedTopic = selectedTopicId && selectedTopicId !== NO_TOPIC
    ? topics.find((t) => t.id === selectedTopicId) || null
    : null;

  const groupTopics = useMemo(
    () => topics.filter((t) => t.group_id === selectedGroupId),
    [topics, selectedGroupId]
  );

  const episodesOf = useCallback(
    (groupId: string, topicId: string | null) =>
      episodes.filter((e) => {
        if (e.group_id !== groupId) return false;
        if (topicId === null) return true;
        if (topicId === NO_TOPIC) return e.topic_id === null;
        return e.topic_id === topicId;
      }),
    [episodes]
  );

  const topicEpisodes = useMemo(
    () => (selectedGroupId ? episodesOf(selectedGroupId, selectedTopicId) : []),
    [episodesOf, selectedGroupId, selectedTopicId]
  );

  const filteredEpisodes = useMemo(() => {
    const from = epFrom.trim() ? Number(epFrom) : null;
    const to = epTo.trim() ? Number(epTo) : null;
    const q = search.trim().toLowerCase();
    return topicEpisodes.filter((ep) => {
      if (!matchesFilter(ep, statusFilter)) return false;
      if (from !== null && (ep.ep_number === null || ep.ep_number < from)) return false;
      if (to !== null && (ep.ep_number === null || ep.ep_number > to)) return false;
      if (!q) return true;
      return (
        ep.title?.toLowerCase().includes(q) ||
        ep.file_name?.toLowerCase().includes(q) ||
        String(ep.ep_number ?? '').includes(q)
      );
    });
  }, [topicEpisodes, search, statusFilter, epFrom, epTo]);

  const resetEpisodeFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setEpFrom('');
    setEpTo('');
    setSelectedEpisodes(new Set());
    lastToggledId.current = null;
  };

  const openGroup = (id: string) => {
    setSelectedGroupId(id);
    setSelectedTopicId(null);
    resetEpisodeFilters();
    setError('');
  };

  const openTopic = (topicId: string) => {
    setSelectedTopicId(topicId);
    resetEpisodeFilters();
  };

  const backToGroups = () => {
    setSelectedGroupId(null);
    setSelectedTopicId(null);
    resetEpisodeFilters();
  };

  const handleScan = async (groupId: string) => {
    setScanning(true);
    setError('');
    try {
      await callBackend(`/api/telegram/groups/${groupId}/scan`);
      setToast(t('groups.scanFinished'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('groups.scanFailed'));
    }
    setScanning(false);
    loadData();
  };

  const handleAddGroup = async (data: NewGroupInput) => {
    const { data: newGroup, error: insertError } = await supabase.from('groups').insert(data).select().single();
    if (insertError || !newGroup) {
      setError(insertError?.message || t('groups.errAddGroup'));
      return;
    }
    setShowAddModal(false);
    const groupId = (newGroup as Group).id;
    openGroup(groupId);
    await loadData();
    if (!backendConfigured) return;
    // Scan straight away so topics/videos show up without an extra manual step.
    try {
      setScanning(true);
      await callBackend(`/api/telegram/groups/${groupId}/scan`);
    } catch {
      // Group was still added successfully; the user can hit Scan manually.
    } finally {
      setScanning(false);
      loadData();
    }
  };

  const handleDeleteGroup = async (id: string, title: string) => {
    const confirmed = window.confirm(t('groups.confirmDelete').replace('{title}', title));
    if (!confirmed) return;
    await supabase.from('groups').delete().eq('id', id);
    if (selectedGroupId === id) backToGroups();
    loadData();
  };

  /** Switches where future downloads of this group get archived -- R2, or a Telegram storage channel. */
  const handleSetStorageBackend = async (id: string, backend: 'r2' | 'telegram') => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, storage_backend: backend } : g)));
    await supabase.from('groups').update({ storage_backend: backend }).eq('id', id);
  };

  /** Toggles the worker's periodic re-scan of this group, so new episodes show up without a manual "Scan" click. */
  const handleToggleAutoRescan = async (id: string, next: boolean) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, auto_rescan: next } : g)));
    await supabase.from('groups').update({ auto_rescan: next }).eq('id', id);
  };

  const queueDownloads = async (eps: Episode[]) => {
    const pending = eps.filter((e) => e.status !== 'completed' && e.status !== 'downloading');
    if (pending.length === 0) {
      setToast(t('groups.alreadyDownloaded'));
      return;
    }
    const { error: dlError } = await supabase.from('downloads').insert(
      pending.map((ep) => ({ episode_id: ep.id, status: 'queued', total_bytes: ep.file_size }))
    );
    if (dlError) {
      setError(dlError.message);
      return;
    }
    await supabase.from('episodes').update({ status: 'queued' }).in('id', pending.map((e) => e.id));
    setSelectedEpisodes(new Set());
    setToast((pending.length === 1 ? t('groups.queuedOne') : t('groups.queuedMany')).replace('{n}', String(pending.length)));
    loadData();
  };

  /**
   * Ticks one video, or -- with Shift held -- everything between it and the
   * last one ticked. Picking "EP012 to EP180" out of a long topic is the
   * common case, and one click per episode is not a way to spend an evening.
   */
  const toggleEpisode = (id: string, shiftKey = false) => {
    const next = new Set(selectedEpisodes);
    const anchor = lastToggledId.current;

    if (shiftKey && anchor && anchor !== id) {
      const from = filteredEpisodes.findIndex((e) => e.id === anchor);
      const to = filteredEpisodes.findIndex((e) => e.id === id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        // The anchor's own state decides the whole run, the way a file list does.
        const selecting = next.has(anchor);
        for (const ep of filteredEpisodes.slice(start, end + 1)) {
          if (selecting) next.add(ep.id);
          else next.delete(ep.id);
        }
        setSelectedEpisodes(next);
        lastToggledId.current = id;
        return;
      }
    }

    if (next.has(id)) next.delete(id);
    else next.add(id);
    lastToggledId.current = id;
    setSelectedEpisodes(next);
  };

  /** Adds every video the current filters show that is not yet downloaded. */
  const selectMatching = (predicate: (ep: Episode) => boolean) => {
    setSelectedEpisodes(new Set(filteredEpisodes.filter(predicate).map((e) => e.id)));
    lastToggledId.current = null;
  };

  const allVisibleSelected = filteredEpisodes.length > 0 && filteredEpisodes.every((e) => selectedEpisodes.has(e.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) setSelectedEpisodes(new Set());
    else setSelectedEpisodes(new Set(filteredEpisodes.map((e) => e.id)));
    lastToggledId.current = null;
  };

  const selectedEpisodeObjects = topicEpisodes.filter((e) => selectedEpisodes.has(e.id));

  return (
    <div className="space-y-4 animate-fade-in">
      <Breadcrumb
        group={selectedGroup}
        topicLabel={
          selectedTopicId === NO_TOPIC ? t('groups.videosWithoutTopic') : selectedTopic?.title ?? null
        }
        onHome={backToGroups}
        onGroup={() => { setSelectedTopicId(null); resetEpisodeFilters(); }}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-error-400/70 hover:text-error-300"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary-500 animate-spin" /></div>
      ) : !selectedGroup ? (
        <GroupGrid
          groups={groups}
          topics={topics}
          episodes={episodes}
          onOpen={openGroup}
          onDelete={handleDeleteGroup}
          onAdd={() => setShowAddModal(true)}
        />
      ) : selectedTopicId === null ? (
        <GroupDetail
          group={selectedGroup}
          topics={groupTopics}
          episodesOf={episodesOf}
          scanning={scanning}
          onScan={() => handleScan(selectedGroup.id)}
          onBack={backToGroups}
          onOpenTopic={openTopic}
          onMirror={() => setMirroring(true)}
          onSetStorageBackend={(backend) => handleSetStorageBackend(selectedGroup.id, backend)}
          onToggleAutoRescan={() => handleToggleAutoRescan(selectedGroup.id, !selectedGroup.auto_rescan)}
          onDownloadTopic={(eps) => queueDownloads(eps)}
          onForwardTopic={(topic, eps) =>
            setForwardRequest({ group: selectedGroup, topic, episodes: eps, mode: 'topic' })
          }
        />
      ) : (
        <EpisodeBrowser
          group={selectedGroup}
          topic={selectedTopic}
          isNoTopicBucket={selectedTopicId === NO_TOPIC}
          episodes={filteredEpisodes}
          totalInTopic={topicEpisodes.length}
          selected={selectedEpisodes}
          onToggle={toggleEpisode}
          allVisibleSelected={allVisibleSelected}
          onToggleAll={toggleSelectAllVisible}
          onSelectNotDownloaded={() => selectMatching((e) => e.status !== 'completed' && e.status !== 'downloading')}
          onSelectNotInR2={() => selectMatching((e) => !e.r2_key && !e.tg_storage_chat_id)}
          onClearSelection={() => { setSelectedEpisodes(new Set()); lastToggledId.current = null; }}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          search={search}
          onSearch={setSearch}
          epFrom={epFrom}
          epTo={epTo}
          onEpFrom={setEpFrom}
          onEpTo={setEpTo}
          scanning={scanning}
          r2Connected={r2Connected}
          onScan={() => handleScan(selectedGroup.id)}
          onBack={() => { setSelectedTopicId(null); resetEpisodeFilters(); }}
          onQueue={() => queueDownloads(selectedEpisodeObjects)}
          onForward={() =>
            setForwardRequest({
              group: selectedGroup,
              topic: selectedTopic,
              episodes: selectedEpisodeObjects,
              mode: 'selected',
            })
          }
        />
      )}

      {showAddModal && <AddGroupModal onClose={() => setShowAddModal(false)} onAdd={handleAddGroup} />}
      {mirroring && selectedGroup && (
        <MirrorModal
          group={selectedGroup}
          topics={groupTopics}
          episodes={episodesOf(selectedGroup.id, null)}
          onClose={() => setMirroring(false)}
          onDone={(message) => {
            setMirroring(false);
            setToast(message);
            loadData();
          }}
        />
      )}
      {forwardRequest && (
        <ForwardModal
          group={forwardRequest.group}
          topic={forwardRequest.topic}
          episodes={forwardRequest.episodes}
          mode={forwardRequest.mode}
          onClose={() => setForwardRequest(null)}
          onDone={(message) => {
            setForwardRequest(null);
            setSelectedEpisodes(new Set());
            setToast(message);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-2 rounded-xl border border-primary-500/30 bg-dark-900 px-4 py-3 text-sm text-white shadow-2xl shadow-black/50 animate-slide-up">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-400" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast('')} className="text-dark-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function Breadcrumb({ group, topicLabel, onHome, onGroup }: {
  group: Group | null;
  topicLabel: string | null;
  onHome: () => void;
  onGroup: () => void;
}) {
  const { t } = useLanguage();
  return (
    <nav className="flex items-center gap-1.5 text-xs text-dark-500 flex-wrap">
      <button onClick={onHome} className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${group ? 'hover:bg-dark-800 hover:text-white' : 'text-white font-medium'}`}>
        <Users className="w-3.5 h-3.5" /> {t('groups.breadcrumbGroups')}
      </button>
      {group && (
        <>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <button onClick={onGroup} className={`px-2 py-1 rounded-md transition-colors truncate max-w-[220px] ${topicLabel ? 'hover:bg-dark-800 hover:text-white' : 'text-white font-medium'}`}>
            {group.title}
          </button>
        </>
      )}
      {group && topicLabel && (
        <>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <span className="px-2 py-1 text-accent-400 font-medium truncate max-w-[260px]">{topicLabel}</span>
        </>
      )}
    </nav>
  );
}

/**
 * The R2 badge on an episode card: copy/open the public URL when there is
 * one, and always a real Download link -- streamed through the backend with
 * Content-Disposition: attachment, so it saves to the device even when the
 * bucket has no public URL configured at all.
 */
function EpisodeUrlBadge({ url, downloadUrl }: { url: string | null; downloadUrl: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1">
      {url && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title={t('groups.copyUrl')}
            className="flex items-center gap-1 rounded-full bg-success-500/10 px-1.5 py-0.5 font-medium text-success-400 transition-colors hover:bg-success-500/20"
          >
            {copied ? <Check className="h-2.5 w-2.5" /> : <Cloud className="h-2.5 w-2.5" />}
            {copied ? t('groups.copied') : t('groups.copyUrl')}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={t('groups.open')}
            className="rounded-full bg-dark-800 px-1.5 py-0.5 text-dark-400 transition-colors hover:text-white"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          onClick={(e) => e.stopPropagation()}
          title={t('groups.downloadToDevice')}
          className="flex items-center gap-1 rounded-full bg-dark-800 px-1.5 py-0.5 text-dark-400 transition-colors hover:text-white"
        >
          <Download className="h-2.5 w-2.5" /> {t('groups.save')}
        </a>
      )}
    </span>
  );
}

function CopyableId({ value }: { value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={t('groups.copyGroupId')}
      className="inline-flex items-center gap-1.5 rounded-md bg-dark-800/80 px-2 py-1 font-mono text-[10px] text-dark-400 transition-colors hover:bg-dark-700 hover:text-white"
    >
      {value}
      {copied ? <Check className="h-3 w-3 text-success-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min((done / total) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-dark-800">
      <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function GroupGrid({ groups, topics, episodes, onOpen, onDelete, onAdd }: {
  groups: Group[];
  topics: Topic[];
  episodes: Episode[];
  onOpen: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onAdd: () => void;
}) {
  const { t } = useLanguage();
  const telegramGroups = groups.filter((g) => !isManualGroup(g));
  const manualGroups = groups.filter(isManualGroup);
  const totalVideos = episodes.length;
  const totalDone = episodes.filter((e) => e.status === 'completed').length;
  const totalSize = episodes.reduce((sum, e) => sum + (e.file_size || 0), 0);

  return (
    <div className="animate-slide-up space-y-6">
      {/* Hero -- a quick-glance summary strip, replacing what used to be a
          plain heading straight into the group grid. */}
      <div className="relative overflow-hidden rounded-2xl border border-dark-800 bg-gradient-to-br from-primary-500/15 via-dark-900/60 to-accent-500/10 p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-1/3 h-32 w-32 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 shadow-lg shadow-primary-500/20">
            <Send className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-base font-bold text-white">
              {t('groups.pageTitle')} <Sparkles className="h-3.5 w-3.5 text-accent-400" />
            </h1>
            <p className="text-xs text-dark-400">{t('groups.pageSubtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeroStat icon={<Users className="h-3.5 w-3.5" />} value={groups.length} label={t('groups.heroGroups')} color="from-primary-500 to-primary-600" />
            <HeroStat icon={<Video className="h-3.5 w-3.5" />} value={totalVideos} label={t('groups.heroVideos')} color="from-accent-500 to-accent-600" />
            <HeroStat icon={<CheckCircle2 className="h-3.5 w-3.5" />} value={totalDone} label={t('groups.heroDownloaded')} color="from-success-500 to-success-600" />
            <HeroStat icon={<HardDrive className="h-3.5 w-3.5" />} value={formatBytes(totalSize)} label={t('groups.heroStorage')} color="from-warning-500 to-warning-600" />
          </div>
        </div>
      </div>

      {/* Telegram groups */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Send className="h-4 w-4 text-primary-400" /> {t('groups.sourceTelegram')}
            <span className="text-xs font-normal text-dark-500">{telegramGroups.length}</span>
          </h2>
          <button
            onClick={onAdd}
            className="flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
          >
            <Plus className="h-4 w-4" /> {t('groups.addGroup')}
          </button>
        </div>

        {telegramGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 p-12 text-center">
            <Send className="mx-auto mb-4 h-12 w-12 text-dark-700" />
            <p className="text-sm text-dark-400">{t('groups.noGroupsYet')}</p>
            <p className="mb-4 mt-1 text-xs text-dark-600">{t('groups.addGroupHint')}</p>
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              <Plus className="h-4 w-4" /> {t('groups.addFirstGroup')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {telegramGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                episodes={episodes.filter((e) => e.group_id === group.id)}
                topicCount={topics.filter((t) => t.group_id === group.id).length}
                onOpen={() => onOpen(group.id)}
                onDelete={() => onDelete(group.id, group.title)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Manual / URL-sourced groups -- kept visually and physically apart from
          real Telegram groups above, since they share nothing but the same
          underlying table (see isManualGroup's comment). */}
      {manualGroups.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Link2 className="h-4 w-4 text-accent-400" /> {t('groups.sourceManual')}
              <span className="text-xs font-normal text-dark-500">{manualGroups.length}</span>
            </h2>
          </div>
          <p className="mb-3 text-xs text-dark-500">{t('groups.sourceManualHint')}</p>
          <div className="divide-y divide-dark-800 rounded-xl border border-dark-800 bg-dark-900/60">
            {manualGroups.map((group) => (
              <ManualGroupRow
                key={group.id}
                group={group}
                episodes={episodes.filter((e) => e.group_id === group.id)}
                onOpen={() => onOpen(group.id)}
                onDelete={() => onDelete(group.id, group.title)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HeroStat({ icon, value, label, color }: { icon: React.ReactNode; value: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dark-700/60 bg-dark-900/50 px-3 py-2">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-white tabular-nums">{value}</p>
        <p className="text-[9px] uppercase tracking-wide text-dark-500">{label}</p>
      </div>
    </div>
  );
}

function GroupCard({ group, episodes, topicCount, onOpen, onDelete }: {
  group: Group;
  episodes: Episode[];
  topicCount: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const manual = isManualGroup(group);
  const done = episodes.filter((e) => e.status === 'completed').length;
  const size = episodes.reduce((sum, e) => sum + (e.file_size || 0), 0);
  const [from, to] = groupGradient(group.id);

  return (
    <button
      onClick={onOpen}
      style={{ '--glow': to } as React.CSSProperties}
      className="group card-hover relative overflow-hidden rounded-2xl border border-dark-800 bg-dark-900/60 p-4 text-left transition-all hover:border-dark-600 hover:shadow-[0_0_28px_-8px_var(--glow)]"
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${from}, ${to})` }}
      />
      <div className="mb-3 flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          {manual ? (
            <Link2 className="h-5 w-5" />
          ) : (
            <span className="text-base font-bold">{group.title.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{group.title}</p>
            {group.is_forum && (
              <span className="shrink-0 rounded bg-accent-500/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-400">FORUM</span>
            )}
          </div>
          <p className="truncate text-xs text-dark-500">
            {manual ? t('groups.manualBadge') : group.username ? '@' + group.username : t('groups.privateGroup')}
          </p>
        </div>
        <span
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('groups.removeGroup')}
          className="rounded p-1 text-dark-600 transition-colors hover:bg-error-500/20 hover:text-error-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </span>
      </div>

      {!manual && <div className="mb-3"><CopyableId value={group.chat_id} /></div>}

      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <Stat icon={<MessagesSquare className="h-3 w-3" />} label={t('groups.statTopics')} value={group.is_forum ? topicCount : '—'} />
        <Stat icon={<Film className="h-3 w-3" />} label={t('groups.statVideos')} value={episodes.length} />
        <Stat icon={<HardDrive className="h-3 w-3" />} label={t('groups.statSize')} value={formatBytes(size)} />
      </div>

      <ProgressBar done={done} total={episodes.length} />
      <div className="mt-2 flex items-center justify-between text-[10px] text-dark-500">
        <span>{t('groups.downloadedOfTotal').replace('{done}', String(done)).replace('{total}', String(episodes.length))}</span>
        <span className="flex items-center gap-1">
          {manual ? t('groups.added').replace('{time}', formatTimeAgo(group.created_at)) : t('groups.lastScan').replace('{time}', formatTimeAgo(group.last_scanned_at))}
          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-dark-800/40 px-2 py-1.5">
      <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wide text-dark-500">{icon}{label}</div>
      <p className="mt-0.5 truncate text-xs font-semibold text-white tabular-nums">{value}</p>
    </div>
  );
}

/**
 * A plain list row for a manual/URL-list "group" -- the colorful card grid
 * used for real Telegram groups was too heavy for a list that's often a
 * dozen-plus one-off URL lists; a row reads faster than a wall of cards.
 */
function ManualGroupRow({ group, episodes, onOpen, onDelete }: {
  group: Group;
  episodes: Episode[];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const done = episodes.filter((e) => e.status === 'completed').length;
  const size = episodes.reduce((sum, e) => sum + (e.file_size || 0), 0);

  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-dark-800/50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
        <Link2 className="h-4 w-4 text-accent-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{group.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-dark-500">
          <span>{(episodes.length === 1 ? t('groups.videoInTopicOne') : t('groups.videoInTopicMany')).replace('{n}', String(episodes.length))}</span>
          <span>{formatBytes(size)}</span>
          <span>{t('groups.downloadedOfTotal').replace('{done}', String(done)).replace('{total}', String(episodes.length))}</span>
          <span>{t('groups.added').replace('{time}', formatTimeAgo(group.created_at))}</span>
        </div>
      </div>
      <div className="hidden w-28 shrink-0 sm:block"><ProgressBar done={done} total={episodes.length} /></div>
      <span
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title={t('groups.removeGroup')}
        className="shrink-0 rounded p-1.5 text-dark-600 transition-colors hover:bg-error-500/20 hover:text-error-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-dark-600 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
    </button>
  );
}

function GroupDetail({ group, topics, episodesOf, scanning, onScan, onBack, onOpenTopic, onMirror, onSetStorageBackend, onToggleAutoRescan, onDownloadTopic, onForwardTopic }: {
  group: Group;
  topics: Topic[];
  episodesOf: (groupId: string, topicId: string | null) => Episode[];
  scanning: boolean;
  onScan: () => void;
  onBack: () => void;
  onOpenTopic: (topicId: string) => void;
  onMirror: () => void;
  onSetStorageBackend: (backend: 'r2' | 'telegram') => void;
  onToggleAutoRescan: () => void;
  onDownloadTopic: (episodes: Episode[]) => void;
  onForwardTopic: (topic: Topic | null, episodes: Episode[]) => void;
}) {
  const { t } = useLanguage();
  const manual = isManualGroup(group);
  const allEpisodes = episodesOf(group.id, null);
  const untopicked = episodesOf(group.id, NO_TOPIC);
  const totalSize = allEpisodes.reduce((sum, e) => sum + (e.file_size || 0), 0);
  const done = allEpisodes.filter((e) => e.status === 'completed').length;

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Group header */}
      <div className="relative overflow-hidden rounded-2xl border border-dark-800 bg-gradient-to-br from-dark-900 via-dark-900 to-primary-950/30 p-5">
        <div className="absolute right-0 top-0 h-56 w-56 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary-500/10 blur-3xl" />
        <div className="relative">
          <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-dark-400 transition-colors hover:bg-dark-800 hover:text-white">
            <ChevronLeft className="h-3.5 w-3.5" /> {t('groups.allGroups')}
          </button>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500/30 to-accent-500/30 glow">
              <span className="text-xl font-bold text-white">{group.title.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-bold text-white">{group.title}</h2>
                {group.is_forum && (
                  <span className="rounded bg-accent-500/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-400">{t('groups.forum')}</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <CopyableId value={group.chat_id} />
                {group.username && <span className="text-xs text-accent-400">@{group.username}</span>}
                <span className="text-[10px] text-dark-500">{t('groups.lastScan').replace('{time}', formatTimeAgo(group.last_scanned_at))}</span>
              </div>
            </div>
            {manual ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-accent-500/10 px-3 py-2 text-xs font-medium text-accent-300">
                <Link2 className="h-3.5 w-3.5" /> {t('groups.manualBadge')}
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onScan}
                  disabled={scanning}
                  className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
                >
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t('groups.scanGroup')}
                </button>
                <button
                  onClick={onMirror}
                  disabled={allEpisodes.length === 0}
                  title={t('groups.mirrorTitle')}
                  className="flex items-center gap-2 rounded-lg bg-dark-800 px-4 py-2 text-sm font-medium text-dark-300 transition-colors hover:bg-accent-500 hover:text-white disabled:opacity-40"
                >
                  <CopyIcon className="h-4 w-4" /> {t('groups.mirrorToNewGroup')}
                </button>
                <div className="flex items-center rounded-lg border border-dark-700 bg-dark-800 p-0.5" title={t('groups.storageBackendTitle')}>
                  <button
                    onClick={() => onSetStorageBackend('r2')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      (group.storage_backend ?? 'r2') === 'r2' ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'
                    }`}
                  >
                    <Cloud className="h-3.5 w-3.5" /> R2
                  </button>
                  <button
                    onClick={() => onSetStorageBackend('telegram')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      group.storage_backend === 'telegram' ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'
                    }`}
                  >
                    <Send className="h-3.5 w-3.5" /> Telegram
                  </button>
                </div>
                <button
                  onClick={onToggleAutoRescan}
                  title={t('groups.autoRescanTitle')}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    group.auto_rescan
                      ? 'bg-success-500/15 text-success-400 hover:bg-success-500/25'
                      : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
                  }`}
                >
                  <RefreshCw className="h-4 w-4" />
                  {group.auto_rescan ? t('groups.autoRescanOn') : t('groups.autoRescanOff')}
                </button>
              </div>
            )}
          </div>
          {manual && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-dark-500">
              <Info className="h-3.5 w-3.5 shrink-0" /> {t('groups.manualDetailHint')}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<MessagesSquare className="h-3 w-3" />} label={t('groups.statTopics')} value={group.is_forum ? topics.length : '—'} />
            <Stat icon={<Film className="h-3 w-3" />} label={t('groups.statVideos')} value={allEpisodes.length} />
            <Stat icon={<Download className="h-3 w-3" />} label={t('groups.statDownloaded')} value={`${done}/${allEpisodes.length}`} />
            <Stat icon={<HardDrive className="h-3 w-3" />} label={t('groups.statTotalSize')} value={formatBytes(totalSize)} />
          </div>
        </div>
      </div>

      {/* Topic list */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Layers className="h-4 w-4 text-accent-400" /> {t('groups.topicsInGroup')}
          <span className="text-xs font-normal text-dark-500">{topics.length}</span>
        </h3>

        {topics.length === 0 && untopicked.length === 0 ? (
          <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 p-10 text-center">
            <MessagesSquare className="mx-auto mb-3 h-10 w-10 text-dark-700" />
            <p className="text-sm text-dark-400">
              {group.is_forum ? t('groups.noTopicsYet') : t('groups.notAForum')}
            </p>
            <p className="mt-1 text-xs text-dark-600">{t('groups.runScanHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topics.map((topic) => {
              const eps = episodesOf(group.id, topic.id);
              return (
                <TopicCard
                  key={topic.id}
                  title={topic.title}
                  episodes={eps}
                  canForward={!manual}
                  onOpen={() => onOpenTopic(topic.id)}
                  onDownload={() => onDownloadTopic(eps)}
                  onForward={() => onForwardTopic(topic, eps)}
                />
              );
            })}
            {untopicked.length > 0 && (
              <TopicCard
                title={t('groups.videosWithoutTopic')}
                episodes={untopicked}
                muted
                canForward={!manual}
                onOpen={() => onOpenTopic(NO_TOPIC)}
                onDownload={() => onDownloadTopic(untopicked)}
                onForward={() => onForwardTopic(null, untopicked)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TopicCard({ title, episodes, muted, canForward = true, onOpen, onDownload, onForward }: {
  title: string;
  episodes: Episode[];
  muted?: boolean;
  canForward?: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onForward: () => void;
}) {
  const { t } = useLanguage();
  const done = episodes.filter((e) => e.status === 'completed').length;
  const inR2 = episodes.filter((e) => e.r2_key || e.tg_storage_chat_id).length;
  const size = episodes.reduce((sum, e) => sum + (e.file_size || 0), 0);

  return (
    <div className="card-hover rounded-2xl border border-dark-800 bg-dark-900/60 p-4 transition-all hover:border-accent-500/40">
      <button onClick={onOpen} className="group w-full text-left">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${muted ? 'bg-dark-800' : 'bg-accent-500/15'}`}>
            <MessagesSquare className={`h-4 w-4 ${muted ? 'text-dark-500' : 'text-accent-400'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-[11px] text-dark-500">
              <span className="font-semibold text-primary-400">
                {(episodes.length === 1 ? t('groups.videoCountOne') : t('groups.videoCountMany')).replace('{n}', String(episodes.length))}
              </span> · {formatBytes(size)}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-dark-600 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
        </div>

        <div className="mt-3"><ProgressBar done={done} total={episodes.length} /></div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-dark-500">
          <span>{t('groups.downloadedOfTotal').replace('{done}', String(done)).replace('{total}', String(episodes.length))}</span>
          {inR2 > 0 && (
            <span className="flex items-center gap-1 text-success-400"><Cloud className="h-3 w-3" /> {t('groups.inR2Count').replace('{n}', String(inR2))}</span>
          )}
        </div>
      </button>

      <div className="mt-3 flex items-center gap-2 border-t border-dark-800 pt-3">
        <button
          onClick={onDownload}
          disabled={episodes.length === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-dark-800 px-2 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-primary-500 hover:text-white disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> {t('groups.downloadAll')}
        </button>
        {canForward && (
          <button
            onClick={onForward}
            disabled={episodes.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-dark-800 px-2 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-accent-500 hover:text-white disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" /> {t('groups.forwardAll')}
          </button>
        )}
      </div>
    </div>
  );
}

interface EpisodeBrowserProps {
  group: Group;
  topic: Topic | null;
  isNoTopicBucket: boolean;
  episodes: Episode[];
  totalInTopic: number;
  selected: Set<string>;
  onToggle: (id: string, shiftKey?: boolean) => void;
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  onSelectNotDownloaded: () => void;
  onSelectNotInR2: () => void;
  onClearSelection: () => void;
  statusFilter: EpisodeFilter;
  onStatusFilter: (v: EpisodeFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  epFrom: string;
  epTo: string;
  onEpFrom: (v: string) => void;
  onEpTo: (v: string) => void;
  scanning: boolean;
  r2Connected: boolean;
  onScan: () => void;
  onBack: () => void;
  onQueue: () => void;
  onForward: () => void;
}

function EpisodeBrowser({
  group, topic, isNoTopicBucket, episodes, totalInTopic, selected, onToggle,
  allVisibleSelected, onToggleAll, onSelectNotDownloaded, onSelectNotInR2, onClearSelection,
  statusFilter, onStatusFilter, search, onSearch, epFrom, epTo, onEpFrom, onEpTo,
  scanning, r2Connected, onScan, onBack, onQueue, onForward,
}: EpisodeBrowserProps) {
  const { t } = useLanguage();
  const title = isNoTopicBucket ? t('groups.videosWithoutTopic') : topic?.title ?? group.title;
  const selectedSize = episodes.filter((e) => selected.has(e.id)).reduce((sum, e) => sum + (e.file_size || 0), 0);
  const [copiedAll, setCopiedAll] = useState(false);
  const [previewItem, setPreviewItem] = useState<Episode | null>(null);

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Topic header */}
      <div className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
        <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-dark-400 transition-colors hover:bg-dark-800 hover:text-white">
          <ChevronLeft className="h-3.5 w-3.5" /> {group.title}
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-500/15">
            <MessagesSquare className="h-5 w-5 text-accent-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">{title}</h2>
            <p className="text-xs text-dark-500">
              <span className="font-semibold text-primary-400">
                {(totalInTopic === 1 ? t('groups.videoInTopicOne') : t('groups.videoInTopicMany')).replace('{n}', String(totalInTopic))}
              </span>
              {r2Connected ? (
                <span className="ml-2 inline-flex items-center gap-1 text-success-400"><Cloud className="h-3 w-3" /> {t('groups.r2Connected')}</span>
              ) : (
                <span className="ml-2 text-dark-600">{t('groups.r2NotConnected')}</span>
              )}
            </p>
          </div>
          {!isManualGroup(group) && (
            <button
              onClick={onScan}
              disabled={scanning}
              className="flex items-center gap-2 rounded-lg bg-dark-800 px-3 py-2 text-xs font-medium text-dark-300 transition-colors hover:bg-dark-700 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t('groups.rescan')}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dark-800 bg-dark-900/60 p-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-dark-700/50 bg-dark-800/50 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-dark-500" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('groups.searchVideos')}
            className="w-40 bg-transparent text-xs text-white placeholder-dark-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-dark-700/50 bg-dark-800/50 px-2.5 py-1.5">
          <span className="text-[10px] font-medium text-dark-500">EP</span>
          <input
            value={epFrom}
            onChange={(e) => onEpFrom(e.target.value.replace(/\D/g, ''))}
            placeholder={t('groups.epFrom')}
            inputMode="numeric"
            className="w-12 bg-transparent text-xs text-white placeholder-dark-600 outline-none"
          />
          <span className="text-dark-600">–</span>
          <input
            value={epTo}
            onChange={(e) => onEpTo(e.target.value.replace(/\D/g, ''))}
            placeholder={t('groups.epTo')}
            inputMode="numeric"
            className="w-12 bg-transparent text-xs text-white placeholder-dark-600 outline-none"
          />
        </div>
        <button
          onClick={onToggleAll}
          disabled={episodes.length === 0}
          className="rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 disabled:opacity-40"
        >
          {allVisibleSelected ? t('groups.deselectAll') : t('groups.selectAll').replace('{n}', String(episodes.length))}
        </button>
        <button
          onClick={onSelectNotDownloaded}
          disabled={episodes.length === 0}
          title={t('groups.selectNotDownloadedTitle')}
          className="rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 disabled:opacity-40"
        >
          {t('groups.selectNotDownloaded')}
        </button>
        <button
          onClick={onSelectNotInR2}
          disabled={episodes.length === 0}
          title={t('groups.selectNotInR2Title')}
          className="rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 disabled:opacity-40"
        >
          {t('groups.selectNotInR2')}
        </button>
        {episodes.some((e) => e.r2_url) && (
          <button
            onClick={() => {
              const urls = episodes.map((e) => e.r2_url).filter(Boolean).join('\n');
              navigator.clipboard?.writeText(urls);
              setCopiedAll(true);
              setTimeout(() => setCopiedAll(false), 1500);
            }}
            title={t('groups.copyAllUrlsTitle')}
            className="flex items-center gap-1.5 rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
          >
            {copiedAll ? <Check className="h-3.5 w-3.5 text-success-400" /> : <Copy className="h-3.5 w-3.5" />}
            {t('groups.copyAllUrls')}
          </button>
        )}
        <span className="ml-auto text-[11px] text-dark-500">
          {t('groups.shownCount').replace('{n}', String(episodes.length))}
        </span>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {EPISODE_FILTER_KEYS.map((filter) => {
          const active = statusFilter === filter.key;
          return (
            <button
              key={filter.key}
              onClick={() => onStatusFilter(filter.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-900/60 text-dark-400 hover:bg-dark-800 hover:text-white'
              }`}
            >
              {t(filter.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-500/30 bg-primary-500/10 px-4 py-3 animate-slide-right">
          <span className="text-xs font-medium text-primary-200">
            {t('groups.selectedCount').replace('{n}', String(selected.size)).replace('{size}', formatBytes(selectedSize))}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClearSelection}
              className="flex items-center gap-1.5 rounded-lg bg-dark-800/70 px-3 py-1.5 text-xs font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
            >
              <X className="h-3.5 w-3.5" /> {t('groups.clear')}
            </button>
            <button
              onClick={onQueue}
              className="flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
            >
              <Download className="h-3.5 w-3.5" /> {t('groups.downloadSelected')}
            </button>
            {!isManualGroup(group) && (
              <button
                onClick={onForward}
                className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-600"
              >
                <Send className="h-3.5 w-3.5" /> {t('groups.forwardToGroup')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Episodes */}
      {episodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 py-14 text-center">
          <Film className="mx-auto mb-3 h-10 w-10 text-dark-700" />
          <p className="text-sm text-dark-500">{t('groups.noVideosMatch')}</p>
          <p className="mt-1 text-xs text-dark-600">{t('groups.clearFiltersHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {episodes.map((ep) => {
            const isSelected = selected.has(ep.id);
            return (
              <div
                key={ep.id}
                onClick={(event) => onToggle(ep.id, event.shiftKey)}
                // select-none: Shift+click is a range tick here, not a text selection.
                className={`flex cursor-pointer select-none items-center gap-3 rounded-xl border p-3 transition-all ${
                  isSelected
                    ? 'border-primary-500/40 bg-primary-500/10'
                    : 'border-transparent bg-dark-900/60 hover:border-dark-700 hover:bg-dark-800/60'
                }`}
              >
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  isSelected ? 'border-primary-500 bg-primary-500' : 'border-dark-600'
                }`}>
                  {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </div>
                <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dark-800/60">
                  {ep.thumbnail_url ? (
                    <img src={ep.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : ep.media_type === 'audio' ? (
                    <Music className="h-5 w-5 text-dark-500" />
                  ) : (
                    <Film className="h-5 w-5 text-dark-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {ep.ep_number !== null && (
                      <span className="shrink-0 text-xs font-bold text-primary-400 tabular-nums">EP{String(ep.ep_number).padStart(3, '0')}</span>
                    )}
                    <p className="truncate text-sm font-medium text-white">{ep.title || ep.file_name || t('groups.untitled')}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-dark-500">
                    <span>{formatBytes(ep.file_size)}</span>
                    {ep.duration > 0 && <span>{Math.floor(ep.duration / 60)}m</span>}
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${getStatusColor(ep.status)}`}>{t(`groups.status.${ep.status}` as TranslationKey)}</span>
                    {ep.r2_key && (
                      <EpisodeUrlBadge
                        url={ep.r2_url}
                        downloadUrl={backendConfigured ? r2DownloadUrl(ep.r2_key, ep.file_name ?? undefined) : ''}
                      />
                    )}
                    {!ep.r2_key && ep.tg_storage_chat_id && ep.tg_storage_message_id && (
                      <EpisodeUrlBadge
                        url={null}
                        downloadUrl={
                          backendConfigured
                            ? telegramStorageDownloadUrl(ep.tg_storage_chat_id, ep.tg_storage_message_id, ep.file_name ?? undefined)
                            : ''
                        }
                      />
                    )}
                  </div>
                </div>
                {ep.status === 'completed' && isPreviewableUrl(ep.r2_url) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewItem(ep); }}
                    title={t('groups.preview')}
                    className="shrink-0 rounded-lg p-1.5 text-dark-500 transition-colors hover:bg-dark-700 hover:text-white"
                  >
                    <PlayCircle className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {previewItem && <EpisodePreviewModal episode={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}

/** True for a downloaded file the browser can play inline. */
function isPreviewableUrl(url: string | null): url is string {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg)(\?|$)/i.test(url);
}

function EpisodePreviewModal({ episode, onClose }: { episode: Episode; onClose: () => void }) {
  const isAudio = episode.media_type === 'audio' || /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(episode.r2_url || '');
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-dark-700 bg-dark-900 p-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="truncate pr-4 text-sm font-medium text-white">{episode.title || episode.file_name}</p>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-dark-500 transition-colors hover:bg-dark-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {isAudio ? (
          <audio src={episode.r2_url ?? undefined} controls autoPlay className="w-full" />
        ) : (
          <video src={episode.r2_url ?? undefined} controls autoPlay className="max-h-[70vh] w-full rounded-lg bg-black" />
        )}
      </div>
    </div>
  );
}
