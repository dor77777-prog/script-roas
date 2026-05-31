// dashboard-web/src/lib/home/__tests__/adapters.test.ts
//
// Task 3.1 — home-tab data-adapter contract tests.
//
// Pins the no-info-loss promise: every adapter exposes the upstream value
// untouched, never silently invents one, and degrades cleanly to null
// when an input is missing rather than feeding "—" through as 0.

import { describe, expect, it } from 'vitest';
import {
  aggregateCpm,
  annotationsToPins,
  toChartData,
  toHeroDelta,
  toHeroPeriod,
  toPerStoreData,
} from '../adapters';
import type { Aggregate, StoreAgg } from '@/lib/analytics';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { Annotation } from '@/lib/annotations';

const EMPTY_AGG: Aggregate = {
  revenue: 0,
  spend: 0,
  fbSpend: 0,
  gaSpend: 0,
  ttSpend: 0,
  roas: 0,
  grossProfit: 0,
  cogs: 0,
  netProfit: 0,
  transactionFees: 0,
  fixedCosts: 0,
  storeCount: 0,
  daysCovered: 0,
  trueNetProfit: 0,
  trueMargin: 0,
  rowCount: 0,
};

function agg(overrides: Partial<Aggregate>): Aggregate {
  return { ...EMPTY_AGG, ...overrides };
}

describe('aggregateCpm', () => {
  it('returns 0/0/0 when rows is undefined', () => {
    const result = aggregateCpm(undefined, '2026-05-01', '2026-05-31', 'All');
    expect(result).toEqual({ cpm: 0, impressions: 0, spend: 0 });
  });

  it('sums spend + impressions across the range and divides into CPM', () => {
    const rows: CampaignsResponse['rows'] = [
      // in-range
      makeRow({ date: '2026-05-10', spend: 100, impressions: 10_000 }),
      // in-range
      makeRow({ date: '2026-05-20', spend: 200, impressions: 20_000 }),
      // out of range
      makeRow({ date: '2026-04-30', spend: 9999, impressions: 999_999 }),
    ];
    const r = aggregateCpm(rows, '2026-05-01', '2026-05-31', 'All');
    expect(r.spend).toBe(300);
    expect(r.impressions).toBe(30_000);
    // 300 / 30_000 * 1000 = 10
    expect(r.cpm).toBe(10);
  });

  it('filters by store when scope !== "All"', () => {
    const rows: CampaignsResponse['rows'] = [
      makeRow({ storeName: 'uzoshop', date: '2026-05-10', spend: 100, impressions: 10_000 }),
      makeRow({ storeName: 'other',   date: '2026-05-10', spend: 999, impressions: 999_000 }),
    ];
    const r = aggregateCpm(rows, '2026-05-01', '2026-05-31', 'uzoshop');
    expect(r.spend).toBe(100);
  });
});

describe('toHeroPeriod', () => {
  it('maps trueNetProfit (not legacy netProfit) into the hero', () => {
    const a = agg({
      trueNetProfit: 4847,
      netProfit: 5000, // legacy — should NOT leak through
      revenue: 10998,
      spend: 3924,
      roas: 2.8,
    });
    const p = toHeroPeriod(a, { cpm: 8.92, impressions: 100, spend: 50 }, 188);
    expect(p.netProfit).toBe(4847);
    expect(p.revenue).toBe(10998);
    expect(p.spend).toBe(3924);
    expect(p.roas).toBe(2.8);
    expect(p.cpm).toBe(8.92);
    expect(p.orders).toBe(188);
  });

  it('null-coerces ROAS when spend is 0', () => {
    const p = toHeroPeriod(agg({ roas: 0 }), { cpm: 0, impressions: 0, spend: 0 }, 0);
    expect(p.roas).toBeNull();
  });

  it('null-coerces CPM when impressions is 0', () => {
    const p = toHeroPeriod(agg({ revenue: 100 }), { cpm: 0, impressions: 0, spend: 0 }, 0);
    expect(p.cpm).toBeNull();
  });
});

describe('toHeroDelta', () => {
  it('returns all-null deltas when the previous period is empty', () => {
    const d = toHeroDelta(
      agg({ revenue: 100, spend: 50, roas: 2 }),
      agg({}), // empty
      { cpm: 0, impressions: 0, spend: 0 },
      { cpm: 0, impressions: 0, spend: 0 },
      10,
      0,
    );
    expect(d.roas).toBeNull();
    expect(d.netProfit).toBeNull();
    expect(d.revenuePct).toBeNull();
    expect(d.spendPct).toBeNull();
    expect(d.orders).toBeNull();
  });

  it('computes deltas when both periods have data', () => {
    const d = toHeroDelta(
      agg({ revenue: 200, spend: 100, roas: 2, trueNetProfit: 50 }),
      agg({ revenue: 100, spend: 50,  roas: 1, trueNetProfit: 25 }),
      { cpm: 8, impressions: 10, spend: 80 },
      { cpm: 4, impressions: 5,  spend: 20 },
      10,
      5,
    );
    expect(d.roas).toBe(1);
    expect(d.netProfit).toBe(25);
    expect(d.revenuePct).toBe(1);
    expect(d.spendPct).toBe(1);
    expect(d.cpmPct).toBe(1);
    expect(d.orders).toBe(5);
  });
});

