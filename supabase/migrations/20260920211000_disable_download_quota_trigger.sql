/*
  Subscription enforcement is turned off in the app for now (App.tsx's
  SUBSCRIPTION_ENFORCED flag), so nobody creates a `subscriptions` row
  anymore -- which means every logged-in user's very first download would
  hit this trigger's "No active subscription" exception and fail outright.

  Drop only the trigger, not the function or the `download_usage` table:
  re-creating `enforce_download_quota_trigger` (see
  20260913163000_download_quota.sql for the exact CREATE TRIGGER statement)
  is all that's needed to bring quota enforcement back alongside flipping
  SUBSCRIPTION_ENFORCED back to true.
*/

DROP TRIGGER IF EXISTS enforce_download_quota_trigger ON downloads;
