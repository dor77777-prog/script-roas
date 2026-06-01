// dashboard-web/src/lib/__tests__/forecastMonthEndStartOfMonthDataFeed.test.ts
//
// Start-of-month forecast bug (2026-06-01).
//
// SYMPTOM: at the START of a month — e.g. day 1 of 30 with 4,359 CAD
// accrued — the GoalTracker's "חיזוי סוף חודש" (end-of-month forecast)
// showed the SAME value as "נצבר עד כה" (month-to-date accrued), i.e. the
// projection collapsed to MTD ("96.8% below target") instead of projecting
// the run-rate (~4,359/1 × 30 ≈ 130,770).
//
// ROOT CAUSE (data-feeding, NOT algorithm): forecastMonthEnd projects with
// the trailing 7 COMPLETED days — baseline window [today-7, today-1]. The
// GoalTracker fed it `data.rows`, which for the default `this_month` preset
// at the start of a month contains ONLY the current month's days (e.g. just
// June 1). So the trailing-7-day baseline (late May) has NO matching rows
// → dailyAvgRevenue = 0 → projectedRevenue = monthToDateRevenue + 0 = MTD.
//
// THE FIX is in GoalTracker.tsx: it now fetches its OWN wide, filter-
// independent window [monthStart-7, today] (all stores) and feeds THOSE
// rows to forecastMonthEnd. forecastMonthEnd's algorithm is correct — it
// was just being starved of the trailing-7-day rows.
//
// This suite proves the fix at the algorithm boundary:
//   1. WIDE feed (current month early days + real trailing-7-day rows that
//      fall in the PREVIOUS month) → projection extrapolates the run-rate
//      and is clearly GREATER than MTD (NOT collapsed).
//   2. STARVED feed (current-month early days ONLY, trailing-7-day rows
//      ABSENT) → projection collapses to MTD. This documents the OLD
//      behavior and proves the bug is about FEEDING the data, not the math.
//
// Hermetic like the sibling forecastMonthEnd suites: no localStorage / no
// billing setup. We assert on the REVENUE side (monthToDateRevenue,
// dailyAvgRevenue, projectedRevenue) which is independent of the billing
// localStorage that aggregate() reads for true-net.

import { describe, expect, it } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
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
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

describe('forecastMonthEnd start-of-month data feed (2026-06-01)', () => {
  it('WIDE feed: trailing-7-day rows in the PREVIOUS month drive a run-rate projection (NOT collapsed to MTD)', () => {
    const today = todayInIsrael();
    const todayDay = parseInt(today.slice(-2), 10);

    // Month-to-date: the early days of THIS month (day 1..today). Keep each
    // day's revenue modest so MTD stays small relative to the run-rate
    // projection. Use exactly `todayDay` MTD days at $4,000 each.
    const MTD_PER_DAY = 4000;
    const rows: DailyRow[] = [];
    for (let day = 1; day <= todayDay; day++) {
      rows.push(
        row({
          date: `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`,
          revenue: MTD_PER_DAY,
          totalSpend: 800,
        }),
      );
    }
    const expectedMtd = MTD_PER_DAY * todayDay;

    // Trailing-7-day baseline [today-7, today-1] at a stable $10,000/day.
    // Near the start of the month these dates fall in the PREVIOUS month —
    // exactly the rows the dashboard's `this_month` slice OMITTED.
    const BASELINE_PER_DAY = 10_000;
    const baselineDates = new Set<string>();
    for (let d = -7; d <= -1; d++) {
      const date = addDays(today, d);
      baselineDates.add(date);
      rows.push(row({ date, revenue: BASELINE_PER_DAY, totalSpend: 1500 }));
    }

    const f = forecastMonthEnd(rows);
    const daysInMonth = f.daysElapsedThisMonth + f.daysRemainingThisMonth;

    // MTD only counts the current-month rows (previous-month baseline rows
    // are NOT in [monthStart, today]).
    expect(f.monthToDateRevenue).toBe(expectedMtd);

    // The baseline produced a real daily average — $10,000/day from 7
    // completed days. (When today is day 1, all 7 baseline dates are in the
    // prior month; when today is later but still ≤ day 7, some baseline dates
    // are prior-month and some current-month — either way all 7 are present
    // in the WIDE feed and each holds $10,000.)
    expect(f.dailyAvgRevenue).toBeCloseTo(BASELINE_PER_DAY, 6);

    // The projection extrapolates: MTD + dailyAvg × daysRemaining.
    const expectedProjection =
      f.monthToDateRevenue + f.dailyAvgRevenue * f.daysRemainingThisMonth;
    expect(f.projectedRevenue).toBeCloseTo(expectedProjection, 4);

    // And critically it is NOT collapsed to MTD — it is meaningfully GREATER
    // (there are days remaining and a positive daily average), proving the
    // forecast is doing its job once it is fed the trailing-7-day rows.
    if (f.daysRemainingThisMonth > 0) {
      expect(f.projectedRevenue).toBeGreaterThan(f.monthToDateRevenue);
      // Concretely far above MTD — the run-rate fills the rest of the month.
      expect(f.projectedRevenue).toBeGreaterThan(f.monthToDateRevenue * 1.5);
    }
    // Sanity: the projection ≈ run-rate over the whole month order of magnitude.
    expect(f.projectedRevenue).toBeCloseTo(
      expectedMtd + BASELINE_PER_DAY * (daysInMonth - todayDay),
      4,
    );
  });

  it('STARVED feed (the OLD bug): current-month early days ONLY → projection collapses to MTD', () => {
    const today = todayInIsrael();
    const todayDay = parseInt(today.slice(-2), 10);

    // ONLY the current month's days — exactly what `this_month` returned at
    // the start of a month. NO trailing-7-day (previous-month) rows.
    const MTD_PER_DAY = 4359;
    const rows: DailyRow[] = [];
    for (let day = 1; day <= todayDay; day++) {
      rows.push(
        row({
          date: `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`,
          revenue: MTD_PER_DAY,
          totalSpend: 800,
        }),
      );
    }
    const expectedMtd = MTD_PER_DAY * todayDay;

    const f = forecastMonthEnd(rows);

    expect(f.monthToDateRevenue).toBe(expectedMtd);

    // With the baseline window empty (when today is early in the month and
    // none of [today-7, today-1] is in the current month), the daily average
    // is 0 and the projection collapses to MTD — the documented OLD behavior.
    //
    // When today is later than the 7th, some of [today-7, today-1] overlaps
    // the current-month rows we DID supply, so the baseline is non-zero. The
    // start-of-month bug only manifests in the first ~7 days; guard the
    // assertion to that window so the test is deterministic on any run date.
    if (todayDay <= 7) {
      expect(f.dailyAvgRevenue).toBe(0);
      expect(f.projectedRevenue).toBeCloseTo(f.monthToDateRevenue, 4);
    }
    // Always finite — no NaN/Infinity leak regardless of the run date.
    expect(Number.isFinite(f.projectedRevenue)).toBe(true);
  });
});
