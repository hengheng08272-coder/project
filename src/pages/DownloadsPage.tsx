import { useEffect, useState, useCallback } from 'react';
import {
  DownloadCloud,
  Play,
  Pause,
  XCircle,
  Trash2,
  Film,
  Loader2,
  CheckCircle2,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { fetchAll, supabase } from '@/lib/supabase';
import type { Download, Episode, Group } from '@/lib/types';
import { formatBytes, formatSpeed, getStatusColor } from '@/lib/utils';

export function DownloadsPage() {
  const [downloads, setDownloads] = useState<(Download & { episode?: Episode; group?: Group })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [simulating, setSimulating] = useState(false);

  const loadDownloads = useCallback(async () => {
    // Paged -- one request tops out at 1000 rows, and a busy queue passes that.
    const all = await fetchAll<Download & { episode?: Episode; group?: Group }>(() =>
      supabase
        .from('downloads')
        .select('*, episode:episodes(*, group:groups(*))')
        .order('created_at', { ascending: false })
        .order('id')
    );
    setDownloads(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  // Simulate progress for demo
  useEffect(() => {
    const activeDls = downloads.filter((d) => d.status === 'downloading' || d.status === 'queued');
    if (activeDls.length === 0) return;

    setSimulating(true);
    const interval = setInterval(async () => {
      const active = downloads.filter((d) => d.status === 'downloading');
      for (const dl of active) {
        const newProgress = Math.min(dl.progress + Math.random() * 8, 100);
        const newDownloaded = Math.min(dl.downloaded_bytes + dl.total_bytes * 0.05, dl.total_bytes);
        const newSpeed = 2 + Math.random() * 8;

        if (newProgress >= 100) {
          await supabase.from('downloads').update({
            status: 'completed',
            progress: 100,
            downloaded_bytes: dl.total_bytes,
            completed_at: new Date().toISOString(),
            speed_mbps: 0,
          }).eq('id', dl.id);
          await supabase.from('episodes').update({ status: 'completed' }).eq('id', dl.episode_id);
        } else {
          await supabase.from('downloads').update({
            progress: newProgress,
            downloaded_bytes: newDownloaded,
            speed_mbps: newSpeed,
          }).eq('id', dl.id);
        }
      }
      loadDownloads();
    }, 2000);

    return () => clearInterval(interval);
  }, [downloads, loadDownloads]);

  const startDownload = async (id: string, episodeId: string) => {
    await supabase.from('downloads').update({
      status: 'downloading',
      started_at: new Date().toISOString(),
    }).eq('id', id);
    await supabase.from('episodes').update({ status: 'downloading' }).eq('id', episodeId);
    loadDownloads();
  };

  const pauseDownload = async (id: string, episodeId: string) => {
    await supabase.from('downloads').update({ status: 'paused', speed_mbps: 0 }).eq('id', id);
    await supabase.from('episodes').update({ status: 'pending' }).eq('id', episodeId);
    loadDownloads();
  };

  const cancelDownload = async (id: string, episodeId: string) => {
    await supabase.from('downloads').update({ status: 'cancelled', speed_mbps: 0 }).eq('id', id);
    await supabase.from('episodes').update({ status: 'pending' }).eq('id', episodeId);
    loadDownloads();
  };

  const deleteDownload = async (id: string) => {
    await supabase.from('downloads').delete().eq('id', id);
    loadDownloads();
  };

  const startAllQueued = async () => {
    const queued = downloads.filter((d) => d.status === 'queued');
    for (const dl of queued.slice(0, 3)) {
      await startDownload(dl.id, dl.episode_id);
    }
  };

  const clearCompleted = async () => {
    const completed = downloads.filter((d) => d.status === 'completed');
    for (const dl of completed) {
      await supabase.from('downloads').delete().eq('id', dl.id);
    }
    loadDownloads();
  };

  const filtered = filter === 'all' ? downloads : downloads.filter((d) => d.status === filter);

  const counts = {
    all: downloads.length,
    downloading: downloads.filter((d) => d.status === 'downloading').length,
    queued: downloads.filter((d) => d.status === 'queued').length,
    completed: downloads.filter((d) => d.status === 'completed').length,
    failed: downloads.filter((d) => d.status === 'failed').length,
    paused: downloads.filter((d) => d.status === 'paused').length,
  };

  const filters = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'downloading', label: 'Downloading', count: counts.downloading },
    { key: 'queued', label: 'Queued', count: counts.queued },
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'failed', label: 'Failed', count: counts.failed },
    { key: 'paused', label: 'Paused', count: counts.paused },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Action Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.key ? 'bg-primary-500 text-white' : 'bg-dark-800 text-dark-400 hover:text-white hover:bg-dark-700'
              }`}
            >
              {f.label}
              {f.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-white/20' : 'bg-dark-700'}`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {counts.queued > 0 && (
            <button
              onClick={startAllQueued}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-medium transition-colors"
            >
              <Zap className="w-3.5 h-3.5" /> Start Queued
            </button>
          )}
          {counts.completed > 0 && (
            <button
              onClick={clearCompleted}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-400 hover:text-white text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear Completed
            </button>
          )}
        </div>
      </div>

      {/* Downloads List */}
      {filtered.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-dark-700 bg-dark-900/40 p-16 text-center">
          <DownloadCloud className="w-12 h-12 text-dark-700 mx-auto mb-4" />
          <p className="text-sm text-dark-400">No downloads {filter !== 'all' ? `with status "${filter}"` : 'yet'}</p>
          <p className="text-xs text-dark-600 mt-1">Queue episodes from the Groups page to see them here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((dl) => (
            <div
              key={dl.id}
              className="rounded-xl border border-dark-800 bg-dark-900/60 p-4 card-hover"
            >
              <div className="flex items-start gap-3">
                {/* Thumbnail / Icon */}
                <div className="w-14 h-14 rounded-lg bg-dark-800 flex items-center justify-center shrink-0 overflow-hidden">
                  {dl.episode?.thumbnail_url ? (
                    <img src={dl.episode.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Film className="w-6 h-6 text-dark-500" />
                  )}
                </div>

                {/* Info + Progress */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {dl.episode?.ep_number !== null && dl.episode?.ep_number !== undefined && (
                          <span className="text-xs font-bold text-primary-400 tabular-nums">
                            EP{String(dl.episode.ep_number).padStart(3, '0')}
                          </span>
                        )}
                        <p className="text-sm text-white font-medium truncate">
                          {dl.episode?.title || dl.episode?.file_name || 'Untitled'}
                        </p>
                        {(dl.episode as Episode & { group?: Group })?.group && (
                          <span className="text-[10px] text-dark-500 flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" /> {(dl.episode as Episode & { group?: Group }).group!.title}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-dark-500">
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${getStatusColor(dl.status)}`}>
                          {dl.status}
                        </span>
                        <span>{formatBytes(dl.downloaded_bytes)} / {formatBytes(dl.total_bytes)}</span>
                        {dl.status === 'downloading' && (
                          <span className="text-accent-400 font-medium">{formatSpeed(dl.speed_mbps)}</span>
                        )}
                        {dl.status === 'completed' && dl.r2_url && (
                          <a href={dl.r2_url} target="_blank" rel="noreferrer" className="text-success-400 hover:underline flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> View in R2
                          </a>
                        )}
                        {dl.error && <span className="text-error-400">{dl.error}</span>}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      {dl.status === 'paused' && (
                        <button onClick={() => startDownload(dl.id, dl.episode_id)} className="p-2 rounded-lg hover:bg-success-500/20 text-dark-400 hover:text-success-400 transition-colors">
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      {dl.status === 'downloading' && (
                        <button onClick={() => pauseDownload(dl.id, dl.episode_id)} className="p-2 rounded-lg hover:bg-warning-500/20 text-dark-400 hover:text-warning-400 transition-colors">
                          <Pause className="w-4 h-4" />
                        </button>
                      )}
                      {dl.status === 'queued' && (
                        <button onClick={() => startDownload(dl.id, dl.episode_id)} className="p-2 rounded-lg hover:bg-success-500/20 text-dark-400 hover:text-success-400 transition-colors">
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      {(dl.status === 'downloading' || dl.status === 'paused' || dl.status === 'queued') && (
                        <button onClick={() => cancelDownload(dl.id, dl.episode_id)} className="p-2 rounded-lg hover:bg-error-500/20 text-dark-400 hover:text-error-400 transition-colors">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => deleteDownload(dl.id)} className="p-2 rounded-lg hover:bg-error-500/20 text-dark-400 hover:text-error-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {dl.total_bytes > 0 && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            dl.status === 'completed'
                              ? 'bg-success-500'
                              : dl.status === 'failed'
                              ? 'bg-error-500'
                              : dl.status === 'downloading'
                              ? 'bg-gradient-to-r from-primary-500 to-accent-500'
                              : dl.status === 'paused'
                              ? 'bg-warning-500'
                              : 'bg-dark-600'
                          }`}
                          style={{ width: `${dl.progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-dark-500 tabular-nums">{dl.progress.toFixed(0)}%</span>
                        {dl.status === 'downloading' && (
                          <span className="text-[10px] text-accent-400 tabular-nums">
                            ETA {Math.ceil((100 - dl.progress) / 5)}s
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {simulating && downloads.some((d) => d.status === 'downloading') && (
        <div className="flex items-center gap-2 text-xs text-accent-400 justify-center pt-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Live download simulation running...
        </div>
      )}
    </div>
  );
}
