-- Phase 13.8 (2026-05-26) — Add per-platform impressions columns to data_daily.
--
-- Motivation: cron-live writes per-platform spend to data_daily every ~10 min
-- via the light fetchers (Meta level=account, Google customer-level, TikTok
-- advertiser-level), but the matching impressions counts have nowhere to land,
-- so the TodayLive (היום — חי) card on the dashboard cannot compute a real
-- CPM during the day. campaigns_daily is the per-campaign granularity table
-- and only gets metric rows from cron-daily overnight, so today's
-- campaigns_daily rows have impressions=0 across all 558 enrollment
-- placeholders → CPM = 0/0 → renderer shows "—" for every store + platform.
--
-- Fix: three additive columns on data_daily, written by cron-live alongside
-- the existing fb_spend_cad / ga_spend_cad / tt_spend_cad. Same nullable
-- semantics as the spend columns — old rows stay NULL, new rows populated.
-- TodayLive's CPM widget will then compute from the store-level
-- (spend, impressions) pair in data_daily, which matches the same scope as
-- cron-live's light fetchers (account / customer / advertiser totals).
--
-- BIGINT because a single store can hit 10⁶ impressions/day during a sale;
-- INTEGER's 2.1e9 ceiling is fine for one day but the API returns the field
-- as an unbounded count and BIGINT future-proofs aggregations.

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS fb_impressions BIGINT,
  ADD COLUMN IF NOT EXISTS ga_impressions BIGINT,
  ADD COLUMN IF NOT EXISTS tt_impressions BIGINT;

COMMENT ON COLUMN data_daily.fb_impressions IS
  'Meta (Facebook/Instagram) impressions for the date+store. Phase 13.8 (2026-05-26). Written by cron-live light fetcher; NULL on historical rows from before this phase.';
COMMENT ON COLUMN data_daily.ga_impressions IS
  'Google Ads impressions for the date+store. Phase 13.8 (2026-05-26). Written by cron-live light fetcher; NULL on historical rows from before this phase.';
COMMENT ON COLUMN data_daily.tt_impressions IS
  'TikTok Ads impressions for the date+store. Phase 13.8 (2026-05-26). Written by cron-live light fetcher; NULL on historical rows from before this phase.';