describe('toPerStoreData', () => {
  it('attaches per-platform CPM only for platforms with spend in range', () => {
    const storeAggs: StoreAgg[] = [
      { ...agg({ revenue: 5000, spend: 1500, roas: 3.3 }), store: 'uzoshop' },
    ];
    const rows: CampaignsResponse['rows'] = [
      makeRow({ storeName: 'uzoshop', platform: 'Meta',   date: '2026-05-10', spend: 800, impressions: 100_000 }),
      makeRow({ storeName: 'uzoshop', platform: 'Google', date: '2026-05-10', spend: 600, impressions:  60_000 }),
      // tiktok has impressions but zero spend → omitted
      makeRow({ storeName: 'uzoshop', platform: 'TikTok', date: '2026-05-10', spend: 0,   impressions:  50_000 }),
    ];
    const result = toPerStoreData(
      storeAggs,
      rows,
      { from: '2026-05-01', to: '2026-05-31' },
      { uzoshop: 70 },
      {},
    );
    expect(result.length).toBe(1);
    const u = result[0];
    expect(u.perPlatformCpm.meta?.spend).toBe(800);
    expect(u.perPlatformCpm.google?.spend).toBe(600);
    expect(u.perPlatformCpm.tiktok).toBeUndefined();
    // AOV = revenue/orders
    expect(u.aov).toBeCloseTo(5000 / 70, 5);
  });

  it('null-coerces AOV when orders is 0 (avoids divide-by-zero)', () => {
    const storeAggs: StoreAgg[] = [
      { ...agg({ revenue: 1000, spend: 100, roas: 10 }), store: 'uzoshop' },
    ];
    const result = toPerStoreData(
      storeAggs,
      [],
      { from: '2026-05-01', to: '2026-05-31' },
      {},
      {},
    );
    expect(result[0].aov).toBeNull();
  });
});

describe('annotationsToPins — Bug fix (2026-05-31)', () => {
  it('maps every annotation to a pin with id + date + label + canonical kind emoji', () => {
    const annotations: Annotation[] = [
      { id: 'a1', date: '2026-05-10', kind: 'launch', title: 'New campaign', createdAt: 1 },
      { id: 'a2', date: '2026-05-15', kind: 'budget', title: 'Bumped CBO', createdAt: 2 },
      { id: 'a3', date: '2026-05-20', kind: 'pause',  title: 'Paused under-performer', createdAt: 3 },
    ];
    const pins = annotationsToPins(annotations);
    expect(pins).toHaveLength(3);
    expect(pins[0]).toEqual({ id: 'a1', date: '2026-05-10', icon: '✨', label: 'New campaign' });
    expect(pins[1]).toEqual({ id: 'a2', date: '2026-05-15', icon: '💰', label: 'Bumped CBO' });
    expect(pins[2]).toEqual({ id: 'a3', date: '2026-05-20', icon: '⏸', label: 'Paused under-performer' });
  });

  it('returns an empty array for empty input', () => {
    expect(annotationsToPins([])).toEqual([]);
  });
});

describe('toChartData — annotation pins wiring (Bug fix 2026-05-31)', () => {
  const aggZero: Aggregate = agg({});
  const cpmZero = { cpm: 0, impressions: 0, spend: 0 };

  it('emits empty pins when annotations is omitted (back-compat)', () => {
    const out = toChartData([], aggZero, cpmZero, null);
    expect(out.pins).toEqual([]);
  });

  it('plumbs supplied annotations through to pins so the chart can render them', () => {
    const annotations: Annotation[] = [
      { id: 'pin-1', date: '2026-05-10', kind: 'sale', title: 'BFCM dry-run', createdAt: 1 },
    ];
    const out = toChartData([], aggZero, cpmZero, null, annotations);
    expect(out.pins).toHaveLength(1);
    expect(out.pins[0].id).toBe('pin-1');
    expect(out.pins[0].date).toBe('2026-05-10');
    expect(out.pins[0].label).toBe('BFCM dry-run');
  });
});

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function makeRow(
  overrides: Partial<CampaignsResponse['rows'][number]>,
): CampaignsResponse['rows'][number] {
  // Cast: CampaignRow has 30+ fields including registry/freshness extras
  // that this adapter doesn't read. The Partial cast keeps the test
  // focused on the only fields aggregateCpm + toPerStoreData consume.
  return {
    date: '2026-05-10',
    storeName: 'uzoshop',
    storeId: 'uzoshop',
    platform: 'Meta',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    ...overrides,
  } as unknown as CampaignsResponse['rows'][number];
}
