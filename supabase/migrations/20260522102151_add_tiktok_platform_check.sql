-- DESTRUCTIVE: drops the two-value CHECK constraints on ads_daily,
-- campaigns_daily, and manual_overrides so they can be replaced with
-- three-value constraints that include 'tiktok'. The drop is required
-- because Postgres CHECK constraints can't be widened in-place — you
-- have to drop and re-add.

-- 2026-05-22 — Add 'tiktok' to the platform CHECK constraints on
-- ads_daily, campaigns_daily, and manual_overrides.
--
-- WHY: Phase 05.7.7 wired TikTok ad insights through cronDaily
-- (cronDaily.ts:611-640 + cronDaily.ts:687-710). The writer upserts
-- platform='tiktok' rows into ads_daily and campaigns_daily, but the
-- migration that added the original CHECK constraints
-- (20260521075741_add_constraints_and_grants.sql:71-73) hard-coded the
-- allowed values to ('meta', 'google'). The first cron-daily run after
-- TikTok creds were active failed with
--   new row for relation "ads_daily" violates check constraint "ads_daily_platform_check"
-- — silently zeroing every TikTok writer's effect.
--
-- WHAT: Drop the old 2-value constraint and replace with a 3-value one
-- across all three tables. manual_overrides is included pre-emptively so
-- the operator console can record TikTok manual overrides without a
-- follow-up migration.
--
-- IDEMPOTENT: Uses DROP IF EXISTS so re-applying the migration is safe.

ALTER TABLE ads_daily
  DROP CONSTRAINT IF EXISTS ads_daily_platform_check;
ALTER TABLE ads_daily
  ADD CONSTRAINT ads_daily_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok'));

ALTER TABLE campaigns_daily
  DROP CONSTRAINT IF EXISTS campaigns_daily_platform_check;
ALTER TABLE campaigns_daily
  ADD CONSTRAINT campaigns_daily_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok'));

ALTER TABLE manual_overrides
  DROP CONSTRAINT IF EXISTS manual_overrides_platform_check;
ALTER TABLE manual_overrides
  ADD CONSTRAINT manual_overrides_platform_check
  CHECK (platform IN ('meta', 'google', 'tiktok'));
