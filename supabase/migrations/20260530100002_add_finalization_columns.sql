-- Phase A: add provenance + finalization columns to all 4 daily tables.
-- 'source' enum (text-encoded, not Postgres ENUM to allow future values):
--   'live_tick' | 'daily_reconcile' | 'weekly_reconcile' | 'backfill' | 'manual_override'
-- See: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE campaigns_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE ads_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE products_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;
