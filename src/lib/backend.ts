import { supabase } from '@/lib/supabase';
import type { PaymentSubmission } from '@/lib/types';

const BACKEND_URL = import.meta.env.VITE_TELEGRAM_BACKEND_URL as string | undefined;
const BACKEND_KEY = import.meta.env.VITE_TELEGRAM_BACKEND_KEY as string | undefined;

export const backendConfigured = Boolean(BACKEND_URL);

/**
 * Calls the userbot/storage backend. Every endpoint is a POST with a JSON
 * body and an API key header, so a single helper covers them all.
 */
export async function callBackend<T = Record<string, unknown>>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!BACKEND_URL) {
    throw new Error('Backend URL is not configured (VITE_TELEGRAM_BACKEND_URL).');
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BACKEND_KEY || '',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'Request to backend failed.');
  }
  return data as T;
}

export interface TelegramLoginResult {
  /** The synthetic email the Telegram account is signed in as -- opaque, not shown to the user. */
  email: string;
  /** A one-time token; the caller exchanges it via supabase.auth.verifyOtp({token_hash, type: 'magiclink'}). */
  token_hash: string;
}

/**
 * Hands the signed payload from the Telegram Login Widget to the backend for
 * verification, and gets back a one-time token to trade for a real Supabase
 * session. Unauthenticated on purpose -- this is how a visitor gets a
 * session in the first place -- so it works even before backendConfigured's
 * usual x-api-key would apply.
 */
export function telegramLogin(payload: Record<string, unknown>) {
  return callBackend<TelegramLoginResult>('/api/auth/telegram-login', payload);
}

/** The Mini App equivalent of {@link telegramLogin}, for the app opened inside Telegram's own WebView. */
export function telegramMiniAppLogin(initData: string) {
  return callBackend<TelegramLoginResult>('/api/auth/telegram-miniapp', { init_data: initData });
}

export interface ResolvedGroupInfo {
  title: string;
  username: string | null;
  is_forum: boolean;
  participants_count?: number;
  topics?: { topic_id: string; title: string }[];
}

/** Looks a Telegram chat up by ID so the UI can confirm it before using it. */
export async function resolveGroup(chatId: string): Promise<ResolvedGroupInfo> {
  const result = await callBackend<{
    title: string;
    username?: string | null;
    is_forum?: boolean;
    participants_count?: number;
    topics?: { topic_id: string; title: string }[];
  }>('/api/telegram/groups/resolve', { chat_id: chatId });
  return {
    title: result.title,
    username: result.username ?? null,
    is_forum: !!result.is_forum,
    participants_count: result.participants_count,
    topics: result.topics,
  };
}

/** Asks the backend to start working a forward job that was just created. */
export function startForwardJob(jobId: string) {
  return callBackend(`/api/telegram/forward/${jobId}/start`);
}

export interface R2TestResult {
  bucket?: string;
  object_count?: number;
  total_bytes?: number;
}

/** Verifies the stored R2 credentials really can reach the bucket. */
export function testR2Connection() {
  return callBackend<R2TestResult>('/api/r2/test');
}

export interface R2UploadResult {
  key: string;
  /** Null when no public URL is configured on the bucket -- the file is in R2, but not reachable. */
  url: string | null;
  size: number | null;
}

/**
 * Sends a video straight from the browser to the backend, which streams it on
 * into R2 and answers with the public URL. XHR rather than fetch(), because
 * only XHR reports upload progress, and a video is big enough to need a bar.
 */
