-- Phase A.5 — per-store TikTok spend aggregation + dependent column recompute.
-- Called by cron-daily AND persistCampaignsLive (live path) after per-row
-- campaigns_daily writes complete. Two passes inside one function:
--
--   Pass 1: UPDATE data_daily.tt_spend_cad = SUM of per-store campaigns_daily
--           slices. The Phase A.5 per-row store_id (via campaign-store-map)
--           is what makes this per-store split meaningful — without it every
--           TikTok row was attributed to a single store_id.
--
--   Pass 2: Recompute total_spend_cad, roas, gross_profit_cad, net_profit_cad
--           for every data_daily row in `d`. Without this, the 4 dependents
--           stay at the upsert-time value (computed from the legacy aggregation)
--           and the dashboard's monthly tables show wrong totals for stores
--           with newly-tagged TikTok campaigns.
--
-- Both passes are deterministic given the row state at call time; idempotent
-- on retries.

CREATE OR REPLACE FUNCTION agg_tiktok_spend_per_store_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1: re-aggregate tt_spend_cad per (date, store_id) from campaigns_daily.
  -- COALESCE(SUM, 0) ensures a store with previously-tagged campaigns that
  -- get untagged correctly resets to 0.
  UPDATE data_daily dd
     SET tt_spend_cad = sub.s
    FROM (
      SELECT date, store_id, COALESCE(SUM(spend_cad), 0)::numeric AS s
        FROM campaigns_daily
       WHERE date = d AND platform = 'tiktok'
       GROUP BY date, store_id
    ) sub
   WHERE dd.date = sub.date AND dd.store_id = sub.store_id;

  -- Pass 2: recompute the 4 derived columns for EVERY data_daily row in `d`.
  -- Even rows where TikTok didn't change benefit from the guaranteed
  -- consistency of total_spend_cad = sum-of-three-platforms.
  UPDATE data_daily
     SET total_spend_cad =
           COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0),
         roas = CASE
           WHEN COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0) > 0
             THEN COALESCE(revenue_cad, 0) / (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0))
           ELSE 0
         END,
         gross_profit_cad =
           COALESCE(revenue_cad, 0) - (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0)),
         net_profit_cad =
           COALESCE(revenue_cad, 0)
           - (COALESCE(fb_spend_cad, 0) + COALESCE(ga_spend_cad, 0) + COALESCE(tt_spend_cad, 0))
           - COALESCE(cogs_cad, 0)
   WHERE date = d;
END;
$$;
