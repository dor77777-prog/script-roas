/**
 * Tests for the Home per-store drill-down MODAL adapter (`toStoreDetail`).
 *
 * The adapter is a PURE transform from the data the HomeTab already holds
 * (current + previous StoreAgg, the per-day DailySeries, the campaigns rows,
 * the per-store order count) into the `StoreDetailData` shape the
 * <StoreDetailModal> renders. No network, no React.
 *
 * Coverage:
 *   • kpis (spend / revenue / operatingProfit = rev−spend−cogs / orders / aov)
 *   • deltas: signed fraction, null when prev value missing/zero, orders/aov
 *     deltas only when prevOrders supplied
 *   • zeroSalesWithSpend mirror of PerStoreRow
 *   • roasSeries gap handling (null per-day cells preserved, ISO order)
 *   • platforms: cpm = spend/impr*1000 (null when 0 impr), roas = value/spend
 *     (null when 0 spend); empty platforms omitted
 *   • topCampaigns: roas-desc sort + top-5 cap
 */

import { describe, expect, it } from 'vitest';
import { toStoreDetail } from '@/lib/home/storeDetail';
import type { StoreAgg, DailySeries } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';

/** Minimal StoreAgg factory — only the fields the adapter reads matter. */
function makeAgg(over: Partial<StoreAgg> & { store: string }): StoreAgg {
  return {
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
    storeCount: 1,
    daysCovered: 0,
    trueNetProfit: 0,
    trueMargin: 0,
    rowCount: 0,
    ...over,
  };
}

/** Minimal CampaignRow factory. */
function makeRow(over: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'C1',
    adSetId: 'a1',
    adSetName: 'A1',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: null,
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...over,
  };
}

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

describe('toStoreDetail — kpis', () => {
  it('maps spend / revenue / operatingProfit(=rev−spend−cogs) / orders / aov', () => {
    const cur = makeAgg({
      store: 'uzoshop',
      spend: 1000,
      revenue: 5000,
      cogs: 1250,
      roas: 5,
    });
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 40,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.kpis.spend).toBe(1000);
    expect(d.kpis.revenue).toBe(5000);
    expect(d.kpis.operatingProfit).toBe(5000 - 1000 - 1250); // 2750
    expect(d.kpis.orders).toBe(40);
    expect(d.kpis.aov).toBeCloseTo(5000 / 40, 6); // 125
    expect(d.roas).toBe(5);
  });

  it('aov is null when orders is 0', () => {
    const cur = makeAgg({ store: 's', spend: 100, revenue: 0, roas: 0 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 0,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.kpis.aov).toBeNull();
  });

  it('roas is null when agg roas is 0 (mirrors PerStoreRow null-ROAS)', () => {
    const cur = makeAgg({ store: 's', spend: 0, revenue: 0, roas: 0 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 0,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.roas).toBeNull();
  });
});

describe('toStoreDetail — deltas', () => {
  it('signed fractional delta when prev value is present and non-zero', () => {
    const cur = makeAgg({ store: 's', spend: 1200, revenue: 6000, cogs: 1500, roas: 5 });
    const prev = makeAgg({ store: 's', spend: 1000, revenue: 5000, cogs: 1250, roas: 5 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 50,
      prevOrders: 40,
      updatedAt: null,
    });
    expect(d.deltas.spendPct).toBeCloseTo((1200 - 1000) / 1000, 6); // +0.2
    expect(d.deltas.revenuePct).toBeCloseTo((6000 - 5000) / 5000, 6); // +0.2
    // operatingProfit cur = 6000−1200−1500 = 3300; prev = 5000−1000−1250 = 2750
    expect(d.deltas.operatingProfitPct).toBeCloseTo((3300 - 2750) / 2750, 6);
    expect(d.deltas.ordersPct).toBeCloseTo((50 - 40) / 40, 6); // +0.25
    // aov cur = 6000/50 = 120; prev = 5000/40 = 125
    expect(d.deltas.aovPct).toBeCloseTo((120 - 125) / 125, 6);
  });

  it('all deltas null when prev StoreAgg is null', () => {
    const cur = makeAgg({ store: 's', spend: 1000, revenue: 5000, cogs: 1250 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 40,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.deltas.spendPct).toBeNull();
    expect(d.deltas.revenuePct).toBeNull();
    expect(d.deltas.operatingProfitPct).toBeNull();
    expect(d.deltas.ordersPct).toBeNull();
    expect(d.deltas.aovPct).toBeNull();
  });

  it('per-metric delta is null when that prev value is zero (no divide-by-zero, no fake 0)', () => {
    const cur = makeAgg({ store: 's', spend: 1000, revenue: 5000, cogs: 1250 });
    const prev = makeAgg({ store: 's', spend: 0, revenue: 5000, cogs: 1250 }); // prev spend 0
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 40,
      prevOrders: 40,
      updatedAt: null,
    });
    expect(d.deltas.spendPct).toBeNull(); // prev spend 0 → can't divide
    expect(d.deltas.revenuePct).toBeCloseTo(0, 6); // prev revenue non-zero → 0 delta is real
  });

  it('orders/aov deltas null when prevOrders not supplied even if prev StoreAgg present', () => {
    const cur = makeAgg({ store: 's', spend: 1000, revenue: 5000, cogs: 1250 });
    const prev = makeAgg({ store: 's', spend: 800, revenue: 4000, cogs: 1000 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 50,
      prevOrders: null, // not supplied
      updatedAt: null,
    });
    expect(d.deltas.spendPct).not.toBeNull(); // money deltas still computed
    expect(d.deltas.ordersPct).toBeNull();
    expect(d.deltas.aovPct).toBeNull();
  });
});

