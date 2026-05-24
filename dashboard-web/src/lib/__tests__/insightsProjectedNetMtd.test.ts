/**
 * Audit fix 2026-05-24 (AUDIT insights ALG-01, Phase 12.2.2) — locks the
 * MTD-COGS-preservation contract for forecastMonthEnd's projectedNet.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * lib_algorithm_insights.json #ALG-01):
 *   `projectedNet = projectedRev - projectedSpend - projectedRev *
 *   observedCogsRate - projectedRev * observedFeesRate - projectedFixed`.
 *   The `projectedRev * observedCogsRate` and `projectedRev *
 *   observedFeesRate` terms apply the LAST-7 rate to the WHOLE projected
 *   month — including the MTD portion that has ALREADY HAPPENED at a
 *   DIFFERENT rate. So an early-MTD day with high 25% COGS gets rewritten
 *   to the last-7 baseline's 10% rate in the projection, producing a
 *   projectedNet that contradicts what actually happened in the month.
 *
 * Post-fix: `projectedCogs = mtdCogs + dailyAvgCogs * daysRemaining` and
 * `projectedFees = mtdFees + dailyAvgFees * daysRemaining`. The actual
 * MTD costs are preserved exactly; only the REMAINING days are projected
 * via the last-7-window daily-average rate. GoalTracker's projection
 * no longer overwrites realized history with the baseline rate.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_insights.json (ALG-01).
 *
 * Test coverage (3 tests):
 *   1. Heterogeneous MTD bug fixture — 1 early-MTD day at 25% COGS +
 *      7 baseline days at 10% COGS. Pre-fix produces 20040; post-fix
 *      produces 18540 (the correct value that respects historic COGS).
 *   2. Homogeneous regression guard — all MTD rows have the same 25%
 *      rate. Pre-fix and post-fix produce identical results because
 *      the dailyAvgCogs path collapses to the same number.
 *   3. Zero-baseline fallback — last-7 window has 0 revenue; mtdCogs
 *      is still preserved (not zeroed) and the formula doesn't NaN.
 */
import { describe, it, expect } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(),
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

