-- "Telegram as storage": a free alternative to R2, chosen per group. A group
-- set to "telegram" has its downloads forwarded server-side into a private
-- storage chat (Settings > Telegram) instead of being fetched and uploaded
-- to R2 -- no bandwidth through the backend, no R2 cost, but retrieval later
-- goes back through the userbot rather than a static URL.

alter table public.groups
  add column if not exists storage_backend text not null default 'r2'
  check (storage_backend in ('r2', 'telegram'));

alter table public.episodes
  add column if not exists tg_storage_chat_id text,
  add column if not exists tg_storage_message_id bigint;

alter table public.telegram_settings
  add column if not exists storage_chat_id text;
