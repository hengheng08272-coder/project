-- Classroom tools for a teacher's Telegram group (backend: classroom.js):
-- the student roster, tag settings, "✅ seen" checks and repeating auto
-- messages. Keyed by Telegram chat/user ids, not Supabase Auth; only the
-- backend's service-role client touches them, so RLS is on with no policies.

create table if not exists public.class_members (
  chat_id bigint not null,
  user_id bigint not null,
  first_name text,
  username text,
  -- Optional team/class name from /join A, for /tagteam.
  team text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.class_settings (
  chat_id bigint primary key,
  -- Names mentioned in one message, and seconds between messages.
  per_message integer not null default 5,
  gap_seconds integer not null default 4,
  updated_at timestamptz not null default now()
);

create table if not exists public.class_checks (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  text text not null,
  created_by bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.class_check_marks (
  check_id uuid not null references public.class_checks (id) on delete cascade,
  user_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (check_id, user_id)
);

create table if not exists public.class_autos (
  id uuid primary key default gen_random_uuid(),
  -- The number teachers type in /autostop.
  short_id bigint generated always as identity,
  chat_id bigint not null,
  text text not null,
  -- How many times to send (0 = until stopped), and every how many minutes.
  times integer not null default 1,
  every_minutes numeric not null,
  tag boolean not null default false,
  team text,
  sent_count integer not null default 0,
  next_at timestamptz not null default now(),
  active boolean not null default true,
  created_by bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists class_autos_due_idx on public.class_autos (next_at) where active;

alter table public.class_members enable row level security;
alter table public.class_settings enable row level security;
alter table public.class_checks enable row level security;
alter table public.class_check_marks enable row level security;
alter table public.class_autos enable row level security;
