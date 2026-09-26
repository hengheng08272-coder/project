-- Free + paid use of the menu bot.
--
-- Free use is what bot_users already tracks (BOT_FREE_DOWNLOADS plus
-- referral bonus_downloads). Paying adds either a block of extra downloads
-- (paid_downloads) or a stretch of unlimited use (premium_until).
--
-- Payment is a KHQR generated per order from the owner's own bank QR, with
-- the exact amount baked in -- the same approach as the telegrambot- app.
-- An order is confirmed either by Bakong's API (md5 of that exact QR) or by
-- the operator tapping Approve on the payer's screenshot.
--
-- Service-role only, like the other bot tables: RLS on, no policies.

alter table public.bot_users
  add column if not exists paid_downloads integer not null default 0,
  add column if not exists premium_until timestamptz;

create table if not exists public.bot_packages (
  id text primary key,
  title_km text not null,
  title_en text not null,
  price_usd numeric(10, 2) not null check (price_usd > 0),
  -- Exactly one of these: a block of downloads, or days of unlimited use.
  downloads integer check (downloads is null or downloads > 0),
  days integer check (days is null or days > 0),
  sort integer not null default 0,
  active boolean not null default true,
  check ((downloads is null) <> (days is null))
);

insert into public.bot_packages (id, title_km, title_en, price_usd, downloads, days, sort) values
  ('p30',   '30 ដង',              '30 downloads',         1.00, 30,   null, 1),
  ('p120',  '120 ដង',             '120 downloads',        3.00, 120,  null, 2),
  ('vip30', 'VIP 30 ថ្ងៃ មិនកំណត់', 'VIP 30 days unlimited', 5.00, null, 30,   3)
on conflict (id) do nothing;

create table if not exists public.bot_orders (
  id uuid primary key default gen_random_uuid(),
  -- Short, human-readable ticket number, shown to the payer and carried in
  -- the QR's bill-number field so one QR belongs to one order.
  ticket text not null unique,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  package_id text not null references public.bot_packages (id),
  amount_usd numeric(10, 2) not null,
  khqr text not null,
  -- md5 of the exact KHQR payload: what Bakong's API is asked about.
  khqr_md5 text not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'rejected', 'expired')),
  screenshot_file_id text,
  -- The bank's transaction hash, once Bakong confirms. Unique, so one
  -- payment can never be used to confirm two orders.
  bank_hash text unique,
  confirmed_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists bot_orders_pending_idx on public.bot_orders (status, created_at);
create index if not exists bot_orders_user_idx on public.bot_orders (telegram_user_id, created_at desc);

-- One row: the owner's bank QR the per-order QRs are built from.
create table if not exists public.bot_settings (
  id integer primary key default 1 check (id = 1),
  khqr_template text,
  updated_at timestamptz not null default now()
);
insert into public.bot_settings (id) values (1) on conflict (id) do nothing;

alter table public.bot_packages enable row level security;
alter table public.bot_orders enable row level security;
alter table public.bot_settings enable row level security;
