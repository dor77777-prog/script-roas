/**
 * sourceStatus.ts — DQ-5 pure rollup of `data_freshness` rows into a
 * per-(store, platform) health verdict for the /operator + freshness UI.
 *
 * Each `data_freshness` row is keyed by (store_id, platform, scope, table_name),
 * so a single (store, platform) source spans MANY rows (one per scope/table).
 * This rollup collapses them into one verdict per `${store_id}::${platform}`.
 *
 * Health rule (locked):
 *   - 'success'      → HEALTHY (just refreshed)
 *   - 'budget_skip'  → HEALTHY (budget-off is a normal operator choice, not an
 *                      outage — never alert on it)
 *   - everything else (transient_error / auth_error / parse_error / unknown)
 *                    → UNHEALTHY
 *
 * For each (store, platform) group we pick the WORST non-healthy status (and the
 * lag of that worst row). A success/budget_skip row in the same group does NOT
 * clear a real error — if any scope is broken, the source is unhealthy. A group
 * with no non-healthy row is omitted entirely.
 *
 * Pure: deterministic, no I/O, no React. `FreshnessRow` is imported read-only.
 */

import type { FreshnessRow } from '@/lib/inngest/freshness';

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * Statuses that count as healthy. Mirrors FreshnessStatus from
 * src/lib/inngest/freshness.ts: 'success' is a fresh refresh and 'budget_skip'
 * is a deliberate budget-off, neither of which is an outage.
 */
const HEALTHY_STATUSES = new Set<string>(['success', 'budget_skip']);

/**
 * Severity ranking for non-healthy statuses — higher wins "worst-of".
 * auth_error (operator must reconnect) > parse_error (shape drift) >
 * transient_error (likely self-healing). Any unrecognized non-healthy status
 * defaults to the lowest non-zero rank so it still surfaces as unhealthy.
 */
const SEVERITY: Record<string, number> = {
  auth_error: 3,
  parse_error: 2,
  transient_error: 1,
};

const UNKNOWN_SEVERITY = 1;

function severityOf(status: string): number {
  return SEVERITY[status] ?? UNKNOWN_SEVERITY;
}

// ---------------------------------------------------------------------------
// Age gate (FIX #5)
// ---------------------------------------------------------------------------

/**
 * Per-scope freshness SLA, in MINUTES. A `success`/`budget_skip` row is only
 * actually healthy if `now − last_success_at` is within this window. The
 * stored `status` says "the last write SUCCEEDED"; it says NOTHING about
 * whether the worker is STILL being invoked. A paused / never-fanned-out
 * worker keeps its 'success' forever and, without this gate, sorts as the
 * freshest source while the pipeline is dead.
 *
 * This is the ONE source of truth for the SLA — health-summary, the read-time
 * live-lag helpers, AND runsSummary (which re-imports HEARTBEAT_SCOPE_SLA below)
 * all key off this single table, so a scope/cadence change updates every
 * surface at once. A heartbeat scope can never be SLA-known to one surface and
 * SLA-unknown (silently 60-min-defaulted) to another — the divergence that
 * dragged health-summary's freshness_pct + flagged the FreshnessPanel matrix.
 *
 *   - status / metric scopes (campaign_metrics, campaign_status, ad_metrics,
 *     adset_metrics, hot_metrics, status, kpi_daily, read_orders) → 60 min.
 *     These are driven by the 10-min worker / 30-min cron cadence; one missed
 *     hour means something is wrong.
 *   - cohort_monthly → 7 days. The cohort/LTV refresh is intentionally
 *     infrequent, so an hour-scale SLA would false-alarm every day.
 *   - heartbeat scopes (cron_live / cron_daily / cron_yesterday / whatsapp /
 *     oauth_canary) → the REAL schedule cadence from vercel.json, each loose
 *     enough to absorb a missed cycle + clock/DST skew (see
 *     HEARTBEAT_SCOPE_SLA_MINUTES below for the per-cadence rationale). These
 *     live HERE — not only in runsSummary — so the per-cadence SLA is honored
 *     by every freshness-reading surface, not just the RunsPanel. (The
 *     'system'-platform heartbeat rows are additionally EXCLUDED from the home
 *     SourceHealthChip rollup and the operator freshness_pct / lag matrix —
 *     cron health is the RunsPanel's job — but they get the correct cadence SLA
 *     here regardless, belt-and-suspenders, so no surface can ever 60-min-stale
 *     a perfectly-healthy daily cron.)
 */

/**
 * Per-HEARTBEAT-scope cadence SLA, in MINUTES — the single source of truth the
 * RunsPanel (runsSummary.ts) re-imports rather than duplicating. Set from the
 * REAL cadence in vercel.json, each loose enough to absorb a missed cycle +
 * clock/DST skew without false-alarming:
 *
 *   - cron_live      every ~10 min      → 30 min   (3× cadence; one missed tick)
 *   - cron_yesterday every 2 h          → 300 min  (5 h; ~2 missed cycles)
 *   - cron_daily     once/day (00:05 IL)→ 1500 min (25 h; one missed day + skew)
 *   - oauth_canary   once/day (00:00 IL)→ 1500 min (25 h; one missed day + skew)
 *   - whatsapp       3×/day             → 840 min  (14 h; clears the ~11.5 h
 *                                          eod→next-noon overnight gap)
 *
 * NOTE: cron_yesterday is the every-2h reconcile cron in vercel.json (the
 * "0 every-2h" UTC schedule). The observability brief grouped it loosely under
 * "~daily", but we age-gate on the REAL every-2h cadence so a genuinely dead
 * yesterday-cron surfaces within hours, not a full day.
 */
export const HEARTBEAT_SCOPE_SLA_MINUTES: Record<string, number> = {
  cron_live: 30,
  cron_yesterday: 300,
  cron_daily: 1500,
  oauth_canary: 1500,
  whatsapp: 840,
};

