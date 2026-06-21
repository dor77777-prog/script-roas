// dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts
//
// Phase 05.6 plan 08 — tests for the 3 cron-daily-{store} Inngest functions
// and their shared handler body `runDailyForStore`.
//
// Coverage map (6 tests, one per acceptance-criteria line in 05.6-08-PLAN.md):
//   Test 1 — cronDailyFunctions.length === 3 (one per store from STORES const)
//   Test 2 — each function has unique id matching `cron-daily-{storeId}`
//   Test 3 — each function's cron trigger is `TZ=Asia/Jerusalem 5 0 * * *`
//            (verifies RESEARCH §Pitfall 1 — Israel-local timezone, NOT UTC)
//   Test 4 — `runDailyForStore` invokes step.run with the expected ordered IDs
//            (free-tier budget per RESEARCH §Pitfall 4 — keep step count low)
//   Test 5 — supabaseAdmin upserts use the correct onConflict strings matching
//            migration 20260521063112_initial_schema.sql PK/UNIQUE definitions
//   Test 6 — an error thrown from any step.run propagates (proves Inngest's
//            retry-on-throw will kick in — D-B6 retry policy)
//
// Mock strategy:
//   - All 5 fetchers in @/lib/fetchers/* are mocked with vi.mock + vi.hoisted
//     state so we can drive their return values per test without real network.
//   - getSupabaseAdmin is mocked to return a chainable stub whose
//     .from(table).upsert(rows, opts) records (table, rows, opts) into a
//     shared array — used by Test 5 to assert onConflict strings.
//   - step.run('id', cb) is mocked to call cb() and record the id; this
//     mirrors Inngest's default-runner behavior (no memoization, no retry)
//     and is sufficient for shape assertions.
//
// Why we do NOT exercise inngest.createFunction at runtime:
//   The SDK's InngestFunction type surface IS introspectable (`fn.opts.triggers`)
//   so Tests 1-3 read those directly. The handler body is the inner
//   async ({ step }) function — Test 4 invokes it via runDailyForStore() with
//   a hand-rolled mockStep. This sidesteps the need to spin up an Inngest
//   dev server or signing layer.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — accessible from inside vi.mock factories AND tests
// ---------------------------------------------------------------------------

type UpsertCall = { table: string; rows: unknown; opts: { onConflict?: string } };

type MockState = {
  upserts: UpsertCall[];
  upsertError: { message: string } | null;
  shopifyResult: {
    storeId: string;
    date: string;
    storeName: string;
    revenueCad: number;
    productRows: Array<{ product_id: string; net_revenue_cad: number }>;
    customItemRefundCad: number;
  };
  // Phase 05.6.1 — three new fetcher results wired into the same step.run
  // callbacks. Each test sets these per-scenario; the default values exercise
  // the happy path where all 3 new writers fire.
  shopifyOrdersResult: Array<{
    storeId: string;
    orderId: string;
    date: string;
    totalCad: number;
    source: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    fbclidPresent: boolean;
    gclidPresent: boolean;
    referrer: string | null;
    utmId: string | null;
    utmTerm: string | null;
    lineItems: Array<{ p: string; u: number; r: number }> | null;
    // תשלומים (2026-06-03) — raw primary payment gateway picked from the
    // order's payment_gateway_names; persisted to orders_attribution.payment_gateway.
    paymentGateway?: string | null;
  }>;
  shopifyCatalogResult: Array<{
    storeId: string;
    productId: string;
    title: string;
    handle: string;
    status: string;
    priceCad: number | null;
    imageUrl: string | null;
    productType: string | null;
    vendor: string | null;
    updatedAt: string | null;
  }>;
  metaAdSetResult: Array<{
    campaignId: string;
    campaignName: string;
    adSetId: string;
    adSetName: string;
    spend: number;
    currency: string;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
  }>;
  // Phase 05.6.1 → 2026-05-21: MetaAdRow exposes raw `spend` + `currency` +
  // `conversionValue` (was `spendCad`/`conversionValueCad: null`). The
  // cronDaily writer FX-converts once per (store, date) via `cadFor`.
  // Stale field names here would silently make `r.spend`/`r.currency`/
  // `r.conversionValue` undefined in the writer — `cadFor(undefined, …)`
  // short-circuits to 0 because the Number.isFinite guard catches it, but
  // the test would not exercise the real Meta-ad FX path.
  metaAdResult: Array<{
    storeId: string;
    date: string;
    platform: 'meta';
    campaignId: string;
    campaignName: string;
    adSetId: string;
    adSetName: string;
    adId: string;
    adName: string;
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    currency: string;
    conversionValue: number;
  }>;
  metaSpendResult: { storeId: string; date: string; spend: number; currency: string };
  // Phase 05.7.2 — Meta budgets fetch result. Maps campaign/adset ID → budget.
  metaBudgetsResult: {
    currency: string;
    campaigns: Record<string, { dailyBudget: number; lifetimeBudget: number; bidStrategy: string | null }>;
    adSets: Record<string, { dailyBudget: number; lifetimeBudget: number; campaignId: string }>;
  };
  googleSpendResult: { storeId: string; date: string; spend: number; currency: string };
  googleAdGroupResult: Array<{
    campaignId: string;
    campaignName: string;
    adSetId: string;
    adSetName: string;
    spend: number;
    currency: string;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
  }>;
  googleAdResult: Array<{
    storeId: string;
    date: string;
    platform: 'google';
    campaignId: string;
    campaignName: string;
    adSetId: string;
    adSetName: string;
    adId: string;
    adName: string;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValueCad: number;
    spendCad: number;
  }>;
  mergeResult: {
    fbSpendCad: number;
    gaSpendCad: number;
    totalSpendCad: number;
    // TikTok unblock (2026-06-02): optional so the bulk of existing scenarios
    // (which don't exercise TikTok overrides) keep their terse mergeResult;
    // the dedicated override scenario sets them explicitly.
    ttSpendCad?: number;
    overridesApplied: { meta: boolean; google: boolean; tiktok?: boolean };
  };
  /** Phase 05.7.7 — TikTok mock fields. Default to zero/empty so the
   *  existing tests don't need to know about TikTok unless they care. */
  tiktokSpendResult: {
    storeId: string;
    date: string;
    spend: number;
    currency: string;
  };
  tiktokAdResult: Array<{
    campaignId: string;
    campaignName: string;
    adGroupId: string;
    adGroupName: string;
    adId: string;
    adName: string;
    spend: number;
    currency: string;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
  }>;
  /** USD→CAD rate used by the mocked getFxRate. Default 1.35. */
  fxRate: number;
  /**
   * If set, the named fetcher throws `new Error(throwIn)` instead of returning
   * its mocked value. Test 6 uses this to verify step.run errors propagate.
   */
  throwIn: null | 'shopify' | 'meta' | 'google' | 'tiktok' | 'merge' | 'upsert';
  /**
   * ads-off Phase 3 (fetch-gate): `fetchAdStateFromPostgres` return value.
   * Default `{}` ⇒ all platforms ON (missing key = enabled). Tests that need
   * a store/platform OFF populate this explicitly.
   */
  adStateMap: Record<string, boolean>;
};