describe('toStoreDetail — zeroSalesWithSpend', () => {
  it('true when spend > 0 and revenue === 0', () => {
    const cur = makeAgg({ store: 's', spend: 100, revenue: 0, roas: 0 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 0,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.zeroSalesWithSpend).toBe(true);
  });

  it('false when spend === 0 (genuine no-activity)', () => {
    const cur = makeAgg({ store: 's', spend: 0, revenue: 0, roas: 0 });
    const d = toStoreDetail({
      storeId: 's',
      storeName: 's',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 0,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.zeroSalesWithSpend).toBe(false);
  });
});

describe('toStoreDetail — roasSeries', () => {
  it('walks the series in ISO order, keeping null gap days as null', () => {
    const series: DailySeries[] = [
      { date: '2026-05-01', byStore: { uzoshop: 2.1, other: 1.0 }, totalRoas: 2, totalRevenue: 0, totalSpend: 0 },
      { date: '2026-05-02', byStore: { uzoshop: null, other: 1.5 }, totalRoas: 0, totalRevenue: 0, totalSpend: 0 },
      { date: '2026-05-03', byStore: { uzoshop: 3.4 }, totalRoas: 3, totalRevenue: 0, totalSpend: 0 },
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series,
      campaignRows: [],
      range: RANGE,
      orders: 5,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.roasSeries).toEqual([
      { date: '2026-05-01', roas: 2.1 },
      { date: '2026-05-02', roas: null },
      { date: '2026-05-03', roas: 3.4 },
    ]);
  });

  it('missing store key on a day yields null roas for that day', () => {
    const series: DailySeries[] = [
      { date: '2026-05-01', byStore: { other: 1.0 }, totalRoas: 0, totalRevenue: 0, totalSpend: 0 },
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop' }),
      prev: null,
      series,
      campaignRows: [],
      range: RANGE,
      orders: 0,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.roasSeries).toEqual([{ date: '2026-05-01', roas: null }]);
  });
});

describe('toStoreDetail — platforms', () => {
  it('computes per-platform spend, cpm = spend/impr*1000, roas = value/spend', () => {
    const rows: CampaignRow[] = [
      makeRow({ platform: 'Meta', spend: 1000, impressions: 50_000, conversionValue: 3600 }),
      makeRow({ platform: 'Meta', spend: 200, impressions: 10_000, conversionValue: 720, campaignId: 'c2' }),
      makeRow({ platform: 'Google', spend: 500, impressions: 100_000, conversionValue: 1550, campaignId: 'g1' }),
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 1700, revenue: 5870, roas: 3.45 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 40,
      prevOrders: null,
      updatedAt: null,
    });
    const meta = d.platforms.find((p) => p.platform === 'meta');
    const google = d.platforms.find((p) => p.platform === 'google');
    expect(meta).toBeDefined();
    expect(meta!.spend).toBe(1200);
    expect(meta!.cpm).toBeCloseTo((1200 / 60_000) * 1000, 6); // 20
    expect(meta!.roas).toBeCloseTo(4320 / 1200, 6); // 3.6
    expect(google!.spend).toBe(500);
    expect(google!.cpm).toBeCloseTo((500 / 100_000) * 1000, 6); // 5
    expect(google!.roas).toBeCloseTo(1550 / 500, 6); // 3.1
  });

  it('cpm is null when impressions are 0; roas is null when spend is 0', () => {
    const rows: CampaignRow[] = [
      makeRow({ platform: 'Meta', spend: 100, impressions: 0, conversionValue: 300 }),
      makeRow({ platform: 'Google', spend: 0, impressions: 5000, conversionValue: 0, campaignId: 'g1' }),
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: null,
    });
    const meta = d.platforms.find((p) => p.platform === 'meta');
    const google = d.platforms.find((p) => p.platform === 'google');
    expect(meta!.cpm).toBeNull(); // 0 impressions
    // Google has 0 spend but rows present → included; roas null
    expect(google).toBeDefined();
    expect(google!.roas).toBeNull();
  });

  it('omits platforms with no rows entirely', () => {
    const rows: CampaignRow[] = [makeRow({ platform: 'Meta', spend: 100, impressions: 1000, conversionValue: 300 })];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.platforms.map((p) => p.platform)).toEqual(['meta']);
  });

  it('only counts rows for the requested store within the range', () => {
    const rows: CampaignRow[] = [
      makeRow({ platform: 'Meta', spend: 100, impressions: 1000, conversionValue: 300 }),
      makeRow({ platform: 'Meta', spend: 999, impressions: 9999, storeName: 'other', campaignId: 'x' }),
      makeRow({ platform: 'Meta', spend: 888, impressions: 8888, date: '2025-01-01', campaignId: 'y' }), // out of range
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: null,
    });
    const meta = d.platforms.find((p) => p.platform === 'meta');
    expect(meta!.spend).toBe(100); // other store + out-of-range excluded
  });
});

