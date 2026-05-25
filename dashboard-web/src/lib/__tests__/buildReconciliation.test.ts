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
import type { OrderAttributionRow, OrderSource } from '@/lib/ordersAttribution';
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
    effectiveStatus: null,
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
    // zolplus has no Google campaigns, productMap empty for Google
    const productMap: ProductMap = { [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A] };

    const result = buildReconciliation({
      summary: makeSummary({ values: [100, 120, 80, 110, 90] }),
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
  // Google primary path (TEST-05 — pin AUDIT-P3-05)
  // ---------------------------------------------------------------------------

  describe('Google campaign primary path', () => {
    it('Google campaign summary still populates Meta series when other Meta campaigns map to the same products (FIX-04 symmetric)', () => {
      const metaValues = [10, 15, 8, 12, 9];   // a separate Meta campaign in the store
      const googleValues = [40, 50, 35, 45, 38];
      const shopifyValues = [80, 90, 70, 85, 75];

      const _productsData = {
        rows: DATES.map((date, i) => makeProductRow({ date, netRevenue: shopifyValues[i] })),
        lastUpdated: new Date().toISOString(),
      };

      const metaCampaignRows = DATES.map((date, i) =>
        makeCampaignRow({
          date,
          platform: 'Meta',
          campaignId: CAMP_META,
          campaignName: 'Meta Camp 1',
          conversionValue: metaValues[i],
        }),
      );
      const googleCampaignRows = DATES.map((date, i) =>
        makeCampaignRow({
          date,
          platform: 'Google',
          campaignId: CAMP_GOOGLE,
          campaignName: 'Google Camp 1',
          conversionValue: googleValues[i],
        }),
      );
      const shopifyOrders = DATES.map((date, i) =>
        makeOrderRow({
          date,
          orderId: `paid-${i}`,
          source: 'google-paid',
          gclidPresent: true,
          fbclidPresent: false,
          lineItems: [{ productId: PROD_A, units: 1, revenueCad: shopifyValues[i] }],
        }),
      );

      const productMap: ProductMap = {
        [campaignKey(STORE, 'Meta', CAMP_META)]: [PROD_A],
        [campaignKey(STORE, 'Google', CAMP_GOOGLE)]: [PROD_A],
      };

      // Drawer is opened on the GOOGLE campaign, but Meta series should
      // still be populated because Meta Camp 1 maps to PROD_A too.
      const result = buildReconciliation({
        // WR-05: buildReconciliation no longer reads campaignId / dailyArr.
        summary: { platform: 'Google' },
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: [...metaCampaignRows, ...googleCampaignRows] },
        ordersData: { rows: shopifyOrders },
        productMap,
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });

      expect(result).not.toBeNull();
      expect(result!.primaryChannel).toBe('Google');
      // Meta series carries the OTHER campaign's conversionValue, not zero.
      // Asymmetric pre-FIX-04 behavior would have set Meta to 0 here because
      // the drawer campaign is Google. Post-FIX-04 the helper walks all
      // mapped Meta campaigns in the store, regardless of the drawer.
      result!.series.forEach((s, i) => {
        expect(s.meta).toBeCloseTo(metaValues[i], 4);
        expect(s.google).toBeCloseTo(googleValues[i], 4);
        expect(s.shopify).toBeCloseTo(shopifyValues[i], 4);
      });
    });

    it('primaryChannel = Google when summary.platform=Google; rGoogle is the meaningful correlation', () => {
      const googleValues = [40, 50, 35, 45, 38];
      const shopifyValues = [80, 100, 70, 90, 76];   // strongly correlated with google

      const _productsData = {
        rows: DATES.map((date, i) => makeProductRow({ date, netRevenue: shopifyValues[i] })),
        lastUpdated: new Date().toISOString(),
      };
      const googleCampaignRows = DATES.map((date, i) =>
        makeCampaignRow({
          date,
          platform: 'Google',
          campaignId: CAMP_GOOGLE,
          campaignName: 'Google Camp 1',
          conversionValue: googleValues[i],
        }),
      );
      const shopifyOrders = DATES.map((date, i) =>
        makeOrderRow({
          date,
          orderId: `paid-${i}`,
          source: 'google-paid',
          gclidPresent: true,
          fbclidPresent: false,
          lineItems: [{ productId: PROD_A, units: 1, revenueCad: shopifyValues[i] }],
        }),
      );

      const result = buildReconciliation({
        // WR-05: buildReconciliation no longer reads campaignId / dailyArr.
        summary: { platform: 'Google' },
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: googleCampaignRows },   // no Meta rows at all
        ordersData: { rows: shopifyOrders },
        productMap: { [campaignKey(STORE, 'Google', CAMP_GOOGLE)]: [PROD_A] },
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });

      expect(result).not.toBeNull();
      expect(result!.primaryChannel).toBe('Google');
      expect(result!.rGoogle).not.toBeNull();
      expect(result!.rGoogle!).toBeGreaterThan(0.9);   // strongly positive
      // Meta series is all zeros → no variance → r = null (post-FIX-07).
      expect(result!.r).toBeNull();
    });

    it('Pearson r = null (not 0) when Meta series is all-zero variance (post-FIX-07)', () => {
      // Same Google-primary fixture but make Meta series explicitly zero
      // by ensuring no Meta campaign rows exist. Pre-FIX-07 pearson()
      // returned 0 for zero-variance inputs ("no signal" misread as
      // "no correlation"). Post-FIX-07 it returns null.
      const _productsData = {
        rows: DATES.map(date => makeProductRow({ date, netRevenue: 100 })),
        lastUpdated: new Date().toISOString(),
      };
      const googleRows = DATES.map(date =>
        makeCampaignRow({
          date,
          platform: 'Google',
          campaignId: CAMP_GOOGLE,
          campaignName: 'Google Camp 1',
          conversionValue: 50,
        }),
      );
      const shopifyOrders = DATES.map((date, i) =>
        makeOrderRow({
          date,
          orderId: `paid-${i}`,
          source: 'google-paid',
          gclidPresent: true,
          fbclidPresent: false,
          lineItems: [{ productId: PROD_A, units: 1, revenueCad: 100 }],
        }),
      );
      const result = buildReconciliation({
        // WR-05: buildReconciliation no longer reads campaignId / dailyArr.
        summary: { platform: 'Google' },
        mappedIds: [PROD_A],
        storeId: STORE,
        campaignsData: { rows: googleRows },
        ordersData: { rows: shopifyOrders },
        productMap: { [campaignKey(STORE, 'Google', CAMP_GOOGLE)]: [PROD_A] },
        rangeFrom: RANGE_FROM,
        rangeTo: RANGE_TO,
      });
      expect(result).not.toBeNull();
      // Meta is identically zero on every day → zero variance → pearson null.
      // NOT 0 — 0 would imply "no correlation found" which is operationally
      // different from "no signal to correlate" (FIX-07).
      expect(result!.r).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Missing optional aggregation inputs → all channel series zero
  // ---------------------------------------------------------------------------

  it('returns channel series as zero when campaignsData/ordersData/productMap are absent', () => {
    const metaValues = [100, 120, 80, 110, 90];

    // Call without optional params — backwards-compat
    const result = buildReconciliation({
      summary: makeSummary({ values: metaValues }),
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

describe('OrderSource sweep — locks FIX-01 (5.2.2.1)', () => {
  const SOURCE_COVERAGE = {
    'meta-paid': false,
    'meta-organic': true,
    'google-paid': false,
    'google-organic': true,
    // Phase 05.7.5: tiktok-paid is a paid source (not organic) — same
    // classification as meta-paid / google-paid for reconciliation purposes.
    'tiktok-paid': false,
    email: true,
    'other-paid': false,
    'other-referral': true,
    direct: true,
    '': false,
  } satisfies Record<OrderSource, boolean>;

  const SOURCE_CASES = [
    { source: 'meta-paid', organic: SOURCE_COVERAGE['meta-paid'] },
    { source: 'meta-organic', organic: SOURCE_COVERAGE['meta-organic'] },
    { source: 'google-paid', organic: SOURCE_COVERAGE['google-paid'] },
    { source: 'google-organic', organic: SOURCE_COVERAGE['google-organic'] },
    { source: 'tiktok-paid', organic: SOURCE_COVERAGE['tiktok-paid'] },
    { source: 'email', organic: SOURCE_COVERAGE.email },
    { source: 'other-paid', organic: SOURCE_COVERAGE['other-paid'] },
    { source: 'other-referral', organic: SOURCE_COVERAGE['other-referral'] },
    { source: 'direct', organic: SOURCE_COVERAGE.direct },
    { source: '', organic: SOURCE_COVERAGE[''] },
  ] satisfies Array<{ source: OrderSource; organic: boolean }>;

  function reconciliationFor(order: OrderAttributionRow) {
    return buildReconciliation({
      summary: { platform: 'Meta' },
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: [] },
      ordersData: { rows: [order] },
      productMap: {},
      rangeFrom: RANGE_FROM,
      rangeTo: RANGE_TO,
    });
  }

  for (const { source, organic } of SOURCE_CASES) {
    it(`source="${source || '(empty)'}" -> ${organic ? 'IN' : 'NOT'} organicByDate`, () => {
      const order = makeOrderRow({
        source,
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: PROD_A, units: 1, revenueCad: 50 }],
      });
      const result = reconciliationFor(order);
      expect(result).not.toBeNull();
      const point = result!.series.find(s => s.date === order.date);
      expect(point).toBeDefined();
      if (organic) {
        expect(point!.organic, `${source} must contribute to organic`).toBe(50);
      } else {
        expect(point!.organic, `${source} must NOT contribute to organic`).toBe(0);
      }
    });
  }

  it('fbclidPresent=true excludes from organic even for source="direct"', () => {
    const order = makeOrderRow({
      source: 'direct',
      fbclidPresent: true,
      gclidPresent: false,
      lineItems: [{ productId: PROD_A, units: 1, revenueCad: 50 }],
    });
    const result = reconciliationFor(order);
    expect(result).not.toBeNull();
    expect(result!.series.find(s => s.date === order.date)!.organic).toBe(0);
  });

  it('gclidPresent=true excludes from organic even for source="direct"', () => {
    const order = makeOrderRow({
      source: 'direct',
      fbclidPresent: false,
      gclidPresent: true,
      lineItems: [{ productId: PROD_A, units: 1, revenueCad: 50 }],
    });
    const result = reconciliationFor(order);
    expect(result).not.toBeNull();
    expect(result!.series.find(s => s.date === order.date)!.organic).toBe(0);
  });
});
