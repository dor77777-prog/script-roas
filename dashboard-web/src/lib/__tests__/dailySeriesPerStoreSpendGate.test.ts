/**
 * dailySeriesPerStoreSpendGate.test.ts — FIX #20 (per-store ROAS plots a
 * no-spend organic day as a catastrophic ROAS=0 dip).
 *
 * LIVE bug: usmile360 has many zero-spend days with organic revenue. On such
 * a day the row carries roas=0 (a 0-spend ratio is meaningless), and
 * dailySeries stored that 0 straight into byStore[store]. The per-store
 * sparkline + StoreDetail line then plotted a real ROAS=0 dot — looking like
 * the store crashed, when it simply had no ad spend that day.
 *
 * The DAY-level chart is already spend-gated (toChartPoints emits null when
 * totalSpend===0). This test pins the SAME gate at the per-store cell: a
 * store's per-day ROAS must be `null` (a gap) when that store had no spend
 * that day, and finite only when spend>0.
 */
import { describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import { dailySeries } from '../analytics';

function row(overrides: Partial<DailyRow> = {}): DailyRow {
  const revenue = overrides.revenue ?? 0;
  const totalSpend = overrides.totalSpend ?? 0;
  const roas = totalSpend > 0 ? revenue / totalSpend : 0;
  return {
    date: '2026-06-15',
    storeId: 'usmile360',
    storeName: '360usmile',
    fbSpend: totalSpend,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend,
    revenue,
    roas,
    grossProfit: revenue - totalSpend,
    cogs: revenue * 0.25,
    netProfit: revenue - totalSpend - revenue * 0.25,
    hasCogs: true,
    grossRevenue: revenue,
    refundDeduction: 0,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

describe('dailySeries — per-store ROAS is spend-gated (FIX #20)', () => {
  it('a no-spend organic day emits null (gap), NOT a real ROAS=0 dip', () => {
    const range: DateRange = { from: '2026-06-14', to: '2026-06-16' };
    const stores = ['360usmile'];
    const rows: DailyRow[] = [
      // Day 1 — paid: spend 200, revenue 600 → roas 3.0
      row({ date: '2026-06-14', revenue: 600, totalSpend: 200 }),
      // Day 2 — ORGANIC: zero spend but real revenue (the live usmile case).
      // The row's roas is 0 (no meaningful ratio); pre-fix it became a ROAS=0
      // dot on the sparkline.
      row({ date: '2026-06-15', revenue: 500, totalSpend: 0 }),
      // Day 3 — paid again.
      row({ date: '2026-06-16', revenue: 700, totalSpend: 250 }),
    ];

    const series = dailySeries(rows, stores, range);
    expect(series).toHaveLength(3);

    // Paid days are finite ROAS.
    expect(series[0].byStore['360usmile']).toBeCloseTo(3.0, 6);
    expect(series[2].byStore['360usmile']).toBeCloseTo(700 / 250, 6);

    // The organic no-spend day must be a GAP (null), not a 0-ROAS dip.
    expect(series[1].byStore['360usmile']).toBeNull();
    expect(series[1].byStore['360usmile']).not.toBe(0);
  });

  it('partial day: paid store finite, no-spend store null (multi-store)', () => {
    const range: DateRange = { from: '2026-06-15', to: '2026-06-15' };
    const stores = ['uzoshop', '360usmile'];
    const rows: DailyRow[] = [
      row({ date: '2026-06-15', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      // usmile spent nothing but earned organically.
      row({ date: '2026-06-15', storeId: 'usmile360', storeName: '360usmile', revenue: 300, totalSpend: 0 }),
    ];

    const series = dailySeries(rows, stores, range);
    expect(series[0].byStore.uzoshop).toBeCloseTo(2.5, 6);
    expect(series[0].byStore['360usmile']).toBeNull();
  });
});
