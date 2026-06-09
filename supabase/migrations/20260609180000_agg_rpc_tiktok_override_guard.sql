-- 2026-06-09 (Task 1 / consistency audit) — Protect the operator's TikTok
-- manual-override from the unified agg RPC.
--
-- BUG: cronDaily already keeps the operator's TikTok spend override
-- authoritative — it skips `agg_tiktok_spend_per_store_for_date` when a TikTok
-- override is applied (cronDaily.ts:1675). But the UNIFIED RPC
-- `agg_data_daily_for_date(d)` — called by cron-live (cronLive.ts:445) and the
-- tiktokWorker hot_metrics branch (tiktokWorker.ts:908) — re-zeroed (Pass 1) and
-- re-aggregated (Pass 2) `tt_spend_cad` from campaigns_daily UNCONDITIONALLY, so
-- the operator's override was silently clobbered within ~10 minutes.
--
-- FIX (in-RPC guard, so ALL three callers inherit it): leave `tt_spend_cad`
-- UNTOUCHED for any (date, store_id) that has a `manual_overrides` row with
-- platform='tiktok' for that date. `manual_overrides` is UNIQUE(date, store_id,
-- platform) — its existence is "active". Everything else runs exactly as before:
-- fb/ga spend, ALL impressions (the override is TikTok-SPEND only), and the
-- Pass-3 derive (which uses the preserved-or-aggregated tt_spend_cad).
--
-- Idempotent. Re-running on a date with no overrides is byte-identical to the
-- previous function.

CREATE OR REPLACE FUNCTION public.agg_data_daily_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1 — zero fb/ga spend + ALL impressions for every row on d.
  UPDATE data_daily
     SET fb_spend_cad = 0,
         ga_spend_cad = 0,
         fb_impressions = 0,
         ga_impressions = 0,
         tt_impressions = 0
   WHERE date = d;

  -- Pass 1b — zero tt_spend_cad ONLY where there is no operator TikTok override.
  -- Override rows keep the operator's authoritative tt_spend_cad untouched.
  UPDATE data_daily dd
     SET tt_spend_cad = 0
   WHERE dd.date = d
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d
          AND mo.store_id = dd.store_id
          AND mo.platform = 'tiktok'
     );

  -- Pass 2 — sum campaigns_daily per (store_id, platform) on d for fb/ga + impressions.
  UPDATE data_daily dd
     SET fb_spend_cad   = COALESCE(s.fb,     0),
         fb_impressions = COALESCE(s.fb_imp, 0),
         ga_spend_cad   = COALESCE(s.ga,     0),
         ga_impressions = COALESCE(s.ga_imp, 0),
         tt_impressions = COALESCE(s.tt_imp, 0)
    FROM (
      SELECT date, store_id,
             SUM(CASE WHEN platform = 'meta'   THEN COALESCE(spend_cad,   0) ELSE 0 END)::numeric AS fb,
             SUM(CASE WHEN platform = 'meta'   THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS fb_imp,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(spend_cad,   0) ELSE 0 END)::numeric AS ga,
             SUM(CASE WHEN platform = 'google' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS ga_imp,
             SUM(CASE WHEN platform = 'tiktok' THEN COALESCE(impressions, 0) ELSE 0 END)::bigint  AS tt_imp
        FROM campaigns_daily
       WHERE date = d
       GROUP BY date, store_id
    ) s
   WHERE dd.date = s.date AND dd.store_id = s.store_id;

  -- Pass 2b — set tt_spend_cad from campaigns_daily ONLY where no TikTok
  -- override exists. Override rows keep their authoritative value (skipped here).
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
        WHERE mo.date = d
          AND mo.store_id = dd.store_id
          AND mo.platform = 'tiktok'
     );

  -- Pass 3 — derive total / roas / gross / net from the freshly-set spend
  -- (including the preserved override tt_spend_cad) + revenue + cogs.
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
