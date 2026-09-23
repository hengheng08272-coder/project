import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Link2,
  Plus,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  List,
  Tag,
  Pencil,
  X,
  Sparkles,
  FileText,
  Send,
  Youtube,
  Facebook,
  Instagram,
  Twitter,
  Twitch,
  AlertTriangle,
  Loader2,
  Cloud,
  CloudUpload,
  RefreshCw,
  Download,
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  Wand2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { backendConfigured, checkUrl, r2DownloadUrl, resolvePageUrl, saveUrlItemsToR2, saveUrlListToR2 } from '@/lib/backend';
import type { UrlList, UrlListItem } from '@/lib/types';
import { formatBytes, getStatusColor } from '@/lib/utils';
import { parseUrls, getSourceColor, isDirectFileUrl, type ParsedUrlItem } from '@/lib/urlParser';

/**
 * Shown near every "paste a link" entry point so it's visible at a glance
 * that this isn't limited to Telegram or a handful of sites -- yt-dlp's
 * generic extractor (pageResolve.js / ytdlp.js on the backend) resolves and
 * downloads from any of these plus ~1800 other sites, direct .mp4/.m3u8
 * links included.
 */
function SupportedSourcesBadge() {
  const platforms: { icon: typeof Youtube; label: string; color: string }[] = [
    { icon: Youtube, label: 'YouTube', color: 'text-error-400' },
    { icon: Facebook, label: 'Facebook', color: 'text-primary-400' },
    { icon: Instagram, label: 'Instagram', color: 'text-accent-400' },
    { icon: Twitter, label: 'Twitter / X', color: 'text-dark-200' },
    { icon: Twitch, label: 'Twitch', color: 'text-accent-500' },
    { icon: Send, label: 'Telegram', color: 'text-accent-400' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {platforms.map(({ icon: Icon, label, color }) => (
        <span
          key={label}
          title={label}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-dark-700 bg-dark-800/60"
        >
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </span>
      ))}
      <span
        title="TikTok"
        className="flex h-6 items-center justify-center rounded-md border border-dark-700 bg-dark-800/60 px-1.5 text-[9px] font-bold text-dark-200"
      >
        TikTok
      </span>
      <span className="ml-1 text-[10px] font-medium text-dark-500">+ ~1800 sites, or any direct .mp4/.m3u8 link</span>
    </div>
  );
}

const COLORS = [
  { name: 'blue', class: 'from-primary-500 to-primary-600', text: 'text-primary-400', bg: 'bg-primary-500/10', glow: 'hover:shadow-[0_0_28px_-10px_theme(colors.primary.500)]' },
  { name: 'cyan', class: 'from-accent-500 to-accent-600', text: 'text-accent-400', bg: 'bg-accent-500/10', glow: 'hover:shadow-[0_0_28px_-10px_theme(colors.accent.500)]' },
  { name: 'green', class: 'from-success-500 to-success-600', text: 'text-success-400', bg: 'bg-success-500/10', glow: 'hover:shadow-[0_0_28px_-10px_theme(colors.success.500)]' },
  { name: 'amber', class: 'from-warning-500 to-warning-600', text: 'text-warning-400', bg: 'bg-warning-500/10', glow: 'hover:shadow-[0_0_28px_-10px_theme(colors.warning.500)]' },
  { name: 'red', class: 'from-error-500 to-error-600', text: 'text-error-400', bg: 'bg-error-500/10', glow: 'hover:shadow-[0_0_28px_-10px_theme(colors.error.500)]' },
];

/** A small pill for the hero banner's at-a-glance stats -- mirrors GroupsPage's HeroStat. */
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

export function UrlListsPage() {
  const [lists, setLists] = useState<UrlList[]>([]);
  const [items, setItems] = useState<UrlListItem[]>([]);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAutoImport, setShowAutoImport] = useState(false);
  const [editingList, setEditingList] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewItem, setPreviewItem] = useState<UrlListItem | null>(null);
  const [quickUrl, setQuickUrl] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickStatus, setQuickStatus] = useState('');

  const loadData = useCallback(async () => {
    const [lRes, iRes] = await Promise.all([
      supabase.from('url_lists').select('*').order('created_at', { ascending: false }),
      supabase.from('url_list_items').select('*').order('episode_number', { ascending: true, nullsFirst: false }),
    ]);
    setLists((lRes.data as UrlList[]) || []);
    setItems((iRes.data as UrlListItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // While anything is on its way into R2 the rows change behind the page's
  // back -- the service writes them -- so follow them until the queue drains.
  const working = items.some((i) => i.status === 'queued' || i.status === 'downloading');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(loadData, 3000);
    return () => clearInterval(timer);
  }, [working, loadData]);

  const addList = async (title: string, description: string, color: string) => {
    const { data } = await supabase.from('url_lists').insert({ title, description, color }).select().single();
    if (data) {
      setShowAddModal(false);
      loadData();
      setSelectedList((data as UrlList).id);
    }
  };

  const QUICK_LIST_TITLE = 'Quick Downloads';

  /**
   * Quick Download sits above the list picker and works with nothing
   * selected yet: the first paste reuses (or creates) a "Quick Downloads"
   * list and switches to it, so pasting a link is never gated on first
   * creating or picking a list. Returns the id directly instead of relying
   * on selectedList's state update, which would not be visible yet to the
   * same call that triggered it.
   */
  const ensureQuickList = async (): Promise<string> => {
    if (selectedList) return selectedList;
    const existing = lists.find((l) => l.title === QUICK_LIST_TITLE);
    if (existing) {
      setSelectedList(existing.id);
      return existing.id;
    }
    const { data } = await supabase
      .from('url_lists')
      .insert({ title: QUICK_LIST_TITLE, description: 'Links added from the Quick Download box', color: 'blue' })
      .select()
      .single();
    const created = data as UrlList;
    setLists((prev) => [created, ...prev]);
    setSelectedList(created.id);
    return created.id;
  };

  const deleteList = async (id: string) => {
    await supabase.from('url_lists').delete().eq('id', id);
    if (selectedList === id) setSelectedList(null);
    loadData();
  };

  const addItem = async (url: string, label: string, epNumber: string, referer: string, listIdOverride?: string) => {
    const listId = listIdOverride ?? selectedList;
    if (!listId || !url) return;
    await supabase.from('url_list_items').insert({
      url_list_id: listId,
      url,
      label: label || null,
      episode_number: epNumber ? parseInt(epNumber) : null,
      referer: referer || null,
    });
    setShowAddItem(false);
    loadData();
  };

  /**
   * The one-box, always-visible way to add a link: paste anything (a plain
   * webpage or a direct file) and press Enter -- or just paste it, since
   * onPaste below calls this the moment a single link lands in the box, no
   * Enter needed. A page link (a "watch" page with a video player embedded
   * in it, not a direct file) is auto-resolved to its real video URL first
   * (same as the "Find the video link" button in the Add URL modal); a
   * direct file link is added as typed. Resolving never blocks adding -- if
   * it fails, the pasted link is saved as-is so yt-dlp can still try it at
   * download time.
   *
   * Takes an optional explicit URL so the paste handler can pass the
   * clipboard text straight through -- state set by the same paste event
   * (setQuickUrl) would not be visible yet inside this closure. Needs no
   * list selected beforehand either -- ensureQuickList() reuses or creates
   * a "Quick Downloads" list on first use.
   */
  const quickAdd = async (urlOverride?: string) => {
    const url = (urlOverride ?? quickUrl).trim();
    if (!url || quickAdding) return;
    setQuickAdding(true);
    setQuickStatus('');
    const listId = await ensureQuickList();

    let finalUrl = url;
    let referer = '';
    let label = '';
    const looksLikeDirectFile = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg|m3u8)(\?|$)/i.test(url);

    if (backendConfigured && !looksLikeDirectFile) {
      setQuickStatus('Looking for the video link on that page…');
      try {
        const result = await resolvePageUrl(url);
        finalUrl = result.url;
        referer = result.referer;
        label = result.title || '';
      } catch {
        // Fall back to the raw pasted link -- still worth a try at download time.
      }
    }

    await addItem(finalUrl, label, '', referer, listId);
    setQuickUrl('');
    setQuickStatus('');
    setQuickAdding(false);
  };

  const importUrls = async (parsed: ParsedUrlItem[]) => {
    if (!selectedList || parsed.length === 0) return;
    const rows = parsed.map((p) => ({
      url_list_id: selectedList,
      url: p.url,
      label: p.label,
      episode_number: p.episode_number,
      referer: p.referer || null,
    }));
    const { error } = await supabase.from('url_list_items').insert(rows);
    if (error) {
      // Fall back to individual inserts for partial success
      for (const row of rows) {
        await supabase.from('url_list_items').insert(row);
      }
    }
    setShowAutoImport(false);
    loadData();
  };

  const deleteItem = async (id: string) => {
    await supabase.from('url_list_items').delete().eq('id', id);
    loadData();
  };

  /**
   * Hands the URL to the service, which fetches it and streams it into R2.
   * Nothing is written here: the service owns the row from this point, and the
   * poll above brings the key and the public URL back.
   */
  const saveItemsToR2 = async (itemIds: string[]) => {
    setError('');
    setNotice('');
    if (!backendConfigured) {
      setError('No backend is configured (VITE_TELEGRAM_BACKEND_URL), so nothing can fetch these URLs.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveUrlItemsToR2(itemIds);
      setNotice(`Saving ${result.queued} URL${result.queued === 1 ? '' : 's'} into R2…`);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start saving to R2.');
    }
    setSaving(false);
  };

  /** The same for a whole list, so a hundred links are one click. */
  const saveListToR2 = async () => {
    if (!selectedList) return;
    setError('');
    setNotice('');
    if (!backendConfigured) {
      setError('No backend is configured (VITE_TELEGRAM_BACKEND_URL), so nothing can fetch these URLs.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveUrlListToR2(selectedList);
      setNotice(
        result.queued === 0
          ? 'Every URL in this list is already in R2.'
          : `Saving ${result.queued} URL${result.queued === 1 ? '' : 's'} into R2…`
      );
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start saving to R2.');
    }
    setSaving(false);
  };

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const updateList = async (id: string, title: string, description: string) => {
    await supabase.from('url_lists').update({ title, description }).eq('id', id);
    setEditingList(null);
    loadData();
  };

  const currentList = lists.find((l) => l.id === selectedList);
  const currentColor = COLORS.find((c) => c.name === currentList?.color) || COLORS[0];
  const listItems = items.filter((i) => i.url_list_id === selectedList);
  const savableCount = listItems.filter((i) => !i.r2_key && i.status !== 'downloading').length;
  const failedItems = listItems.filter((i) => i.status === 'failed');
  const inR2 = listItems.filter((i) => i.r2_key);
  const savedBytes = inR2.reduce((sum, i) => sum + (i.file_size || 0), 0);
  const existingUrls = useMemo(() => new Set(listItems.map((i) => i.url)), [listItems]);

  const totalItems = items.length;
  const totalDoneItems = items.filter((i) => i.status === 'completed').length;
  const totalSizeAll = items.reduce((sum, i) => sum + (i.file_size || 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero -- matches the Groups page's banner treatment for a consistent
          feel across the app instead of a plain heading. */}
      <div className="relative overflow-hidden rounded-2xl border border-dark-800 bg-gradient-to-br from-primary-500/15 via-dark-900/60 to-accent-500/10 p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-1/3 h-32 w-32 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 shadow-lg shadow-primary-500/20">
              <Link2 className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white">URL / MP4 / M3U8 Downloader</h1>
              <p className="mb-2 text-xs text-dark-400">Organize episode URLs into lists for batch downloading</p>
              <SupportedSourcesBadge />
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
          >
            <Plus className="w-4 h-4" /> New List
          </button>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <HeroStat icon={<List className="h-3.5 w-3.5" />} value={lists.length} label="Lists" color="from-primary-500 to-primary-600" />
          <HeroStat icon={<Link2 className="h-3.5 w-3.5" />} value={totalItems} label="URLs" color="from-accent-500 to-accent-600" />
          <HeroStat icon={<Check className="h-3.5 w-3.5" />} value={totalDoneItems} label="Done" color="from-success-500 to-success-600" />
          <HeroStat icon={<Cloud className="h-3.5 w-3.5" />} value={formatBytes(totalSizeAll)} label="Saved" color="from-warning-500 to-warning-600" />
        </div>
      </div>

      {/* Quick Download -- the fastest path in, and always the first thing on
          the page: paste a link (or just press Enter) and it's resolved and
          saved without picking or creating a list first. The first use
          reuses/creates a "Quick Downloads" list (ensureQuickList); once a
          list is selected below, new links go there instead. */}
      <div className="rounded-xl border border-primary-500/30 bg-gradient-to-r from-primary-500/10 to-accent-500/10 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Download className="w-4 h-4 text-primary-400" />
          <p className="text-sm font-semibold text-white">Quick Download</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-900/60 p-2">
          <Wand2 className="w-4 h-4 shrink-0 text-primary-400 ml-1" />
          <input
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(); }}
            onPaste={(e) => {
              // A single pasted link (no newlines) goes straight in -- that
              // covers the common "copy the page URL, paste it here" flow
              // with no extra click. Pasting several lines at once is left
              // for Auto Import instead, since this box only ever adds one
              // item.
              const pasted = e.clipboardData.getData('text').trim();
              if (!pasted || /[\r\n]/.test(pasted) || !/^https?:\/\//i.test(pasted)) return;
              setQuickUrl(pasted);
              setTimeout(() => quickAdd(pasted), 0);
            }}
            placeholder="Paste any link here (a webpage or a direct video/m3u8 link) — it's added automatically…"
            disabled={quickAdding}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-dark-500 outline-none disabled:opacity-60"
          />
          <button
            onClick={() => quickAdd()}
            disabled={!quickUrl.trim() || quickAdding}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium transition-colors disabled:opacity-40"
          >
            {quickAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-dark-500">
          {quickStatus ? (
            <><Loader2 className="w-3 h-3 animate-spin text-primary-400" /> {quickStatus}</>
          ) : (
            <>Saved to: <span className="font-medium text-dark-300">{currentList?.title || QUICK_LIST_TITLE}</span></>
          )}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-error-400/70 hover:text-error-300"><X className="h-4 w-4" /></button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-primary-500/30 bg-primary-500/10 px-4 py-3 text-sm text-primary-200">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="text-primary-400/70 hover:text-primary-200"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lists sidebar */}
        <div className="space-y-2">
          {lists.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 p-8 text-center">
              <List className="w-10 h-10 text-dark-700 mx-auto mb-3" />
              <p className="text-sm text-dark-500">No lists yet</p>
              <p className="text-xs text-dark-600 mt-1">Create a list to organize your URLs</p>
            </div>
          ) : (
            lists.map((list) => {
              const color = COLORS.find((c) => c.name === list.color) || COLORS[0];
              const count = items.filter((i) => i.url_list_id === list.id).length;
              const isSelected = selectedList === list.id;
              return (
                <div
                  key={list.id}
                  onClick={() => setSelectedList(isSelected ? null : list.id)}
                  className={`relative overflow-hidden rounded-xl border p-4 cursor-pointer transition-all ${
                    isSelected ? 'border-primary-500 bg-primary-500/5' : `border-dark-800 bg-dark-900/60 hover:border-dark-700 card-hover ${color.glow}`
                  }`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${color.class}`} />
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color.class} flex items-center justify-center shrink-0 shadow-md`}>
                        <List className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{list.title}</p>
                        {list.description && <p className="text-xs text-dark-500 truncate">{list.description}</p>}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteList(list.id); }}
                      className="p-1 rounded hover:bg-error-500/20 text-dark-600 hover:text-error-400 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${color.bg} ${color.text} font-medium`}>
                      {count} URLs
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Items panel */}
        <div className="lg:col-span-2">
          {selectedList ? (
            <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${currentColor.class} flex items-center justify-center`}>
                    <Tag className="w-4 h-4 text-white" />
                  </div>
                  {editingList === selectedList ? (
                    <EditListName list={currentList!} onSave={(t, d) => updateList(selectedList, t, d)} onCancel={() => setEditingList(null)} />
                  ) : (
                    <div>
                      <p className="text-sm text-white font-medium">{currentList?.title}</p>
                      {currentList?.description && <p className="text-xs text-dark-500">{currentList.description}</p>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingList(selectedList)} className="p-2 rounded-lg hover:bg-dark-800 text-dark-400 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={saveListToR2}
                    disabled={saving || listItems.length === 0 || savableCount === 0}
                    title={savableCount === 0 ? 'Every URL in this list is already in R2' : 'Fetch every URL and store it in R2'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-medium transition-colors disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    Save all to R2{savableCount > 0 ? ` (${savableCount})` : ''}
                  </button>
                  {failedItems.length > 0 && (
                    <button
                      onClick={() => saveItemsToR2(failedItems.map((i) => i.id))}
                      disabled={saving}
                      title="Give every failed URL another try"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error-500/15 hover:bg-error-500/25 text-error-300 text-xs font-medium transition-colors disabled:opacity-40"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Retry failed ({failedItems.length})
                    </button>
                  )}
                  <button
                    onClick={() => setShowAutoImport(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 text-white text-xs font-medium transition-all glow"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Auto Import
                  </button>
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add URL
                  </button>
                </div>
              </div>

              {/* Quick stats */}
              {listItems.length > 0 && (
                <div className="flex items-center gap-3 mb-3 text-[10px]">
                  <span className="text-dark-500">{listItems.length} total</span>
                  <span className="text-success-400">{listItems.filter((i) => i.status === 'completed').length} done</span>
                  <span className="text-primary-400">{listItems.filter((i) => i.status === 'downloading').length} active</span>
                  <span className="text-dark-500">{listItems.filter((i) => i.status === 'pending').length} pending</span>
                  {listItems.some((i) => i.status === 'failed') && (
                    <span className="text-error-400">{listItems.filter((i) => i.status === 'failed').length} failed</span>
                  )}
                  {inR2.length > 0 && (
                    <span className="flex items-center gap-1 text-accent-400">
                      <Cloud className="w-3 h-3" /> {inR2.length} in R2 · {formatBytes(savedBytes)}
                    </span>
                  )}
                  {inR2.some((i) => i.r2_url) && (
                    <button
                      onClick={() => copyUrl(inR2.map((i) => i.r2_url).filter(Boolean).join('\n'), 'all-r2')}
                      className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-dark-400 hover:bg-dark-800 hover:text-white transition-colors"
                    >
                      {copiedId === 'all-r2' ? <Check className="w-3 h-3 text-success-400" /> : <Copy className="w-3 h-3" />}
                      Copy all R2 URLs
                    </button>
                  )}
                </div>
              )}

              {listItems.length === 0 ? (
                <div className="text-center py-10">
                  <Link2 className="w-10 h-10 text-dark-700 mx-auto mb-3" />
                  <p className="text-sm text-dark-500">No URLs in this list yet</p>
                  <p className="text-xs text-dark-600 mt-1 mb-4">Use Auto Import to paste links in bulk</p>
                  <button
                    onClick={() => setShowAutoImport(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 text-white text-sm font-medium transition-all glow"
                  >
                    <Sparkles className="w-4 h-4" /> Auto Import URLs
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                  {listItems.map((item) => {
                    const source = detectSource(item.url);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/60 transition-colors group"
                      >
                        {item.episode_number !== null && (
                          <span className={`text-xs font-bold ${currentColor.text} tabular-nums w-12 shrink-0`}>
                            EP{String(item.episode_number).padStart(3, '0')}
                          </span>
                        )}
                        <SourceBadge source={source} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate font-medium">{item.label || item.url}</p>
                          {item.r2_url ? (
                            <p className="text-[10px] text-accent-300 truncate font-mono">{item.r2_url}</p>
                          ) : (
                            <p className="text-[10px] text-dark-500 truncate font-mono">{item.url}</p>
                          )}
                          {item.status === 'failed' && item.error && (
                            <p className="text-[10px] text-error-400 break-words" title={item.error}>{item.error}</p>
                          )}
                          {item.status === 'downloading' && typeof item.progress === 'number' && (
                            <div className="mt-1 h-1 w-full max-w-[160px] rounded-full bg-dark-700 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary-500 transition-all duration-500"
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                          )}
                        </div>
                        {item.file_size ? (
                          <span className="text-[10px] text-dark-500 shrink-0 tabular-nums">{formatBytes(item.file_size)}</span>
                        ) : null}
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getStatusColor(item.status)} shrink-0`}>
                          {(item.status === 'downloading' || item.status === 'queued') && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {item.status === 'downloading'
                            ? `saving${typeof item.progress === 'number' ? ` ${item.progress}%` : ''}`
                            : item.status}
                        </span>
                        {item.status === 'completed' && isPreviewable(item.r2_url) && (
                          <button
                            onClick={() => setPreviewItem(item)}
                            title="Preview the downloaded file"
                            className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors shrink-0"
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => copyUrl(item.r2_url || item.url, item.id)}
                          title={item.r2_url ? 'Copy the R2 URL' : 'Copy the source URL'}
                          className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors shrink-0"
                        >
                          {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-success-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          href={item.r2_url || item.url}
                          target="_blank"
                          rel="noreferrer"
                          title={item.r2_url ? 'Open the file in R2' : 'Open the source URL'}
                          className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {item.r2_key && (
                          <a
                            href={r2DownloadUrl(item.r2_key, item.label || undefined)}
                            title="Save this file to your device (phone or PC)"
                            className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {item.status === 'failed' ? (
                          <button
                            onClick={() => saveItemsToR2([item.id])}
                            disabled={saving}
                            title="Retry this download"
                            className="p-1.5 rounded-lg hover:bg-error-500/20 text-error-400 transition-colors shrink-0 disabled:opacity-40"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          item.status !== 'downloading' && item.status !== 'queued' && (
                            <button
                              onClick={() => saveItemsToR2([item.id])}
                              disabled={saving}
                              title={item.r2_key ? 'Fetch it again and replace the copy in R2' : 'Fetch this URL and store it in R2'}
                              className="p-1.5 rounded-lg hover:bg-accent-500/20 text-dark-500 hover:text-accent-400 transition-colors shrink-0 disabled:opacity-40"
                            >
                              {item.r2_key ? <Cloud className="w-3.5 h-3.5 text-accent-400/70" /> : <CloudUpload className="w-3.5 h-3.5" />}
                            </button>
                          )
                        )}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1.5 rounded-lg hover:bg-error-500/20 text-dark-600 hover:text-error-400 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 p-16 text-center">
              <Link2 className="w-12 h-12 text-dark-700 mx-auto mb-4" />
              <p className="text-sm text-dark-400">Select a list to view its URLs</p>
              <p className="text-xs text-dark-600 mt-1">Or create a new list to get started</p>
            </div>
          )}
        </div>
      </div>

      {showAddModal && <AddListModal onClose={() => setShowAddModal(false)} onAdd={addList} />}
      {showAddItem && <AddItemModal onClose={() => setShowAddItem(false)} onAdd={addItem} />}
      {showAutoImport && selectedList && (
        <AutoImportModal
          existingUrls={existingUrls}
          onClose={() => setShowAutoImport(false)}
          onImport={importUrls}
        />
      )}
      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}

function detectSource(url: string): 'telegram' | 'youtube' | 'other' {
  if (/t\.me|telegram\.org/.test(url)) return 'telegram';
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  return 'other';
}

/** True for a downloaded file lucide-react/the browser can actually preview inline. */
function isPreviewable(url: string | null): url is string {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg)(\?|$)/i.test(url);
}

function isAudioOnly(url: string): boolean {
  return /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(url);
}

function PreviewModal({ item, onClose }: { item: UrlListItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-dark-700 bg-dark-900 p-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-white font-medium truncate pr-4">{item.label || item.url}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-800 text-dark-400 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        {item.r2_url && (
          isAudioOnly(item.r2_url) ? (
            <audio src={item.r2_url} controls autoPlay className="w-full" />
          ) : (
            <video src={item.r2_url} controls autoPlay className="w-full max-h-[70vh] rounded-lg bg-black" />
          )
        )}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: 'telegram' | 'youtube' | 'other' }) {
  const config = {
    telegram: { icon: Send, color: 'text-accent-400 bg-accent-500/10' },
    youtube: { icon: Youtube, color: 'text-error-400 bg-error-500/10' },
    other: { icon: Link2, color: 'text-dark-400 bg-dark-700' },
  };
  const { icon: Icon, color } = config[source];
  return (
    <span className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${color}`}>
      <Icon className="w-3 h-3" />
    </span>
  );
}

function AutoImportModal({
  existingUrls,
  onClose,
  onImport,
}: {
  existingUrls: Set<string>;
  onClose: () => void;
  onImport: (items: ParsedUrlItem[]) => void;
}) {
  const [text, setText] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [importing, setImporting] = useState(false);
  const [resolveProgress, setResolveProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const parsed = useMemo(() => {
    if (!text.trim()) return [];
    return parseUrls(text, { skipDuplicates, existingUrls });
  }, [text, skipDuplicates, existingUrls]);

  const duplicates = parsed.filter((p) => p.duplicate);
  const telegramCount = parsed.filter((p) => p.source === 'telegram').length;
  const youtubeCount = parsed.filter((p) => p.source === 'youtube').length;
  const otherCount = parsed.filter((p) => p.source === 'other').length;
  const withEpNumbers = parsed.filter((p) => p.episode_number !== null).length;

  const handleFileRead = async (file: File) => {
    if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      const content = await file.text();
      setText((prev) => (prev ? prev + '\n' + content : content));
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFileRead(file);
  };

  /**
   * Same auto-resolve as the single-link quick-add box, applied to every
   * page link in the batch (a Telegram/YouTube/direct-file link is left as
   * typed). Run one at a time -- yt-dlp spawns a subprocess per link, and a
   * hundred of those at once would just fight each other for CPU.
   */
  const handleImport = async () => {
    if (parsed.length === 0) return;
    setImporting(true);

    let toImport = parsed;
    if (autoDetect && backendConfigured) {
      const needsResolve = parsed.filter((p) => !p.duplicate && !isDirectFileUrl(p.url));
      if (needsResolve.length > 0) {
        setResolveProgress({ done: 0, total: needsResolve.length });
        const resolved = new Map<string, ParsedUrlItem>();
        let done = 0;
        for (const item of needsResolve) {
          try {
            const result = await resolvePageUrl(item.url);
            resolved.set(item.url, { ...item, url: result.url, label: item.label || result.title || item.label, referer: result.referer });
          } catch {
            // Leave it as pasted -- yt-dlp gets another shot at it when this item is actually downloaded.
          }
          done += 1;
          setResolveProgress({ done, total: needsResolve.length });
        }
        toImport = parsed.map((p) => resolved.get(p.url) ?? p);
      }
    }

    await onImport(toImport);
    setResolveProgress(null);
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border border-dark-700 bg-dark-900 p-6 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-400" /> Auto Import URLs
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-dark-800 text-dark-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-dark-500 mb-5">
          Paste any text containing links. Episode numbers, labels, and sources are detected automatically.
        </p>

        {/* Drop zone + textarea */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative rounded-xl border-2 border-dashed transition-colors mb-4 ${
            dragOver ? 'border-primary-500 bg-primary-500/5' : 'border-dark-700 bg-dark-800/30'
          }`}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDrop={(e) => { e.preventDefault(); }}
            placeholder={
              'Paste URLs here — one per line or comma-separated:\n\n' +
              'https://t.me/groupname/123 EP1\n' +
              'https://t.me/c/123456/789 EP2 Episode Title\n' +
              'https://t.me/groupname/456, https://t.me/groupname/789\n' +
              '@channelname/123 EP3\n\n' +
              'Or drag & drop a .txt file here'
            }
            rows={8}
            className="w-full bg-transparent px-4 py-3 text-xs text-white placeholder-dark-600 outline-none resize-y font-mono"
          />
          {!text && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <FileText className="w-8 h-8 text-dark-700 mx-auto mb-2" />
                <p className="text-xs text-dark-600">Or drag a .txt file here</p>
              </div>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              type="button"
              onClick={() => setSkipDuplicates(!skipDuplicates)}
              className={`w-10 h-6 rounded-full transition-colors relative ${skipDuplicates ? 'bg-primary-500' : 'bg-dark-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${skipDuplicates ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-dark-300">Skip duplicates</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              type="button"
              onClick={() => setAutoDetect(!autoDetect)}
              className={`w-10 h-6 rounded-full transition-colors relative ${autoDetect ? 'bg-primary-500' : 'bg-dark-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${autoDetect ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-dark-300" title="Runs each webpage link through yt-dlp first to grab its real video/m3u8 URL and title.">
              Auto-detect video link
            </span>
          </label>
          {duplicates.length > 0 && (
            <span className="text-xs text-warning-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''} found
            </span>
          )}
        </div>

        {/* Stats bar */}
        {parsed.length > 0 && (
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-xs font-bold text-white bg-dark-800 px-3 py-1.5 rounded-lg">
              {parsed.length} URLs ready
            </span>
            {telegramCount > 0 && (
              <span className="text-xs text-accent-400 bg-accent-500/10 px-2.5 py-1 rounded-lg flex items-center gap-1">
                <Send className="w-3 h-3" /> {telegramCount} Telegram
              </span>
            )}
            {youtubeCount > 0 && (
              <span className="text-xs text-error-400 bg-error-500/10 px-2.5 py-1 rounded-lg flex items-center gap-1">
                <Youtube className="w-3 h-3" /> {youtubeCount} YouTube
              </span>
            )}
            {otherCount > 0 && (
              <span className="text-xs text-dark-400 bg-dark-700 px-2.5 py-1 rounded-lg flex items-center gap-1">
                <Link2 className="w-3 h-3" /> {otherCount} Other
              </span>
            )}
            {withEpNumbers > 0 && (
              <span className="text-xs text-primary-400 bg-primary-500/10 px-2.5 py-1 rounded-lg">
                {withEpNumbers} EP numbers detected
              </span>
            )}
          </div>
        )}

        {/* Preview table */}
        {parsed.length > 0 && (
          <div className="rounded-lg border border-dark-700 bg-dark-800/30 mb-5 max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-dark-900 text-dark-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-16">EP</th>
                  <th className="text-left px-3 py-2 font-medium w-16">Type</th>
                  <th className="text-left px-3 py-2 font-medium">URL & Label</th>
                  <th className="text-left px-3 py-2 font-medium w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 50).map((item, i) => (
                  <tr key={i} className="border-t border-dark-700/50 hover:bg-dark-800/50">
                    <td className="px-3 py-2 text-primary-400 font-bold tabular-nums">
                      {item.episode_number !== null ? `EP${String(item.episode_number).padStart(3, '0')}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold ${getSourceColor(item.source)}`}>
                        {item.source === 'telegram' ? 'TG' : item.source === 'youtube' ? 'YT' : 'LINK'}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-0">
                      <p className="text-white truncate font-medium">{item.label}</p>
                      <p className="text-dark-500 truncate font-mono text-[10px]">{item.url}</p>
                    </td>
                    <td className="px-3 py-2">
                      {item.duplicate ? (
                        <span className="text-warning-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> dup
                        </span>
                      ) : (
                        <span className="text-success-400 flex items-center gap-1">
                          <Check className="w-3 h-3" /> new
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {parsed.length > 50 && (
                  <tr className="border-t border-dark-700/50">
                    <td colSpan={4} className="px-3 py-2 text-center text-dark-500">
                      +{parsed.length - 50} more...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-dark-600">
            {resolveProgress
              ? `Detecting video links… ${resolveProgress.done}/${resolveProgress.total}`
              : parsed.length > 0
              ? `${parsed.length} URLs will be imported`
              : 'Paste text to start parsing'}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={parsed.length === 0 || importing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed glow"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Import {parsed.length > 0 ? `${parsed.length} URL${parsed.length !== 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddListModal({ onClose, onAdd }: { onClose: () => void; onAdd: (title: string, description: string, color: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('blue');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-dark-700 bg-dark-900 p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-1">New URL List</h3>
        <p className="text-xs text-dark-500 mb-5">Create a list to organize episode links</p>
        <form onSubmit={(e) => { e.preventDefault(); if (title) onAdd(title, description, color); }} className="space-y-4">
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">List Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Series EP1-EP100"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors" />
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Season 1 links"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors" />
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-2">Color Tag</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c.name} type="button" onClick={() => setColor(c.name)}
                  className={`w-8 h-8 rounded-lg bg-gradient-to-br ${c.class} transition-all ${color === c.name ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-900' : ''}`} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors">Create List</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddItemModal({ onClose, onAdd }: { onClose: () => void; onAdd: (url: string, label: string, epNumber: string, referer: string) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [epNumber, setEpNumber] = useState('');
  const [referer, setReferer] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'ok' | 'bad' | null>(null);
  const [checkError, setCheckError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const isM3u8 = /\.m3u8(\?|$)/i.test(url);
  const isDirectFile = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg|m3u8)(\?|$)/i.test(url);

  const runCheck = async () => {
    if (!url || !backendConfigured) return;
    setChecking(true);
    setCheckResult(null);
    setCheckError('');
    try {
      await checkUrl(url);
      setCheckResult('ok');
    } catch (err) {
      setCheckResult('bad');
      setCheckError(err instanceof Error ? err.message : 'Could not reach that URL.');
    }
    setChecking(false);
  };

  /**
   * Finds the real .m3u8/media link behind a "watch this episode" page --
   * the same link someone would otherwise dig out of DevTools' Network tab
   * by hand -- and swaps the URL field to it, with the page itself filled
   * in as the Referer (the CDN usually needs it) and the title as a label.
   */
  const runResolve = async () => {
    if (!url || !backendConfigured) return;
    setResolving(true);
    setResolveError('');
    setCheckResult(null);
    try {
      const result = await resolvePageUrl(url);
      setUrl(result.url);
      setReferer(result.referer);
      if (result.title && !label) setLabel(result.title);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Could not find a video on that page.');
    }
    setResolving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-dark-700 bg-dark-900 p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-1">Add URL</h3>
        <p className="text-xs text-dark-500 mb-5">Add a single episode URL to this list</p>
        <form onSubmit={(e) => { e.preventDefault(); if (url) onAdd(url, label, epNumber, referer); }} className="space-y-4">
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">URL *</label>
            <div className="flex items-center gap-2">
              <input
                value={url}
                onChange={(e) => { setUrl(e.target.value); setCheckResult(null); }}
                placeholder="https://t.me/group/123 or https://cdn.example.com/video.m3u8"
                className="flex-1 min-w-0 bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={runCheck}
                disabled={!url || checking || !backendConfigured}
                title={backendConfigured ? 'Check this link is reachable before adding it' : 'No backend configured'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-xs font-medium transition-colors disabled:opacity-40"
              >
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Check
              </button>
            </div>
            {checkResult === 'ok' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-success-400">
                <ShieldCheck className="w-3.5 h-3.5" /> Reachable -- this link can be saved.
              </p>
            )}
            {checkResult === 'bad' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-error-400">
                <ShieldAlert className="w-3.5 h-3.5" /> {checkError}
              </p>
            )}
            {!isDirectFile && url && (
              <div className="mt-2 rounded-lg border border-dashed border-primary-500/30 bg-primary-500/5 p-2.5">
                <button
                  type="button"
                  onClick={runResolve}
                  disabled={resolving || !backendConfigured}
                  title="Have the server find the real video link on this page, the way DevTools' Network tab would show it"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/15 hover:bg-primary-500/25 px-3 py-2 text-xs font-medium text-primary-300 transition-colors disabled:opacity-40"
                >
                  {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Find the video link on this page
                </button>
                <p className="mt-1.5 text-[10px] text-dark-500">
                  This looks like a normal webpage, not a direct video link. Click above to have the
                  server find the .m3u8/video URL automatically -- no need to open DevTools yourself.
                </p>
                {resolveError && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-error-400">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {resolveError}
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Episode 1 - The Beginning"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors" />
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">Episode Number</label>
            <input type="number" value={epNumber} onChange={(e) => setEpNumber(e.target.value)} placeholder="1"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors" />
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">
              Referer {isM3u8 ? '(recommended for .m3u8)' : '(optional)'}
            </label>
            <input value={referer} onChange={(e) => setReferer(e.target.value)} placeholder="https://the-site-you-watched-it-on.com/watch/123"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono" />
            {isM3u8 && (
              <p className="mt-1.5 text-[10px] text-dark-500">
                An .m3u8 stream often needs the page you watched it on as a Referer, or the CDN answers 403.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors">Add URL</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditListName({ list, onSave, onCancel }: { list: UrlList; onSave: (title: string, description: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(list.title);
  const [description] = useState(list.description || '');
  return (
    <div className="flex items-center gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
        className="bg-dark-800 border border-dark-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-primary-500" />
      <button onClick={() => onSave(title, description)} className="p-1 rounded hover:bg-success-500/20 text-success-400"><Check className="w-4 h-4" /></button>
      <button onClick={onCancel} className="p-1 rounded hover:bg-dark-800 text-dark-500"><X className="w-4 h-4" /></button>
    </div>
  );
}
