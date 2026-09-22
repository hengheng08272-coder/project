-- Lets a group opt into the worker automatically re-scanning it on its own
-- schedule (see AUTO_RESCAN_MINUTES), instead of only ever picking up new
-- episodes when someone clicks "Scan" by hand.
alter table public.groups
  add column if not exists auto_rescan boolean not null default false;
