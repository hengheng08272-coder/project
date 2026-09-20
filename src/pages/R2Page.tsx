import { useEffect, useMemo, useState } from 'react';
import {
  Database,
  Cloud,
  HardDrive,
  CheckCircle2,
  XCircle,
  Save,
  Loader2,
  ExternalLink,
  Folder,
  FileVideo,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
  Clapperboard,
  Download,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { backendConfigured, deleteR2Object, r2DownloadUrl, testR2Connection } from '@/lib/backend';
import { R2Uploader } from '@/components/R2Uploader';
import { useLanguage } from '@/lib/i18n';
import type { R2Settings, Episode, Group, Topic } from '@/lib/types';
import { formatBytes, formatTimeAgo } from '@/lib/utils';

export function R2Page() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<R2Settings | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remoteStats, setRemoteStats] = useState<{ object_count?: number; total_bytes?: number } | null>(null);
  const [copied, setCopied] = useState('');
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error: loadError } = await supabase.from('r2_settings').select('*').maybeSingle();
      if (loadError) {
        setError(t('r2.errLoadSettings'));
      } else if (data) {
        setSettings(data as R2Settings);
        setConnected((data as R2Settings).connected);
      } else {
        setSettings({
          id: '', account_id: '', access_key_id: '', secret_access_key: '',
          bucket_name: '', endpoint_url: '', public_url: '', region: 'auto',
          connected: false, last_connected_at: null, created_at: '', updated_at: '',
        });
      }
      const [{ data: epData }, { data: groupData }, { data: topicData }] = await Promise.all([
        supabase.from('episodes').select('*').not('r2_key', 'is', null).order('ep_number', { ascending: true }),
        supabase.from('groups').select('*'),
        supabase.from('topics').select('*'),
      ]);
      setEpisodes((epData as Episode[]) || []);
      setGroups((groupData as Group[]) || []);
      setTopics((topicData as Topic[]) || []);
      setLoading(false);
    })();
  }, []);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? '' : c)), 1500);
    } catch {
      setCopied('');
    }
  };

  /** Deletes the file from the bucket, then reverts the episode to "not in R2" so it can be re-downloaded. */
  const handleDelete = async (ep: Episode) => {
    if (!ep.r2_key) return;
    const label = ep.ep_number != null ? `EP${ep.ep_number}` : ep.file_name || ep.r2_key;
    if (!window.confirm(t('r2.deleteConfirm').replace('{file}', label))) return;
    setError('');
    setDeletingId(ep.id);
    try {
      await deleteR2Object(ep.r2_key);
      await supabase.from('episodes').update({ r2_key: null, r2_url: null, file_size: 0 }).eq('id', ep.id);
      setEpisodes((prev) =>
        prev.map((e) => (e.id === ep.id ? { ...e, r2_key: null, r2_url: null, file_size: 0 } : e)).filter((e) => e.r2_key)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('r2.errDeleteFailed'));
    }
    setDeletingId('');
  };

  /** Groups episodes by show (and season, when set), sorted the same way the show library is. */
  const shows = useMemo(() => {
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const byGroup = new Map<string, Episode[]>();
    for (const ep of episodes) {
      const list = byGroup.get(ep.group_id);
      if (list) list.push(ep);
      else byGroup.set(ep.group_id, [ep]);
    }
    return Array.from(byGroup.entries())
      .map(([groupId, eps]) => ({
        group: groupById.get(groupId),
        episodes: [...eps].sort((a, b) => {
          const seasonA = topicById.get(a.topic_id || '')?.title || '';
          const seasonB = topicById.get(b.topic_id || '')?.title || '';
          if (seasonA !== seasonB) return seasonA.localeCompare(seasonB);
          return (a.ep_number ?? 0) - (b.ep_number ?? 0);
        }),
        topicById,
      }))
      .sort((a, b) => (a.group?.title || '').localeCompare(b.group?.title || ''));
  }, [episodes, groups, topics]);

  const urlFor = (ep: Episode) => ep.r2_url || (ep.r2_key && settings?.public_url ? `${settings.public_url.replace(/\/+$/, '')}/${ep.r2_key}` : null);

  /** Persists the form and returns the row id, or null when the save failed. */
  const handleSave = async (): Promise<string | null> => {
    if (!settings) return null;
    setSaving(true);
    setError('');
    const result = settings.id
      ? await supabase.from('r2_settings').update({
          account_id: settings.account_id,
          access_key_id: settings.access_key_id,
          secret_access_key: settings.secret_access_key,
          bucket_name: settings.bucket_name,
          endpoint_url: settings.endpoint_url,
          public_url: settings.public_url,
          region: settings.region,
        }).eq('id', settings.id)
      : await supabase.from('r2_settings').insert({
          account_id: settings.account_id,
          access_key_id: settings.access_key_id,
          secret_access_key: settings.secret_access_key,
          bucket_name: settings.bucket_name,
          endpoint_url: settings.endpoint_url,
          public_url: settings.public_url,
          region: settings.region,
        }).select().maybeSingle();

    let savedId: string | null = settings.id || null;
    if (result.error) {
      setError(t('r2.errSaveSettings'));
      savedId = null;
    } else if (!settings.id && result.data) {
      savedId = (result.data as R2Settings).id;
      setSettings({ ...settings, id: savedId });
    }
    setSaving(false);
    return savedId;
  };

  const handleTest = async () => {
    if (!settings) return;
    setError('');
    setNotice('');
    if (!settings.account_id || !settings.access_key_id || !settings.secret_access_key || !settings.bucket_name) {
      setError(t('r2.errFillFields'));
      return;
    }
    if (!backendConfigured) {
      setError(t('r2.errNoBackend'));
      return;
    }
    setTesting(true);
    let savedId: string | null = null;
    try {
      // Save first so the backend tests exactly what is stored.
      savedId = await handleSave();
      if (!savedId) {
        setTesting(false);
        return;
      }
      const rowId: string = savedId;
      const result = await testR2Connection();
      setRemoteStats({ object_count: result.object_count, total_bytes: result.total_bytes });
      setConnected(true);
      const now = new Date().toISOString();
      await supabase.from('r2_settings').update({ connected: true, last_connected_at: now }).eq('id', rowId);
      setSettings((prev) => (prev ? { ...prev, id: rowId, connected: true, last_connected_at: now } : prev));
      setNotice(t('r2.connectedNotice').replace('{bucket}', result.bucket || settings.bucket_name || ''));
    } catch (err) {
      setConnected(false);
      if (savedId) {
        await supabase.from('r2_settings').update({ connected: false }).eq('id', savedId);
      }
      setError(err instanceof Error ? err.message : t('r2.errTestFailed'));
    }
    setTesting(false);
  };

  const update = (field: keyof R2Settings, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const totalSize = remoteStats?.total_bytes ?? episodes.reduce((sum, e) => sum + (e.file_size || 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-success-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {/* Connection Status Banner */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 ${
        connected ? 'border-success-500/30 bg-gradient-to-br from-success-500/10 to-dark-900' : 'border-dark-800 bg-dark-900/60'
      }`}>
        <div className="absolute top-0 right-0 w-48 h-48 bg-accent-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${connected ? 'bg-success-500/20' : 'bg-dark-800'}`}>
              <Cloud className={`w-6 h-6 ${connected ? 'text-success-400' : 'text-dark-500'}`} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{t('r2.title')}</h2>
              <p className="text-xs text-dark-500">
                {connected ? t('r2.connectedToSubtitle').replace('{bucket}', settings?.bucket_name || t('r2.bucketFallback')) : t('r2.notConnected')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-500/10 text-success-400 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4" /> {t('r2.connected')} {settings?.last_connected_at && `· ${formatTimeAgo(settings.last_connected_at)}`}
              </span>
            ) : (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 text-dark-400 text-xs font-medium">
                <XCircle className="w-4 h-4" /> {t('r2.disconnected')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Storage Overview */}
      {connected && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4 text-accent-400" />
              <h3 className="text-sm font-semibold text-white">{t('r2.storageUsed')}</h3>
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">{formatBytes(totalSize)}</p>
            <div className="h-2 bg-dark-800 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-gradient-to-r from-accent-500 to-primary-500 rounded-full" style={{ width: `${Math.min((totalSize / (50 * 1024 * 1024 * 1024)) * 100, 100)}%` }} />
            </div>
            <p className="text-[10px] text-dark-500 mt-1">{t('r2.ofSize').replace('{size}', formatBytes(totalSize))}</p>
          </div>
          <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileVideo className="w-4 h-4 text-primary-400" />
              <h3 className="text-sm font-semibold text-white">{t('r2.filesInR2')}</h3>
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">{remoteStats?.object_count ?? episodes.length}</p>
            <p className="text-xs text-dark-500 mt-1">
              {remoteStats?.object_count !== undefined ? t('r2.objectsInBucket') : t('r2.videoFilesUploaded')}
            </p>
          </div>
          <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Folder className="w-4 h-4 text-warning-400" />
              <h3 className="text-sm font-semibold text-white">{t('r2.bucket')}</h3>
            </div>
            <p className="text-sm text-white font-medium truncate">{settings?.bucket_name || '—'}</p>
            <p className="text-xs text-dark-500 mt-1">{settings?.region || 'auto'}</p>
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-primary-400" /> {t('r2.configuration')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('r2.accountId')} value={settings?.account_id || ''} onChange={(v) => update('account_id', v)} placeholder={t('r2.placeholderAccountId')} mono />
          <Field label={t('r2.bucketName')} value={settings?.bucket_name || ''} onChange={(v) => update('bucket_name', v)} placeholder={t('r2.placeholderBucketName')} />
          <Field label={t('r2.accessKeyId')} value={settings?.access_key_id || ''} onChange={(v) => update('access_key_id', v)} placeholder={t('r2.placeholderAccessKeyId')} mono type="password" />
          <Field label={t('r2.secretAccessKey')} value={settings?.secret_access_key || ''} onChange={(v) => update('secret_access_key', v)} placeholder={t('r2.placeholderSecretAccessKey')} mono type="password" />
          <Field label={t('r2.endpointUrl')} value={settings?.endpoint_url || ''} onChange={(v) => update('endpoint_url', v)} placeholder="https://<account>.r2.cloudflarestorage.com" mono />
          <Field label={t('r2.publicUrlOptional')} value={settings?.public_url || ''} onChange={(v) => update('public_url', v)} placeholder="https://cdn.example.com" mono />
          <Field label={t('r2.region')} value={settings?.region || 'auto'} onChange={(v) => update('region', v)} placeholder="auto" />
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('r2.saveSettings')}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t('r2.testConnection')}
          </button>
        </div>
      </div>

      {/* Upload videos by hand, straight into the bucket */}
      <R2Uploader publicUrl={settings?.public_url || ''} />

      {/* Files in R2, organized by show and episode number instead of a flat key list */}
      {episodes.length > 0 && (
        <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <FileVideo className="w-4 h-4 text-accent-400" /> {t('r2.filesInR2Storage')}
            <span className="text-dark-500 font-normal">({episodes.length})</span>
          </h3>
          <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
            {shows.map(({ group, episodes: eps, topicById }) => (
              <div key={group?.id || 'unknown'}>
                <div className="flex items-center gap-2 mb-1.5 px-0.5">
                  <Clapperboard className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                  <h4 className="text-xs font-semibold text-white truncate">{group?.title || t('r2.unknownShow')}</h4>
                  <span className="text-[10px] text-dark-500">
                    {(eps.length === 1 ? t('r2.episodeCountOne') : t('r2.episodeCountMany')).replace('{n}', String(eps.length))}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {eps.map((ep) => {
                    const url = urlFor(ep);
                    const season = topicById.get(ep.topic_id || '')?.title;
                    const label = ep.ep_number != null ? t('r2.episodeLabel').replace('{n}', String(ep.ep_number)) : ep.title || ep.file_name || t('r2.untitled');
                    return (
                      <div key={ep.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-dark-800/30 hover:bg-dark-800/60 transition-colors">
                        <FileVideo className="w-4 h-4 text-dark-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-white truncate font-medium">{label}</p>
                            {season && (
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-dark-700 text-dark-300">
                                {season}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-dark-500 font-mono truncate">{ep.r2_key}</p>
                          <p className="text-[10px] text-dark-500">{formatBytes(ep.file_size)}</p>
                        </div>
                        {url && (
                          <>
                            <button
                              onClick={() => void copy(url, ep.id)}
                              title={t('r2.copyUrl')}
                              className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors"
                            >
                              {copied === ep.id ? (
                                <Check className="w-3.5 h-3.5 text-success-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title={t('r2.open')}
                              className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </>
                        )}
                        {backendConfigured && ep.r2_key && (
                          <a
                            href={r2DownloadUrl(ep.r2_key, ep.file_name ?? undefined)}
                            title={t('r2.downloadToDevice')}
                            className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-500 hover:text-white transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {backendConfigured && ep.r2_key && (
                          <button
                            onClick={() => void handleDelete(ep)}
                            disabled={deletingId === ep.id}
                            title={t('r2.deleteFile')}
                            className="p-1.5 rounded-lg hover:bg-error-500/20 text-dark-500 hover:text-error-400 transition-colors disabled:opacity-40"
                          >
                            {deletingId === ep.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup Guide */}
      <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">{t('r2.setupGuideTitle')}</h3>
        <div className="space-y-2 text-xs text-dark-400">
          {[
            t('r2.setupStep1'),
            t('r2.setupStep2'),
            t('r2.setupStep3'),
            t('r2.setupStep4'),
            t('r2.setupStep5'),
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-dark-400 font-medium block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}
