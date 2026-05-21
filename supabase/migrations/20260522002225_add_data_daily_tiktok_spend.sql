-- Phase 05.7.5 — Add tt_spend_cad to data_daily (TikTok Ads platform).
--
-- Scope of Phase A (Schema + Classifier):
--   1. Migration adds `tt_spend_cad` column (this file).
--   2. Classifier in shopify.ts maps ttclid / utm_source=tiktok / source_name=tiktok
--      to a new `tiktok-paid` source bucket (was 'other-paid' before).
--   3. WhatsApp summary builder counts tiktok-paid as a separate bucket.
--
-- NOT in Phase A (deferred to Phase B/C/D):
--   - TikTok Marketing API fetcher (needs operator's API token first)
--   - cronDaily/cronLive writers populating tt_spend_cad
--   - Dashboard UI rendering a TikTok column
--   - WhatsApp template body updated to include טיקטוק bucket (requires
--     re-submission to Meta for approval — ~1-12h SLA)
--
-- Column is nullable so historical rows (where TikTok was bucketed under
-- 'other-paid' / 0 spend) don't break. The UI degrades gracefully when null.
-- Once Phase B ships, new rows will have tt_spend_cad populated; old rows
-- stay null and the UI shows '—' for those days.
--
-- Total-spend invariant after Phase B will be:
--   total_spend_cad = fb_spend_cad + ga_spend_cad + COALESCE(tt_spend_cad, 0)
-- (cronDaily.ts writer is the enforcement point; this migration is just
-- the storage shape.)

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS tt_spend_cad NUMERIC(14, 4);

COMMENT ON COLUMN data_daily.tt_spend_cad IS
  'TikTok Ads spend in CAD for the date+store. Phase 05.7.5 (2026-05-22). NULL until Phase B writer ships.';
