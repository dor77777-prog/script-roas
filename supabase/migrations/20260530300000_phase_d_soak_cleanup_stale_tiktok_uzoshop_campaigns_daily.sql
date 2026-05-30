-- supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql
--
-- Phase D soak hotfix #2 (2026-05-30) — clean 2 cross-attribution
-- TikTok campaigns_daily rows that the prior cron-live enrollment
-- UPSERT bug created today.
--
-- Context:
--   cron-live (per-minute) builds an enrollment list of active ad-sets
--   and UPSERTs placeholder rows into campaigns_daily under the
--   function-arg storeId (= uzoshop on uzoshop's tick). It did NOT
--   consult dashboard_state.campaign-store-map, so TikTok campaigns
--   mapped to a non-uzoshop store ended up double-attributed: a
--   correct (tiktok, usmile360, X) row from cron-live-heavy AND a
--   wrong (tiktok, uzoshop, X) row from cron-live.
--
--   The 1st soak-fix migration (20260530290000) DELETE'd the matching
--   stale registry rows; this migration cleans the upstream
--   campaigns_daily rows so coverage parity (registry ⊇ dailies)
--   holds again. A follow-up code commit makes cron-live OMIT TikTok
--   from the enrollment UPSERT (Phase A.5 v2 already takes this
--   approach for TikTok spend; this extends the same principle to
--   the placeholder enrollment path).
--
-- Migration is idempotent (rows simply won't exist on a re-apply).
-- Bounded by date + 2 specific campaign_ids; cannot affect any other
-- store/platform/campaign even if the same IDs reappear later.

BEGIN;

DELETE FROM campaigns_daily
 WHERE date = '2026-05-30'
   AND platform = 'tiktok'
   AND store_id = 'uzoshop'
   AND campaign_id IN ('1866440028463153', '1866443196508418');

COMMIT;
