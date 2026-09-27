/*
  # Watch: per-topic sale metadata (not yet applied)

  The bot's "🎬 Watch" feature (project1/src/watch.js) needs a few things
  `topics` doesn't have yet -- kind (genre), on-sale status, a poster and a
  per-episode price -- to sell episodes one at a time inside the Telegram
  bot. This service's Supabase MCP connection currently can't reach this
  project to apply it, so watch.js keeps the same fields as one JSON file
  in Storage (bucket "watch-catalog") instead, in the meantime.

  Run this migration once this project is reachable again, then have
  watch.js read/write these columns directly and retire the JSON file.
*/

alter table public.topics
  add column if not exists kind text check (kind is null or kind in ('anime', 'donghua', 'movie')),
  add column if not exists status text not null default 'ongoing' check (status in ('ongoing', 'completed')),
  add column if not exists poster_emoji_id text,
  add column if not exists ep_credits integer not null default 1 check (ep_credits > 0),
  add column if not exists on_sale boolean not null default true;

create table if not exists public.watch_purchases (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  credits_spent integer not null default 1,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, episode_id)
);

create index if not exists watch_purchases_user_idx on public.watch_purchases (telegram_user_id);

alter table public.bot_users
  add column if not exists watch_credits integer not null default 0;

-- RLS: service-role only, same as the other bot_* tables (no anon/authenticated policies).
alter table public.watch_purchases enable row level security;
