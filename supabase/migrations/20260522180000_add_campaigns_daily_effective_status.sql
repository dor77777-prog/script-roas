-- Phase 05.7.x — add `effective_status` to campaigns_daily.
--
-- Why: the dashboard's "כבוי" chip was driven purely by `lastActiveDate`
-- (the latest day with spend > 0 within the selected range), with a
-- 2-day buffer to avoid false positives during cron lag. The result was
-- that a campaign paused 1 hour ago still rendered as active until two
-- full days of zero-spend rows accumulated — a meaningful gap between
-- what the operator sees in Ads Manager (PAUSED) and what the dashboard
-- claims.
--
-- The Meta fetcher (fetchMetaBudgets in lib/fetchers/meta.ts) ALREADY
-- requests `effective_status` via the /campaigns endpoint fields= query
-- (line 680), but discarded the value when shaping the MetaBudgets
-- response. This migration adds the column so the upstream extraction
-- + downstream UI can route the field end-to-end.
--
-- Semantics:
--   - Values are platform-native strings. Meta uses ACTIVE, PAUSED,
--     CAMPAIGN_PAUSED, ARCHIVED, DELETED, IN_PROCESS, WITH_ISSUES,
--     ADSET_PAUSED, DISAPPROVED, PENDING_REVIEW, PREAPPROVED,
--     PENDING_BILLING_INFO, IN_PROCESS — see Marketing API docs.
--     Google + TikTok land in follow-up commits; their statuses live in
--     the same column (uppercase platform-native strings).
--   - NULL = unknown (Google/TikTok not yet wired, or fetcher soft-failed
--     on the budgets endpoint). The UI MUST treat NULL as "fall back to
--     lastActiveDate heuristic" so existing behaviour is preserved for
--     campaigns/platforms we haven't migrated yet.
--   - Reset/replaced on every cronDaily upsert (campaign-level status is
--     mutable; we always trust the most-recent fetch). The PRIMARY KEY
--     (date, store_id, platform, campaign_id, ad_set_id) means status is
--     stored per ad-set; aggregator surfaces the LATEST-by-date status
--     per campaign-or-adset.
--
-- Reversal: just DROP the column — the column is additive and nullable,
-- nothing in the dashboard requires it to be present once the writer +
-- reader paths revert.

ALTER TABLE campaigns_daily
  ADD COLUMN IF NOT EXISTS effective_status TEXT;

COMMENT ON COLUMN campaigns_daily.effective_status IS
  'Platform-native effective status (ACTIVE / PAUSED / ARCHIVED / etc). Populated by fetchMetaBudgets (Meta only as of Phase 05.7.x; Google + TikTok follow-up). NULL = unknown → UI falls back to lastActiveDate heuristic.';