const SCOPE_SLA_MINUTES: Record<string, number> = {
  campaign_metrics: 60,
  campaign_status: 60,
  ad_metrics: 60,
  adset_metrics: 60,
  hot_metrics: 60,
  status: 60,
  kpi_daily: 60,
  read_orders: 60,
  cohort_monthly: 7 * 24 * 60,
  // Heartbeat scopes inherit their per-cadence SLA so scopeSlaMinutes() never
  // 60-min-defaults a slow-cadence cron heartbeat on any surface.
  ...HEARTBEAT_SCOPE_SLA_MINUTES,
};

/** Default SLA for any unrecognized scope — treat as a 60-min status scope. */
const DEFAULT_SLA_MINUTES = 60;

/** Synthetic status assigned to a success/budget_skip row that has aged out. */
export const SYNTHETIC_STALE_STATUS = 'stale';

export function scopeSlaMinutes(scope: string): number {
  return SCOPE_SLA_MINUTES[scope] ?? DEFAULT_SLA_MINUTES;
}

/**
 * True when a row's `last_success_at` is older than its scope SLA (or is null /
 * unparseable — never-succeeded is never fresh). `now` is injected so the
 * function stays pure/testable, mirroring `computeStaleness`.
 */
export function isAgeStale(
  lastSuccessAt: string | null | undefined,
  scope: string,
  now: number = Date.now(),
): boolean {
  if (lastSuccessAt == null) return true;
  const parsed = Date.parse(lastSuccessAt);
  if (Number.isNaN(parsed)) return true;
  const ageMin = (now - parsed) / 60_000;
  return ageMin > scopeSlaMinutes(scope);
}

/** Live lag in whole minutes from last_success_at to now; null if unknown. */
function liveLagMinutes(
  lastSuccessAt: string | null | undefined,
  now: number,
): number | null {
  if (lastSuccessAt == null) return null;
  const parsed = Date.parse(lastSuccessAt);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 60_000));
}

/**
 * True when an ERROR row's last_attempt_at is OLDER than its scope cadence SLA
 * (or is null/unparseable). Such an error is STALE — it was recorded long ago
 * and has not been retried since (the cron writes on its own slow cadence), so
 * it is not an actionable live failure for the home SourceHealthChip.
 *
 * This mirrors the runsSummary stale-vs-live discipline: we surface CURRENT
 * failures, not frozen old ones a slow-cadence cron has not had a chance to
 * clear. A LIVE error (recent last_attempt) is NOT stale and still flags — so a
 * genuine current meta-metric failure is never hidden.
 */
function isErrorAttemptStale(
  lastAttemptAt: string | null | undefined,
  scope: string,
  now: number,
): boolean {
  if (lastAttemptAt == null) return true;
  const parsed = Date.parse(lastAttemptAt);
  if (Number.isNaN(parsed)) return true;
  const ageMin = (now - parsed) / 60_000;
  return ageMin > scopeSlaMinutes(scope);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnhealthySource = {
  storeId: string;
  platform: string;
  status: string;
  lagMinutes: number | null;
};

export type SourceStatusRollup = {
  anyUnhealthy: boolean;
  unhealthy: UnhealthySource[];
};

// ---------------------------------------------------------------------------
// sourceStatusRollup
// ---------------------------------------------------------------------------

export function sourceStatusRollup(
  rows: FreshnessRow[],
  now: number = Date.now(),
): SourceStatusRollup {
  // worst non-healthy row seen so far, per `${store_id}::${platform}`.
  const worstByGroup = new Map<string, UnhealthySource>();

  for (const r of rows) {
    // The 'system' platform is the cron HEARTBEAT lane (recordHeartbeat), not a
    // per-(store, platform) DATA SOURCE. Cron health is the RunsPanel's job; a
    // failing cron must never raise a "system · …" badge on the home chip.
    if (r.platform === 'system') continue;

    // FIX #5: a `success`/`budget_skip` row is healthy ONLY if its
    // last_success_at is within the scope SLA. An aged one is treated as a
    // SYNTHETIC stale (it reads "succeeded" but the worker stopped firing).
    // Compute lag LIVE from last_success_at — the stored lag_minutes is frozen
    // at write time (0 on success) and would let a dead worker look freshest.
    let status = r.status;
    let lagMinutes = r.lag_minutes;

    if (HEALTHY_STATUSES.has(r.status)) {
      if (!isAgeStale(r.last_success_at, r.scope, now)) continue; // genuinely fresh
      status = SYNTHETIC_STALE_STATUS;
      lagMinutes = liveLagMinutes(r.last_success_at, now);
    } else if (isErrorAttemptStale(r.last_attempt_at, r.scope, now)) {
      // SourceHealthChip false-alarm fix: a real ERROR row only drives
      // source-health "error/transient" while it is LIVE (last_attempt within
      // the scope's cadence). A stale slow-cadence error (e.g. a daily
      // kpi_daily transient_error from 8h ago, never retried) is dropped here
      // so it cannot flag the home chip while the live metric scopes are fresh.
      // A RECENT error stays (we filter stale errors, never mute current ones).
      continue;
    }

    const key = `${r.store_id}::${r.platform}`;
    const candidate: UnhealthySource = {
      storeId: r.store_id,
      platform: r.platform,
      status,
      lagMinutes,
    };

    const incumbent = worstByGroup.get(key);
    if (!incumbent || severityOf(candidate.status) > severityOf(incumbent.status)) {
      worstByGroup.set(key, candidate);
    }
  }

  const unhealthy = Array.from(worstByGroup.values());

  return {
    anyUnhealthy: unhealthy.length > 0,
    unhealthy,
  };
}
