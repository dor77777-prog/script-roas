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
    const BASELINE_PER_DAY = 10_000;
    const monthPrefix = today.slice(0, 7);

    // One row per date (a Map dedupes overlap). Set the trailing-7 baseline
    // FIRST at $10k so those dates ALWAYS hold $10k; fill the remaining
    // current-month days at $4k. This makes the trailing-7 daily average a
    // deterministic $10k on ANY run date (no day-of-month duplicate inflation —
    // the prior version double-added "today-1" once it was a current-month day).
    const byDate = new Map<string, number>();
    for (let d = -7; d <= -1; d++) byDate.set(addDays(today, d), BASELINE_PER_DAY);
    for (let day = 1; day <= todayDay; day++) {
      const date = `${monthPrefix}-${String(day).padStart(2, '0')}`;
      if (!byDate.has(date)) byDate.set(date, MTD_PER_DAY);
    }
    const rows: DailyRow[] = [...byDate].map(([date, revenue]) =>
      row({ date, revenue, totalSpend: 800 }),
    );

    // expectedMtd = Σ revenue for current-month dates up to today (computed
    // from the rows, so it's correct regardless of trailing/MTD overlap).
    let expectedMtd = 0;
    for (const [date, revenue] of byDate) {
      if (date.slice(0, 7) === monthPrefix && date <= today) expectedMtd += revenue;
    }

    const f = forecastMonthEnd(rows);

    expect(f.monthToDateRevenue).toBe(expectedMtd);

    // All 7 trailing-window dates hold $10k → deterministic daily average.
    expect(f.dailyAvgRevenue).toBeCloseTo(BASELINE_PER_DAY, 6);

    // The projection extrapolates: MTD + dailyAvg × daysRemaining.
    const expectedProjection =
      f.monthToDateRevenue + f.dailyAvgRevenue * f.daysRemainingThisMonth;
    expect(f.projectedRevenue).toBeCloseTo(expectedProjection, 4);

    // Critically NOT collapsed to MTD — strictly greater when days remain,
    // proving the forecast projects the run-rate once fed the trailing rows.
    if (f.daysRemainingThisMonth > 0) {
      expect(f.projectedRevenue).toBeGreaterThan(f.monthToDateRevenue);
    }
    expect(Number.isFinite(f.projectedRevenue)).toBe(true);
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
    // Only on day 1 is the ENTIRE trailing window [today-7, today-1] outside
    // the current-month feed → baseline empty → projection collapses to MTD
    // (the documented bug). On day ≥2 some trailing dates ARE current-month
    // rows we supplied, so the baseline is non-zero — guard to day 1 so the
    // test is deterministic on any run date.
    if (todayDay === 1) {
      expect(f.dailyAvgRevenue).toBe(0);
      expect(f.projectedRevenue).toBeCloseTo(f.monthToDateRevenue, 4);
    }
    // Always finite — no NaN/Infinity leak regardless of the run date.
    expect(Number.isFinite(f.projectedRevenue)).toBe(true);
  });
});
