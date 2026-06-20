-- 2026-06-11 (#10 — migration-layer hardening) — make agg_data_daily_for_date
-- create a skeleton data_daily row before it aggregates, so a worker that runs
-- before the day's row exists no longer silently drops that platform's spend.
--
-- BUG (#10): `agg_data_daily_for_date(d)` is UPDATE-only. Every pass is
--   `UPDATE data_daily ... WHERE date = d AND store_id = ...`. If the (date,
--   store_id) row does NOT yet exist when a hot_metrics worker (or cron-live)
--   calls this RPC, every UPDATE matches 0 rows and that platform's spend for
--   the day is silently discarded. The data_daily row is normally created by
--   cron-live / cron-daily on a Shopify pull, so the window self-heals within
--   ≤10 min on the next cron-live tick — BUT a sustained Shopify failure (or a
--   worker firing well before the first Shopify pull of the day) keeps the row
--   absent and persists the dropped spend until Shopify recovers.
--
-- FIX: as the FIRST step inside the function, idempotently INSERT a skeleton
--   data_daily row for every (date, store_id) that already has campaigns_daily
--   activity on d, using ON CONFLICT (date, store_id) DO NOTHING. data_daily PK
--   is (date, store_id) (initial_schema.sql), and store_name is TEXT NOT NULL —
--   we seed it with the store_id slug as a PLACEHOLDER. cron-live / cron-daily
--   overwrite store_name with the proper display name on the next Shopify write,
--   so the placeholder is transient and never user-visible in steady state.
--
-- The rest of the body is reproduced BYTE-FOR-BYTE from the latest definition
-- (20260610120000_override_guards_meta_google_tiktok.sql): Pass 1 / 1a / 1b /
-- 1c (override-gated zeroing), Pass 2 / 2a / 2b / 2c (override-gated
-- re-aggregation), Pass 3 (derive totals). All NOT-EXISTS manual_overrides
-- guards are preserved exactly. Only the skeleton INSERT is added.
--
-- Idempotent. With every data_daily row already present (the normal case) the
-- skeleton INSERT is a no-op (DO NOTHING) and the function behaves identically
-- to its previous version. This RPC is load-bearing and CANNOT be unit-tested;
-- its behavior is covered post-application by the AUDIT_LIVE reconcile harness.

CREATE OR REPLACE FUNCTION public.agg_data_daily_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 0 (#10) — idempotent skeleton insert. Ensure a data_daily row exists
  -- for every store with campaigns_daily activity on d BEFORE the UPDATE-only
  -- passes below run, so a worker firing before Shopify creates the row no
  -- longer drops that platform's spend. store_name = store_id is a PLACEHOLDER
  -- overwritten by cron-live/cron-daily on the next Shopify write.
  INSERT INTO data_daily (date, store_id, store_name)
  SELECT DISTINCT date, store_id, store_id
    FROM campaigns_daily
   WHERE date = d
  ON CONFLICT (date, store_id) DO NOTHING;

  -- Pass 1 — zero ALL impressions for every row on d (never override-gated).
  UPDATE data_daily
     SET fb_impressions = 0,
         ga_impressions = 0,
         tt_impressions = 0
   WHERE date = d;

  -- Pass 1a — zero fb_spend_cad ONLY where there is no operator META override.
  UPDATE data_daily dd
     SET fb_spend_cad = 0
   WHERE dd.date = d
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'meta'
     );

  -- Pass 1b — zero ga_spend_cad ONLY where there is no operator GOOGLE override.
  UPDATE data_daily dd
     SET ga_spend_cad = 0
   WHERE dd.date = d
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'google'
     );

  -- Pass 1c — zero tt_spend_cad ONLY where there is no operator TIKTOK override.
  UPDATE data_daily dd
     SET tt_spend_cad = 0
   WHERE dd.date = d
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'tiktok'
     );

  -- Pass 2 — impressions from campaigns_daily sums (all three platforms,
  -- never override-gated).
  UPDATE data_daily dd
     SET fb_impressions = COALESCE(s.fb_imp, 0),
         ga_impressions = COALESCE(s.ga_imp, 0),
         tt_impressions = COALESCE(s.tt_imp, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'meta'   THEN COALESCE(impressions, 0) ELSE 0 END)::bigint AS fb_imp,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint AS ga_imp,
             SUM(CASE WHEN platform = 'tiktok' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint AS tt_imp
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id;

  -- Pass 2a — fb_spend_cad from sums ONLY where no META override.
  UPDATE data_daily dd
     SET fb_spend_cad = COALESCE(s.fb, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'meta' THEN COALESCE(spend_cad, 0) ELSE 0 END)::numeric AS fb
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'meta'
     );

  -- Pass 2b — ga_spend_cad from sums ONLY where no GOOGLE override.
  UPDATE data_daily dd
     SET ga_spend_cad = COALESCE(s.ga, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(spend_cad, 0) ELSE 0 END)::numeric AS ga
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'google'
     );

  -- Pass 2c — tt_spend_cad from sums ONLY where no TIKTOK override.
  UPDATE data_daily dd
     SET tt_spend_cad = COALESCE(s.tt, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'tiktok' THEN COALESCE(spend_cad, 0) ELSE 0 END)::numeric AS tt
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'tiktok'
     );

  -- Pass 3 — derive total / roas / gross / net from the freshly-set spend
  -- (including any preserved override values) + revenue + cogs. Unchanged.
  UPDATE data_daily
     SET total_spend_cad =
           COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0),
         roas = CASE
           WHEN COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0) > 0
             THEN COALESCE(revenue_cad, 0)
                  / (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0))
           ELSE 0
         END,
         gross_profit_cad =
           COALESCE(revenue_cad, 0)
           - (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0)),
         net_profit_cad =
           COALESCE(revenue_cad, 0)
           - (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0))
           - COALESCE(cogs_cad, 0)
   WHERE date = d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.agg_data_daily_for_date(date) TO anon, service_role;
