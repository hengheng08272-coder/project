-- Classroom lessons, scheduled lesson DMs, quizzes and moving a class to a
-- new group (backend: classroom.js). Service-role only, like the other
-- class_* tables: RLS on with no policies.

alter table public.class_settings
  add column if not exists title text,
  -- /autolesson: Cambodia-time HH:MM, every N days, next lesson number.
  add column if not exists lesson_time text,
  add column if not exists lesson_every_days integer not null default 1,
  add column if not exists lesson_next_pos integer not null default 1,
  add column if not exists lesson_next_at timestamptz,
  -- Set when /move carried this class into another group.
  add column if not exists moved_to bigint;

create index if not exists class_settings_lesson_due_idx
  on public.class_settings (lesson_next_at) where lesson_time is not null;

-- Group admins who have used the classroom commands; /move lists their classes.
create table if not exists public.class_teachers (
  chat_id bigint not null,
  user_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists class_teachers_user_idx on public.class_teachers (user_id);

-- A lesson keeps its text or Telegram file_id, so it can be re-sent even
-- after the group it was posted in is gone.
create table if not exists public.class_lessons (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  position integer not null,
  title text not null,
  -- text, photo, video, document, audio, voice or animation
  kind text not null,
  file_id text,
  text text,
  created_by bigint,
  created_at timestamptz not null default now(),
  unique (chat_id, position)
);

create table if not exists public.class_lesson_reads (
  lesson_id uuid not null references public.class_lessons (id) on delete cascade,
  user_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (lesson_id, user_id)
);

create index if not exists class_members_user_idx on public.class_members (user_id);

create table if not exists public.class_quizzes (
  poll_id text primary key,
  chat_id bigint not null,
  question text not null,
  correct_option integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.class_quiz_answers (
  poll_id text not null references public.class_quizzes (poll_id) on delete cascade,
  user_id bigint not null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.class_teachers enable row level security;
alter table public.class_lessons enable row level security;
alter table public.class_lesson_reads enable row level security;
alter table public.class_quizzes enable row level security;
alter table public.class_quiz_answers enable row level security;