const mockState = vi.hoisted<MockState>(() => ({
  upserts: [],
  upsertError: null,
  shopifyResult: {
    storeId: 'uzoshop',
    date: '2026-05-20',
    storeName: 'uzoshop',
    revenueCad: 1234.56,
    productRows: [
      { product_id: 'p1', net_revenue_cad: 800 },
      { product_id: 'p2', net_revenue_cad: 434.56 },
    ],
    customItemRefundCad: 0,
  },
  shopifyOrdersResult: [
    {
      storeId: 'uzoshop',
      orderId: 'O-1',
      date: '2026-05-20',
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
      paymentGateway: 'shopify_payments',
    },
  ],
  shopifyCatalogResult: [
    {
      storeId: 'uzoshop',
      productId: 'p1',
      title: 'Test Product',
      handle: 'test-product',
      status: 'active',
      priceCad: 19.99,
      imageUrl: 'https://cdn.shopify.com/img.jpg',
      productType: 'Widget',
      vendor: 'TestCo',
      updatedAt: '2026-05-20T08:00:00Z',
    },
  ],
  metaAdSetResult: [
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
  ],
  metaAdResult: [
    {
      storeId: 'uzoshop',
      date: '2026-05-20',
      platform: 'meta',
      campaignId: 'c1',
      campaignName: 'Campaign 1',
      adSetId: 'as1',
      adSetName: 'Ad Set 1',
      adId: 'ad-meta-1',
      adName: 'Meta Ad 1',
      impressions: 600,
      clicks: 30,
      conversions: 3,
      // 2026-05-21: raw ILS values (writer FX-converts to CAD via cadFor).
      spend: 60,
      currency: 'ILS',
      conversionValue: 300,
    },
  ],
  metaSpendResult: { storeId: 'uzoshop', date: '2026-05-20', spend: 100, currency: 'ILS' },
  // Phase 05.7.2 — Default Meta budgets fixture: one CBO campaign + one ABO
  // ad-set. Demonstrates both branches in a single fixture row.
  metaBudgetsResult: {
    currency: 'ILS',
    campaigns: {
      c1: { dailyBudget: 50, lifetimeBudget: 0, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' },
    },
    adSets: {
      as1: { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'c1' },
    },
  },
  googleSpendResult: { storeId: 'uzoshop', date: '2026-05-20', spend: 50, currency: 'CAD' },
  googleAdGroupResult: [
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
    },
  ],
  googleAdResult: [
    {
      storeId: 'uzoshop',
      date: '2026-05-20',
      platform: 'google',
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
  ],
  mergeResult: {
    fbSpendCad: 36, // 100 ILS * ~0.36 CAD/ILS
    gaSpendCad: 50,
    totalSpendCad: 86,
    overridesApplied: { meta: false, google: false },
  },
  // Phase 05.7.7 — TikTok defaults (zero spend, no ads). Tests that
  // exercise TikTok writes (campaigns_daily(platform=tiktok), ads_daily,
  // tt_spend_cad) populate these explicitly.
  tiktokSpendResult: {
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 0,
    currency: 'USD',
  },
  tiktokAdResult: [],
  fxRate: 1.35,
  throwIn: null,
  adStateMap: {},
}));

// ---------------------------------------------------------------------------
// Mocks — order matters: declare BEFORE the SUT import.
// ---------------------------------------------------------------------------

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn(async () => {
    if (mockState.throwIn === 'shopify') throw new Error('shopify-failed');
    return mockState.shopifyResult;
  }),
  // Phase 05.6.1 — 2 new Shopify fetchers wired alongside fetchShopifyDayRows.
  fetchShopifyOrdersAttribution: vi.fn(async () => {
    if (mockState.throwIn === 'shopify') throw new Error('shopify-orders-failed');
    return mockState.shopifyOrdersResult;
  }),
  fetchShopifyProductsCatalog: vi.fn(async () => {
    if (mockState.throwIn === 'shopify') throw new Error('shopify-catalog-failed');
    return mockState.shopifyCatalogResult;
  }),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error('meta-adset-failed');
    return mockState.metaAdSetResult;
  }),
  fetchMetaSpendForDay: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error('meta-spend-failed');
    return mockState.metaSpendResult;
  }),
  // Phase 05.6.1 — ad-level insights wired inside fetch-meta step.
  fetchMetaAdInsights: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error('meta-ad-failed');
    return mockState.metaAdResult;
  }),
  // Phase 05.7.2 — per-campaign / per-adset budgets wired inside fetch-meta step.
  fetchMetaBudgets: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error('meta-budgets-failed');
    return mockState.metaBudgetsResult;
  }),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-spend-failed');
    return mockState.googleSpendResult;
  }),
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-adgroup-failed');
    return mockState.googleAdGroupResult;
  }),
  // Phase 05.6.1 — ad-level insights wired inside fetch-google step.
  fetchGoogleAdsAdInsights: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-ad-failed');
    return mockState.googleAdResult;
  }),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn(async () => {
    if (mockState.throwIn === 'merge') throw new Error('merge-failed');
    return mockState.mergeResult;
  }),
}));

