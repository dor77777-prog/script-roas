-- supabase/migrations/20260530250000_phase_d_backfill_registries.sql
--
-- Phase D (2026-05-30) — One-time backfill of the 3 registries from their
-- matching *_daily tables. Brings campaign_registry / adset_registry /
-- ad_registry to parity with the active dailies so the upcoming
-- campaigns_enriched / adsets_enriched / ads_enriched VIEWs never expose
-- NULL reg_* columns to the UI.
--
-- See docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.1.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.
-- Order matters: campaign_registry → adset_registry → ad_registry, because
-- adset and ad rows logically depend on their parent campaign row existing.

-- ---------------------------------------------------------------------------
-- 1. campaign_registry
-- ---------------------------------------------------------------------------
INSERT INTO campaign_registry (
  store_id, platform, campaign_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  cd.store_id,
  cd.platform,
  cd.campaign_id,
  MAX(cd.campaign_name)                            AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  MIN(cd.date)::timestamptz                        AS first_seen_at,
  MAX(cd.date)::timestamptz                        AS last_seen_at,
  NULL::timestamptz                                AS platform_updated_at,
  NULL::timestamptz                                AS status_changed_at,
  NULL::timestamptz                                AS last_metrics_success_at,
  NULL::timestamptz                                AS last_status_success_at,
  '{}'::jsonb                                      AS raw_status_payload,
  0                                                AS missed_seen_count,
  FALSE                                            AS is_removed
FROM campaigns_daily cd
CROSS JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN cd2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN cd2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN cd2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN cd2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_enabled,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_serving
  FROM campaigns_daily cd2
  WHERE cd2.store_id    = cd.store_id
    AND cd2.platform    = cd.platform
    AND cd2.campaign_id = cd.campaign_id
    AND cd2.effective_status IS NOT NULL
  ORDER BY cd2.date DESC
  LIMIT 1
) AS latest
GROUP BY
  cd.store_id, cd.platform, cd.campaign_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. adset_registry  (adsets_daily has the same per-day shape; ad_set_id PK)
-- ---------------------------------------------------------------------------
INSERT INTO adset_registry (
  store_id, platform, campaign_id, adset_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  daily_budget_cad, lifetime_budget_cad,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  ad.store_id,
  ad.platform,
  ad.campaign_id,
  ad.ad_set_id                                     AS adset_id,
  MAX(ad.ad_set_name)                              AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  NULL::numeric                                    AS daily_budget_cad,
  NULL::numeric                                    AS lifetime_budget_cad,
  MIN(ad.date)::timestamptz                        AS first_seen_at,
  MAX(ad.date)::timestamptz                        AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM adsets_daily ad
CROSS JOIN LATERAL (
  SELECT
    ad2.effective_status,
    CASE
      WHEN ad2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN ad2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN ad2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN ad2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN ad2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    CASE
      WHEN ad2.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN ad2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_enabled,
    CASE
      WHEN ad2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN ad2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_serving
  FROM adsets_daily ad2
  WHERE ad2.store_id   = ad.store_id
    AND ad2.platform   = ad.platform
    AND ad2.ad_set_id  = ad.ad_set_id
    AND ad2.effective_status IS NOT NULL
  ORDER BY ad2.date DESC
  LIMIT 1
) AS latest
GROUP BY
  ad.store_id, ad.platform, ad.campaign_id, ad.ad_set_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, adset_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. ad_registry  (ads_daily; ad_id PK)
-- ---------------------------------------------------------------------------
INSERT INTO ad_registry (
  store_id, platform, campaign_id, adset_id, ad_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  a.store_id,
  a.platform,
  a.campaign_id,
  a.ad_set_id                                      AS adset_id,
  a.ad_id,
  MAX(a.ad_name)                                   AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  MIN(a.date)::timestamptz                         AS first_seen_at,
  MAX(a.date)::timestamptz                         AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM ads_daily a
CROSS JOIN LATERAL (
  SELECT
    a2.effective_status,
    CASE
      WHEN a2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN a2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE'
      ) THEN 'NOT_DELIVERING'
      WHEN a2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    CASE
      WHEN a2.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN a2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_enabled,
    CASE
      WHEN a2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN a2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_serving
  FROM ads_daily a2
  WHERE a2.store_id = a.store_id
    AND a2.platform = a.platform
    AND a2.ad_id    = a.ad_id
    AND a2.effective_status IS NOT NULL
  ORDER BY a2.date DESC
  LIMIT 1
) AS latest
GROUP BY
  a.store_id, a.platform, a.campaign_id, a.ad_set_id, a.ad_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, ad_id) DO NOTHING;
