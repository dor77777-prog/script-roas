// dashboard-web/src/lib/jobs/heartbeat.ts
//
// Lightweight cron HEARTBEAT — the observability fix for the 5 schedule-cadence
// crons (cron-live, cron-daily, cron-yesterday, whatsapp, oauth-canary) that
// write NO separately-attributable run-telemetry and therefore showed as
// "אין נתון" (unknown) forever in the operator RunsPanel.
//
// Each of those crons calls recordHeartbeat() at the SUCCESSFUL end of its work
// (status 'success') or on a caught failure (status 'transient_error' + the
// error message). That writes ONE `data_freshness` row identifying the job, so
// buildRunsSummary can light the job up as success / stale / error with a
// last-run time — and a job that has never beat still degrades to the honest
// `unknown` placeholder (no fabricated green light).
//
// ROW CONVENTION (valid against the data_freshness PK + the all-text columns —
// the table has no CHECK constraints on platform/scope/status, see
// supabase/migrations/20260530100001_add_data_freshness.sql):
//
//   PK (store_id, platform, scope, table_name) =
//     ('__system__', 'system', <jobKey>, 'heartbeat')
//
//   - platform 'system'    → a dedicated lane that never collides with a real
//                            ad-platform's rows (so the home SourceHealthChip's
//                            per-(store,platform) rollup never sees these rows
//                            under meta/google/tiktok), and that the worker
//                            ACTIVE_WORKER_SCOPES allowlist already excludes.
//   - store_id '__system__'→ sentinel; never a real store id, never enumerated
//                            by loadActiveStoreIds, so it cannot pollute any
//                            per-store aggregate.
//   - scope <jobKey>       → one of cron_live | cron_daily | cron_yesterday |
//                            whatsapp | oauth_canary. Distinct from every worker
//                            metric scope, so runsSummary can map scope→job 1:1.
//   - table_name 'heartbeat'.
//
// recordFreshness already swallows all DB-layer errors internally (try/catch +
// console.warn + Sentry breadcrumb), so a write failure can never break the
// cron's real work. We ALSO guard here (belt-and-suspenders) so an unexpected
// throw from recordFreshness — or a programming error in this wrapper — is
// likewise non-fatal: the heartbeat is pure observability, never load-bearing.

import { recordFreshness } from '@/lib/inngest/freshness';

/** Canonical heartbeat sentinel convention. */
export const HEARTBEAT_PLATFORM = 'system' as const;
export const HEARTBEAT_STORE_ID = '__system__' as const;
export const HEARTBEAT_TABLE = 'heartbeat' as const;

/** The scope (== job key) written by each of the 5 schedule-cadence crons. */
export type HeartbeatJobKey =
  | 'cron_live'
  | 'cron_daily'
  | 'cron_yesterday'
  | 'whatsapp'
  | 'oauth_canary';

/** Heartbeat outcome. success = job finished; transient_error = caught failure. */
export type HeartbeatStatus = 'success' | 'transient_error';

/**
 * Write a single best-effort heartbeat row for a schedule-cadence cron.
 * Never throws — a heartbeat is observability, not part of the cron's real
 * work, so a DB hiccup (or any unexpected error) must not surface to the route.
 */
export async function recordHeartbeat(
  job: HeartbeatJobKey,
  status: HeartbeatStatus,
  errorMessage?: string,
): Promise<void> {
  try {
    await recordFreshness({
      storeId: HEARTBEAT_STORE_ID,
      platform: HEARTBEAT_PLATFORM,
      scope: job,
      tableName: HEARTBEAT_TABLE,
      status,
      ...(status === 'success' ? {} : { errorMessage }),
    });
  } catch (e) {
    // Defensive: recordFreshness is already soft-failing, but a heartbeat must
    // be impossible to make fatal. Log only — do NOT rethrow.
    console.warn('[recordHeartbeat] non-fatal write error:', e);
  }
}
