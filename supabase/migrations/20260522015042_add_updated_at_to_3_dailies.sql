-- Phase 05.7.6 follow-up — Add updated_at + trigger to the 3 sibling daily tables.
--
-- Reason (2026-05-22): the dashboard's per-tab freshness chip needs a
-- last-write timestamp on each table its API consumes. data_daily got
-- this in migration 20260522010146 (Phase 1). This migration extends the
-- same pattern to:
--   - campaigns_daily — consumed by /api/campaigns → campaigns tab
--   - products_daily  — consumed by /api/products  → products tab
--   - ads_daily       — consumed by /api/ads       → ads tab
--
-- Trigger pattern is identical to data_daily: BEFORE INSERT OR UPDATE,
-- writes NOW() to updated_at on every UPSERT. App-level writers do NOT
-- need to be touched.

ALTER TABLE campaigns_daily
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE products_daily
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE ads_daily
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- One shared trigger function (returns NEW, sets updated_at to NOW()).
-- data_daily already has its own function `data_daily_set_updated_at` from
-- the prior migration; we keep this generic one for the 3 siblings so a
-- future table can also reuse it.
CREATE OR REPLACE FUNCTION set_updated_at_to_now()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_daily_updated_at ON campaigns_daily;
CREATE TRIGGER trg_campaigns_daily_updated_at
  BEFORE INSERT OR UPDATE ON campaigns_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_to_now();

DROP TRIGGER IF EXISTS trg_products_daily_updated_at ON products_daily;
CREATE TRIGGER trg_products_daily_updated_at
  BEFORE INSERT OR UPDATE ON products_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_to_now();

DROP TRIGGER IF EXISTS trg_ads_daily_updated_at ON ads_daily;
CREATE TRIGGER trg_ads_daily_updated_at
  BEFORE INSERT OR UPDATE ON ads_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_to_now();

COMMENT ON COLUMN campaigns_daily.updated_at IS 'Last write timestamp (trigger-managed). Phase 05.7.6 2026-05-22.';
COMMENT ON COLUMN products_daily.updated_at  IS 'Last write timestamp (trigger-managed). Phase 05.7.6 2026-05-22.';
COMMENT ON COLUMN ads_daily.updated_at       IS 'Last write timestamp (trigger-managed). Phase 05.7.6 2026-05-22.';
