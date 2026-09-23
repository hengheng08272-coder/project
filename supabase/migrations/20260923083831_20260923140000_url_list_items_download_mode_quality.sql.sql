/*
# Add download_mode and quality_pref to url_list_items

1. Purpose
   Lets each URL-list item choose how it is downloaded and at what quality,
   turning the tool into a "god of download" that handles .ts segments,
   HLS playlists, and direct files with fine-grained control.

2. New Columns on `url_list_items`
   - `download_mode` (text, default 'auto'):
       'auto'       – the backend decides: direct fetch for plain files,
                       yt-dlp for everything else (current behavior).
       'ytdlp'      – always use yt-dlp (HLS/HLS/.ts segments, embedded
                       players, geo-restricted streams).
       'direct'     – always plain HTTP fetch (fastest for a real .mp4/.ts
                       single file on a CDN).
   - `quality_pref` (text, default 'best'):
       'best'       – bestvideo+bestaudio merged to mp4 (current).
       '720p'       – up to 720p.
       '1080p'      – up to 1080p.
       'audio_only' – extract audio only (m4a).

3. Security
   No new tables. Existing RLS policies on url_list_items are unchanged.
*/

ALTER TABLE url_list_items
  ADD COLUMN IF NOT EXISTS download_mode text NOT NULL DEFAULT 'auto';

ALTER TABLE url_list_items
  ADD COLUMN IF NOT EXISTS quality_pref text NOT NULL DEFAULT 'best';
