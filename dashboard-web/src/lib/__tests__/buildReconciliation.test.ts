import { describe, it, expect, vi } from 'vitest';

// MetaShopifyReconciliation imports lucide-react + recharts (UI libs).
// Stub them so the pure-function buildReconciliation can run in Node.
vi.mock('lucide-react', () => ({ TrendingUp: () => null }));
vi.mock('recharts', () => ({
  ComposedChart: () => null,
  Line: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { buildReconciliation } from '@/components/MetaShopifyReconciliation';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import { campaignKey, type ProductMap } from '@/lib/campaignProductMap';
import type { ProductRow } from '@/lib/products';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const STORE = 'uzoshop';
const CAMP_META = 'meta-camp-1';
const CAMP_META_2 = 'meta-camp-2';
const CAMP_GOOGLE = 'google-camp-1';
const PROD_A = 'prod-a';
const PROD_B = 'prod-b';

/** 5 consecutive dates starting 2026-05-01 */
const DATES = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'];
const RANGE_FROM = DATES[0];
const RANGE_TO = DATES[DATES.length - 1];

function makeSummary(overrides: {
  platform?: string;
  campaignId?: string;
  values?: number[];
} = {}) {
  const { platform = 'Meta', campaignId = CAMP_META, values = [100, 120, 80, 110, 90] } = overrides;
  return {
    platform,
    campaignId,
    dailyArr: DATES.map((date, i) => ({ date, value: values[i] ?? 0 })),
  };
}

function makeProductRow(overrides: Partial<ProductRow>): ProductRow {
  return {
    date: '2026-05-01',
    storeId: STORE,
    storeName: 'uzoshop',
    productId: PROD_A,
    productTitle: 'Product A',
    units: 1,
    revenue: 100,
    orders: 1,
    netRevenue: 100,
    ...overrides,
  };
}

function makeCampaignRow(overrides: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-05-01',
    storeId: STORE,
    storeName: 'uzoshop',
    platform: 'Google',
    campaignId: CAMP_GOOGLE,
    campaignName: 'Google Camp 1',
    adSetId: 'adset-g1',
    adSetName: 'Ad Set G1',
    spend: 50,
    impressions: 1000,
    clicks: 50,
    conversions: 3,
    conversionValue: 150,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    ...overrides,
  };
}

function makeOrderRow(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-01',
    storeId: STORE,
    storeName: 'uzoshop',
    orderId: 'ord-1',
    totalCad: 80,
    source: 'direct',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    fbclidPresent: false,
    gclidPresent: false,
    referringSite: '',
    utmId: '',
    utmTerm: '',
    lineItems: [{ productId: PROD_A, units: 1, revenueCad: 80 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Full 4-series with Meta campaign
// ---------------------------------------------------------------------------

describe('buildReconciliation', () => {
  it('returns 4-key series + 4 Pearson values + darkTrafficPercent for full data', () => {
    const metaValues = [100, 120, 80, 110, 90];
    const extraMetaValues = [5, 6, 4, 5, 4];
    const shopifyValues = [95, 115, 75, 105, 85]; // close to meta
    const googleValues = [20, 30, 10, 25, 15];
    const organicValues = [10, 15, 5, 12, 8];

    const productsData = {
      rows: DATES.map((date, i) => makeProductRow({ date, netRevenue: shopifyValues[i] })),
      lastUpdated: new Date().toISOString(),
    };

    const metaCampaignRows = DATES.flatMap((date, i) => [
      makeCampaignRow({
        date,
        platform: 'Meta',
        campaignId: CAMP_META,
        campaignName: 'Meta Camp 1',
        conversionValue: metaValues[i],
      }),
      makeCampaignRow({
        date,
        platform: 'Meta',
        campaignId: CAMP_META_2,
        campaignName: 'Meta Camp 2',
        conversionValue: extraMetaValues[i],
      }),
    ]);
    const googleCampaignRows = DATES.map((date, i) =>
      makeCampaignRow({ date, conversionValue: googleValues[i] }),
    );

    const organicOrders = DATES.map((date, i) =>
      makeOrderRow({
        date,
        orderId: `ord-${i}`,
        source: 'direct',
        lineItems: [{ productId: PROD_A, units: 1, revenueCad: organicValues[i] }],
      }),
    );
    const paidOrders = DATES.map((date, i) =>
      makeOrderRow({
        date,
        orderId: `paid-${i}`,
        source: 'meta-paid',
        fbclidPresent: true,
        lineItems: [{ productId: PROD_A, units: 1, revenueCad: shopifyValues[i] - organicValues[i] }],
      }),
    );

    const productMap: ProductMap = {
      [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A],
      [campaignKey(STORE, 'Meta', CAMP_META_2)]: [PROD_A],
      [campaignKey(STORE, 'Google', CAMP_GOOGLE)]: [PROD_A],
    };

    const result = buildReconciliation({
      summary: makeSummary({ values: metaValues }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: [...metaCampaignRows, ...googleCampaignRows] },
      ordersData: { rows: [...organicOrders, ...paidOrders] },
      productMap,
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });

    expect(result).not.toBeNull();
    expect(result!.series).toHaveLength(5);

    // Each point has all 4 keys
    const first = result!.series[0];
    expect(first).toHaveProperty('date', '2026-05-01');
    expect(first).toHaveProperty('meta', 105);
    expect(first).toHaveProperty('google', 20);
    expect(first).toHaveProperty('organic', 10);
    expect(first).toHaveProperty('shopify', 95);

    // 4 Pearson values present and in valid range
    expect(typeof result!.r).toBe('number');
    expect(typeof result!.rGoogle).toBe('number');
    expect(typeof result!.rOrganic).toBe('number');
    expect(typeof result!.rCombined).toBe('number');
    expect(result!.r).toBeGreaterThanOrEqual(-1);
    expect(result!.r).toBeLessThanOrEqual(1);

    // darkTrafficPercent is a non-negative number
    expect(typeof result!.darkTrafficPercent).toBe('number');
    expect(result!.darkTrafficPercent).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Store without Google campaigns → google series all zeros
  // ---------------------------------------------------------------------------

  it('returns google series = 0 for every day when no Google campaigns in productMap', () => {
    const productsData = {
      rows: DATES.map(date => makeProductRow({ date, netRevenue: 100 })),
      lastUpdated: new Date().toISOString(),
    };

    // zolplus has no Google campaigns, productMap empty for Google
    const productMap: ProductMap = { [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A] };

    const result = buildReconciliation({
      summary: makeSummary({ values: [100, 120, 80, 110, 90] }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: [] }, // no campaigns at all
      ordersData: { rows: [] },
      productMap,
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });

    expect(result).not.toBeNull();
    for (const s of result!.series) {
      expect(s.google).toBe(0);
    }
    // rGoogle is null (all zeros -> no variance)
    expect(result!.rGoogle).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 3: Partial-order line-item organic attribution
  // ---------------------------------------------------------------------------

  it('counts only mapped-product line items for organic, not unmapped products', () => {
    const productsData = {
      rows: DATES.map(date => makeProductRow({ date, netRevenue: 100 })),
      lastUpdated: new Date().toISOString(),
    };

    // One order per day: mixed product (prod-a mapped, prod-b NOT mapped)
    const orders = DATES.map((date, i) =>
      makeOrderRow({
        date,
        orderId: `ord-${i}`,
        source: 'direct',
        totalCad: 120,
        lineItems: [
          { productId: PROD_A, units: 1, revenueCad: 60 }, // mapped
          { productId: PROD_B, units: 1, revenueCad: 60 }, // NOT mapped
        ],
      }),
    );

    const result = buildReconciliation({
      summary: makeSummary(),
      productsData,
      mappedIds: [PROD_A], // only PROD_A mapped, not PROD_B
      storeId: STORE,
      campaignsData: { rows: [] },
      ordersData: { rows: orders },
      productMap: {},
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });

    expect(result).not.toBeNull();
    // Each day organic should be 60 (only the mapped line item), not 120
    for (const s of result!.series) {
      expect(s.organic).toBe(60);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: Dark traffic detection
  // ---------------------------------------------------------------------------

  it('sets darkTrafficPercent when Meta+Google+Organic < 80% of Shopify', () => {
    // channels = 60 total per day, shopify = 100 per day → gap = 40%
    const productsData = {
      rows: DATES.map(date => makeProductRow({ date, netRevenue: 100 })),
      lastUpdated: new Date().toISOString(),
    };

    // Meta claims 60 per day, no google, no organic → channels = 60, shopify = 100
    const metaRows = DATES.map(date =>
      makeCampaignRow({
        date,
        platform: 'Meta',
        campaignId: CAMP_META,
        campaignName: 'Meta Camp 1',
        conversionValue: 60,
      }),
    );
    const shopifyOrders = DATES.map((date, i) =>
      makeOrderRow({
        date,
        orderId: `paid-dark-${i}`,
        source: 'meta-paid',
        fbclidPresent: true,
        lineItems: [{ productId: PROD_A, units: 1, revenueCad: 100 }],
      }),
    );
    const result = buildReconciliation({
      summary: makeSummary({ values: [60, 60, 60, 60, 60] }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: metaRows },
      ordersData: { rows: shopifyOrders },
      productMap: { [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A] },
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });

    expect(result).not.toBeNull();
    // sumChannels = 60*5 = 300, sumShopify = 100*5 = 500 → ratio = 0.6 < 0.8
    // darkTrafficPercent = round((1 - 0.6) * 100) = 40
    expect(result!.darkTrafficPercent).toBe(40);
  });

  // ---------------------------------------------------------------------------
  // darkTrafficPercent boundary (TEST-02 — pin AUDIT-P3-02)
  // ---------------------------------------------------------------------------

  describe('darkTrafficPercent boundary', () => {
    function buildBoundaryFixture(opts: {
      metaPerDay: number;
      shopifyPerDay: number;
    }) {
      const { metaPerDay, shopifyPerDay } = opts;
      const productsData = {
        rows: DATES.map(date => makeProductRow({ date, netRevenue: shopifyPerDay })),
        lastUpdated: new Date().toISOString(),
      };
      // Meta campaign rows — sole channel source, simple to reason about.
      const metaRows = DATES.map(date =>
        makeCampaignRow({
          date,
          platform: 'Meta',
          campaignId: CAMP_META,
          campaignName: 'Meta Camp 1',
          conversionValue: metaPerDay,
        }),
      );
      // Shopify-actual via line-item revenue (post-FIX-12 canonical basis).
      const shopifyOrders = shopifyPerDay > 0
        ? DATES.map((date, i) =>
            makeOrderRow({
              date,
              orderId: `paid-${i}`,
              source: 'meta-paid',
              fbclidPresent: true,
              lineItems: [{ productId: PROD_A, units: 1, revenueCad: shopifyPerDay }],
            }),
          )
        : [];
      return {
        productsData,
        metaRows,
        shopifyOrders,
        productMap: { [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A] } as ProductMap,
      };
    }

    it('returns 0 when channels are exactly 80% of Shopify (boundary excludes warning)', () => {
      // 80 (meta per day) / 100 (shopify per day) = 0.80 exactly. The code
      // uses `< 0.8` which is non-inclusive at the boundary → no warning.
      const fx = buildBoundaryFixture({ metaPerDay: 80, shopifyPerDay: 100 });
      const result = buildReconciliation({
        summary: makeSummary({ values: [80, 80, 80, 80, 80] }),
        productsData: fx.productsData,
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: fx.metaRows },
        ordersData: { rows: fx.shopifyOrders },
        productMap: fx.productMap,
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });
      expect(result).not.toBeNull();
      // 80/100 = 0.8 — strictly NOT less than 0.8 → no warning, 0%.
      expect(result!.darkTrafficPercent).toBe(0);
    });

    it('fires warning just below the 80% boundary (ratio 0.799)', () => {
      // 79.9 / 100 = 0.799 < 0.8 → round((1 - 0.799) * 100) = round(20.1) = 20.
      // Note: the plan's text said "21" but the arithmetic is round(20.1) = 20.
      // The test pins the actual implementation.
      const fx = buildBoundaryFixture({ metaPerDay: 79.9, shopifyPerDay: 100 });
      const result = buildReconciliation({
        summary: makeSummary({ values: [79.9, 79.9, 79.9, 79.9, 79.9] }),
        productsData: fx.productsData,
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: fx.metaRows },
        ordersData: { rows: fx.shopifyOrders },
        productMap: fx.productMap,
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });
      expect(result).not.toBeNull();
      expect(result!.darkTrafficPercent).toBe(20);
    });

    it('returns 0 (not NaN) when Shopify is 0 (avoid divide-by-zero)', () => {
      // No Shopify orders at all → sumShopify = 0. The guard `sumShopify > 0`
      // in MetaShopifyReconciliation:260 must short-circuit before division.
      const fx = buildBoundaryFixture({ metaPerDay: 100, shopifyPerDay: 0 });
      const result = buildReconciliation({
        summary: makeSummary({ values: [100, 100, 100, 100, 100] }),
        productsData: fx.productsData,
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: fx.metaRows },
        ordersData: { rows: fx.shopifyOrders },
        productMap: fx.productMap,
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });
      expect(result).not.toBeNull();
      expect(result!.darkTrafficPercent).toBe(0);
      expect(Number.isNaN(result!.darkTrafficPercent)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Missing optional aggregation inputs → all channel series zero
  // ---------------------------------------------------------------------------

  it('returns channel series as zero when campaignsData/ordersData/productMap are absent', () => {
    const metaValues = [100, 120, 80, 110, 90];
    const shopifyValues = [95, 115, 75, 105, 85];

    const productsData = {
      rows: DATES.map((date, i) => makeProductRow({ date, netRevenue: shopifyValues[i] })),
      lastUpdated: new Date().toISOString(),
    };

    // Call without optional params — backwards-compat
    const result = buildReconciliation({
      summary: makeSummary({ values: metaValues }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      // No campaignsData, ordersData, productMap
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });

    expect(result).not.toBeNull();
    for (const s of result!.series) {
      expect(s.meta).toBe(0);
      expect(s.google).toBe(0);
      expect(s.organic).toBe(0);
    }
    // Shopify actual now uses orders-attribution line items; without ordersData,
    // it stays zero instead of falling back to products-daily netRevenue.
    expect(result!.series[0].shopify).toBe(0);
    // rGoogle/rOrganic are null (all zeros -> no variance)
    expect(result!.rGoogle).toBeNull();
    expect(result!.rOrganic).toBeNull();
  });
});
