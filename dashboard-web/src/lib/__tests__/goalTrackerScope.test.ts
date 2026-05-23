import { describe, expect, it } from 'vitest';
import { filterRows } from '@/lib/analytics';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

/**
 * d/CR-04 (audit 2026-05-23) — locks the GoalTracker store-scoping fix.
 *
 * The component used to pass `data.rows` (every row, every store) directly
 * to `forecastMonthEnd`, so "X% מהיעד" stayed the all-stores total even
 * when the dashboard's global store filter narrowed every other KPI to a
 * single store. The fix runs `filterRows(rows, range, filters.store)`
 * BEFORE `forecastMonthEnd` so the panel scopes correctly.
 *
 * This suite tests the exact pipeline the component now uses:
 *   filterRows(rows, FULL_RANGE, store) -> forecastMonthEnd(scopedRows)
 *
 * The test is independent of "today" — we build a month-anchored fixture
 * around whatever today's Israel-tz YYYY-MM is. forecastMonthEnd's
 * `r.date >= monthStart && r.date <= today` slice will accept all of our
 * fixture rows (we put them on today's date) so the math is deterministic.
 */

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function makeRow(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(),
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 100,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

// Permissive range that mirrors what GoalTracker passes to filterRows so
// rows in the current month always survive the date guard. The component
// uses '0000-01-01'..'9999-12-31' for the same reason.
const FULL_RANGE = { from: '0000-01-01', to: '9999-12-31' };

describe('GoalTracker scoping pipeline — locks d/CR-04', () => {
  it('All-stores view sums every row regardless of storeName', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',   revenue: 1000 }),
      makeRow({ storeName: 'Zol Plus',  revenue: 2000 }),
      makeRow({ storeName: '360usmile', revenue: 3000 }),
    ];
    const scoped = filterRows(rows, FULL_RANGE, 'All');
    const forecast = forecastMonthEnd(scoped);
    expect(forecast.monthToDateRevenue).toBe(6000);
  });

  it('Filtered to uzoshop returns ONLY uzoshop revenue, ignoring siblings', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',   revenue: 1000 }),
      makeRow({ storeName: 'Zol Plus',  revenue: 2000 }),
      makeRow({ storeName: '360usmile', revenue: 3000 }),
    ];
    const scoped = filterRows(rows, FULL_RANGE, 'uzoshop');
    const forecast = forecastMonthEnd(scoped);
    // Pre-fix: would have returned 6000 (the unfiltered total) — the
    // operator's complaint. Post-fix: 1000 (uzoshop only).
    expect(forecast.monthToDateRevenue).toBe(1000);
  });

  it('Filtered store with NO matching rows returns 0 (not the all-stores total)', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',   revenue: 1000 }),
      makeRow({ storeName: 'Zol Plus',  revenue: 2000 }),
    ];
    const scoped = filterRows(rows, FULL_RANGE, '360usmile');
    const forecast = forecastMonthEnd(scoped);
    expect(forecast.monthToDateRevenue).toBe(0);
  });

  it('Filtered store with matching rows: spend is also scoped', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',  revenue: 1000, totalSpend: 100 }),
      makeRow({ storeName: 'Zol Plus', revenue: 2000, totalSpend: 500 }),
    ];
    const scopedAll = filterRows(rows, FULL_RANGE, 'All');
    const scopedUzo = filterRows(rows, FULL_RANGE, 'uzoshop');
    const all = forecastMonthEnd(scopedAll);
    const uzo = forecastMonthEnd(scopedUzo);
    expect(all.monthToDateSpend).toBe(600);
    expect(uzo.monthToDateSpend).toBe(100);
    // And revenue moves in lockstep — both numbers belong to the same
    // store after filtering.
    expect(uzo.monthToDateRevenue).toBe(1000);
  });
});
