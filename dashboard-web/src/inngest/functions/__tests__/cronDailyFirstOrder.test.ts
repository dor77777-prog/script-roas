/**
 * Phase 3 — cron-daily dual-write guard for the first-order columns.
 *
 * Pins:
 *   1. The orders_attribution upsert map includes customer_id + order_created_at
 *      (sourced from the fetched ShopifyOrderRow.customerId / .createdAt).
 *   2. runDailyForStore calls the recompute_first_order_flags RPC with the
 *      store id (so is_first_order is refreshed every nightly tick).
 *
 * Mock strategy mirrors cronDaily.test.ts (same fetcher import surface:
 * fetchShopifyDayRows / fetchShopifyOrdersAttribution / fetchShopifyProductsCatalog,
 * meta/google/tiktok/fx/manualOverrides), with getSupabaseAdmin returning a
 * chainable stub recording upsert(table,rows,opts) + rpc(name,args). The two
 * Phase-3 assertions are appended on top.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state.
// ---------------------------------------------------------------------------
type UpsertCall = { table: string; rows: unknown };
type RpcCall = { name: string; args: unknown };

const mockState = vi.hoisted(() => ({
  upserts: [] as UpsertCall[],
  rpcs: [] as RpcCall[],
}));

// --- Shopify fetchers (real surface: day rows + orders attribution + catalog).
vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn().mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-20',
    storeName: 'uzoshop',
    revenueCad: 80,
    productRows: [],
    customItemRefundCad: 0,
  }),
  fetchShopifyOrdersAttribution: vi.fn().mockResolvedValue([
    {
      storeId: 'uzoshop',
      orderId: 'o-1',
      date: '2026-05-20',
      totalCad: 80,
      source: 'meta-paid',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      fbclidPresent: false,
      gclidPresent: false,
      referrer: null,
      utmId: null,
      utmTerm: null,
      lineItems: null,
      customerId: '778899',
      createdAt: '2026-05-20T09:30:00-04:00',
    },
  ]),
  fetchShopifyProductsCatalog: vi.fn().mockResolvedValue([]),
}));

// --- Meta fetchers (zero spend, no insights).
vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn().mockResolvedValue([]),
  // 2026-07-01 — KPI leg is the LIGHT account-level fetch.
  fetchMetaSpendForDayLight: vi.fn().mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 0,
    currency: 'ILS',
  }),
  fetchMetaAdInsights: vi.fn().mockResolvedValue([]),
  fetchMetaBudgets: vi.fn().mockResolvedValue({ currency: 'ILS', campaigns: {}, adSets: {} }),
}));

// --- Google fetchers (zero spend, no insights).
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn().mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 0,
    currency: 'CAD',
  }),
  fetchGoogleAdsAdGroupInsights: vi.fn().mockResolvedValue([]),
  fetchGoogleAdsAdInsights: vi.fn().mockResolvedValue([]),
}));

// --- TikTok fetchers (zero spend, no ads).
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn().mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 0,
    currency: 'USD',
  }),
  fetchTikTokAdInsights: vi.fn().mockResolvedValue([]),
  fetchTikTokAdvertiserInfo: vi.fn().mockResolvedValue({
    advertiserId: '7306450983905787906',
    name: 'DOD DIGITAL1128',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  }),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn().mockResolvedValue({
    fbSpendCad: 0,
    gaSpendCad: 0,
    totalSpendCad: 0,
    overridesApplied: { meta: false, google: false },
  }),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn().mockResolvedValue(1.35),
}));

// --- Supabase admin: record upserts (table, rows) + rpc (name, args).
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown) => {
        mockState.upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        in: () => Promise.resolve({ error: null }),
        not: () => Promise.resolve({ error: null }),
      }),
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    rpc: (name: string, args: unknown) => {
      mockState.rpcs.push({ name, args });
      return Promise.resolve({ error: null });
    },
  }),
}));

// --- Phase A / notification side modules (no DB in tests).
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

// ---- SUT import (after mocks) ----------------------------------------------
import { runDailyForStore } from '@/inngest/functions/cronDaily';

// A minimal mock for the Inngest StepTools `step` arg: invoke each callback
// directly (no retry, no memoization).
function makeStep() {
  return { step: { run: async (_id: string, cb: () => unknown) => cb() } };
}

beforeEach(() => {
  mockState.upserts.length = 0;
  mockState.rpcs.length = 0;
});

describe('cron-daily — first-order dual-write + RPC', () => {
  it('orders_attribution upsert rows include customer_id + order_created_at', async () => {
    await runDailyForStore('uzoshop', '2026-05-20', makeStep() as never);

    const ordersUpsert = mockState.upserts.find((u) => u.table === 'orders_attribution');
    expect(ordersUpsert).toBeTruthy();
    const rows = ordersUpsert!.rows as Array<Record<string, unknown>>;
    expect(rows[0].customer_id).toBe('778899');
    expect(rows[0].order_created_at).toBe('2026-05-20T09:30:00-04:00');
  });

  it('calls recompute_first_order_flags with the store id', async () => {
    await runDailyForStore('uzoshop', '2026-05-20', makeStep() as never);

    const rpc = mockState.rpcs.find((r) => r.name === 'recompute_first_order_flags');
    expect(rpc).toBeTruthy();
    expect(rpc!.args).toEqual({ p_store_id: 'uzoshop' });
  });
});
