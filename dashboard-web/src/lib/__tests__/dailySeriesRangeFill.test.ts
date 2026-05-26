// dashboard-web/src/lib/__tests__/dailySeriesRangeFill.test.ts
//
// Regression tests for audit 2026-05-23-v3 CRIT-3 + HIGH-8:
//
//   CRIT-3 / O2-CR-02 — RoasChart categorical X-axis aliased gap days as
//                       1-day adjacency. dailySeries only emitted rows for
//                       dates that had data, so a 5-day outage in a 30-day
//                       window was rendered as a single 1-day slope between
//                       the surrounding active points. Same bug v2 c/CR-03
//                       fixed for HeroOverview's RoasTrendChart — but the
//                       primary RoasChart was missed.
//
//   HIGH-8 / O2-HI-05 — Missing per-store cells on a day where SOME store
//                       had data were back-filled with 0. The chart drew
//                       those as real ROAS=0 dots, indistinguishable from
//                       a legitimate "spent without earning" disaster.
//
// Fix: `dailySeries(rows, stores, range?)` — when `range` is supplied:
//   - The result walks EVERY calendar day in [range.from, range.to].
//   - Missing per-store cells emit `null` (not 0).
//   - Gap days have totalRoas=0, totalRevenue=0, totalSpend=0, and every
//     per-store value is `null`.
//
// vitest runs under environment: 'node'; analytics functions are pure.

import { describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import { dailySeries } from '../analytics';

// ---------------------------------------------------------------------------
// Production-shaped row builder. Matches the DailyRow contract that
// data_daily writes (cron-daily + cron-live). Defaults to a realistic
// hasCogs:true row so every field is explicit.
// ---------------------------------------------------------------------------
function row(overrides: Partial<DailyRow> = {}): DailyRow {
  const revenue = overrides.revenue ?? 0;
  const totalSpend = overrides.totalSpend ?? 0;
  const roas = totalSpend > 0 ? revenue / totalSpend : 0;
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
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

describe('dailySeries — CRIT-3: full-range walk with `range` arg', () => {
  it('30-day range with 5-day mid-range outage emits exactly 30 rows with nulls in the gap', () => {
    // Production-shape scenario: operator selected "last 30 days" via the
    // Filters preset; the data pipeline went down for 5 days in the middle
    // of the window (e.g. Frankfurter FX outage cascaded into cron-daily
    // dead-letters). Rows exist for days 1-12 + 18-30 (outage = days 13-17).
    const range: DateRange = { from: '2026-04-21', to: '2026-05-20' };
    const stores = ['uzoshop', 'Zol Plus'];
    const rows: DailyRow[] = [];

    // Days 1-12: both stores deliver normally.
    const activeBefore = [
      '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-25',
      '2026-04-26', '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30',
      '2026-05-01', '2026-05-02',
    ];
    for (const date of activeBefore) {
      rows.push(row({ date, storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000, totalSpend: 350 }));
      rows.push(row({ date, storeId: 'zolplus', storeName: 'Zol Plus', revenue: 600, totalSpend: 200 }));
    }
    // Days 13-17 (2026-05-03 .. 2026-05-07): OUTAGE — no rows at all.
    // Days 18-30: both stores resume.
    const activeAfter = [
      '2026-05-08', '2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12',
      '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17',
      '2026-05-18', '2026-05-19', '2026-05-20',
    ];
    for (const date of activeAfter) {
      rows.push(row({ date, storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1100, totalSpend: 360 }));
      rows.push(row({ date, storeId: 'zolplus', storeName: 'Zol Plus', revenue: 650, totalSpend: 210 }));
    }

    const series = dailySeries(rows, stores, range);

    // EXACT row count: 30 days inclusive — gap days must be present.
    expect(series).toHaveLength(30);

    // Chronological order, first + last dates match range bounds.
    expect(series[0].date).toBe('2026-04-21');
    expect(series[29].date).toBe('2026-05-20');
    for (let i = 1; i < series.length; i++) {
      expect(series[i - 1].date < series[i].date).toBe(true);
    }

    // Exact null positions for outage days 13-17 (indexes 12..16 zero-based).
    const outageDates = ['2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07'];
    for (const date of outageDates) {
      const day = series.find((d) => d.date === date)!;
      expect(day.byStore.uzoshop).toBeNull();
      expect(day.byStore['Zol Plus']).toBeNull();
      expect(day.totalRoas).toBe(0);
      expect(day.totalRevenue).toBe(0);
      expect(day.totalSpend).toBe(0);
    }

    // Active days have real numeric per-store ROAS (not null).
    const sampleBefore = series.find((d) => d.date === '2026-04-21')!;
    expect(sampleBefore.byStore.uzoshop).toBeCloseTo(1000 / 350, 6);
    expect(sampleBefore.byStore['Zol Plus']).toBeCloseTo(600 / 200, 6);

    const sampleAfter = series.find((d) => d.date === '2026-05-20')!;
    expect(sampleAfter.byStore.uzoshop).toBeCloseTo(1100 / 360, 6);
    expect(sampleAfter.byStore['Zol Plus']).toBeCloseTo(650 / 210, 6);

    // PRE-FIX behavior: 25 rows (gap days dropped). Pin so this can't regress.
    expect(series.length).not.toBe(25);
  });

  it('all stores with full coverage: behavior matches the row-derived path (no regression)', () => {
    // When every day in the range has data for every store, the range-fill
    // path must produce the same rows + per-store values as the legacy
    // (no-range) path. This is the "happy clean data" regression guard.
    const range: DateRange = { from: '2026-05-10', to: '2026-05-12' };
    const stores = ['uzoshop'];
    const rows: DailyRow[] = [
      row({ date: '2026-05-10', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      row({ date: '2026-05-11', storeName: 'uzoshop', revenue: 1200, totalSpend: 400 }),
      row({ date: '2026-05-12', storeName: 'uzoshop', revenue: 900, totalSpend: 300 }),
    ];

    const withRange = dailySeries(rows, stores, range);
    const withoutRange = dailySeries(rows, stores);

    expect(withRange).toHaveLength(3);
    expect(withoutRange).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      expect(withRange[i].date).toBe(withoutRange[i].date);
      expect(withRange[i].byStore.uzoshop).toBe(withoutRange[i].byStore.uzoshop);
      expect(withRange[i].totalRoas).toBe(withoutRange[i].totalRoas);
      expect(withRange[i].totalRevenue).toBe(withoutRange[i].totalRevenue);
      expect(withRange[i].totalSpend).toBe(withoutRange[i].totalSpend);
    }
  });

  it('single store with sparse data: gap days emit null per-store (HIGH-8)', () => {
    // Single-store scenario — operator filtered to one store; only days 1
    // and 3 of a 3-day window have rows. Gap day (day 2) must emit null
    // for the store, NOT 0 (HIGH-8 — pre-fix the chart drew ROAS=0 dots
    // for missing days, looking like a crash).
    const range: DateRange = { from: '2026-05-10', to: '2026-05-12' };
    const stores = ['uzoshop'];
    const rows: DailyRow[] = [
      row({ date: '2026-05-10', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      row({ date: '2026-05-12', storeName: 'uzoshop', revenue: 900, totalSpend: 300 }),
    ];

    const series = dailySeries(rows, stores, range);
    expect(series).toHaveLength(3);

    expect(series[0].date).toBe('2026-05-10');
    expect(series[0].byStore.uzoshop).toBeCloseTo(2.5, 6);

    expect(series[1].date).toBe('2026-05-11');
    // CRITICAL: this is `null`, not `0`. Pre-fix HIGH-8 emitted 0 here.
    expect(series[1].byStore.uzoshop).toBeNull();
    expect(series[1].byStore.uzoshop).not.toBe(0);
    expect(series[1].totalRoas).toBe(0);
    expect(series[1].totalRevenue).toBe(0);
    expect(series[1].totalSpend).toBe(0);

    expect(series[2].date).toBe('2026-05-12');
    expect(series[2].byStore.uzoshop).toBeCloseTo(3, 6);
  });

  it('partial-day coverage: store WITH data gets number, store WITHOUT gets null (HIGH-8)', () => {
    // The classic HIGH-8 trap: on a day where store A reports data but
    // store B doesn't (TikTok API rate limit, Meta token expired for one
    // store but not another, etc.), the missing store must be `null`, not 0.
    const range: DateRange = { from: '2026-05-15', to: '2026-05-15' };
    const stores = ['uzoshop', 'Zol Plus', '360usmile'];
    const rows: DailyRow[] = [
      row({ date: '2026-05-15', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      // Zol Plus + 360usmile have no row on this date.
    ];

    const series = dailySeries(rows, stores, range);
    expect(series).toHaveLength(1);
    const day = series[0];

    expect(day.byStore.uzoshop).toBeCloseTo(2.5, 6);
    expect(day.byStore['Zol Plus']).toBeNull();
    expect(day.byStore['360usmile']).toBeNull();
    // The totals across the day reflect just uzoshop (which is what's there).
    expect(day.totalRevenue).toBe(1000);
    expect(day.totalSpend).toBe(400);
    expect(day.totalRoas).toBeCloseTo(2.5, 6);
  });

  it('null flows through to chart-shaped data point correctly (CRIT-3 + HIGH-8 wire)', () => {
    // Simulate the exact transformation RoasChart performs:
    //   chartData = data.map(d => ({ date, dateLabel, ...d.byStore }))
    // The `null` per-store values must survive the spread so Recharts'
    // <Line connectNulls={false}> can render the gap. JSON-stringify also
    // round-trips null (unlike Infinity which collapses to null silently —
    // see HIGH-11 for that landmine).
    const range: DateRange = { from: '2026-05-10', to: '2026-05-12' };
    const stores = ['uzoshop', 'Zol Plus'];
    const rows: DailyRow[] = [
      row({ date: '2026-05-10', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      row({ date: '2026-05-12', storeId: 'zolplus', storeName: 'Zol Plus', revenue: 600, totalSpend: 200 }),
    ];

    const series = dailySeries(rows, stores, range);
    // The exact reshape RoasChart applies. Typed as an open-ended record so
    // the spread of dynamic store names compiles without each store name
    // needing its own key in the literal.
    type ChartRow = { date: string; dateLabel: string } & Record<string, string | number | null>;
    const chartData: ChartRow[] = series.map((d) => ({
      date: d.date,
      dateLabel: d.date.slice(5).replace('-', '/'),
      ...d.byStore,
    }));

    // Day 1: uzoshop=number, Zol Plus=null (the gap signal).
    expect(chartData[0].uzoshop).toBeCloseTo(2.5, 6);
    expect(chartData[0]['Zol Plus']).toBeNull();
    // Day 2 (middle): both stores null (full gap day).
    expect(chartData[1].uzoshop).toBeNull();
    expect(chartData[1]['Zol Plus']).toBeNull();
    // Day 3: uzoshop=null, Zol Plus=number.
    expect(chartData[2].uzoshop).toBeNull();
    expect(chartData[2]['Zol Plus']).toBeCloseTo(3, 6);

    // Round-trip: null survives JSON.stringify (Recharts serializes via
    // structured clone of the data prop — but JSON is the lowest common
    // denominator and the most likely shape SWR/cloudSync would touch).
    const roundtripped = JSON.parse(JSON.stringify(chartData)) as ChartRow[];
    expect(roundtripped[1].uzoshop).toBeNull();
    expect(roundtripped[1]['Zol Plus']).toBeNull();
  });
});

describe('dailySeries — legacy (no `range`) backward-compat', () => {
  it('without range arg: produces one row per distinct date present in rows', () => {
    // The legacy contract: only dates with data become rows. Missing
    // per-store cells default to `null` (the new safer default — the
    // pre-fix `0` was the HIGH-8 bug).
    const stores = ['uzoshop', 'Zol Plus'];
    const rows: DailyRow[] = [
      row({ date: '2026-05-15', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000, totalSpend: 400 }),
      row({ date: '2026-05-15', storeId: 'zolplus', storeName: 'Zol Plus', revenue: 500, totalSpend: 200 }),
      row({ date: '2026-05-16', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1200, totalSpend: 400 }),
      // Note: no Zol Plus row on 2026-05-16.
    ];

    const series = dailySeries(rows, stores);
    expect(series).toHaveLength(2);
    expect(series[0].date).toBe('2026-05-15');
    expect(series[1].date).toBe('2026-05-16');

    // Day 2: Zol Plus missing → null (HIGH-8 fix applies here too).
    expect(series[1].byStore.uzoshop).toBeCloseTo(3, 6);
    expect(series[1].byStore['Zol Plus']).toBeNull();
  });

  it('empty rows + no range: returns empty array', () => {
    expect(dailySeries([], ['uzoshop'])).toEqual([]);
  });

  it('empty rows + range provided: returns one null-only row per calendar day', () => {
    const range: DateRange = { from: '2026-05-10', to: '2026-05-12' };
    const series = dailySeries([], ['uzoshop'], range);
    expect(series).toHaveLength(3);
    for (const day of series) {
      expect(day.byStore.uzoshop).toBeNull();
      expect(day.totalRoas).toBe(0);
      expect(day.totalRevenue).toBe(0);
      expect(day.totalSpend).toBe(0);
    }
  });
});
