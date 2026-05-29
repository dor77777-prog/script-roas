/**
 * Phase A 2026-05-29 — Task 13: cron-daily finalization writes + pre-flight
 * Meta BUC gate.
 *
 * Tests (9):
 *   1. data_daily upsert payload contains source='daily_reconcile', is_finalized=true, reconciled_at
 *   2. products_daily upsert payload contains finalization fields
 *   3. campaigns_daily Meta upsert payload contains finalization fields
 *   4. ads_daily upsert payload contains finalization fields
 *   5. campaigns_daily Google + TikTok upsert payloads contain finalization fields
 *   6. pre-flight detects high BUC + skips Meta + still runs Google/TikTok/Shopify
 *   7. pre-flight skip routes to cron_daily_budget_skip operation
 *   8. reconciled_at value is identical across all 6 upserts in one tick
 *   9. stale BUC row (older than 15 min) → optimistic proceed (Meta still fetched)
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

// ---------------------------------------------------------------------------
// Supabase mock — records upsert calls per table
// ---------------------------------------------------------------------------
type UpsertCall = { table: string; rows: unknown; opts: { onConflict?: string } };
const upsertCalls: UpsertCall[] = [];

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        upsertCalls.push({ table, rows, opts });
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (_fn: string, _args: unknown) => Promise.resolve({ error: null }),
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

vi.mock('@/lib/platformsByStore', () => ({
  STORES_WITH_TIKTOK_IDS: new Set(['uzoshop']),
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

// ---------------------------------------------------------------------------
// BUC usage helper
// ---------------------------------------------------------------------------
function makeBucUsage(maxPct: number, ageMin = 5) {
  const ts = new Date(Date.now() - ageMin * 60_000).toISOString();
  return {
    max_ads_insights_call_pct: maxPct,
    max_ads_insights_cputime_pct: 0,
    max_ads_insights_time_pct: 0,
    max_ads_management_call_pct: 0,
    max_ads_management_cputime_pct: 0,
    max_ads_management_time_pct: 0,
    max_eta_minutes: 0,
    rows: [
      {
        store_id: STORE,
        ad_account_id: 'act_123',
        ads_insights_call_pct: maxPct,
        ads_insights_cputime_pct: 0,
        ads_insights_time_pct: 0,
        ads_management_call_pct: 0,
        ads_management_cputime_pct: 0,
        ads_management_time_pct: 0,
        ads_insights_eta_minutes: 0,
        ads_management_eta_minutes: 0,
        last_updated_at: ts,
        last_url: '',
      },
    ],
  };
}

beforeEach(async () => {
  upsertCalls.length = 0;
  // Only reset call counts — preserve mock return values set by vi.mock factories.
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('cron-daily — finalization writes + pre-flight Meta BUC gate', () => {
  it('1. data_daily upsert payload contains source=daily_reconcile, is_finalized=true, reconciled_at', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const dataDailyCall = upsertCalls.find((u) => u.table === 'data_daily');
    expect(dataDailyCall).toBeDefined();
    const row = dataDailyCall!.rows as Record<string, unknown>;
    expect(row.source).toBe('daily_reconcile');
    expect(row.is_finalized).toBe(true);
    expect(typeof row.reconciled_at).toBe('string');
    // reconciled_at must be a valid ISO timestamp
    expect(new Date(row.reconciled_at as string).getTime()).not.toBeNaN();
  });

  it('2. products_daily upsert payload contains finalization fields', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const productCall = upsertCalls.find((u) => u.table === 'products_daily');
    expect(productCall).toBeDefined();
    const rows = productCall!.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe('daily_reconcile');
      expect(row.is_finalized).toBe(true);
      expect(typeof row.reconciled_at).toBe('string');
    }
  });

  it('3. campaigns_daily Meta upsert payload contains finalization fields', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    // First campaigns_daily upsert is Meta rows (by writer order in cronDaily)
    const campaignCalls = upsertCalls.filter((u) => u.table === 'campaigns_daily');
    expect(campaignCalls.length).toBeGreaterThan(0);
    const metaCall = campaignCalls.find((c) => {
      const rows = c.rows as Array<Record<string, unknown>>;
      return rows.length > 0 && rows[0].platform === 'meta';
    });
    expect(metaCall).toBeDefined();
    const rows = metaCall!.rows as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.source).toBe('daily_reconcile');
      expect(row.is_finalized).toBe(true);
      expect(typeof row.reconciled_at).toBe('string');
    }
  });

  it('4. ads_daily upsert payload contains finalization fields', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const adsCall = upsertCalls.find((u) => u.table === 'ads_daily');
    expect(adsCall).toBeDefined();
    const rows = adsCall!.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe('daily_reconcile');
      expect(row.is_finalized).toBe(true);
      expect(typeof row.reconciled_at).toBe('string');
    }
  });

  it('5. campaigns_daily Google + TikTok upsert payloads contain finalization fields', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const campaignCalls = upsertCalls.filter((u) => u.table === 'campaigns_daily');
    // Expect Google and TikTok rows in separate upsert calls
    const googleCall = campaignCalls.find((c) => {
      const rows = c.rows as Array<Record<string, unknown>>;
      return rows.length > 0 && rows[0].platform === 'google';
    });
    const tiktokCall = campaignCalls.find((c) => {
      const rows = c.rows as Array<Record<string, unknown>>;
      return rows.length > 0 && rows[0].platform === 'tiktok';
    });

    expect(googleCall).toBeDefined();
    const googleRows = googleCall!.rows as Array<Record<string, unknown>>;
    for (const row of googleRows) {
      expect(row.source).toBe('daily_reconcile');
      expect(row.is_finalized).toBe(true);
      expect(typeof row.reconciled_at).toBe('string');
    }

    expect(tiktokCall).toBeDefined();
    const tiktokRows = tiktokCall!.rows as Array<Record<string, unknown>>;
    for (const row of tiktokRows) {
      expect(row.source).toBe('daily_reconcile');
      expect(row.is_finalized).toBe(true);
      expect(typeof row.reconciled_at).toBe('string');
    }
  });

  it('6. pre-flight detects high BUC + skips Meta + still runs Google/TikTok/Shopify', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(85), // 85 >= 80 threshold, fresh within 15 min
    );

    const metaMod = await import('@/lib/fetchers/meta');
    const googleMod = await import('@/lib/fetchers/googleAds');
    const tiktokMod = await import('@/lib/fetchers/tiktok');
    const shopifyMod = await import('@/lib/fetchers/shopify');

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    // Meta fetchers must NOT be called when pre-flight gates them out
    expect(metaMod.fetchMetaAdSetInsights).not.toHaveBeenCalled();
    expect(metaMod.fetchMetaAdInsights).not.toHaveBeenCalled();
    expect(metaMod.fetchMetaBudgets).not.toHaveBeenCalled();

    // Google, TikTok, Shopify ARE still called
    expect(googleMod.fetchGoogleAdsAdGroupInsights).toHaveBeenCalled();
    expect(tiktokMod.fetchTikTokAdInsights).toHaveBeenCalled();
    expect(shopifyMod.fetchShopifyDayRows).toHaveBeenCalled();
  });

  it('7. pre-flight skip routes to cron_daily_budget_skip operation', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(90), // 90 >= 80 threshold, fresh within 15 min
    );

    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { recordFreshness } = await import('@/lib/inngest/freshness');

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    // notifyTokenFailure called with operation='cron_daily_budget_skip'
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        storeId: STORE,
        operation: 'cron_daily_budget_skip',
      }),
    );

    // recordFreshness called with budget_skip for Meta scopes
    const rFCalls = (recordFreshness as ReturnType<typeof vi.fn>).mock.calls;
    const budgetSkipCalls = rFCalls.filter(
      (c) => (c[0] as { status: string }).status === 'budget_skip',
    );
    expect(budgetSkipCalls.length).toBeGreaterThanOrEqual(3);

    const scopes = budgetSkipCalls.map((c) => (c[0] as { scope: string }).scope);
    expect(scopes).toContain('campaign_metrics');
    expect(scopes).toContain('adset_metrics');
    expect(scopes).toContain('ad_metrics');
    // kpi_daily scope
    expect(scopes).toContain('kpi_daily');
  });

  it('8. reconciled_at value is identical across all 6 upserts in one tick (auditability invariant)', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    // Collect all reconciled_at values from finalization-tracked tables
    const reconciledAts: string[] = [];

    const dataDaily = upsertCalls.find((u) => u.table === 'data_daily');
    if (dataDaily) {
      reconciledAts.push((dataDaily.rows as Record<string, unknown>).reconciled_at as string);
    }

    const productsDaily = upsertCalls.find((u) => u.table === 'products_daily');
    if (productsDaily) {
      const rows = productsDaily.rows as Array<Record<string, unknown>>;
      for (const r of rows) reconciledAts.push(r.reconciled_at as string);
    }

    const campaignCalls = upsertCalls.filter((u) => u.table === 'campaigns_daily');
    for (const call of campaignCalls) {
      const rows = call.rows as Array<Record<string, unknown>>;
      for (const r of rows) reconciledAts.push(r.reconciled_at as string);
    }

    const adsDaily = upsertCalls.find((u) => u.table === 'ads_daily');
    if (adsDaily) {
      const rows = adsDaily.rows as Array<Record<string, unknown>>;
      for (const r of rows) reconciledAts.push(r.reconciled_at as string);
    }

    expect(reconciledAts.length).toBeGreaterThan(0);
    // Every reconciled_at must be exactly the same value
    const unique = new Set(reconciledAts);
    expect(unique.size).toBe(1);
  });

  it('9. stale BUC row (older than 15 min) → optimistic proceed (Meta still fetched)', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    // High pct but 20 min old — beyond the 15-min fresh window
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(90, 20),
    );

    const metaMod = await import('@/lib/fetchers/meta');
    const { recordFreshness } = await import('@/lib/inngest/freshness');

    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    // Meta fetchers ARE called (optimistic proceed)
    expect(metaMod.fetchMetaAdSetInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaAdInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaBudgets).toHaveBeenCalled();

    // No budget_skip recordFreshness calls
    const rFCalls = (recordFreshness as ReturnType<typeof vi.fn>).mock.calls;
    const budgetSkipCalls = rFCalls.filter(
      (c) => (c[0] as { status: string }).status === 'budget_skip',
    );
    expect(budgetSkipCalls.length).toBe(0);
  });
});
