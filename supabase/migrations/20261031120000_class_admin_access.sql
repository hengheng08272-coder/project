-- Lets the web app's "Bot Groups" page show the bot's groups to admins
-- (profiles.is_admin), straight from the browser session. Read-only, except
-- that an admin may stop an auto message or a lesson schedule. Everything
-- else is still written only by the backend's service-role client.

do $$
declare
  t text;
begin
  foreach t in array array[
    'class_members', 'class_settings', 'class_checks', 'class_check_marks', 'class_autos',
    'class_teachers', 'class_lessons', 'class_lesson_reads', 'class_quizzes', 'class_quiz_answers'
  ]
  loop
    execute format('drop policy if exists "admins read %1$s" on public.%1$I', t);
    execute format(
      'create policy "admins read %1$s" on public.%1$I for select to authenticated
         using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true))',
      t
    );
  end loop;
end $$;

drop policy if exists "admins stop class_autos" on public.class_autos;
create policy "admins stop class_autos" on public.class_autos for update to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));

drop policy if exists "admins update class_settings" on public.class_settings;
create policy "admins update class_settings" on public.class_settings for update to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true));
