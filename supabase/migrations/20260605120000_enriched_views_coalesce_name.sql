-- supabase/migrations/20260605120000_enriched_views_coalesce_name.sql
--
-- Retroactive-name projection (2026-06-05).
--
-- Why: the *_daily tables store the entity name as observed on the day a
-- metric row was written. When an operator later renames a campaign / ad-set /
-- ad on the platform, historical *_daily rows keep the OLD name, while the
-- registry (campaign_registry / adset_registry / ad_registry) tracks the
-- CURRENT name via its per-tick status discovery. Readers that want "always
-- show the current name, fall back to the day's name if the registry has no
-- match" had to COALESCE in app code per row. This migration moves that
-- COALESCE into the enriched views so it is computed once, server-side.
--
-- What: CREATE OR REPLACE the three Phase D enriched views, preserving EVERY
-- column / join the current views already expose (see
-- 20260530270000_phase_d_enriched_views.sql) and ADDING new, distinctly-named
-- projected aliases:
--     reg_campaign_name = COALESCE(registry.name, daily.campaign_name)
--     reg_ad_set_name   = COALESCE(registry.name, daily.ad_set_name)
--     reg_ad_name       = COALESCE(registry.name, daily.ad_name)
--
-- Backward-compatibility: this change is PURELY ADDITIVE. The existing
-- reg_* status columns and the daily's own campaign_name / ad_set_name /
-- ad_name (surfaced via cd.* / a.*) are untouched and keep their positions —
-- only new columns are appended at the end. Old readers that SELECT a subset
-- (or SELECT *) continue to work unchanged; new readers prefer the reg_*name
-- aliases.
--
-- CRITICAL: the new aliases are DISTINCT names (reg_campaign_name etc.), never
-- the same name as an existing cd.* / a.* column. COALESCE-ing into an existing
-- column name would produce a duplicate-column error.

-- ---------------------------------------------------------------------------
-- 1. campaigns_enriched
--    Existing: cd.* + campaign_registry (cr) status columns, joined by
--    campaign_id. ADD an adset_registry (ar) LEFT JOIN by ad_set_id so the
--    ad-set's CURRENT name is available, then project the two retroactive
--    name aliases.
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
  cr.is_removed                AS reg_is_removed,
  COALESCE(NULLIF(cr.name, ''), cd.campaign_name)  AS reg_campaign_name,
  COALESCE(NULLIF(ar.name, ''), cd.ad_set_name)    AS reg_ad_set_name
FROM campaigns_daily cd
LEFT JOIN campaign_registry cr
  ON  cr.store_id    = cd.store_id
  AND cr.platform    = cd.platform
  AND cr.campaign_id = cd.campaign_id
LEFT JOIN adset_registry ar
  ON  ar.store_id    = cd.store_id
  AND ar.platform    = cd.platform
  AND ar.adset_id    = cd.ad_set_id;

-- ---------------------------------------------------------------------------
-- 2. adsets_enriched — sourced from campaigns_daily (ad-set-granular)
--    LEFT JOINed to adset_registry by ad_set_id. Lower-priority for the
--    reader, but updated for consistency: project the retroactive ad-set name.
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
  ar.is_removed                AS reg_is_removed,
  COALESCE(NULLIF(ar.name, ''), cd.ad_set_name)    AS reg_ad_set_name
FROM campaigns_daily cd
LEFT JOIN adset_registry ar
  ON  ar.store_id  = cd.store_id
  AND ar.platform  = cd.platform
  AND ar.adset_id  = cd.ad_set_id;

-- ---------------------------------------------------------------------------
-- 3. ads_enriched
--    Existing: a.* + ad_registry (arr) status columns, joined by ad_id. ADD
--    campaign_registry (crr) by campaign_id and adset_registry (arr2) by
--    ad_set_id so all three CURRENT names are available, then project the
--    three retroactive name aliases.
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

-- ---------------------------------------------------------------------------
-- Grants — re-issue SELECT to anon to mirror 20260530270000. Some
-- environments need this even though CREATE OR REPLACE preserves grants.
-- ---------------------------------------------------------------------------
GRANT SELECT ON campaigns_enriched, adsets_enriched, ads_enriched TO anon;
