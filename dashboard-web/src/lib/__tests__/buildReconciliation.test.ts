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
import type { ProductMap } from '@/lib/campaignProductMap';
import type { ProductRow } from '@/lib/products';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const STORE = 'uzoshop';
const CAMP_META = 'meta-camp-1';
const CAMP_GOOGLE = 'google-camp-1';
const PROD_A = 'prod-a';
const PROD_B = 'prod-b';

/** 5 consecutive dates starting 2026-05-01 */
const DATES = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'];

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
    const shopifyValues = [95, 115, 75, 105, 85]; // close to meta
    const googleValues = [20, 30, 10, 25, 15];
    const organicValues = [10, 15, 5, 12, 8];

    const productsData = {
      rows: DATES.map((date, i) => makeProductRow({ date, netRevenue: shopifyValues[i] })),
      lastUpdated: new Date().toISOString(),
    };

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

    const productMap: ProductMap = { [`${STORE}::${CAMP_GOOGLE}`]: [PROD_A] };

    const result = buildReconciliation({
      summary: makeSummary({ values: metaValues }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: googleCampaignRows },
      ordersData: { rows: organicOrders },
      productMap,
    });

    expect(result).not.toBeNull();
    expect(result!.series).toHaveLength(5);

    // Each point has all 4 keys
    const first = result!.series[0];
    expect(first).toHaveProperty('date', '2026-05-01');
    expect(first).toHaveProperty('meta', 100);
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
    const productMap: ProductMap = { [`${STORE}::${CAMP_META}`]: [PROD_A] };

    const result = buildReconciliation({
      summary: makeSummary({ values: [100, 120, 80, 110, 90] }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: [] }, // no campaigns at all
      ordersData: { rows: [] },
      productMap,
    });

    expect(result).not.toBeNull();
    for (const s of result!.series) {
      expect(s.google).toBe(0);
    }
    // rGoogle should be 0 (all zeros → no variance)
    expect(result!.rGoogle).toBe(0);
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
    const result = buildReconciliation({
      summary: makeSummary({ values: [60, 60, 60, 60, 60] }),
      productsData,
      mappedIds: [PROD_A],
      storeId: STORE,
      campaignsData: { rows: [] },
      ordersData: { rows: [] },
      productMap: {},
    });

    expect(result).not.toBeNull();
    // sumChannels = 60*5 = 300, sumShopify = 100*5 = 500 → ratio = 0.6 < 0.8
    // darkTrafficPercent = round((1 - 0.6) * 100) = 40
    expect(result!.darkTrafficPercent).toBe(40);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Backwards-compat — null/empty optional fields → google=0, organic=0
  // ---------------------------------------------------------------------------

  it('returns google=0 and organic=0 when campaignsData/ordersData/productMap are absent', () => {
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
    });

    expect(result).not.toBeNull();
    for (const s of result!.series) {
      expect(s.google).toBe(0);
      expect(s.organic).toBe(0);
    }
    // Meta and shopify should still be correct
    expect(result!.series[0].meta).toBe(100);
    expect(result!.series[0].shopify).toBe(95);
    // rGoogle = 0 (all zeros → degenerate)
    expect(result!.rGoogle).toBe(0);
    // rOrganic = 0 (all zeros → degenerate)
    expect(result!.rOrganic).toBe(0);
  });
});