export function uploadToR2(
  file: File,
  options: {
    /** A full, readable object key (e.g. "naruto/season-1/EP007.mp4"). Takes priority over `folder`. */
    key?: string;
    folder?: string;
    /**
     * When set, the backend also files this upload as an episode (see
     * library.js) so it shows up in Groups/Downloads next to videos pulled
     * from Telegram -- grouped by show, sorted by episode number.
     */
    show?: string;
    season?: string;
    episode?: number;
    label?: string;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<R2UploadResult> {
  return new Promise((resolve, reject) => {
    if (!BACKEND_URL) {
      reject(new Error('Backend URL is not configured (VITE_TELEGRAM_BACKEND_URL).'));
      return;
    }
    const query = new URLSearchParams({ name: file.name });
    if (options.key) query.set('key', options.key);
    else query.set('folder', options.folder || 'uploads');
    if (options.show) query.set('show', options.show);
    if (options.season) query.set('season', options.season);
    if (options.episode !== undefined) query.set('episode', String(options.episode));
    if (options.label) query.set('label', options.label);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND_URL}/api/r2/upload?${query}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-api-key', BACKEND_KEY || '');

    xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded, e.total || file.size);
    xhr.onerror = () => reject(new Error('The upload could not reach the backend.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.onload = () => {
      let data: Partial<R2UploadResult> & { error?: string; success?: boolean } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300 || data.success === false) {
        reject(new Error(data.error || `Upload failed (HTTP ${xhr.status}).`));
        return;
      }
      resolve({ key: data.key || '', url: data.url ?? null, size: data.size ?? file.size });
    };

    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export interface R2Object {
  key: string;
  size: number;
  last_modified: string | null;
  url: string | null;
}

/** Lists what is really in the bucket under a prefix, newest first. */
export function listR2Objects(prefix = '', limit = 100) {
  return callBackend<{ bucket: string; objects: R2Object[]; total: number }>('/api/r2/objects', {
    prefix,
    limit,
  });
}

/** Removes one object from the bucket. */
export function deleteR2Object(key: string) {
  return callBackend('/api/r2/delete', { key });
}

/**
 * A URL that, opened directly (an <a href>, not fetch), makes the browser
 * save the object to the device -- the backend streams it through with
 * Content-Disposition: attachment, so this works even when the bucket has no
 * public URL configured at all. Returns '' when no backend is configured.
 */
export function r2DownloadUrl(key: string, filename?: string): string {
  if (!BACKEND_URL) return '';
  const params = new URLSearchParams({ key });
  if (BACKEND_KEY) params.set('api_key', BACKEND_KEY);
  if (filename) params.set('filename', filename);
  return `${BACKEND_URL}/api/r2/download?${params.toString()}`;
}

/**
 * A still preview of an episode's video -- fetched from Telegram's own
 * message thumbnail and cached to R2 on first request -- so it can be shown
 * before the episode is actually downloaded. Returns '' when no backend is
 * configured; the caller falls back to a generic file icon in that case.
 */
export function episodeThumbnailUrl(episodeId: string): string {
  if (!BACKEND_URL) return '';
  const params = new URLSearchParams();
  if (BACKEND_KEY) params.set('api_key', BACKEND_KEY);
  const query = params.toString();
  return `${BACKEND_URL}/api/episodes/${episodeId}/thumbnail${query ? `?${query}` : ''}`;
}

/**
 * The equivalent of {@link r2DownloadUrl} for an episode archived to a
 * Telegram storage channel instead of R2 -- the backend re-fetches it from
 * Telegram on every call, since there is no static URL for it.
 */
export function telegramStorageDownloadUrl(chatId: string, messageId: number, filename?: string): string {
  if (!BACKEND_URL) return '';
  const params = new URLSearchParams({ chat_id: chatId, message_id: String(messageId) });
  if (BACKEND_KEY) params.set('api_key', BACKEND_KEY);
  if (filename) params.set('filename', filename);
  return `${BACKEND_URL}/api/telegram-storage/download?${params.toString()}`;
}

/** Verifies the stored source-S3 credentials really can reach that bucket. */
export function testS3SourceConnection() {
  return callBackend<R2TestResult>('/api/s3source/test');
}

export interface S3SourceObject {
  key: string;
  size: number;
  last_modified: string | null;
}

/** Lists what is really in the source bucket under a prefix, newest first. */
export function listS3SourceObjects(prefix = '', limit = 100) {
  return callBackend<{ bucket: string; objects: S3SourceObject[]; total: number }>('/api/s3source/objects', {
    prefix,
    limit,
  });
}

export interface S3MigrationStatus {
  running: boolean;
  dry_run: boolean;
  prefix: string;
  started_at: string | null;
  finished_at: string | null;
  total: number;
  scanned: number;
  migrated: number;
  skipped: number;
  deleted: number;
  failed: number;
  bytes: number;
  errors: { key: string; error: string }[];
}

/**
 * Starts streaming every object from the source bucket into R2 (deleting it
 * from the source once confirmed there, unless deleteSource is false).
 * Answers as soon as the job is queued -- follow progress with
 * getS3MigrationStatus().
 */
export function startS3Migration(options: { prefix?: string; dryRun?: boolean; deleteSource?: boolean } = {}) {
  return callBackend<{ status: string }>('/api/s3import/run', {
    prefix: options.prefix ?? '',
    dry_run: options.dryRun ?? false,
    delete_source: options.deleteSource ?? true,
  });
}

/** The current or most recent migration run's counters, for a progress bar. */
export function getS3MigrationStatus() {
  return callBackend<S3MigrationStatus>('/api/s3import/status');
}

/**
 * Asks the service to fetch every URL in a list and stream it into R2. It
 * answers as soon as the work is queued -- the page follows the rows, which
 * carry the key and the public URL once each one lands.
 */
export function saveUrlListToR2(listId: string) {
  return callBackend<{ queued: number }>(`/api/urls/lists/${listId}/save`);
}

/** The same, for the items that were ticked rather than a whole list. */
export function saveUrlItemsToR2(itemIds: string[]) {
  return callBackend<{ queued: number }>('/api/urls/items/save', { item_ids: itemIds });
}

/**
 * Checks a URL is a public, fetchable address before it's added to a list --
 * the same check the service itself runs before ever touching a saved URL,
 * just surfaced early so a typo or a dead link shows up immediately instead
 * of only after "Save to R2" fails.
 */
export function checkUrl(url: string) {
  return callBackend<{ success: boolean }>('/api/urls/check', { url });
}

export interface ResolvedPageUrl {
  title: string | null;
  url: string;
  referer: string;
}

/**
 * Resolves an ordinary "watch this episode" webpage to the raw .m3u8/media
 * URL actually playing on it, via yt-dlp -- the same link someone would
 * otherwise have to find by hand in the browser's DevTools Network tab.
 * Nothing is downloaded; this only extracts the URL.
 */
export function resolvePageUrl(url: string, referer?: string) {
  return callBackend<ResolvedPageUrl>('/api/urls/resolve', { url, referer: referer || '' });
}

export interface BackendHealth {
  telegram: boolean;
  r2: boolean;
  takeout: boolean;
}

/**
 * Liveness probe. Unlike every other call this is a GET and needs no API key,
 * so the UI can poll it to show whether the userbot service is up.
 */
export async function checkHealth(): Promise<BackendHealth> {
  if (!BACKEND_URL) throw new Error('Backend URL is not configured.');
  const res = await fetch(`${BACKEND_URL}/health`);
  if (!res.ok) throw new Error('The userbot service did not respond.');
  const data = await res.json();
  return {
    telegram: Boolean(data.telegram),
    r2: Boolean(data.r2),
    takeout: Boolean(data.takeout),
  };
}

/** Lists the groups the userbot is a member of, so a chat ID need not be typed. */
export function listDialogs() {
  return callBackend<{ dialogs: DialogInfo[] }>('/api/telegram/dialogs');
}

export interface DialogInfo {
  chat_id: string;
  title: string;
  username: string | null;
  is_forum: boolean;
  participants_count: number | null;
}

/** Joins a public group or an invite link, then returns the group it resolved to. */
export function joinChat(invite: string) {
  return callBackend<ResolvedGroupInfo & { chat_id: string }>('/api/telegram/join', { invite });
}

export interface PublicChatResult {
  chat_id: string;
  title: string;
  username: string | null;
  is_channel: boolean;
  is_megagroup: boolean;
  participants_count: number | null;
  /** True/false when known, undefined when Telegram didn't report membership for this kind of chat. */
  already_joined?: boolean;
}

/** Searches Telegram's public directory by keyword -- groups/channels not yet joined included. */
export function searchPublicChats(query: string, limit = 20) {
  return callBackend<{ results: PublicChatResult[] }>('/api/telegram/groups/search', { query, limit });
}

/** Sends a short message to the userbot's own Saved Messages. */
export function notifySelf(text: string) {
  return callBackend('/api/telegram/notify', { text });
}

/** Asks the service to create the destination topics and queue every job. */
export function prepareMirror(mirrorId: string) {
  return callBackend(`/api/telegram/mirror/${mirrorId}/prepare`);
}

/** Stops a mirror and every job it spawned. */
export function cancelMirror(mirrorId: string) {
  return callBackend(`/api/telegram/mirror/${mirrorId}/cancel`);
}

export interface TakeoutResult {
  success: boolean;
  already_active?: boolean;
  was_active?: boolean;
  takeout_id?: string;
}

/**
 * Starts Telegram's Takeout mode: an official bulk-export session that
 * relaxes flood limits, at the cost of needing a one-time confirmation from
 * another signed-in device (or a wait Telegram itself imposes) the first
 * time it's used. See Settings › Telegram for the full explanation shown to
 * the operator before they turn this on.
 */
export function startTakeout() {
  return callBackend<TakeoutResult>('/api/telegram/takeout/start');
}

/** Ends the active takeout session; downloads and forwards go back to normal. */
export function stopTakeout(success = true) {
  return callBackend<TakeoutResult>('/api/telegram/takeout/stop', { success });
}

// ------------------------------------------------------------ subscriptions
//
// These routes are gated by the caller's own Supabase session (requireUser/
// requireAdmin in server.js), not the shared x-api-key every call above
// uses -- callBackend can't be reused here, since it always sends that key
// and never the caller's own JWT.

async function callAuthedBackend<T = Record<string, unknown>>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!BACKEND_URL) {
    throw new Error('Backend URL is not configured (VITE_TELEGRAM_BACKEND_URL).');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Request to backend failed.');
  }
  return json as T;
}

/** Creates a pending payment claim for the signed-in subscriber. */
export function submitPaymentClaim(tier: string) {
  return callAuthedBackend<{ submission: PaymentSubmission }>('/api/subscription/submit', { tier });
}

/** Attaches an uploaded screenshot to the caller's own pending claim. */
export function attachPaymentScreenshot(submissionId: string, screenshotUrl: string) {
  return callAuthedBackend<{ submission: PaymentSubmission }>('/api/subscription/attach-screenshot', {
    submission_id: submissionId,
    screenshot_url: screenshotUrl,
  });
}

/** Abandons the caller's own pending claim (e.g. switching plans). */
export function cancelPaymentClaim(submissionId: string) {
  return callAuthedBackend('/api/subscription/cancel', { submission_id: submissionId });
}

export interface SubscriptionStatusResult {
  subscribed: boolean;
  tier: string | null;
  capability: 'basic' | 'pro' | null;
  expiresAt: string | null;
}

/** The signed-in subscriber's own current plan/expiry. */
export function getSubscriptionStatus() {
  return callAuthedBackend<SubscriptionStatusResult>('/api/subscription/status');
}

/** Admin: approves a pending payment claim (same effect as the Telegram button). */
export function approvePayment(submissionId: string) {
  return callAuthedBackend(`/api/admin/payments/${submissionId}/approve`);
}

/** Admin: rejects a pending payment claim. */
export function rejectPayment(submissionId: string, note?: string) {
  return callAuthedBackend(`/api/admin/payments/${submissionId}/reject`, { note });
}
