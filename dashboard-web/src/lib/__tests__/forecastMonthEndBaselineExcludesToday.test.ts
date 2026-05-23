// dashboard-web/src/lib/__tests__/forecastMonthEndBaselineExcludesToday.test.ts
//
// HIGH-10 / O3-HI-02 regression: forecastMonthEnd's 7-day baseline window
// used to be [today-6, today] — INCLUDED today. At an 11:00 snapshot the
// current day's row often holds 30-40% of its eventual revenue, dragging
// the daily-avg down by ~10% and emitting a optimistic-by-omission
// projection. Worse, today's MTD-side row was DOUBLE-counted across
// `mtdRev` + `dailyAvgRev * daysRemaining` in a subtle way.
//
// Fix: baseline window = [today-7, today-1] — last 7 COMPLETED days, today
// excluded. Trade-off: today's row never contributes to the projection's
// daily-avg. That's fine because today's row would either be incomplete
// or already counted in MTD; the projection's job is to extrapolate
// COMPLETED-day rate × daysRemaining.
//
// Test strategy: build a baseline of 7 completed days at a stable
// $1000/day plus a half-empty today row at $500. Pre-fix the daily avg
// would be ~929 ((7*1000 + 500)/8); post-fix it's exactly $1000.

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
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

describe('forecastMonthEnd baseline excludes today (HIGH-10 / O3-HI-02)', () => {
  it("today's half-empty row does NOT drag down dailyAvgRevenue", () => {
    // 7 completed days at $1000 revenue each + today's half-empty $500.
    // Post-fix dailyAvgRev should be exactly 1000 (today excluded).
    // Pre-fix dailyAvgRev would be (7000 + 500)/8 = 937.5.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 200,
          cogs: 250,
        }),
      );
    }
    rows.push(
      row({
        date: today,
        revenue: 500, // intentionally half a normal day — incomplete snapshot
        totalSpend: 100,
        cogs: 125,
      }),
    );

    const f = forecastMonthEnd(rows);
    // 7 days at $1000 → avg should be exactly $1000.
    expect(f.dailyAvgRevenue).toBeCloseTo(1000, 6);
    // Pin the pre-fix value so a regression is loud.
    expect(f.dailyAvgRevenue).not.toBeCloseTo(937.5, 0);
  });

  it("today's row is still counted in MTD totals (not the baseline, but MTD)", () => {
    // Sanity: HIGH-10 only changes the projection-baseline window, not
    // MTD. Today's revenue still flows into monthToDateRevenue.
    const today = todayInIsrael();
    const rows: DailyRow[] = [
      row({ date: addDays(today, -1), revenue: 1000 }),
      row({ date: today, revenue: 500 }),
    ];
    const f = forecastMonthEnd(rows);
    // MTD includes both today + yesterday (assuming both are in the same
    // month — the test runs near today so this is fine unless we're
    // exactly on day 1 of the month).
    if (today.endsWith('-01')) {
      // Edge-case: yesterday is in last month. Then MTD only contains today.
      expect(f.monthToDateRevenue).toBe(500);
    } else {
      expect(f.monthToDateRevenue).toBe(1500);
    }
    // Baseline (yesterday only) → dailyAvgRev = 1000.
    expect(f.dailyAvgRevenue).toBeCloseTo(1000, 6);
  });

  it('empty baseline (no rows in [today-7, today-1]) keeps dailyAvgRev at 0 without NaN', () => {
    // Only today has data. Baseline window is empty → last7DaysCount
    // is clamped to Math.max(1, 0) = 1; numerator is 0 → 0/1 = 0.
    // Crucial: no NaN/Infinity leak from a divide-by-zero.
    const today = todayInIsrael();
    const rows: DailyRow[] = [
      row({ date: today, revenue: 5000, totalSpend: 1000, cogs: 1250 }),
    ];
    const f = forecastMonthEnd(rows);
    expect(f.dailyAvgRevenue).toBe(0);
    expect(Number.isFinite(f.projectedRevenue)).toBe(true);
    expect(Number.isFinite(f.projectedNet)).toBe(true);
  });

  it('the window boundary is exactly [today-7, today-1] (not [today-8, today-2] or [today-6, today])', () => {
    // Pin the precise window: a row dated today-7 should be IN; today-8
    // should be OUT; today should be OUT; today-1 should be IN.
    const today = todayInIsrael();
    const rows: DailyRow[] = [
      row({ date: addDays(today, -8), revenue: 999 }), // OUT
      row({ date: addDays(today, -7), revenue: 100 }), // IN
      row({ date: addDays(today, -1), revenue: 100 }), // IN
      row({ date: today,              revenue: 999 }), // OUT
    ];
    const f = forecastMonthEnd(rows);
    // Baseline sees just the two $100 rows → avg = (200) / 2 = 100.
    expect(f.dailyAvgRevenue).toBeCloseTo(100, 6);
  });
});
