-- Phase 05.7.6 — Add data_daily.updated_at with auto-update trigger.
--
-- Reason (2026-05-22): the dashboard had no way to surface "when was
-- this data last refreshed?". Users asked "is this live?" — without a
-- visible last-update timestamp, the only answer was "trust the cron".
-- This migration adds a column + trigger so every INSERT/UPDATE on
-- data_daily timestamps itself, and the dashboard can render the chip
-- "עודכן לפני X דק׳" in the header.
--
-- Sibling tables (stores, dashboard_state, manual_overrides,
-- notification_config) already have updated_at NOT NULL DEFAULT NOW().
-- data_daily was the exception because it's a hot-write table — but the
-- write rate (3 stores × cron-live every 15 min ≈ 12/hour) is trivial
-- compared to even one user request, so a trigger here costs nothing.
--
-- Trigger pattern: BEFORE INSERT OR UPDATE — guarantees the column is
-- correctly set regardless of which writer (cronDaily, cronLive,
-- eventSyncNow, eventBackfill) emits the row. App-level writers do NOT
-- need to be touched.

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION data_daily_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_data_daily_updated_at ON data_daily;
CREATE TRIGGER trg_data_daily_updated_at
  BEFORE INSERT OR UPDATE ON data_daily
  FOR EACH ROW
  EXECUTE FUNCTION data_daily_set_updated_at();

COMMENT ON COLUMN data_daily.updated_at IS
  'Timestamp of last write (INSERT or UPDATE). Set by trigger trg_data_daily_updated_at — writers do NOT need to set explicitly. Phase 05.7.6 2026-05-22.';