describe('forecastMonthEnd projectedNet preserves MTD COGS (insights ALG-01)', () => {
  it('heterogeneous MTD: projection preserves early-MTD 25% COGS history; extrapolates only remaining days', () => {
    // The bug fixture from raw-returns/lib_algorithm_insights.json #ALG-01:
    //   - one early-MTD day with revenue=10000, cogs=2500 (25% rate)
    //   - seven baseline days (today-7 .. today-1) with revenue=1000/day,
    //     cogs=100/day (10% rate)
    // Pre-fix formula: projectedCogs = projectedRev * (last7Cogs/last7Rev)
    //   = projectedRev * 0.10  → REWRITES the early 25%-COGS day at 10%.
    // Post-fix formula: projectedCogs = mtdCogs + dailyAvgCogs * daysRemaining
    //   = 3200 + 100 * daysRemaining  → preserves MTD at 25%, extrapolates
    //   only the remaining days at the baseline rate.
    const today = todayInIsrael();
    const monthStartDay = today.slice(-2);
    const daysElapsed = parseInt(monthStartDay, 10);
    // We need an MTD day that's NOT in the last-7 window. Anchor it to
    // monthStart so the test works regardless of where in the month
    // "today" lands. If "today" is day 1-8 of the month, the last-7
    // window goes back into the previous month and there's no slot for
    // an early-MTD day that's strictly outside both windows — in that
    // case skip the test gracefully (the bug is intractable on the
    // first week of the month anyway).
    if (daysElapsed < 9) {
      // Skip this test on first 8 days of month — the heterogeneity
      // setup requires an early-MTD day BEFORE the baseline window.
      return;
    }
    const monthStart = today.slice(0, 8) + '01';
    void monthStart;

    const rows: DailyRow[] = [];
    // Early MTD day on day 3 of month — 25% COGS rate.
    const earlyDate = today.slice(0, 8) + '03';
    rows.push(
      row({
        date: earlyDate,
        revenue: 10000,
        totalSpend: 0,
        cogs: 2500,
        hasCogs: true,
      }),
    );
    // Baseline window: today-7 .. today-1 inclusive, 7 days × 1000 rev,
    // 100 cogs each (10% rate).
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 0,
          cogs: 100,
          hasCogs: true,
        }),
      );
    }

    const f = forecastMonthEnd(rows);

    // mtdRev = 10000 + 7000 = 17000
    // mtdCogs = 2500 + 700 = 3200
    // mtdFees = 17000 * 0.065 = 1105
    // last7Rev = 7000; last7Cogs = 700; last7Fees = 7000 * 0.065 = 455
    // dailyAvgRev = 1000; dailyAvgCogs = 100; dailyAvgFees = 65
    // projectedRev = 17000 + 1000 * daysRemaining
    // PRE-FIX  projectedCogs = projectedRev * 0.10  ← BUG (rewrites history)
    // POST-FIX projectedCogs = 3200 + 100 * daysRemaining  ← preserves MTD
    const daysRemaining = f.daysRemainingThisMonth;
    const expectedProjectedCogs = 3200 + 100 * daysRemaining;
    const expectedProjectedFees = 1105 + 65 * daysRemaining;
    const expectedProjectedNet =
      f.projectedRevenue - 0 - expectedProjectedCogs - expectedProjectedFees;

    // Pre-fix would have rewritten history at 10%:
    const preFixWrongProjectedCogs = f.projectedRevenue * 0.1;
    const preFixWrongProjectedFees = f.projectedRevenue * 0.065;
    const preFixWrongProjectedNet =
      f.projectedRevenue -
      0 -
      preFixWrongProjectedCogs -
      preFixWrongProjectedFees;

    expect(f.projectedNet).toBeCloseTo(expectedProjectedNet, 4);
    // Pin: the pre-fix value differs from the correct value, so we MUST
    // be far from it (more than $1 apart guarantees we're not landing
    // on the buggy formula by accident).
    expect(Math.abs(f.projectedNet - preFixWrongProjectedNet)).toBeGreaterThan(
      1,
    );
  });

  it('homogeneous MTD regression guard: same rate across MTD and baseline → no observable change', () => {
    // All MTD rows have the same 25% COGS rate. The split into
    // mtdCogs + dailyAvgCogs * daysRemaining should produce a result
    // VERY close to (but not exactly equal to) the pre-fix formula
    // projectedRev * 0.25 — because the pre-fix formula uses
    // (last7Cogs / last7Rev) as the rate and applies it to the WHOLE
    // projectedRev including the MTD portion. In a homogeneous case
    // those two collapse to the same number.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 100,
          cogs: 250,
          hasCogs: true,
        }),
      );
    }

    const f = forecastMonthEnd(rows);
    const daysRemaining = f.daysRemainingThisMonth;

    // mtdRev = 7000, mtdCogs = 1750, mtdFees = 455
    // dailyAvg: rev=1000, cogs=250, fees=65
    // projectedRev = 7000 + 1000 * daysRemaining
    // projectedCogs = 1750 + 250 * daysRemaining
    // projectedFees = 455 + 65 * daysRemaining
    const expectedProjectedCogs = 1750 + 250 * daysRemaining;
    const expectedProjectedFees = 455 + 65 * daysRemaining;
    const expectedProjectedNet =
      f.projectedRevenue -
      f.projectedSpend -
      expectedProjectedCogs -
      expectedProjectedFees;

    expect(f.projectedNet).toBeCloseTo(expectedProjectedNet, 4);
  });

  it('zero-baseline fallback: last-7 window empty, MTD COGS still preserved (not zeroed)', () => {
    // Last-7 window has zero revenue → dailyAvgCogs falls back to the
    // global default rate × dailyAvgRev (which is also 0). But mtdCogs
    // from existing MTD rows MUST still be preserved as the projection's
    // baseline. The formula must NOT NaN/Infinity out.
    const today = todayInIsrael();
    const monthDay = parseInt(today.slice(-2), 10);
    if (monthDay < 9) {
      // Skip on first 8 days — no slot for an MTD-only row outside the
      // last-7 window.
      return;
    }
    // One MTD row at day 3 with revenue + cogs; nothing in the last-7
    // window.
    const earlyDate = today.slice(0, 8) + '03';
    const rows: DailyRow[] = [
      row({
        date: earlyDate,
        revenue: 500,
        totalSpend: 100,
        cogs: 90,
        hasCogs: true,
      }),
    ];

    const f = forecastMonthEnd(rows);

    // The projection must be finite — no NaN, no Infinity.
    expect(Number.isFinite(f.projectedNet)).toBe(true);

    // mtdCogs = 90 is preserved as the floor of projectedCogs. With
    // no last-7 baseline, dailyAvgRev = 0 → projectedRev = mtdRev = 500;
    // dailyAvgCogs falls back to dailyAvgRev * COGS_RATE_OF_REVENUE
    // = 0 * 0.25 = 0; projectedCogs = 90 + 0 * daysRemaining = 90.
    // dailyAvgFees similarly = 0; projectedFees = mtdFees + 0 =
    // 500 * 0.065 = 32.5. projectedSpend = 100 + 0 = 100.
    // projectedNet = 500 - 100 - 90 - 32.5 = 277.5.
    expect(f.projectedNet).toBeCloseTo(277.5, 4);
  });
});
