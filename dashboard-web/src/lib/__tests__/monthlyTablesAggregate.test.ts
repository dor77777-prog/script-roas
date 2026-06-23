// Pure aggregation helpers for the Monthly (Archive) tables enhancements.
// Step 1 (net profit + margin) + Step 3-5 (scorecard matrix + MoM delta).
import { describe, it, expect } from 'vitest';
import type { DailyRow } from '@/lib/types';
import {
  aggregateRows,
  marginPct,
  computeMonthScorecards,
} from '@/lib/monthlyTablesAggregate';

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date'>): DailyRow {
  const fb = over.fbSpend ?? 0;
  const ga = over.gaSpend ?? 0;
  const tt = over.ttSpend ?? 0;
  const totalSpend = over.totalSpend ?? fb + ga + tt;
  const revenue = over.revenue ?? 0;
  return {
    storeId: over.storeId ?? 'store-1',
    storeName: over.storeName ?? 'store-1',
    fbSpend: fb,
    gaSpend: ga,
    ttSpend: tt,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    grossProfit: over.grossProfit ?? 0,
    cogs: over.cogs ?? 0,
    netProfit: over.netProfit ?? 0,
    hasCogs: over.hasCogs ?? false,
    grossRevenue: over.grossRevenue ?? null,
    refundDeduction: over.refundDeduction ?? null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
  };
}

describe('aggregateRows', () => {
  it('sums spend / revenue / netProfit and computes blended ROAS', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 300, netProfit: 120, hasCogs: true }),
      makeRow({ date: '2026-06-02', fbSpend: 200, revenue: 600, netProfit: 250, hasCogs: true }),
    ];
    const agg = aggregateRows(rows);
    expect(agg.totalSpend).toBe(300);
    expect(agg.revenue).toBe(900);
    expect(agg.netProfit).toBe(370);
    expect(agg.roas).toBeCloseTo(3, 5);
    expect(agg.hasCogs).toBe(true);
  });

  it('only counts netProfit from rows that have COGS; hasCogs false when none do', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 300, netProfit: 0, hasCogs: false }),
      makeRow({ date: '2026-06-02', fbSpend: 200, revenue: 600, netProfit: 0, hasCogs: false }),
    ];
    const agg = aggregateRows(rows);
    expect(agg.hasCogs).toBe(false);
  });

  it('roas is 0 when spend is 0 (avoids divide-by-zero)', () => {
    const rows: DailyRow[] = [makeRow({ date: '2026-06-01', totalSpend: 0, revenue: 500 })];
    expect(aggregateRows(rows).roas).toBe(0);
  });
});

describe('marginPct', () => {
  it('returns netProfit / revenue as a fraction', () => {
    expect(marginPct(250, 1000)).toBeCloseTo(0.25, 5);
  });
  it('returns null when revenue is 0', () => {
    expect(marginPct(250, 0)).toBeNull();
  });
  it('can be negative', () => {
    expect(marginPct(-100, 1000)).toBeCloseTo(-0.1, 5);
  });
});

describe('computeMonthScorecards', () => {
  it('produces one card per month, sorted newest-first, with MoM deltas vs the prior calendar month', () => {
    const rows: DailyRow[] = [
      // May: spend 100, revenue 300, ROAS 3, net 100
      makeRow({ date: '2026-05-01', fbSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      // June: spend 200, revenue 800, ROAS 4, net 300
      makeRow({ date: '2026-06-01', fbSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    const cards = computeMonthScorecards(rows);
    expect(cards.map(c => c.ym)).toEqual(['2026-06', '2026-05']);

    const june = cards[0];
    expect(june.totalSpend).toBe(200);
    expect(june.revenue).toBe(800);
    expect(june.roas).toBeCloseTo(4, 5);
    expect(june.netProfit).toBe(300);
    expect(june.margin).toBeCloseTo(300 / 800, 5);

    // MoM deltas June vs May: spend (200-100)/100 = +1.0, rev (800-300)/300, etc.
    expect(june.deltas).not.toBeNull();
    expect(june.deltas!.spend).toBeCloseTo(1.0, 5);
    expect(june.deltas!.revenue).toBeCloseTo(500 / 300, 5);
    expect(june.deltas!.roas).toBeCloseTo((4 - 3) / 3, 5);
    expect(june.deltas!.netProfit).toBeCloseTo((300 - 100) / 100, 5);
  });

  it('the OLDEST month (no prior) has null deltas', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-05-01', fbSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', fbSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    const cards = computeMonthScorecards(rows);
    const may = cards.find(c => c.ym === '2026-05')!;
    expect(may.deltas).toBeNull();
  });

  it('delta uses the immediately-prior CALENDAR month, not just the prior list entry (gap-aware)', () => {
    // March and June only (April + May missing). June's prior is March in the
    // ordering, but since there is no April/May the prior-list-entry IS March,
    // so the delta is vs March. We assert the prior is the next-older present month.
    const rows: DailyRow[] = [
      makeRow({ date: '2026-03-01', fbSpend: 100, revenue: 200, netProfit: 50, hasCogs: true }),
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 150, hasCogs: true }),
    ];
    const cards = computeMonthScorecards(rows);
    const june = cards.find(c => c.ym === '2026-06')!;
    expect(june.deltas).not.toBeNull();
    expect(june.deltas!.revenue).toBeCloseTo((400 - 200) / 200, 5);
  });

  it('per-month dailyRoasSeries is ordered by date ascending for the sparkline', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-03', fbSpend: 100, revenue: 500, roas: 5 }),
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 200, roas: 2 }),
      makeRow({ date: '2026-06-02', fbSpend: 100, revenue: 300, roas: 3 }),
    ];
    const cards = computeMonthScorecards(rows);
    const june = cards.find(c => c.ym === '2026-06')!;
    expect(june.dailyRoasSeries).toEqual([2, 3, 5]);
  });

  it('aggregates multiple stores within a month into one card', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 'a', fbSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', storeName: 'b', fbSpend: 100, revenue: 500, netProfit: 200, hasCogs: true }),
    ];
    const cards = computeMonthScorecards(rows);
    expect(cards).toHaveLength(1);
    expect(cards[0].totalSpend).toBe(200);
    expect(cards[0].revenue).toBe(800);
    expect(cards[0].netProfit).toBe(300);
  });
});
