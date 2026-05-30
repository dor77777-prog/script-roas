-- supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
--
-- Phase D (2026-05-30) — AFTER INSERT triggers on the 2 source dailies
-- (campaigns_daily + ads_daily) that ensure registry parity within the
-- same transaction as the daily insert. Closes the 10-min orchestrator
-- gap for newly-spending entities.
--
-- Strict invariant: triggers ONLY insert missing registry rows. They do
-- NOT update existing ones. UPDATEs of *_daily do not fire them (triggers
-- are AFTER INSERT only). This guarantees we never clobber richer data
-- that Phase B/C workers have written.

-- ---------------------------------------------------------------------------
-- 1. ensure_campaign_and_adset_registry_rows
--    Fires AFTER INSERT ON campaigns_daily. Each row inserts BOTH the
--    campaign-level registry row AND the ad-set-level registry row, since
--    campaigns_daily rows are ad-set-granular (PK includes ad_set_id).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_campaign_and_adset_registry_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- (a) campaign_registry
  INSERT INTO campaign_registry (
    store_id, platform, campaign_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.campaign_name,
    'BACKFILL_UNKNOWN',
    NEW.effective_status,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN NEW.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN NEW.effective_status IN ('PENDING','PENDING_REVIEW') THEN 'PENDING_REVIEW'
      WHEN NEW.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN NEW.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED') THEN 'LIMITED'
      WHEN NEW.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END,
    -- is_enabled here is gated on effective_status because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;

  -- (b) adset_registry — same row, ad-set view.
  INSERT INTO adset_registry (
    store_id, platform, campaign_id, adset_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.ad_set_id, NEW.ad_set_name,
    'BACKFILL_UNKNOWN',
    NEW.effective_status,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN NEW.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN NEW.effective_status IN ('PENDING','PENDING_REVIEW') THEN 'PENDING_REVIEW'
      WHEN NEW.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN NEW.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED') THEN 'LIMITED'
      WHEN NEW.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END,
    -- is_enabled here is gated on effective_status because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, adset_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_daily_ensure_registry ON campaigns_daily;
CREATE TRIGGER campaigns_daily_ensure_registry
  AFTER INSERT ON campaigns_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_campaign_and_adset_registry_rows();

-- ---------------------------------------------------------------------------
-- 2. ensure_ad_registry_row — keys-only.
--    ads_daily has no effective_status column, so the registry row is
--    seeded with NULL status fields and configured_status =
--    'BACKFILL_UNKNOWN'. Phase B/C ad-level status workers fill the rest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ad_registry_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ad_registry (
    store_id, platform, campaign_id, adset_id, ad_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.ad_set_id, NEW.ad_id, NEW.ad_name,
    'BACKFILL_UNKNOWN',
    NULL::text,
    NULL::text,
    NULL::boolean,
    NULL::boolean,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, ad_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ads_daily_ensure_registry ON ads_daily;
CREATE TRIGGER ads_daily_ensure_registry
  AFTER INSERT ON ads_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_ad_registry_row();
