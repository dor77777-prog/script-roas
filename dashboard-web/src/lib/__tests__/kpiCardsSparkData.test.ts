// dashboard-web/src/components/__tests__/kpiCardsSparkData.test.ts
//
// CRIT-4 / O2-CR-03 regression: KpiCards' net-profit sparkline was built as
// `revenue - spend - cogs(global 25%)` per day, while the big-number on the
// same card displays `current.trueNetProfit` which also subtracts transaction
// fees AND prorated fixed costs. The two shapes never matched — a card could
// display a $400/day net while the sparkline implied $600/day. Codex's
// preferred fix: drop the net-profit sparkline (rather than fake a daily
// allocation of fees + fixed costs that billing.ts doesn't currently prorate
// per day).
//
// HIGH-7 + Codex-NEW-1 land in follow-up commits and have their own files.
// This test only pins:
//   - `computeKpiSparkData` exists as an exported pure helper
//   - The returned shape NO LONGER includes a `netProfit` key
//   - Existing keys still produce the same per-day numbers as before
//
// vitest runs node so we can import the .tsx component file and use the
// exported helper directly — no JSX rendering needed.

import { describe, expect, it } from 'vitest';
import type { DailyRow } from '@/lib/types';
import { computeKpiSparkData } from '@/components/KpiCards';

function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-15',
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

describe('computeKpiSparkData (CRIT-4 / O2-CR-03)', () => {
  it('returns an empty shape for empty rows', () => {
    const spark = computeKpiSparkData([]);
    expect(spark.roas).toEqual([]);
    expect(spark.revenue).toEqual([]);
    expect(spark.spend).toEqual([]);
    expect(spark.grossProfit).toEqual([]);
    expect(spark.cogs).toEqual([]);
    // The key invariant: no netProfit field. TS-level type check is the
    // primary enforcement; this runtime assertion belts-and-braces a
    // refactor that might bring it back via Object.assign etc.
    expect('netProfit' in spark).toBe(false);
  });

  it('returns 5 series — and explicitly NO `netProfit` field — for a populated set', () => {
    const series: DailyRow[] = [
      row({ date: '2026-05-13', revenue: 100, totalSpend: 40, grossProfit: 60 }),
      row({ date: '2026-05-14', revenue: 200, totalSpend: 80, grossProfit: 120 }),
      row({ date: '2026-05-15', revenue: 300, totalSpend: 100, grossProfit: 200 }),
    ];
    const spark = computeKpiSparkData(series);
    expect(spark.roas).toHaveLength(3);
    expect(spark.revenue).toEqual([100, 200, 300]);
    expect(spark.spend).toEqual([40, 80, 100]);
    expect(spark.grossProfit).toEqual([60, 120, 200]);
    expect(spark.cogs).toHaveLength(3);

    // CRIT-4 hammer: net-profit sparkline is OUT. Pinning both ways so a
    // refactor cannot quietly re-add it.
    expect('netProfit' in spark).toBe(false);
    expect(Object.keys(spark).sort()).toEqual(
      ['cogs', 'grossProfit', 'revenue', 'roas', 'spend'].sort(),
    );
  });

  it('rolls up multiple stores per date into one sparkline point', () => {
    // Production-shape: two stores on the same date — each card's spark is
    // the cross-store sum per day (matches the global aggregate big-number).
    const series: DailyRow[] = [
      row({ date: '2026-05-15', storeName: 'uzoshop',  revenue: 100, totalSpend: 40, grossProfit: 60 }),
      row({ date: '2026-05-15', storeName: 'Zol Plus', revenue: 200, totalSpend: 80, grossProfit: 120 }),
    ];
    const spark = computeKpiSparkData(series);
    expect(spark.revenue).toEqual([300]);
    expect(spark.spend).toEqual([120]);
    expect(spark.grossProfit).toEqual([180]);
    // ROAS for the day = 300 / 120 = 2.5
    expect(spark.roas[0]).toBeCloseTo(2.5, 6);
  });

  it('per-day ROAS uses cross-store revenue / cross-store spend (weighted), not avg-of-rows', () => {
    // Two stores, very different ROAS, on the same day. Weighted-correct
    // answer is rev_sum / spend_sum, not average(r.roas). Pins the existing
    // dailyRoas behavior so a refactor doesn't accidentally switch to mean.
    const series: DailyRow[] = [
      row({ date: '2026-05-15', storeName: 'a', revenue: 1000, totalSpend: 100 }), // roas 10
      row({ date: '2026-05-15', storeName: 'b', revenue: 100,  totalSpend: 100 }), // roas 1
    ];
    const spark = computeKpiSparkData(series);
    // Weighted: (1000 + 100) / (100 + 100) = 1100/200 = 5.5
    expect(spark.roas[0]).toBeCloseTo(5.5, 6);
    // Not the unweighted mean (~5.5 is coincidentally also the mean here);
    // pick a second scenario that distinguishes them.
    const series2: DailyRow[] = [
      row({ date: '2026-05-15', storeName: 'a', revenue: 2000, totalSpend: 100 }), // roas 20
      row({ date: '2026-05-15', storeName: 'b', revenue: 100,  totalSpend: 100 }), // roas 1
    ];
    const spark2 = computeKpiSparkData(series2);
    // Weighted: 2100/200 = 10.5; unweighted mean would be 10.5 — also coincides.
    // Use a clear distinguisher:
    const series3: DailyRow[] = [
      row({ date: '2026-05-15', storeName: 'a', revenue: 1000, totalSpend: 100 }), // roas 10
      row({ date: '2026-05-15', storeName: 'b', revenue: 1000, totalSpend: 900 }), // roas ~1.11
    ];
    const spark3 = computeKpiSparkData(series3);
    // Weighted: 2000/1000 = 2.0. Unweighted mean: (10 + 1.11)/2 ≈ 5.56.
    expect(spark3.roas[0]).toBeCloseTo(2.0, 6);
    // Pin the spark2 value to keep this test's invariants explicit.
    expect(spark2.roas[0]).toBeCloseTo(10.5, 6);
  });

  it('sparkline date order is ascending (date string lex sort)', () => {
    // Out-of-order input rows must come out chronologically — the sparkline
    // assumes the x-axis is time-asc.
    const series: DailyRow[] = [
      row({ date: '2026-05-15', revenue: 300 }),
      row({ date: '2026-05-13', revenue: 100 }),
      row({ date: '2026-05-14', revenue: 200 }),
    ];
    const spark = computeKpiSparkData(series);
    expect(spark.revenue).toEqual([100, 200, 300]);
  });
});
