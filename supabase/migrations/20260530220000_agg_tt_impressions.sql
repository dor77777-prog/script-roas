-- Phase A.5 v2 evening hotfix #6 (2026-05-29) — extend agg_tiktok_spend_per_store_for_date
-- to also aggregate tt_impressions, not just tt_spend_cad.
--
-- Background: the 2026-05-29 evening cron-live hotfix (ef8dda7) stopped
-- cron-live from writing tt_spend_cad / tt_impressions to data_daily
-- because cron-live fetches the advertiser's full TikTok spend without
-- honoring the campaign-store-map → its values WRONGLY attribute a moved
-- campaign's spend back to the pre-mapping store. The fix delegated
-- tt_spend_cad ownership to this RPC (called from persistCampaignsLive +
-- cronDaily every 30 min). BUT the RPC only handled tt_spend_cad; it
-- never touched tt_impressions, so tt_impressions stayed at whatever
-- value was last written (0 for new rows; stale for old rows) →
-- TodayLive CPM rendered "—" for every store with TikTok activity.
--
-- This migration adds tt_impressions to both passes of the aggregation:
--   Pass 1a: zero tt_impressions alongside tt_spend_cad for all
--            data_daily rows of d. Stores with no TikTok activity end
--            up at 0 (correct; CPM is undefined → "—").
--   Pass 1b: SUM(impressions) per (date, store_id) from campaigns_daily,
--            same predicate as the spend sum. Stores with at least one
--            TikTok row get the correct positive value.
--   Pass 2:  unchanged — only depends on tt_spend_cad / fb_spend_cad /
--            ga_spend_cad to recompute total_spend_cad + 3 dependents.
--
-- Idempotent: re-running on the same date yields the same result.

CREATE OR REPLACE FUNCTION agg_tiktok_spend_per_store_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1a: zero tt_spend_cad AND tt_impressions for every data_daily
  -- row on d. Stores with no TikTok activity for d stay at 0; stores
  -- with activity get overwritten by Pass 1b.
  UPDATE data_daily
     SET tt_spend_cad = 0,
         tt_impressions = 0
   WHERE date = d;

  -- Pass 1b: re-aggregate tt_spend_cad + tt_impressions per (date,
  -- store_id) from campaigns_daily. SUM(impressions) cast to BIGINT to
  -- match the column type added in 20260526185040.
  UPDATE data_daily dd
     SET tt_spend_cad = sub.s,
         tt_impressions = sub.i
    FROM (
      SELECT date, store_id,
             COALESCE(SUM(spend_cad), 0)::numeric AS s,
             COALESCE(SUM(impressions), 0)::bigint AS i
        FROM campaigns_daily
       WHERE date = d AND platform = 'tiktok'
       GROUP BY date, store_id
    ) sub
   WHERE dd.date = sub.date AND dd.store_id = sub.store_id;

  -- Pass 2: recompute total_spend_cad + 3 dependents for EVERY data_daily
  -- row on d. Unchanged from 20260530200000.
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