describe('toStoreDetail — topCampaigns', () => {
  it('aggregates per campaign, computes roas, sorts desc, caps at 5', () => {
    const rows: CampaignRow[] = [
      makeRow({ campaignId: 'a', campaignName: 'A', platform: 'Meta', spend: 100, conversionValue: 420 }), // 4.2
      makeRow({ campaignId: 'b', campaignName: 'B', platform: 'Google', spend: 100, conversionValue: 330 }), // 3.3
      makeRow({ campaignId: 'c', campaignName: 'C', platform: 'Meta', spend: 100, conversionValue: 300 }), // 3.0
      makeRow({ campaignId: 'd', campaignName: 'D', platform: 'TikTok', spend: 100, conversionValue: 240 }), // 2.4
      makeRow({ campaignId: 'e', campaignName: 'E', platform: 'Meta', spend: 100, conversionValue: 170 }), // 1.7
      makeRow({ campaignId: 'f', campaignName: 'F', platform: 'Meta', spend: 100, conversionValue: 100 }), // 1.0 (should drop, top5)
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 600, revenue: 1560, roas: 2.6 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 10,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.topCampaigns).toHaveLength(5);
    expect(d.topCampaigns.map((c) => c.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(d.topCampaigns[0].roas).toBeCloseTo(4.2, 6);
    expect(d.topCampaigns[0].platform).toBe('meta');
    expect(d.topCampaigns[0].spend).toBe(100);
  });

  it('folds multiple rows of the same campaign before computing roas', () => {
    const rows: CampaignRow[] = [
      makeRow({ campaignId: 'a', campaignName: 'A', platform: 'Meta', date: '2026-05-10', spend: 50, conversionValue: 200 }),
      makeRow({ campaignId: 'a', campaignName: 'A', platform: 'Meta', date: '2026-05-11', spend: 50, conversionValue: 220 }),
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 420, roas: 4.2 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 4,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.topCampaigns).toHaveLength(1);
    expect(d.topCampaigns[0].spend).toBe(100);
    expect(d.topCampaigns[0].roas).toBeCloseTo(420 / 100, 6); // 4.2
  });

  it('a campaign with 0 spend gets roas null and sorts last', () => {
    const rows: CampaignRow[] = [
      makeRow({ campaignId: 'a', campaignName: 'A', platform: 'Meta', spend: 100, conversionValue: 300 }),
      makeRow({ campaignId: 'z', campaignName: 'Z', platform: 'Meta', spend: 0, conversionValue: 0, impressions: 10 }),
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: rows,
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.topCampaigns[0].name).toBe('A');
    expect(d.topCampaigns[d.topCampaigns.length - 1].name).toBe('Z');
    expect(d.topCampaigns.find((c) => c.name === 'Z')!.roas).toBeNull();
  });
});

describe('toStoreDetail — passthrough fields', () => {
  it('passes storeId, storeName, updatedAt through', () => {
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: [],
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: '2026-05-31T10:00:00Z',
    });
    expect(d.storeId).toBe('uzoshop');
    expect(d.storeName).toBe('uzoshop');
    expect(d.updatedAt).toBe('2026-05-31T10:00:00Z');
  });

  it('tolerates undefined campaignRows (no platforms, no campaigns)', () => {
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur: makeAgg({ store: 'uzoshop', spend: 100, revenue: 300, roas: 3 }),
      prev: null,
      series: [],
      campaignRows: undefined,
      range: RANGE,
      orders: 2,
      prevOrders: null,
      updatedAt: null,
    });
    expect(d.platforms).toEqual([]);
    expect(d.topCampaigns).toEqual([]);
  });
});
