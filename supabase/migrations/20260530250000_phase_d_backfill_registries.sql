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
LEFT JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN cd2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN cd2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN cd2.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN cd2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN cd2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    -- is_enabled is gated on effective_status here because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
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
) AS latest ON TRUE
GROUP BY
  cd.store_id, cd.platform, cd.campaign_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. adset_registry — sourced from campaigns_daily (NOT a separate adsets_daily;
--    campaigns_daily has ad-set granularity per its PK
--    `(date, store_id, platform, campaign_id, ad_set_id)`).
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
  cd.store_id,
  cd.platform,
  cd.campaign_id,
  cd.ad_set_id                                     AS adset_id,
  MAX(cd.ad_set_name)                              AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  NULL::numeric                                    AS daily_budget_cad,
  NULL::numeric                                    AS lifetime_budget_cad,
  MIN(cd.date)::timestamptz                        AS first_seen_at,
  MAX(cd.date)::timestamptz                        AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM campaigns_daily cd
LEFT JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN cd2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN cd2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN cd2.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN cd2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN cd2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    -- is_enabled is gated on effective_status here because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
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
    AND cd2.ad_set_id   = cd.ad_set_id
    AND cd2.effective_status IS NOT NULL
  ORDER BY cd2.date DESC
  LIMIT 1
) AS latest ON TRUE
GROUP BY
  cd.store_id, cd.platform, cd.campaign_id, cd.ad_set_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, adset_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. ad_registry — keys-only backfill. `ads_daily` has NO `effective_status`
--    column, so we can only seed the keys + name and leave status fields NULL.
--    The Phase B/C ad-level status workers populate the rest going forward;
--    until they do, the UI classifier treats `regDeliveryStatus IS NULL` as
--    fall-through-to-legacy. configured_status is the BACKFILL_UNKNOWN
--    sentinel so the dashboard can render the "טוען מ-Platform" chip.
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
  NULL::text                                       AS effective_status,
  NULL::text                                       AS delivery_status,
  NULL::boolean                                    AS is_enabled,
  NULL::boolean                                    AS is_serving,
  MIN(a.date)::timestamptz                         AS first_seen_at,
  MAX(a.date)::timestamptz                         AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM ads_daily a
GROUP BY a.store_id, a.platform, a.campaign_id, a.ad_set_id, a.ad_id
ON CONFLICT (store_id, platform, ad_id) DO NOTHING;