// Phase 05.7.7 — TikTok fetchers (uzoshop only in prod, but the mock
// returns zero/empty by default for all stores so test 4 step-order
// assertions stay deterministic; tests that need TikTok data populate
// mockState.tiktokSpendResult / mockState.tiktokAdResult explicitly).
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn(async () => {
    if (mockState.throwIn === 'tiktok') throw new Error('tiktok-spend-failed');
    return mockState.tiktokSpendResult;
  }),
  fetchTikTokAdInsights: vi.fn(async () => {
    if (mockState.throwIn === 'tiktok') throw new Error('tiktok-ad-failed');
    return mockState.tiktokAdResult;
  }),
  fetchTikTokAdvertiserInfo: vi.fn(async () => ({
    advertiserId: '7306450983905787906',
    name: 'DOD DIGITAL1128',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  })),
}));

// Phase 05.7.7 — FX helper mock. cron-daily uses getFxRate for TikTok
// USD→CAD conversion at persist-batch time. Tests can override the rate
// via mockState.fxRate; default 1.35 = realistic USD→CAD ratio.
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => mockState.fxRate ?? 1.35),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        mockState.upserts.push({ table, rows, opts });
        if (mockState.throwIn === 'upsert') {
          return Promise.resolve({ error: { message: 'upsert-failed' } });
        }
        return Promise.resolve({ error: mockState.upsertError });
      },
    }),
    // Phase 3 (2026-06-02) — runDailyForStore now calls
    // admin.rpc('recompute_first_order_flags', {...}) at the end of the
    // persist step. Soft-fail (returns { error: null }); no recording needed
    // here — the dedicated cronDailyFirstOrder.test.ts asserts the call.
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

// Phase A 2026-05-29 (Task 13) — mock the new BUC + freshness + alert
// modules added to cronDaily.ts. Without these, the `step.run('pre-flight-
// meta-buc-…')` callback tries to read from Supabase (no DB in tests).
vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: vi.fn().mockResolvedValue(undefined),
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

// ads-off Phase 3 (fetch-gate) — mock fetchAdStateFromPostgres so tests can
// drive per-store/platform off states without a real Supabase connection.
vi.mock('@/lib/postgresReaders', async (orig) => ({
  ...(await orig<typeof import('@/lib/postgresReaders')>()),
  fetchAdStateFromPostgres: vi.fn(async () => mockState.adStateMap),
}));

// ---- SUT import (after mocks) ----------------------------------------------

import { runDailyForStore } from '../cronDaily';
import {
  fetchMetaSpendForDay,
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaBudgets,
} from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsSpendForDay,
  fetchGoogleAdsAdGroupInsights,
  fetchGoogleAdsAdInsights,
} from '@/lib/fetchers/googleAds';
import {
  fetchTikTokSpendForDay,
  fetchTikTokAdInsights,
} from '@/lib/fetchers/tiktok';

// ---- Shared helpers --------------------------------------------------------

/**
 * A minimal mock for the Inngest StepTools `step` arg. Records each call's
 * id (in order), then invokes the callback directly — no retry, no
 * memoization. Sufficient for shape assertions.
 */
function makeMockStep(): { step: { run: (id: string, cb: () => Promise<unknown>) => Promise<unknown> }; ids: string[] } {
  const ids: string[] = [];
  const step = {
    run: async (id: string, cb: () => Promise<unknown>) => {
      ids.push(id);
      return await cb();
    },
  };
  return { step, ids };
}

