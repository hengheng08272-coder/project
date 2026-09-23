/*
# Multiple Telegram accounts

## Purpose
The app supported exactly one userbot session (telegram_settings, a
single-row table). This adds telegram_accounts -- any number of extra
Telegram accounts, each with its own api_id/api_hash/phone/session --
and lets a group be scanned/downloaded/forwarded through one of them
instead of always the original single account.

## Design
- telegram_settings stays exactly as-is: it remains "the default account"
  and every group with account_id = null keeps using it, unchanged. This
  is what makes the change backward compatible -- an app that never adds
  a second account behaves identically to before.
- telegram_accounts holds only the *additional* accounts. Its shape
  mirrors telegram_settings so the backend can treat both the same way
  once it has resolved which row to read.
- groups.account_id is nullable and points at telegram_accounts; null
  means "use the default account" (telegram_settings), same as every
  existing group has always implicitly meant.
*/

CREATE TABLE IF NOT EXISTS telegram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'Account',
  api_id text,
  api_hash text,
  phone text,
  session_string text,
  connected boolean NOT NULL DEFAULT false,
  last_connected_at timestamptz,
  account_first_name text,
  account_last_name text,
  account_username text,
  account_user_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE telegram_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_tg_accounts" ON telegram_accounts;
CREATE POLICY "anon_read_tg_accounts" ON telegram_accounts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_tg_accounts" ON telegram_accounts;
CREATE POLICY "anon_insert_tg_accounts" ON telegram_accounts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tg_accounts" ON telegram_accounts;
CREATE POLICY "anon_update_tg_accounts" ON telegram_accounts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_tg_accounts" ON telegram_accounts;
CREATE POLICY "anon_delete_tg_accounts" ON telegram_accounts FOR DELETE TO anon, authenticated USING (true);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES telegram_accounts(id) ON DELETE SET NULL;
COMMENT ON COLUMN groups.account_id IS 'Which Telegram account scans/downloads this group. Null = the default account (telegram_settings).';
