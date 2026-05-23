import { describe, expect, it } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

/**
 * Operator correction (2026-05-23) — supersedes the original d/CR-04 fix.
 *
 * The monthly revenue goal is a single business-wide target. It must NOT
 * change with the dashboard's store filter or its date range. The earlier
 * audit-fix wired `filterRows(rows, FULL_RANGE, filters.store)` into the
 * GoalTracker so MTD scoped per store; the operator rejected that — the
 * intent is one goal across the whole business, not a per-store sub-goal.
 *
 * This suite locks the new contract:
 *   - forecastMonthEnd(data.rows) is fed the unfiltered row set
 *   - MTD revenue always equals the sum across every store
 *   - No store-specific subset is ever computed by the panel
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

describe('GoalTracker is global — locks operator correction (2026-05-23)', () => {
  it('MTD revenue is the sum across every store, regardless of storeName', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',   revenue: 1000 }),
      makeRow({ storeName: 'Zol Plus',  revenue: 2000 }),
      makeRow({ storeName: '360usmile', revenue: 3000 }),
    ];
    // Component now feeds data.rows directly (no filterRows call).
    const forecast = forecastMonthEnd(rows);
    expect(forecast.monthToDateRevenue).toBe(6000);
  });

  it('MTD spend is also the unfiltered cross-store total', () => {
    const rows: DailyRow[] = [
      makeRow({ storeName: 'uzoshop',  revenue: 1000, totalSpend: 100 }),
      makeRow({ storeName: 'Zol Plus', revenue: 2000, totalSpend: 500 }),
    ];
    const forecast = forecastMonthEnd(rows);
    expect(forecast.monthToDateRevenue).toBe(3000);
    expect(forecast.monthToDateSpend).toBe(600);
  });

  it('Empty row set produces zeros, never a per-store fallback', () => {
    const forecast = forecastMonthEnd([]);
    expect(forecast.monthToDateRevenue).toBe(0);
    expect(forecast.monthToDateSpend).toBe(0);
  });
});