// Phase 05.6.1 — capture initial array fixtures so each test starts from a
// known-good state even after Test 8 (which empties them). Deep-copying via
// structuredClone preserves nested objects (e.g. lineItems arrays) without the
// risk of accidental cross-test mutation.
const INITIAL_SHOPIFY_ORDERS = structuredClone(mockState.shopifyOrdersResult);
const INITIAL_SHOPIFY_CATALOG = structuredClone(mockState.shopifyCatalogResult);
const INITIAL_META_ADS = structuredClone(mockState.metaAdResult);
const INITIAL_GOOGLE_ADS = structuredClone(mockState.googleAdResult);

beforeEach(() => {
  mockState.upserts = [];
  mockState.upsertError = null;
  mockState.throwIn = null;
  mockState.adStateMap = {};
  // Reset the Phase 05.6.1 fixture arrays so Test 8's emptying does not leak.
  mockState.shopifyOrdersResult = structuredClone(INITIAL_SHOPIFY_ORDERS);
  mockState.shopifyCatalogResult = structuredClone(INITIAL_SHOPIFY_CATALOG);
  mockState.metaAdResult = structuredClone(INITIAL_META_ADS);
  mockState.googleAdResult = structuredClone(INITIAL_GOOGLE_ADS);
  // ads-off Phase 3: clear spy call counts so `not.toHaveBeenCalled()` only
  // sees calls from the current test, not accumulated across the suite.
  vi.clearAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

// The old per-store factory (cronDailyFunctions: array length / `cron-daily-{store}`
// ids / `TZ=Asia/Jerusalem 5 0 * * *` schedule) was removed in the Inngest →
// Vercel Cron + QStash migration. cron-daily now runs on Vercel Cron at
// /api/cron/daily → QStash → /api/worker/daily-store (schedule/gating covered by
// dailyRoute.test.ts). These tests cover the runDailyForStore handler logic.
describe('cronDaily — handler', () => {
  it('Test 4: `runDailyForStore` invokes step.run with the expected ordered step IDs', async () => {
    const { step, ids } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    // Per RESEARCH §Pitfall 4 recommended decomposition. Phase 05.7.7
    // added fetch-tiktok. Phase 13.4 (2026-05-25) split fetch-shopify
    // into 3 parallel sub-steps (day / orders / catalog) so each retries
    // independently and Inngest doesn't have to refetch the whole bundle
    // when one half fails. Step count: 6 → 8.
    // Phase A 2026-05-29 (Task 13): added pre-flight-meta-buc step.
    // Step count: 8 → 9.
    // ads-off Phase 3 (fetch-gate): added fetch-ad-state as the first step
    // (before fetch-shopify). Step count: 9 → 10.
    expect(ids).toEqual([
      'fetch-ad-state',
      'pre-flight-meta-buc-uzoshop',
      'fetch-shopify-day',
      'fetch-shopify-orders',
      'fetch-shopify-catalog',
      'fetch-meta',
      'fetch-google',
      'fetch-tiktok',
      'apply-manual-overrides',
      'persist-batch',
    ]);
    // Free-tier guard: total step count must stay ≤ 11 (1 function + 10
    // steps = 11 execs/run; × 3 stores × 1 run/day × 30 days = 990
    // execs/month from cron-daily — still well under 50K/mo free-tier).
    expect(ids.length).toBeLessThanOrEqual(11);
  });

  it('Test 5: persist-batch upserts use the correct `onConflict` strings (match migration PK/UNIQUE)', async () => {
    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    // Inspect every upsert call made by the persist-batch step.
    const byTable = new Map<string, UpsertCall[]>();
    for (const call of mockState.upserts) {
      const list = byTable.get(call.table) ?? [];
      list.push(call);
      byTable.set(call.table, list);
    }

    // data_daily — PK (date, store_id)
    const dataDailyCalls = byTable.get('data_daily') ?? [];
    expect(dataDailyCalls.length).toBeGreaterThan(0);
    expect(dataDailyCalls[0].opts.onConflict).toBe('date,store_id');

    // products_daily — PK (date, store_id, product_id)
    const productsCalls = byTable.get('products_daily') ?? [];
    expect(productsCalls.length).toBeGreaterThan(0);
    expect(productsCalls[0].opts.onConflict).toBe('date,store_id,product_id');

    // campaigns_daily — PK (date, store_id, platform, campaign_id, ad_set_id)
    // There may be TWO campaigns_daily upsert calls (one for meta rows, one
    // for google rows) — both must use the same onConflict string.
    const campaignsCalls = byTable.get('campaigns_daily') ?? [];
    expect(campaignsCalls.length).toBeGreaterThan(0);
    for (const c of campaignsCalls) {
      expect(c.opts.onConflict).toBe('date,store_id,platform,campaign_id,ad_set_id');
    }

    // Phase 05.6.1 — 3 new tables.
    // ads_daily — PK (date, store_id, ad_id). One combined upsert with
    // both Meta and Google rows.
    const adsCalls = byTable.get('ads_daily') ?? [];
    expect(adsCalls.length).toBe(1);
    expect(adsCalls[0].opts.onConflict).toBe('date,store_id,ad_id');
    // Rows array must include both platforms (1 meta + 1 google from the
    // fixture defaults).
    const adsRows = adsCalls[0].rows as Array<{ platform: string }>;
    expect(adsRows.map((r) => r.platform).sort()).toEqual(['google', 'meta']);

    // orders_attribution — PK (store_id, order_id) — NOT date-scoped.
    const ordersCalls = byTable.get('orders_attribution') ?? [];
    expect(ordersCalls.length).toBe(1);
    expect(ordersCalls[0].opts.onConflict).toBe('store_id,order_id');

    // product_catalog — PK (store_id, product_id) — snapshot, no date.
    const catalogCalls = byTable.get('product_catalog') ?? [];
    expect(catalogCalls.length).toBe(1);
    expect(catalogCalls[0].opts.onConflict).toBe('store_id,product_id');
  });

  it('Test 5b (תשלומים 2026-06-03): orders_attribution upsert row carries payment_gateway from the row', async () => {
    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    const ordersCall = mockState.upserts.find(
      (u) => u.table === 'orders_attribution',
    );
    expect(ordersCall).toBeDefined();
    const rows = ordersCall!.rows as Array<{
      order_id: string;
      payment_gateway: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe('O-1');
    // Default fixture order pays via shopify_payments → persisted raw.
    expect(rows[0].payment_gateway).toBe('shopify_payments');
  });

  it('Test 5c (תשלומים 2026-06-03): missing paymentGateway persists as null (not undefined)', async () => {
    mockState.shopifyOrdersResult = [
      { ...INITIAL_SHOPIFY_ORDERS[0], orderId: 'O-2', paymentGateway: null },
    ];

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    const ordersCall = mockState.upserts.find(
      (u) => u.table === 'orders_attribution',
    );
    expect(ordersCall).toBeDefined();
    const rows = ordersCall!.rows as Array<{ payment_gateway: string | null }>;
    expect(rows[0].payment_gateway).toBeNull();
    // The key MUST be present (NULL write), not absent — so a NULL clears any
    // stale value on re-upsert rather than leaving it untouched.
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'payment_gateway')).toBe(
      true,
    );
  });

  it('Test 7: result exposes the 4 new row counts (metaAd, googleAd, ordersAttribution, productCatalog)', async () => {
    const { step } = makeMockStep();
    const result = await runDailyForStore('uzoshop', '2026-05-20', { step });

    // Default fixtures: 1 meta ad, 1 google ad, 1 order, 1 catalog product.
    expect(result.metaAdRowCount).toBe(1);
    expect(result.googleAdRowCount).toBe(1);
    expect(result.ordersAttributionRowCount).toBe(1);
    expect(result.productCatalogRowCount).toBe(1);
  });

  it('Test 8: empty fetcher results skip writes (no upsert calls when arrays are empty)', async () => {
    mockState.shopifyOrdersResult = [];
    mockState.shopifyCatalogResult = [];
    mockState.metaAdResult = [];
    mockState.googleAdResult = [];

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    const tables = new Set(mockState.upserts.map((u) => u.table));
    // The 3 newly-added tables MUST NOT be hit when their input arrays are
    // empty — same conservative pattern the existing products_daily and
    // campaigns_daily writes follow at cronDaily.ts:249/280/314.
    expect(tables.has('ads_daily')).toBe(false);
    expect(tables.has('orders_attribution')).toBe(false);
    expect(tables.has('product_catalog')).toBe(false);

    // The 3 pre-existing writes still happen (data_daily always; products and
    // campaigns when their fixtures have rows — they DO in the defaults).
    expect(tables.has('data_daily')).toBe(true);
  });

  it('Test 9 (Phase 05.7.2): campaigns_daily Meta upsert populates budget_type + budget CAD per row', async () => {
    // Override the default 1-adset fixture with 3 adsets that cover the 3
    // budget cases: CBO (campaign has daily), ABO (adset has daily), '' (paused).
    mockState.metaAdSetResult = [
      {
        campaignId: 'c-cbo',
        campaignName: 'CBO Campaign',
        adSetId: 'as-cbo-1',
        adSetName: 'AdSet CBO 1',
        spend: 100,
        currency: 'ILS',
        impressions: 1000,
        clicks: 50,
        conversions: 5,
        conversionValue: 500,
      },
      {
        campaignId: 'c-abo',
        campaignName: 'ABO Campaign',
        adSetId: 'as-abo-1',
        adSetName: 'AdSet ABO 1',
        spend: 200,
        currency: 'ILS',
        impressions: 2000,
        clicks: 100,
        conversions: 10,
        conversionValue: 1000,
      },
      {
        campaignId: 'c-paused',
        campaignName: 'Paused Campaign',
        adSetId: 'as-paused-1',
        adSetName: 'AdSet Paused',
        spend: 0,
        currency: 'ILS',
        impressions: 0,
        clicks: 0,
        conversions: 1, // late-attributed (matches keep-rule)
        conversionValue: 30,
      },
    ];
    // Matching budgets fixture: CBO with daily, ABO with adset daily, paused empty.
    mockState.metaBudgetsResult = {
      currency: 'ILS',
      campaigns: {
        'c-cbo': { dailyBudget: 75, lifetimeBudget: 0, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' },
        'c-abo': { dailyBudget: 0, lifetimeBudget: 0, bidStrategy: null },
        'c-paused': { dailyBudget: 0, lifetimeBudget: 0, bidStrategy: null },
      },
      adSets: {
        'as-cbo-1': { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'c-cbo' },
        'as-abo-1': { dailyBudget: 40, lifetimeBudget: 0, campaignId: 'c-abo' },
        'as-paused-1': { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'c-paused' },
      },
    };

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    // Find the Meta campaigns_daily upsert (NOT the google one — first
    // upsert call to campaigns_daily is meta per the writer order).
    const campaignsCalls = mockState.upserts.filter(
      (u) => u.table === 'campaigns_daily',
    );
    expect(campaignsCalls.length).toBeGreaterThanOrEqual(1);
    const metaUpsert = campaignsCalls[0];
    const rows = metaUpsert.rows as Array<{
      campaign_id: string;
      ad_set_id: string;
      budget_type: 'CBO' | 'ABO' | '';
      campaign_budget_cad: number | null;
      ad_set_budget_cad: number | null;
    }>;
    expect(rows).toHaveLength(3);

    // CBO row — campaign owns daily=75, adset owns nothing. campaign_budget_cad
    // is some positive CAD number (the actual FX rate depends on the FX
    // closure; we just assert >0 so the test isn't brittle to ILS→CAD rates).
    const cbo = rows.find((r) => r.campaign_id === 'c-cbo')!;
    expect(cbo.budget_type).toBe('CBO');
    expect(cbo.campaign_budget_cad).not.toBeNull();
    expect(cbo.campaign_budget_cad!).toBeGreaterThan(0);
    expect(cbo.ad_set_budget_cad).toBeNull();

    // ABO row — campaign 0, adset has daily=40.
    const abo = rows.find((r) => r.campaign_id === 'c-abo')!;
    expect(abo.budget_type).toBe('ABO');
    expect(abo.campaign_budget_cad).toBeNull();
    expect(abo.ad_set_budget_cad).not.toBeNull();
    expect(abo.ad_set_budget_cad!).toBeGreaterThan(0);

    // Paused row — both zero, empty budget_type, both CAD fields null.
    const paused = rows.find((r) => r.campaign_id === 'c-paused')!;
    expect(paused.budget_type).toBe('');
    expect(paused.campaign_budget_cad).toBeNull();
    expect(paused.ad_set_budget_cad).toBeNull();
  });

  it('Test 6: an error inside any step propagates out of `runDailyForStore` (D-B6 retry-on-throw)', async () => {
    mockState.throwIn = 'shopify';
    const { step } = makeMockStep();
    // Phase 13.4: fetch-shopify split into 3 parallel steps means Promise.all
    // races and any of the 3 mocks (day/orders/catalog) can reject first.
    // The contract — "an error from Shopify propagates" — still holds; we
    // just match whichever of the 3 error messages bubbles up.
    await expect(runDailyForStore('uzoshop', '2026-05-20', { step })).rejects.toThrow(/shopify(-orders|-catalog)?-failed/);

    mockState.throwIn = 'merge';
    const { step: step2 } = makeMockStep();
    await expect(runDailyForStore('uzoshop', '2026-05-20', { step: step2 })).rejects.toThrow(/merge-failed/);

    mockState.throwIn = 'upsert';
    const { step: step3 } = makeMockStep();
    await expect(runDailyForStore('uzoshop', '2026-05-20', { step: step3 })).rejects.toThrow(/upsert/);
  });

  // ===========================================================================
  // Audit fix 2026-05-23 a/WARN-1 — platform-throw SOFT-FAIL regression tests.
  //
  // Commit 11161e8 added try/catch around fetch-meta / fetch-google /
  // fetch-tiktok so a single token expiry on one platform no longer kills
  // runDailyForStore (which previously rolled back Shopify + the OTHER
  // platforms too). The throw branches had no regression tests; this block
  // pins them. For each platform we assert:
  //   (a) runDailyForStore does NOT throw.
  //   (b) data_daily UPSERT was called (persist-batch still ran).
  //   (c) the failed platform's spend column landed as 0 (zero sentinel),
  //       while the other platforms' values survived intact.
  // ===========================================================================

  describe('Test 10 (a/WARN-1): platform-throw soft-fail', () => {
    function getDataDailyRow(): Record<string, unknown> | undefined {
      const call = mockState.upserts.find((u) => u.table === 'data_daily');
      if (!call) return undefined;
      // data_daily upsert always passes a single row object.
      return call.rows as Record<string, unknown>;
    }

    it('Meta fetch throw → runDailyForStore completes, data_daily persists, fb_spend_cad = 0', async () => {
      // Seed Google + TikTok with non-zero spend so we can prove they
      // survived while Meta zeroed out. ttSpendResult of 0 USD would still
      // be 0 CAD; bump it to 10 USD so a TikTok survival assertion is
      // possible. Google fixture is already CAD 50.
      mockState.tiktokSpendResult = {
        storeId: 'uzoshop',
        date: '2026-05-20',
        spend: 10,
        currency: 'USD',
      };
      // mergeResult currently has fbSpendCad=36 — but mergeOverridesFromSupabase
      // is mocked and ALWAYS returns mockState.mergeResult regardless of the
      // meta.spend input. To make the test reflect what really happens in
      // production (Meta throws → meta.spend = 0 → merger returns
      // fbSpendCad=0), tighten the mock to zero-out fb when meta zeroed.
      // The throw above already returns spend=0 to merger; we just need the
      // merge mock to honour that. Override mergeResult so the assertion
      // pin is meaningful.
      mockState.mergeResult = {
        fbSpendCad: 0, // simulates the merger seeing meta.spend=0
        gaSpendCad: 50, // Google survived
        totalSpendCad: 50,
        overridesApplied: { meta: false, google: false },
      };
      mockState.throwIn = 'meta';

      const { step } = makeMockStep();
      // (a) Must NOT throw.
      await expect(
        runDailyForStore('uzoshop', '2026-05-20', { step }),
      ).resolves.toBeDefined();

      // (b) data_daily UPSERT was called.
      const row = getDataDailyRow();
      expect(row).toBeDefined();

      // (c) fb_spend_cad is 0 (Meta zero sentinel), while Google and TikTok
      //     spend survived.
      expect(row?.fb_spend_cad).toBe(0);
      expect(row?.ga_spend_cad).toBe(50);
      expect(Number(row?.tt_spend_cad)).toBeGreaterThan(0);
    });

    // Phase 13.4.1 — regression pin. The pre-13.4.1 meta-throw fallback used
    // `new Map()` for budgets.campaigns / budgets.adSets. Inngest serializes
    // step.run return values via JSON, which loses Map contents — `{}` —
    // and the type cast on the step return hides the mismatch from tsc.
    // After 13.4.1 the fallback returns plain objects ({}) + currency.
    // This test pins the JSON-roundtrip contract: nothing in the step return
    // can be a Map (would silently serialize to {} and break downstream
    // bracket-access reads).
    it('Test 10b (Phase 13.4.1): meta-throw fallback returns JSON-roundtrippable budgets (no Map)', async () => {
      mockState.throwIn = 'meta';

      // Snoop on what the fetch-meta step.run returns by replacing the
      // StepRunner with one that captures callback return values.
      const stepReturns = new Map<string, unknown>();
      const step = {
        run: async (id: string, fn: () => Promise<unknown>): Promise<unknown> => {
          const result = await fn();
          stepReturns.set(id, result);
          return result;
        },
      };

      await runDailyForStore('uzoshop', '2026-05-20', { step });

      const metaReturn = stepReturns.get('fetch-meta') as {
        budgets: { campaigns: unknown; adSets: unknown; currency: unknown };
      };
      // No Map at any level — Map's serialization loses entries.
      expect(metaReturn.budgets.campaigns).not.toBeInstanceOf(Map);
      expect(metaReturn.budgets.adSets).not.toBeInstanceOf(Map);
      // The whole budgets object survives a JSON roundtrip unchanged.
      const roundtripped = JSON.parse(JSON.stringify(metaReturn.budgets));
      expect(roundtripped).toEqual(metaReturn.budgets);
      // currency is required (cadFor consumers read it).
      expect(typeof roundtripped.currency).toBe('string');
    });

    it('Google fetch throw → runDailyForStore completes, data_daily persists, ga_spend_cad = 0', async () => {
      mockState.tiktokSpendResult = {
        storeId: 'uzoshop',
        date: '2026-05-20',
        spend: 10,
        currency: 'USD',
      };
      // Merger sees google.spend = 0 → gaSpendCad = 0. Meta survives.
      mockState.mergeResult = {
        fbSpendCad: 36,
        gaSpendCad: 0,
        totalSpendCad: 36,
        overridesApplied: { meta: false, google: false },
      };
      mockState.throwIn = 'google';

      const { step } = makeMockStep();
      await expect(
        runDailyForStore('uzoshop', '2026-05-20', { step }),
      ).resolves.toBeDefined();

      const row = getDataDailyRow();
      expect(row).toBeDefined();
      expect(row?.ga_spend_cad).toBe(0);
      expect(row?.fb_spend_cad).toBe(36);
      expect(Number(row?.tt_spend_cad)).toBeGreaterThan(0);
    });

    it('TikTok fetch throw → runDailyForStore completes, data_daily persists, tt_spend_cad = 0', async () => {
      mockState.mergeResult = {
        fbSpendCad: 36,
        gaSpendCad: 50,
        totalSpendCad: 86,
        overridesApplied: { meta: false, google: false },
      };
      mockState.throwIn = 'tiktok';

      const { step } = makeMockStep();
      await expect(
        runDailyForStore('uzoshop', '2026-05-20', { step }),
      ).resolves.toBeDefined();

      const row = getDataDailyRow();
      expect(row).toBeDefined();
      // TikTok zero sentinel: tt_spend_cad lands as 0 (cadFor short-circuits
      // when spend === 0).
      expect(row?.tt_spend_cad).toBe(0);
      // Meta + Google unaffected.
      expect(row?.fb_spend_cad).toBe(36);
      expect(row?.ga_spend_cad).toBe(50);
    });

    // ===========================================================================
    // ads-off Phase 3 (fetch-gate) — Test 11: per-platform gate via adStateMap.
    //
    // When a store/platform is OFF, the corresponding fetchers must NOT be called
    // and the run still completes (persist-batch writes the existing zero sentinel).
    // Default empty map ⇒ all platforms ON ⇒ unchanged behaviour.
    // ===========================================================================

    describe('Test 11 (ads-off Phase 3): fetch-gate skips fetchers when platform is OFF', () => {
      it('Meta OFF for uzoshop → Meta fetchers never called; run completes', async () => {
        mockState.adStateMap = { 'uzoshop:meta': false };

        const { step } = makeMockStep();
        await expect(
          runDailyForStore('uzoshop', '2026-05-20', { step }),
        ).resolves.toBeDefined();

        expect(vi.mocked(fetchMetaSpendForDay)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchMetaAdSetInsights)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchMetaAdInsights)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchMetaBudgets)).not.toHaveBeenCalled();

        // persist-batch still ran (data_daily was upserted)
        expect(mockState.upserts.some((u) => u.table === 'data_daily')).toBe(true);
      });

      it('Google OFF for uzoshop → Google fetchers never called; run completes', async () => {
        mockState.adStateMap = { 'uzoshop:google': false };

        const { step } = makeMockStep();
        await expect(
          runDailyForStore('uzoshop', '2026-05-20', { step }),
        ).resolves.toBeDefined();

        expect(vi.mocked(fetchGoogleAdsSpendForDay)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchGoogleAdsAdGroupInsights)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchGoogleAdsAdInsights)).not.toHaveBeenCalled();

        // persist-batch still ran
        expect(mockState.upserts.some((u) => u.table === 'data_daily')).toBe(true);
      });

      it('TikTok OFF for BOTH shared stores → TikTok fetchers never called', async () => {
        // Both uzoshop + usmile360 off ⇒ tiktokAccountFetchEnabled returns false
        mockState.adStateMap = {
          'uzoshop:tiktok': false,
          'usmile360:tiktok': false,
        };

        const { step } = makeMockStep();
        await expect(
          runDailyForStore('uzoshop', '2026-05-20', { step }),
        ).resolves.toBeDefined();

        expect(vi.mocked(fetchTikTokSpendForDay)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchTikTokAdInsights)).not.toHaveBeenCalled();
      });

      it('TikTok OFF for only uzoshop → TikTok fetchers still called (account-level gate requires ALL shared stores OFF)', async () => {
        // Only one of the two shared stores is off → account-level fetch must proceed
        mockState.adStateMap = { 'uzoshop:tiktok': false };

        const { step } = makeMockStep();
        await expect(
          runDailyForStore('uzoshop', '2026-05-20', { step }),
        ).resolves.toBeDefined();

        // usmile360 is still ON, so the shared account fetch proceeds
        expect(vi.mocked(fetchTikTokSpendForDay)).toHaveBeenCalled();
        expect(vi.mocked(fetchTikTokAdInsights)).toHaveBeenCalled();
      });

      it('empty adStateMap (default) → all platform fetchers called (unchanged behaviour)', async () => {
        // mockState.adStateMap is already {} from beforeEach
        const { step } = makeMockStep();
        await runDailyForStore('uzoshop', '2026-05-20', { step });

        expect(vi.mocked(fetchMetaSpendForDay)).toHaveBeenCalled();
        expect(vi.mocked(fetchGoogleAdsSpendForDay)).toHaveBeenCalled();
        expect(vi.mocked(fetchTikTokSpendForDay)).toHaveBeenCalled();
      });
    });

    // TikTok manual-override unblock (2026-06-02) — end-to-end consumer proof.
    // When mergeOverridesFromSupabase reports overridesApplied.tiktok=true, the
    // operator's FX'd value (merged.ttSpendCad) MUST be the persisted
    // tt_spend_cad — NOT the fetched/FX'd value — and total_spend_cad must roll
    // it up exactly once (no double-count with the merge's own total).
    it('TikTok manual override → persisted tt_spend_cad uses the override value (not the fetched spend)', async () => {
      // Fetched TikTok says 10 USD (→ would be 13.5 CAD at fxRate 1.35); the
      // operator override says 280 CAD. The override must win.
      mockState.tiktokSpendResult = {
        storeId: 'uzoshop',
        date: '2026-05-20',
        spend: 10,
        currency: 'USD',
      };
      mockState.mergeResult = {
        fbSpendCad: 36,
        gaSpendCad: 50,
        ttSpendCad: 280, // operator override, already FX'd to CAD by the merge
        totalSpendCad: 366, // 36 + 50 + 280 (merge's own roll-up)
        overridesApplied: { meta: false, google: false, tiktok: true },
      };

      const { step } = makeMockStep();
      await expect(
        runDailyForStore('uzoshop', '2026-05-20', { step }),
      ).resolves.toBeDefined();

      const row = getDataDailyRow();
      expect(row).toBeDefined();
      // Override value wins (280), NOT the fetched 10 USD × 1.35 = 13.5.
      expect(row?.tt_spend_cad).toBe(280);
      // total_spend_cad rolls up fb + ga + the chosen tt exactly once.
      expect(row?.total_spend_cad).toBe(366);
      expect(row?.fb_spend_cad).toBe(36);
      expect(row?.ga_spend_cad).toBe(50);
    });
  });
});
