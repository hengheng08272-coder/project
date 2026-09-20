-- Usage counter for the "paste a Telegram link, get it downloaded" bot flow.
-- Keyed by the requester's Telegram user id (there is no app login in this
-- flow at all), so this is deliberately outside the Supabase Auth / RLS
-- world the rest of the schema lives in -- only the backend's service-role
-- client ever touches it.
create table if not exists public.bot_link_downloads (
  telegram_user_id bigint primary key,
  free_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bot_link_downloads enable row level security;
-- No policies: this table is written only by the backend's service-role
-- client (which bypasses RLS entirely), never by a client-side session.
