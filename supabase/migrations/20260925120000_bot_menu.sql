-- The menu bot: who is using it, and which link downloads belong to whom.
--
-- Like bot_link_downloads, both tables are keyed by a Telegram user id and
-- have nothing to do with Supabase Auth -- there is no app login in the bot
-- flow. Only the backend's service-role client touches them, so RLS is on
-- with no policies at all (which denies every client-side session).

create table if not exists public.bot_users (
  telegram_user_id bigint primary key,
  username text,
  first_name text,
  -- 'km' or 'en'; the bot answers in this language.
  language text not null default 'km',
  -- Who invited them (a /start ref_<id> payload), set once and never changed.
  referred_by bigint references public.bot_users (telegram_user_id) on delete set null,
  -- Extra downloads earned by referring other people.
  bonus_downloads integer not null default 0,
  blocked boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_users_referred_by_idx on public.bot_users (referred_by);

-- One row per link a bot user asked for. url_list_item_id is where the actual
-- download lives (the same pipeline the web app's link lists use), so this
-- table only has to remember who to send the result back to, and whether that
-- has happened yet.
create table if not exists public.bot_jobs (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  chat_id bigint not null,
  url_list_item_id uuid references public.url_list_items (id) on delete cascade,
  source_url text not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists bot_jobs_pending_idx on public.bot_jobs (notified, created_at);
create index if not exists bot_jobs_user_idx on public.bot_jobs (telegram_user_id, created_at desc);

alter table public.bot_users enable row level security;
alter table public.bot_jobs enable row level security;
