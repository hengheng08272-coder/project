-- Lets an admin create an auto message from the web app's "Bot Groups" page
-- (how many times, every how many minutes). The backend's worker picks the
-- row up at next_at and sends it, same as one made with /auto in Telegram.

drop policy if exists "admins create class_autos" on public.class_autos;
create policy "admins create class_autos" on public.class_autos for insert to authenticated
  with check (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true)
    and times >= 0
    and every_minutes > 0
    and sent_count = 0
    and length(text) between 1 and 4000
  );
