-- Phase A.5 v2 (2026-05-29 evening hotfix #5) — fix the per-store TikTok
-- aggregation function to correctly zero out stores that LOST their TikTok
-- attribution (campaign was tagged out of them).
--
-- Bug in the original migration (20260530120000): Pass 1's UPDATE only
-- touches data_daily rows whose (date, store_id) appears in the subquery.
-- If a store has zero TikTok rows in campaigns_daily for `d` (e.g. the
-- only TikTok campaign got tagged away), the subquery returns no row for
-- that store, the UPDATE skips it, and tt_spend_cad keeps its historical
-- value → all-stores SUM double-counts (the moved campaign's spend now
-- lives in BOTH the new store's row AND the old store's stale value).
--
-- Fix: a new Pass 1a that zeroes out tt_spend_cad for ALL data_daily rows
-- of `d` BEFORE the aggregation UPDATE runs. The aggregation UPDATE then
-- sets the correct positive value for stores that have TikTok activity;
-- stores that don't end up correctly at 0.
--
-- Pass 2 (recompute total_spend_cad + dependents) is unchanged — it
-- already runs after Pass 1 and uses whatever tt_spend_cad is in the row.

CREATE OR REPLACE FUNCTION agg_tiktok_spend_per_store_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1a (Phase A.5 v2 evening hotfix): zero out tt_spend_cad for
  -- every data_daily row on `d`. Stores with no TikTok activity stay at
  -- 0; stores with activity get overwritten by Pass 1b below.
  UPDATE data_daily SET tt_spend_cad = 0 WHERE date = d;

  -- Pass 1b: re-aggregate tt_spend_cad per (date, store_id) from
  -- campaigns_daily. Only stores with at least one TikTok row are touched.
  UPDATE data_daily dd
     SET tt_spend_cad = sub.s
    FROM (
      SELECT date, store_id, COALESCE(SUM(spend_cad), 0)::numeric AS s
        FROM campaigns_daily
       WHERE date = d AND platform = 'tiktok'
       GROUP BY date, store_id
    ) sub
   WHERE dd.date = sub.date AND dd.store_id = sub.store_id;

  -- Pass 2: recompute total_spend_cad + 3 dependents for EVERY data_daily
  -- row on `d`. Unchanged from the original migration. Stores whose
  -- tt_spend_cad was just zeroed get their total_spend_cad correctly
  -- recomputed as fb + ga + 0.
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
