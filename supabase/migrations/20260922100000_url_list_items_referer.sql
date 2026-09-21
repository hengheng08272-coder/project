-- HLS (.m3u8) sources often need the page's own URL as a Referer header to
-- avoid a 403 from the CDN; m3u8fetch.js reads this when present.
alter table public.url_list_items
  add column if not exists referer text;
