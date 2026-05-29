/**
 * Phase A.5 Task 6 — cron-daily calls agg_tiktok_spend_per_store_for_date
 * after the TikTok campaigns_daily upsert.
 *
 * Tests (3):
 *   1. rpc called with ('agg_tiktok_spend_per_store_for_date', { d: dateStr })
 *      after the TikTok campaigns_daily upsert.
 *   2. RPC call is positioned AFTER the campaigns_daily (tiktok) upsert
 *      (counter-based ordering check).
 *   3. When the RPC returns an error the function still completes — soft-fail.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const STORE = 'uzoshop';
const DATE = '2026-05-28'; // "yesterday" for the daily run

// ---------------------------------------------------------------------------
// Module mocks — established before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn(),
}));

vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: vi.fn(async () => undefined),
}));

vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn().mockResolvedValue({ alerted: false, throttled: false, dbWritten: true }),
}));

vi.mock('@/lib/notifications/detectAuthError', async (orig) => ({
  ...(await orig<typeof import('@/lib/notifications/detectAuthError')>()),
}));

vi.mock('@/lib/sentry/capture', () => ({
  captureCronFetchError: vi.fn().mockResolvedValue(undefined),
  captureStepError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE,
    date: DATE,
    spend: 100,
    currency: 'ILS',
    impressions: 1000,
  }),
  fetchMetaAdSetInsights: vi.fn().mockResolvedValue([
    {
      campaignId: 'c1',
      campaignName: 'Campaign 1',
      adSetId: 'as1',
      adSetName: 'Ad Set 1',
      spend: 100,
      currency: 'ILS',
      impressions: 1000,
      clicks: 50,
      conversions: 5,
      conversionValue: 500,
    },
  ]),
  fetchMetaAdInsights: vi.fn().mockResolvedValue([
    {
      storeId: STORE,
      date: DATE,
      platform: 'meta' as const,
      campaignId: 'c1',
      campaignName: 'Campaign 1',
      adSetId: 'as1',
      adSetName: 'Ad Set 1',
      adId: 'ad-meta-1',
      adName: 'Meta Ad 1',
      impressions: 600,
      clicks: 30,
      conversions: 3,
      spend: 60,
      currency: 'ILS',
      conversionValue: 300,
    },
  ]),
  fetchMetaBudgets: vi.fn().mockResolvedValue({
    currency: 'ILS',
    campaigns: { c1: { dailyBudget: 50, lifetimeBudget: 0, bidStrategy: null } },
    adSets: { as1: { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'c1' } },
  }),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE,
    date: DATE,
    spend: 50,
    currency: 'CAD',
    impressions: 500,
  }),
  fetchGoogleAdsAdGroupInsights: vi.fn().mockResolvedValue([
    {
      campaignId: 'gc1',
      campaignName: 'Google Campaign 1',
      adSetId: 'ag1',
      adSetName: 'Ad Group 1',
      spend: 50,
      currency: 'CAD',
      impressions: 500,
      clicks: 25,
      conversions: 2,
      conversionValue: 200,
      effectiveStatus: 'ENABLED',
    },
  ]),
  fetchGoogleAdsAdInsights: vi.fn().mockResolvedValue([
    {
      storeId: STORE,
      date: DATE,
      platform: 'google' as const,
      campaignId: 'gc1',
      campaignName: 'Google Campaign 1',
      adSetId: 'ag1',
      adSetName: 'Ad Group 1',
      adId: 'ad-g-1',
      adName: 'Google Ad 1',
      impressions: 300,
      clicks: 15,
      conversions: 1,
      conversionValueCad: 90,
      spendCad: 25,
    },
  ]),
}));

vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE,
    date: DATE,
    spend: 20,
    currency: 'USD',
    impressions: 200,
  }),
  fetchTikTokAdInsights: vi.fn().mockResolvedValue([
    {
      campaignId: 'tk1',
      campaignName: 'TikTok Campaign 1',
      adGroupId: 'tkg1',
      adGroupName: 'TikTok AdGroup 1',
      adId: 'ad-tk-1',
      adName: 'TikTok Ad 1',
      spend: 20,
      currency: 'USD',
      impressions: 200,
      clicks: 10,
      conversions: 1,
      conversionValue: 50,
      effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
    },
  ]),
  fetchTikTokAdvertiserInfo: vi.fn().mockResolvedValue({
    advertiserId: '7306450983905787906',
    name: 'DOD DIGITAL',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  }),
}));

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn().mockResolvedValue({
    storeId: STORE,
    date: DATE,
    storeName: 'uzoshop',
    revenueCad: 1234.56,
    grossRevenueCad: 1300,
    refundDeductionCad: 65.44,
    productRows: [
      {
        product_id: 'p1',
        product_title: 'Test Product',
        units: 3,
        gross_revenue_cad: 600,
        orders: 2,
        net_revenue_cad: 580,
      },
    ],
    customItemRefundCad: 0,
  }),
  fetchShopifyOrdersAttribution: vi.fn().mockResolvedValue([
    {
      storeId: STORE,
      orderId: 'O-1',
      date: DATE,
      totalCad: 150,
      source: 'meta-paid',
      utmSource: 'facebook',
      utmMedium: 'cpc',
      utmCampaign: 'spring_sale',
      utmContent: null,
      fbclidPresent: true,
      gclidPresent: false,
      referrer: 'l.facebook.com',
      utmId: null,
      utmTerm: null,
      lineItems: [{ p: 'p1', u: 1, r: 150 }],
    },
  ]),
  fetchShopifyProductsCatalog: vi.fn().mockResolvedValue([
    {
      storeId: STORE,
      productId: 'p1',
      title: 'Test Product',
      handle: 'test-product',
      status: 'active',
      priceCad: 19.99,
      imageUrl: 'https://cdn.shopify.com/img.jpg',
      productType: 'Widget',
      vendor: 'TestCo',
      updatedAt: DATE + 'T08:00:00Z',
    },
  ]),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn().mockResolvedValue({
    fbSpendCad: 36,
    gaSpendCad: 50,
    totalSpendCad: 86,
    overridesApplied: { meta: false, google: false },
  }),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/platformsByStore', () => ({
  STORES_WITH_TIKTOK_IDS: new Set(['uzoshop']),
}));

// ---------------------------------------------------------------------------
// Supabase mock — records upsert calls AND rpc calls with ordering
// ---------------------------------------------------------------------------
let callOrder = 0;
type UpsertCall = { table: string; rows: unknown; opts: { onConflict?: string }; order: number };
type RpcCall = { fn: string; args: unknown; order: number };
const upsertCalls: UpsertCall[] = [];
const rpcCalls: RpcCall[] = [];

// rpcMock can be configured per-test to return errors.
let rpcReturnValue: { error: { message: string } | null } = { error: null };

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        upsertCalls.push({ table, rows, opts, order: ++callOrder });
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args, order: ++callOrder });
      return Promise.resolve(rpcReturnValue);
    },
  })),
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn(
      (opts: { id: string; triggers: Array<{ cron: string }> }, _handler: unknown) => ({
        id: opts.id,
      }),
    ),
  },
}));

// ---------------------------------------------------------------------------
// Step runner stub — executes callbacks directly (no memoization)
// ---------------------------------------------------------------------------
function makeStepStub() {
  return {
    step: {
      async run<T>(_id: string, cb: () => Promise<T>): Promise<T> {
        return cb();
      },
    },
  };
}

beforeEach(async () => {
  callOrder = 0;
  upsertCalls.length = 0;
  rpcCalls.length = 0;
  rpcReturnValue = { error: null };

  vi.clearAllMocks();

  // Re-establish default return values that clearAllMocks wiped.
  const metaMod = await import('@/lib/fetchers/meta');
  (metaMod.fetchMetaSpendForDay as ReturnType<typeof vi.fn>).mockResolvedValue({
    storeId: STORE, date: DATE, spend: 100, currency: 'ILS', impressions: 1000,
  });
  (metaMod.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockResolvedValue([{
    campaignId: 'c1', campaignName: 'Campaign 1', adSetId: 'as1', adSetName: 'Ad Set 1',
    spend: 100, currency: 'ILS', impressions: 1000, clicks: 50, conversions: 5, conversionValue: 500,
  }]);
  (metaMod.fetchMetaAdInsights as ReturnType<typeof vi.fn>).mockResolvedValue([{
    storeId: STORE, date: DATE, platform: 'meta' as const,
    campaignId: 'c1', campaignName: 'Campaign 1', adSetId: 'as1', adSetName: 'Ad Set 1',
    adId: 'ad-meta-1', adName: 'Meta Ad 1',
    impressions: 600, clicks: 30, conversions: 3, spend: 60, currency: 'ILS', conversionValue: 300,
  }]);
  (metaMod.fetchMetaBudgets as ReturnType<typeof vi.fn>).mockResolvedValue({
    currency: 'ILS',
    campaigns: { c1: { dailyBudget: 50, lifetimeBudget: 0, bidStrategy: null } },
    adSets: { as1: { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'c1' } },
  });

  const googleMod = await import('@/lib/fetchers/googleAds');
  (googleMod.fetchGoogleAdsSpendForDay as ReturnType<typeof vi.fn>).mockResolvedValue({
    storeId: STORE, date: DATE, spend: 50, currency: 'CAD', impressions: 500,
  });
  (googleMod.fetchGoogleAdsAdGroupInsights as ReturnType<typeof vi.fn>).mockResolvedValue([{
    campaignId: 'gc1', campaignName: 'Google Campaign 1', adSetId: 'ag1', adSetName: 'Ad Group 1',
    spend: 50, currency: 'CAD', impressions: 500, clicks: 25, conversions: 2, conversionValue: 200,
    effectiveStatus: 'ENABLED',
  }]);
  (googleMod.fetchGoogleAdsAdInsights as ReturnType<typeof vi.fn>).mockResolvedValue([{
    storeId: STORE, date: DATE, platform: 'google' as const,
    campaignId: 'gc1', campaignName: 'Google Campaign 1', adSetId: 'ag1', adSetName: 'Ad Group 1',
    adId: 'ad-g-1', adName: 'Google Ad 1',
    impressions: 300, clicks: 15, conversions: 1, conversionValueCad: 90, spendCad: 25,
  }]);

  const tiktokMod = await import('@/lib/fetchers/tiktok');
  (tiktokMod.fetchTikTokSpendForDay as ReturnType<typeof vi.fn>).mockResolvedValue({
    storeId: STORE, date: DATE, spend: 20, currency: 'USD', impressions: 200,
  });
  (tiktokMod.fetchTikTokAdInsights as ReturnType<typeof vi.fn>).mockResolvedValue([{
    campaignId: 'tk1', campaignName: 'TikTok Campaign 1',
    adGroupId: 'tkg1', adGroupName: 'TikTok AdGroup 1',
    adId: 'ad-tk-1', adName: 'TikTok Ad 1',
    spend: 20, currency: 'USD', impressions: 200, clicks: 10, conversions: 1, conversionValue: 50,
    effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
  }]);
  (tiktokMod.fetchTikTokAdvertiserInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    advertiserId: '7306450983905787906', name: 'DOD DIGITAL', currency: 'USD', timezone: 'Etc/GMT-2',
  });

  const shopifyMod = await import('@/lib/fetchers/shopify');
  (shopifyMod.fetchShopifyDayRows as ReturnType<typeof vi.fn>).mockResolvedValue({
    storeId: STORE, date: DATE, storeName: 'uzoshop',
    revenueCad: 1234.56, grossRevenueCad: 1300, refundDeductionCad: 65.44,
    productRows: [{
      product_id: 'p1', product_title: 'Test Product',
      units: 3, gross_revenue_cad: 600, orders: 2, net_revenue_cad: 580,
    }],
    customItemRefundCad: 0,
  });
  (shopifyMod.fetchShopifyOrdersAttribution as ReturnType<typeof vi.fn>).mockResolvedValue([{
    storeId: STORE, orderId: 'O-1', date: DATE, totalCad: 150, source: 'meta-paid',
    utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'spring_sale',
    utmContent: null, fbclidPresent: true, gclidPresent: false,
    referrer: 'l.facebook.com', utmId: null, utmTerm: null,
    lineItems: [{ p: 'p1', u: 1, r: 150 }],
  }]);
  (shopifyMod.fetchShopifyProductsCatalog as ReturnType<typeof vi.fn>).mockResolvedValue([{
    storeId: STORE, productId: 'p1', title: 'Test Product', handle: 'test-product',
    status: 'active', priceCad: 19.99, imageUrl: 'https://cdn.shopify.com/img.jpg',
    productType: 'Widget', vendor: 'TestCo', updatedAt: DATE + 'T08:00:00Z',
  }]);

  const overridesMod = await import('@/lib/fetchers/manualOverrides');
  (overridesMod.mergeOverridesFromSupabase as ReturnType<typeof vi.fn>).mockResolvedValue({
    fbSpendCad: 36, gaSpendCad: 50, totalSpendCad: 86,
    overridesApplied: { meta: false, google: false },
  });

  const fxMod = await import('@/lib/fetchers/fx');
  (fxMod.getFxRate as ReturnType<typeof vi.fn>).mockResolvedValue(1);

  const tokenFailuresMod = await import('@/lib/notifications/tokenFailures');
  (tokenFailuresMod.notifyTokenFailure as ReturnType<typeof vi.fn>).mockResolvedValue({
    alerted: false, throttled: false, dbWritten: true,
  });

  const freshnessMod = await import('@/lib/inngest/freshness');
  (freshnessMod.recordFreshness as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

  const bucMod = await import('@/lib/notifications/metaBucUsage');
  (bucMod.getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('cron-daily — TikTok per-store aggregation RPC', () => {
  it('1. rpc called with agg_tiktok_spend_per_store_for_date + dateStr after TikTok upsert', async () => {
    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');
    expect(aggCall).toBeDefined();
    expect(aggCall!.args).toEqual({ d: DATE });
  });

  it('2. RPC call is positioned AFTER the campaigns_daily tiktok upsert', async () => {
    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const tiktokUpsert = upsertCalls.find((u) => {
      const rows = u.rows as Array<Record<string, unknown>>;
      return u.table === 'campaigns_daily' && Array.isArray(rows) && rows.length > 0 && rows[0].platform === 'tiktok';
    });
    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');

    expect(tiktokUpsert).toBeDefined();
    expect(aggCall).toBeDefined();
    // The RPC must come after the TikTok campaigns_daily upsert
    expect(aggCall!.order).toBeGreaterThan(tiktokUpsert!.order);
  });

  it('3. RPC error is swallowed (soft-fail) — function still completes without throwing', async () => {
    rpcReturnValue = { error: { message: 'simulated RPC failure' } };

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();

    // Must NOT throw even when the RPC returns an error
    await expect(runDailyForStore(STORE, DATE, { step })).resolves.not.toThrow();

    // The RPC was still called
    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');
    expect(aggCall).toBeDefined();
  });
});
