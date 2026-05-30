-- supabase/migrations/20260530290000_phase_d_soak_cleanup_stuck_unknown_rows.sql
--
-- Phase D soak hotfix (2026-05-30) — clear 4 stuck BACKFILL_UNKNOWN
-- registry rows that the workers cannot reach. Context:
--   • 2 TikTok rows are cross-store-attribution duplicates from a
--     transient bad campaigns_daily snapshot at Phase D migration time.
--     The campaigns are mapped to usmile360 per dashboard_state
--     campaign-store-map; the usmile360 registry rows are healthy and
--     updated by the worker. The uzoshop rows are stale leftovers.
--   • 1 Google row is an active campaign that hasn't changed in 24h,
--     so the change_status worker (24h window) never refreshes it.
--     A follow-up worker patch adds a BACKFILL_UNKNOWN sweep so this
--     can't recur; this migration just heals the existing row.
--   • 1 TikTok row is a week-old DISABLED campaign no longer returned
--     by /campaign/get/ (archived/deleted). Worker correctly skips it;
--     this migration derives configured_status from the historical
--     effective_status snapshot so the row exits BACKFILL_UNKNOWN.
--
-- Migration is idempotent (WHERE configured_status = 'BACKFILL_UNKNOWN'
-- clause makes re-apply a no-op).

BEGIN;

-- 1. DELETE 2 stale TikTok uzoshop rows (cross-attribution duplicates).
DELETE FROM campaign_registry
 WHERE platform = 'tiktok'
   AND store_id = 'uzoshop'
   AND campaign_id IN ('1866440028463153', '1866443196508418')
   AND configured_status = 'BACKFILL_UNKNOWN';

-- 2. UPDATE the 2 worker-unreachable rows: derive configured_status from
--    the effective_status backfilled by the Phase D migration.
UPDATE campaign_registry
   SET configured_status = effective_status
 WHERE configured_status = 'BACKFILL_UNKNOWN'
   AND effective_status IS NOT NULL
   AND (
     (platform = 'google' AND store_id = 'uzoshop' AND campaign_id = '22552655236')
     OR
     (platform = 'tiktok' AND store_id = 'uzoshop' AND campaign_id = '1865960813023330')
   );

COMMIT;
