/*
# One episode row per Telegram message

Overlapping scans of the same group (a second Scan click while a long
full-history scan was still running, or the auto-rescan tick) each saw a
message as "new" and inserted it again -- the same video ended up listed
up to 15 times. Keep one row per (group, message), preferring one already
saved to R2/Telegram storage, then a completed one, then the oldest, and
let the database refuse any further copy. Rows with no message_id
(URL-list/manual uploads) are unaffected: NULLs never conflict.
*/

lock table episodes in share row exclusive mode;

delete from episodes e
using (
  select id, row_number() over (
    partition by group_id, message_id
    order by (r2_key is not null or tg_storage_message_id is not null) desc,
             (status = 'completed') desc,
             created_at asc, id asc
  ) as rn
  from episodes where message_id is not null
) r
where e.id = r.id and r.rn > 1;

create unique index if not exists episodes_group_message_unique
  on episodes (group_id, message_id);
