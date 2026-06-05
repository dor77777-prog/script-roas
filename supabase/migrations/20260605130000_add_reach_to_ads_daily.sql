-- DESTRUCTIVE: rebuild ads_enriched view (DROP VIEW + CREATE VIEW) to expose new ads_daily.reach — view is a query definition, zero data loss
-- supabase/migrations/20260605130000_add_reach_to_ads_daily.sql
--
-- Creative-fatigue frequency leg (2026-06-05).
-- Add ad-level daily reach (unique people) to ads_daily so the dashboard can
-- derive frequency = impressions / reach for the early-warning fatigue insight.
-- Meta + TikTok populate it; Google leaves it NULL (no per-user frequency on
-- Search/Shopping/PMax). Additive + nullable → no writer/reader breaks.

ALTER TABLE ads_daily ADD COLUMN IF NOT EXISTS reach BIGINT;

-- ads_enriched is `SELECT a.*` from ads_daily; the view's column list was frozen
-- at creation, so it must be rebuilt to surface the new column. DROP+CREATE
-- (not CREATE OR REPLACE) because a.* re-expansion places `reach` mid-list,
-- which CREATE OR REPLACE rejects. Body is identical to
-- 20260605120000_enriched_views_coalesce_name.sql (ads_enriched only).
DROP VIEW IF EXISTS ads_enriched;
CREATE VIEW ads_enriched AS
SELECT
  a.*,
  arr.configured_status        AS reg_configured_status,
  arr.effective_status         AS reg_effective_status,
  arr.delivery_status          AS reg_delivery_status,
  arr.is_enabled               AS reg_is_enabled,
  arr.is_serving               AS reg_is_serving,
  arr.first_seen_at            AS reg_first_seen_at,
  arr.last_seen_at             AS reg_last_seen_at,
  arr.status_changed_at        AS reg_status_changed_at,
  arr.last_status_success_at   AS reg_last_status_success_at,
  arr.last_metrics_success_at  AS reg_last_metrics_success_at,
  arr.missed_seen_count        AS reg_missed_seen_count,
  arr.is_removed               AS reg_is_removed,
  COALESCE(NULLIF(crr.name, ''), a.campaign_name)  AS reg_campaign_name,
  COALESCE(NULLIF(arr2.name, ''), a.ad_set_name)   AS reg_ad_set_name,
  COALESCE(NULLIF(arr.name, ''), a.ad_name)        AS reg_ad_name
FROM ads_daily a
LEFT JOIN ad_registry arr
  ON  arr.store_id = a.store_id
  AND arr.platform = a.platform
  AND arr.ad_id    = a.ad_id
LEFT JOIN campaign_registry crr
  ON  crr.store_id    = a.store_id
  AND crr.platform    = a.platform
  AND crr.campaign_id = a.campaign_id
LEFT JOIN adset_registry arr2
  ON  arr2.store_id = a.store_id
  AND arr2.platform = a.platform
  AND arr2.adset_id = a.ad_set_id;

GRANT SELECT ON ads_enriched TO anon;
