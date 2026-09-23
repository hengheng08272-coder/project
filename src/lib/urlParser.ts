export interface ParsedUrlItem {
  url: string;
  label: string;
  episode_number: number | null;
  source: 'telegram' | 'youtube' | 'other';
  duplicate: boolean;
  /** Set once auto-detect resolves this item's real media URL (see UrlListsPage's AutoImportModal). */
  referer?: string;
}

/** True when the URL's path already ends in a known media extension -- the same check the backend uses to skip yt-dlp for a link that is obviously a direct file already. */
export function isDirectFileUrl(url: string): boolean {
  try {
    return /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg|m3u8)(\?|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

interface ParseOptions {
  skipDuplicates?: boolean;
  existingUrls?: Set<string>;
}

/**
 * Smart URL parser — extracts URLs from pasted text, auto-detects episode
 * numbers, labels, and source type. Supports:
 *
 * - One URL per line with optional label/EP number
 * - Comma-separated URLs
 * - Telegram t.me/c/.../123 and t.me/groupname/123 links
 * - "EP1", "EP 12", "Episode 5", "ep-03" patterns
 * - Whitespace-separated URL + label on same line
 * - Lines with only a URL (no label)
 */
export function parseUrls(text: string, options: ParseOptions = {}): ParsedUrlItem[] {
  const { skipDuplicates = true, existingUrls = new Set() } = options;
  const seenInBatch = new Set<string>();

  const lines = text
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedUrlItem[] = [];

  for (const line of lines) {
    const url = extractUrl(line);
    if (!url) continue;

    const isDup = existingUrls.has(url) || seenInBatch.has(url);
    if (isDup && skipDuplicates) continue;

    seenInBatch.add(url);

    const source = detectSource(url);
    const epMatch = line.match(/(?:ep(?:isode)?|ep\.?)\s*[-:_]?\s*(\d{1,4})/i);
    const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : null;

    const label = extractLabel(line, url);

    results.push({
      url,
      label,
      episode_number: episodeNumber,
      source,
      duplicate: isDup,
    });
  }

  return results;
}

function extractUrl(line: string): string | null {
  const urlMatch = line.match(/https?:\/\/[^\s,]+/i);
  if (urlMatch) return urlMatch[0];

  if (/^@[\w_]{3,}/.test(line)) {
    const parts = line.split(/\s+/);
    return `https://t.me/${parts[0].substring(1)}`;
  }

  if (/^t\.me\//.test(line)) {
    return `https://${line.split(/\s+/)[0]}`;
  }

  return null;
}

function extractLabel(line: string, url: string): string {
  let label = line.replace(url, '').trim();
  label = label.replace(/https?:\/\/[^\s,]+/i, '').trim();

  if (!label) {
    const tgMatch = url.match(/t\.me\/(?:c\/\d+\/|([\w_]+)\/)?(\d+)/);
    if (tgMatch) {
      const group = tgMatch[1] || 'private';
      const msgId = tgMatch[2];
      return `${group}/${msgId}`;
    }
    return url;
  }

  return label;
}

function detectSource(url: string): ParsedUrlItem['source'] {
  if (/t\.me|telegram\.org/.test(url)) return 'telegram';
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  return 'other';
}

export function getSourceIcon(source: ParsedUrlItem['source']): string {
  switch (source) {
    case 'telegram': return 'TG';
    case 'youtube': return 'YT';
    default: return 'LINK';
  }
}

export function getSourceColor(source: ParsedUrlItem['source']): string {
  switch (source) {
    case 'telegram': return 'text-accent-400 bg-accent-500/10';
    case 'youtube': return 'text-error-400 bg-error-500/10';
    default: return 'text-dark-400 bg-dark-700';
  }
}
