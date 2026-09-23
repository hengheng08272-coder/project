-- Lets the URL Lists page show a live percentage while ytdlp.js downloads a
-- source (previously the row just said "downloading" with no way to tell
-- whether it was moving or stuck).
alter table public.url_list_items
  add column if not exists progress smallint;

comment on column public.url_list_items.progress is
  'yt-dlp download percentage (0-100) while status = downloading; null otherwise.';
