// dashboard-web/src/lib/refundDayHeuristic.ts
//
// Pure helpers for the refund-visibility UX feature (spec
// 2026-05-28-refund-visibility-ux-design.md). Single source of truth for the
// "heavy refund day" threshold so HeroOverview, RoasChart and PnLBreakdown
// stay in lockstep.

import type { DailyRow } from './types';

/** A day qualifies as "heavy refund" if refunds reach this fraction of gross. */
export const HEAVY_REFUND_PCT_THRESHOLD = 0.20;

/** ...OR if absolute refund amount reaches this CAD floor. */
export const HEAVY_REFUND_ABS_THRESHOLD = 500;

/**
 * True iff the day's refunds are material enough to surface with the
 * amber chip / dot ring / story sentence.
 *
 * Triggers on EITHER refundDeduction ≥ 20% × gross OR refundDeduction ≥ $500.
 * The OR semantics catch two distinct cases: (a) high-percent refund days
 * even when totals are small, and (b) very large absolute refunds (the
 * 2026-05-20 uzoshop case) that drown out everything else on the chart
 * regardless of the day's gross.
 *
 * Legacy fallback: when grossRevenue is null (rows pre-Phase 05.7.3), uses
 * revenue + refundDeduction as the effective gross. Returns false when both
 * are zero — no signal, no heuristic.
 */
export function isHeavyRefundDay(row: DailyRow): boolean {
  const refund = row.refundDeduction ?? 0;
  if (refund <= 0) return false;
  if (refund >= HEAVY_REFUND_ABS_THRESHOLD) return true;
  // For the pct check, use grossRevenue when available; fall back to
  // revenue + refund only when revenue > 0 (otherwise the signal is absent).
  const gross =
    row.grossRevenue !== null
      ? row.grossRevenue
      : row.revenue > 0
        ? row.revenue + refund
        : 0;
  if (gross <= 0) return false;
  return refund / gross >= HEAVY_REFUND_PCT_THRESHOLD;
}

/**
 * Sum of refundDeduction across the rows the caller passes in. The caller
 * is responsible for filtering by store / date range first — this helper
 * does not enforce scope.
 */
export function sumRefundsInRange(rows: readonly DailyRow[]): number {
  return rows.reduce((acc, r) => acc + (r.refundDeduction ?? 0), 0);
}

/**
 * Sorted, deduplicated list of date strings (YYYY-MM-DD) where at least
 * one row qualifies as a heavy refund day. Multiple rows on the same
 * date (e.g. multi-store filter set to "All") collapse to one entry.
 */
export function heavyRefundDates(rows: readonly DailyRow[]): string[] {
  const dates = new Set<string>();
  for (const r of rows) {
    if (isHeavyRefundDay(r)) dates.add(r.date);
  }
  return Array.from(dates).sort();
}
