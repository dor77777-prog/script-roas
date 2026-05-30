-- Phase E1.6.2 (2026-05-30 evening hotfix) — derive-calc decoupling.
--
-- Pre-fix architecture:
--   cron-live computed total_spend_cad + roas + gross_profit_cad +
--   net_profit_cad inside persistDayForStore using priorSpend values
--   it SELECTed at the start of each 10-min tick. This required
--   cron-live to KNOW ABOUT the FB / Google / TikTok spend columns
--   even though Phase E1.6 had moved their FETCH to the 3 hot_metrics
--   worker branches. Worse, when workers wrote fresh spend between
--   cron-live's SELECT and its UPSERT, cron-live's derived calcs were
--   stale — and prior to Phase E1.6.2, cron-live ALSO re-wrote
--   fb_spend_cad / ga_spend_cad / fb_impressions / ga_impressions
--   from those stale priors, OVERWRITING the worker-fresh values.
--
-- Post-fix architecture:
--   cron-live writes only Shopify-derived columns (revenue_cad,
--   gross_revenue_cad, refund_deduction_cad, store_name, cogs_cad,
--   last_live_tick_at). Workers write platform spend + impressions.
--   This function — recompute_data_daily_derived(d) — atomically
--   re-derives total_spend_cad + roas + gross_profit_cad + net_profit_cad
--   from whatever spend + revenue values currently sit in data_daily
--   for date d. cron-live calls it after each Shopify UPSERT; each
--   worker calls it after its spend UPSERT. Idempotent — re-running
--   on the same d yields the same row state.
--
-- net_profit_cad formula: revenue − total_spend − cogs. Matches the
-- pre-fix inline formula in cronLive.ts.
--
-- ROAS formula: revenue / total_spend (CASE protects /0).

CREATE OR REPLACE FUNCTION public.recompute_data_daily_derived(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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

GRANT EXECUTE ON FUNCTION public.recompute_data_daily_derived(date) TO anon, service_role;
