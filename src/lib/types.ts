export interface TelegramSettings {
  id: string;
  api_id: string | null;
  api_hash: string | null;
  phone: string | null;
  session_string: string | null;
  connected: boolean;
  last_connected_at: string | null;
  account_first_name: string | null;
  account_last_name: string | null;
  account_username: string | null;
  account_user_id: string | null;
  /** The private channel/group the userbot forwards into for a group set to the "telegram" storage backend. */
  storage_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface R2Settings {
  id: string;
  account_id: string | null;
  access_key_id: string | null;
  secret_access_key: string | null;
  bucket_name: string | null;
  endpoint_url: string | null;
  public_url: string | null;
  region: string;
  connected: boolean;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A second, independent S3-compatible bucket -- browsed and optionally migrated into R2. */
export interface S3SourceSettings {
  id: string;
  endpoint_url: string | null;
  access_key_id: string | null;
  secret_access_key: string | null;
  bucket_name: string | null;
  region: string;
  force_path_style: boolean;
  connected: boolean;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  chat_id: string;
  title: string;
  username: string | null;
  is_forum: boolean;
  active: boolean;
  total_episodes: number;
  downloaded_episodes: number;
  last_scanned_at: string | null;
  /** Where future downloads of this group get archived -- R2 (default), or a Telegram storage channel (free, no bandwidth). */
  storage_backend: 'r2' | 'telegram';
  /** When true, the worker re-scans this group on its own every AUTO_RESCAN_MINUTES, so new episodes show up without a manual "Scan" click. */
  auto_rescan: boolean;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  group_id: string;
  topic_id: string | null;
  title: string;
  active: boolean;
  total_episodes: number;
  downloaded_episodes: number;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: string;
  group_id: string;
  topic_id: string | null;
  message_id: string | null;
  ep_number: number | null;
  title: string | null;
  file_name: string | null;
  file_size: number;
  duration: number;
  thumbnail_url: string | null;
  status: 'pending' | 'queued' | 'downloading' | 'completed' | 'failed' | 'skipped';
  r2_key: string | null;
  r2_url: string | null;
  media_type: 'video' | 'audio';
  mime_type: string | null;
  /** Set instead of r2_key/r2_url when this episode was archived to a Telegram storage channel. */
  tg_storage_chat_id: string | null;
  tg_storage_message_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Download {
  id: string;
  episode_id: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'paused' | 'cancelled';
  progress: number;
  speed_mbps: number;
  downloaded_bytes: number;
  total_bytes: number;
  r2_key: string | null;
  r2_url: string | null;
  error: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UrlList {
  id: string;
  title: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface UrlListItem {
  id: string;
  url_list_id: string;
  url: string;
  label: string | null;
  episode_number: number | null;
  /** Sent as the Referer header for a .m3u8 source that needs one to avoid a 403; ignored for a plain file URL. */
  referer: string | null;
  status: 'pending' | 'queued' | 'downloading' | 'completed' | 'failed';
  r2_key: string | null;
  r2_url: string | null;
  file_size: number | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AutoDownloadRule {
  id: string;
  group_id: string;
  topic_id: string | null;
  auto_ep_start: number | null;
  auto_ep_end: number | null;
  quality_filter: string | null;
  min_file_size_mb: number;
  forward_to_chat_id: string | null;
  forward_to_topic_id: string | null;
  forward_enabled: boolean;
  active: boolean;
  last_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadSettings {
  id: string;
  concurrent_downloads: number;
  speed_limit_mbps: number;
  auto_start: boolean;
  quality_pref: string;
  notify_on_complete: boolean;
  retry_on_fail: boolean;
  max_retries: number;
  r2_folder_pattern: string;
  auto_r2_upload: boolean;
  created_at: string;
  updated_at: string;
}

export interface ForwardTarget {
  id: string;
  chat_id: string;
  title: string;
  username: string | null;
  is_forum: boolean;
  verified: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CopyMode = 'auto' | 'forward' | 'reupload';

export interface GroupMirror {
  id: string;
  source_group_id: string;
  target_chat_id: string;
  target_title: string | null;
  create_topics: boolean;
  copy_mode: CopyMode;
  auto_follow: boolean;
  status: 'draft' | 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_topics: number;
  total_videos: number;
  error: string | null;
  prepared_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MirrorTopicMap {
  id: string;
  mirror_id: string;
  source_topic_id: string | null;
  target_topic_id: string | null;
  title: string;
  created_at: string;
}

export interface ForwardJob {
  id: string;
  source_group_id: string | null;
  source_topic_id: string | null;
  target_chat_id: string;
  target_title: string | null;
  target_topic_id: string | null;
  mirror_id: string | null;
  copy_mode: CopyMode;
  mode: 'selected' | 'topic';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_count: number;
  forwarded_count: number;
  failed_count: number;
  auto_follow: boolean;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ForwardJobItem {
  id: string;
  job_id: string;
  episode_id: string | null;
  status: 'pending' | 'forwarded' | 'failed' | 'skipped';
  forwarded_message_id: string | null;
  error: string | null;
  forwarded_at: string | null;
  created_at: string;
}

export type PageKey =
  | 'dashboard'
  | 'groups'
  | 'downloads'
  | 'urllists'
  | 'settings'
  | 'guide'
  | 'admin';

export type Capability = 'basic' | 'pro';

export interface PricingTier {
  key: string;
  capability: Capability;
  price: number;
  months: number;
  monthly_quota: number | null;
  label_km: string;
  label_en: string;
  pitch_km: string | null;
  pitch_en: string | null;
  active: boolean;
}

export interface SubscriptionRow {
  user_id: string;
  email: string | null;
  tier: string | null;
  capability: Capability | null;
  expires_at: string | null;
  updated_at: string;
}

export interface PaymentSubmission {
  id: string;
  user_id: string;
  email: string | null;
  tier: string;
  amount: number;
  screenshot_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  aba_trx_id: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
}
