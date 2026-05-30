-- Phase E1.7 (2026-05-30 night) — unified agg RPC for data_daily.
--
-- Replaces predecessors that landed in this same evening session and
-- are now superseded:
--   • 20260530120000_add_tt_spend_agg_function.sql (TikTok only)
--   • 20260530200000_fix_tt_spend_agg_zero_pass.sql (TikTok zero-pass)
--   • 20260530220000_agg_tt_impressions.sql (TikTok impressions)
--   • 20260530300000_recompute_data_daily_derived.sql (derive-only)
--
-- Three passes per call (idempotent):
--
--   Pass 1 — ZERO. For every data_daily row on date d, zero
--   fb/ga/tt_spend_cad and fb/ga/tt_impressions. Stores that lost all
--   activity correctly drop to 0 instead of inheriting stale values.
--
--   Pass 2 — AGGREGATE. SUM campaigns_daily.spend_cad + impressions
--   per (date, store_id, platform) and UPDATE data_daily. TikTok rows
--   attributed via the Phase A.5 v2 campaign-store-map flow naturally
--   to the right store_id at write time.
--
--   Pass 3 — DERIVE. Re-compute total_spend_cad, roas,
--   gross_profit_cad, net_profit_cad from freshly-set spend +
--   cron-live-owned revenue + cogs.
--
-- Called from:
--   • cronLive.ts persistDayForStore (after Shopify UPSERT)
--   • metaWorker hot_metrics branch (before empty-hot-set + after upserts)
--   • googleWorker hot_metrics branch (same pattern)
--   • tiktokWorker hot_metrics branch (same pattern)

CREATE OR REPLACE FUNCTION public.agg_data_daily_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1 — zero fb/ga/tt spend + impressions for every row on d.
  UPDATE data_daily
     SET fb_spend_cad = 0,
         ga_spend_cad = 0,
         tt_spend_cad = 0,
         fb_impressions = 0,
         ga_impressions = 0,
         tt_impressions = 0
   WHERE date = d;

  -- Pass 2 — sum campaigns_daily per (store_id, platform) on d.
  UPDATE data_daily dd
     SET fb_spend_cad   = COALESCE(s.fb,     0),
         fb_impressions = COALESCE(s.fb_imp, 0),
         ga_spend_cad   = COALESCE(s.ga,     0),
         ga_impressions = COALESCE(s.ga_imp, 0),
         tt_spend_cad   = COALESCE(s.tt,     0),
         tt_impressions = COALESCE(s.tt_imp, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'meta'   THEN COALESCE(spend_cad,   0) ELSE 0 END)::numeric AS fb,
             SUM(CASE WHEN platform = 'meta'   THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS fb_imp,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(spend_cad,   0) ELSE 0 END)::numeric AS ga,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS ga_imp,
             SUM(CASE WHEN platform = 'tiktok' THEN COALESCE(spend_cad,   0) ELSE 0 END)::numeric AS tt,
             SUM(CASE WHEN platform = 'tiktok' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS tt_imp
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id;

  -- Pass 3 — derive total / roas / gross / net.
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
