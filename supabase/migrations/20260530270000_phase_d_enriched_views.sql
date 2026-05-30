-- supabase/migrations/20260530270000_phase_d_enriched_views.sql
--
-- Phase D (2026-05-30) — 3 read-only VIEWs that LEFT JOIN each daily to its
-- registry server-side. App layer SELECTs from the view instead of the
-- daily; status fields arrive as reg_* columns alongside the daily's
-- existing columns.
--
-- After Migrations A + B run, the LEFT side never has a NULL match in
-- production; LEFT JOIN is kept (rather than INNER) for defensive semantics
-- against the unlikely edge case of a registry row being deleted out-of-band.
--
-- Performance: planner picks a hash join on the shared 3-tuple PK; cost
-- stays sub-50ms over 1k rows on production data.

-- ---------------------------------------------------------------------------
-- 1. campaigns_enriched
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW campaigns_enriched AS
SELECT
  cd.*,
  cr.configured_status         AS reg_configured_status,
  cr.effective_status          AS reg_effective_status,
  cr.delivery_status           AS reg_delivery_status,
  cr.is_enabled                AS reg_is_enabled,
  cr.is_serving                AS reg_is_serving,
  cr.first_seen_at             AS reg_first_seen_at,
  cr.last_seen_at              AS reg_last_seen_at,
  cr.status_changed_at         AS reg_status_changed_at,
  cr.last_status_success_at    AS reg_last_status_success_at,
  cr.last_metrics_success_at   AS reg_last_metrics_success_at,
  cr.missed_seen_count         AS reg_missed_seen_count,
  cr.is_removed                AS reg_is_removed
FROM campaigns_daily cd
LEFT JOIN campaign_registry cr
  ON  cr.store_id    = cd.store_id
  AND cr.platform    = cd.platform
  AND cr.campaign_id = cd.campaign_id;

-- ---------------------------------------------------------------------------
-- 2. adsets_enriched — sourced from campaigns_daily (ad-set-granular)
--    LEFT JOINed to adset_registry by ad_set_id. Created but NOT consumed
--    by Phase D Task 5/6 (the existing reader stays on campaigns_enriched
--    + uses the campaign-level reg_*). Available for future ad-set-only
--    consumers that want the adset_registry's status fields instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW adsets_enriched AS
SELECT
  cd.*,
  ar.configured_status         AS reg_configured_status,
  ar.effective_status          AS reg_effective_status,
  ar.delivery_status           AS reg_delivery_status,
  ar.is_enabled                AS reg_is_enabled,
  ar.is_serving                AS reg_is_serving,
  ar.first_seen_at             AS reg_first_seen_at,
  ar.last_seen_at              AS reg_last_seen_at,
  ar.status_changed_at         AS reg_status_changed_at,
  ar.last_status_success_at    AS reg_last_status_success_at,
  ar.last_metrics_success_at   AS reg_last_metrics_success_at,
  ar.missed_seen_count         AS reg_missed_seen_count,
  ar.is_removed                AS reg_is_removed
FROM campaigns_daily cd
LEFT JOIN adset_registry ar
  ON  ar.store_id  = cd.store_id
  AND ar.platform  = cd.platform
  AND ar.adset_id  = cd.ad_set_id;

-- ---------------------------------------------------------------------------
-- 3. ads_enriched
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ads_enriched AS
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
  arr.is_removed               AS reg_is_removed
FROM ads_daily a
LEFT JOIN ad_registry arr
  ON  arr.store_id = a.store_id
  AND arr.platform = a.platform
  AND arr.ad_id    = a.ad_id;

-- ---------------------------------------------------------------------------
-- Grants — anon needs SELECT to mirror the existing pattern for *_daily.
-- ---------------------------------------------------------------------------
GRANT SELECT ON campaigns_enriched, adsets_enriched, ads_enriched TO anon;
