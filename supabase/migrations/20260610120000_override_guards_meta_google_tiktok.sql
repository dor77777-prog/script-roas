-- 2026-06-10 (P0-3 / full-system audit) — complete the manual-override
-- protection across BOTH agg RPCs and ALL THREE platforms.
--
-- BUG (audit-confirmed): migration 20260609180000 protected the operator's
-- manual override for TIKTOK only, and only inside `agg_data_daily_for_date`.
-- Two legs remained exposed:
--   Leg A — a META or GOOGLE override (the exact May-1-8 platform-outage
--   emergency flow, fully supported by the operator UI) is zeroed +
--   re-aggregated from campaigns_daily by `agg_data_daily_for_date`, which
--   cron-live calls every ~10 min for the rolling 3-day window and all three
--   hot_metrics workers call for today → the operator's typed value is
--   silently clobbered within ≤10 minutes and permanently lost once the date
--   exits the window.
--   Leg B — `agg_tiktok_spend_per_store_for_date` (the TikTok-only sibling
--   used by cron-daily's non-override path + backfill scripts) zeroes
--   tt_spend_cad DATE-GLOBALLY for all stores with no override awareness, so
--   a TikTok override typed for zolplus/usmile360 is clobbered by uzoshop's
--   runs (uzoshop is the only STORES_WITH_TIKTOK member, so its runs are the
--   ones that fire this RPC).
--
-- FIX: mirror the proven 20260609180000 NOT-EXISTS pattern for
-- platform='meta' on fb_spend_cad and platform='google' on ga_spend_cad in
-- the unified RPC, and add the platform='tiktok' guard to BOTH passes of the
-- sibling RPC. `manual_overrides` is UNIQUE(date, store_id, platform); row
-- existence = active. Impressions are NEVER override-protected (overrides
-- are spend-only by design). Pass 3 derive is unchanged and correctly folds
-- the preserved override values into totals/roas/profit.
--
-- Idempotent. With zero override rows both functions behave byte-identically
-- to their previous versions.

CREATE OR REPLACE FUNCTION public.agg_data_daily_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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

-- ── Sibling RPC: same tiktok guard on both its passes ──────────────────────

CREATE OR REPLACE FUNCTION agg_tiktok_spend_per_store_for_date(d date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Pass 1a — zero tt_spend_cad for every row on d EXCEPT stores with an
  -- operator TikTok override (their typed value stays authoritative).
  UPDATE data_daily dd
     SET tt_spend_cad = 0
   WHERE dd.date = d
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'tiktok'
     );

  -- Pass 1b — re-aggregate tt_spend_cad per (date, store_id) from
  -- campaigns_daily, skipping override-protected stores.
  UPDATE data_daily dd
     SET tt_spend_cad = sub.s
    FROM (
      SELECT date, store_id, COALESCE(SUM(spend_cad), 0)::numeric AS s
        FROM campaigns_daily
       WHERE date = d AND platform = 'tiktok'
       GROUP BY date, store_id
    ) sub
   WHERE dd.date = sub.date AND dd.store_id = sub.store_id
     AND NOT EXISTS (
       SELECT 1 FROM manual_overrides mo
        WHERE mo.date = d AND mo.store_id = dd.store_id AND mo.platform = 'tiktok'
     );

  -- Pass 2 — recompute total_spend_cad + dependents for EVERY row on d.
  -- Unchanged; preserved override values flow into the totals correctly.
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
