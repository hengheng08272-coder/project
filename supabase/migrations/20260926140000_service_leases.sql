-- One holder at a time for the Telegram userbot session.
--
-- Telegram invalidates a session the moment the same auth key is connected
-- from two places ("AuthKeyDuplicated ... the current session was
-- invalidated"). A Railway deploy starts the new container before stopping
-- the old one, so without coordination both connect for a few seconds and
-- the session dies -- which is what kept signing the userbot out.
--
-- A lease is a row that says who may connect, and until when. A process
-- takes it before opening any Telegram connection, renews it while running,
-- and drops it on shutdown; a crashed holder's lease simply runs out. The
-- new container therefore waits for the old one to let go instead of
-- colliding with it.

create table if not exists public.service_leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null
);

alter table public.service_leases enable row level security;

-- Takes or renews a lease. Atomic, because a single INSERT ... ON CONFLICT
-- DO UPDATE ... WHERE either wins the row or does nothing: two processes
-- racing for a free lease cannot both be told they have it.
create or replace function public.acquire_lease(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  won boolean;
begin
  insert into service_leases as l (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.holder = excluded.holder or l.expires_at < now()
  returning true into won;
  return coalesce(won, false);
end;
$$;

-- Lets go, but only of a lease this holder still owns.
create or replace function public.release_lease(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from service_leases where name = p_name and holder = p_holder;
$$;

-- Only the backend's service-role client calls these.
revoke all on function public.acquire_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_lease(text, text) from public, anon, authenticated;
