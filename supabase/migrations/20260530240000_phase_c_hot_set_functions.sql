-- Phase C (2026-05-30) — Hot-set Postgres functions for orchestrator-driven
-- metrics refresh. Three functions per platform: campaigns, adsets, ads.
--
-- 5-branch UNION per the umbrella spec §"Hot set SQL":
--   1. Status-active in registry
--   2. Recently status-changed (last 24h)
--   3. Recently first-seen (last 72h)
--   4. Has activity today (any of: spend, impressions, clicks, conversions)
--   5. Had spend yesterday tail (covers "paused this morning")
--
-- Each returns text[] of entity ids. Empty array if no rows qualify.

-- ---------------------------------------------------------------------------
-- 1. get_hot_campaign_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_campaign_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    -- (1) Status-active in registry
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND is_enabled = true
       AND COALESCE(is_serving, false) = true

    UNION
    -- (2) Recently status-changed
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND status_changed_at >= now() - INTERVAL '24 hours'

    UNION
    -- (3) Recently first-seen
    SELECT campaign_id FROM campaign_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false
       AND first_seen_at >= now() - INTERVAL '72 hours'

    UNION
    -- (4) Has activity today
    SELECT DISTINCT campaign_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)

    UNION
    -- (5) Had spend yesterday tail
    SELECT DISTINCT campaign_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(campaign_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_hot_adset_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_adset_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND is_enabled = true AND COALESCE(is_serving, false) = true
    UNION
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND status_changed_at >= now() - INTERVAL '24 hours'
    UNION
    SELECT adset_id FROM adset_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND first_seen_at >= now() - INTERVAL '72 hours'
    UNION
    SELECT DISTINCT ad_set_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND ad_set_id IS NOT NULL
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)
    UNION
    SELECT DISTINCT ad_set_id FROM campaigns_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1 AND ad_set_id IS NOT NULL
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(adset_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_hot_ad_ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_hot_ad_ids(
  p_store_id text,
  p_platform text
) RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  WITH hot AS (
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND is_enabled = true AND COALESCE(is_serving, false) = true
    UNION
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND status_changed_at >= now() - INTERVAL '24 hours'
    UNION
    SELECT ad_id FROM ad_registry
     WHERE store_id = p_store_id AND platform = p_platform
       AND is_removed = false AND first_seen_at >= now() - INTERVAL '72 hours'
    UNION
    SELECT DISTINCT ad_id FROM ads_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE
       AND (COALESCE(spend_cad, 0) > 0
            OR COALESCE(impressions, 0) > 0
            OR COALESCE(clicks, 0) > 0
            OR COALESCE(conversions, 0) > 0)
    UNION
    SELECT DISTINCT ad_id FROM ads_daily
     WHERE store_id = p_store_id AND platform = p_platform
       AND date = CURRENT_DATE - 1
       AND COALESCE(spend_cad, 0) > 0
  )
  SELECT COALESCE(array_agg(ad_id), ARRAY[]::text[]) FROM hot;
$$;

-- ---------------------------------------------------------------------------
-- Grants — anon can call these via PostgREST (URL-obscurity trust model).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_hot_campaign_ids(text, text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_hot_adset_ids(text, text)    TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_hot_ad_ids(text, text)       TO anon, service_role;
