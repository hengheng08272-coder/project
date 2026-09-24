import { Facebook, Instagram, Send, Twitch, Twitter, Youtube } from 'lucide-react';

/**
 * Shown near every "paste a link" entry point so it's visible at a glance
 * that this isn't limited to Telegram or a handful of sites -- yt-dlp's
 * generic extractor (pageResolve.js / ytdlp.js on the backend) resolves and
 * downloads from any of these plus ~1800 other sites, direct .mp4/.m3u8
 * links included.
 */
export function SupportedSourcesBadge({ compact = false }: { compact?: boolean }) {
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
      {!compact && (
        <span className="ml-1 text-[10px] font-medium text-dark-500">
          + ~1800 sites, or any direct .mp4/.m3u8 link
        </span>
      )}
    </div>
  );
}
