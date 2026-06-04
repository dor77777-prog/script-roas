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

export function sourceStatusRollup(rows: FreshnessRow[]): SourceStatusRollup {
  // worst non-healthy row seen so far, per `${store_id}::${platform}`.
  const worstByGroup = new Map<string, UnhealthySource>();

  for (const r of rows) {
    if (HEALTHY_STATUSES.has(r.status)) continue;

    const key = `${r.store_id}::${r.platform}`;
    const candidate: UnhealthySource = {
      storeId: r.store_id,
      platform: r.platform,
      status: r.status,
      lagMinutes: r.lag_minutes,
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
