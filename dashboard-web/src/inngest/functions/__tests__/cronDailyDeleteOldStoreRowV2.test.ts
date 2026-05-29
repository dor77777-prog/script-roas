// dashboard-web/src/inngest/functions/__tests__/cronDailyDeleteOldStoreRowV2.test.ts
//
// Phase A.5 v2 — verifies cron-daily does DELETE-then-UPSERT for TikTok rows
// so the nightly reconcile also can't introduce duplicate rows. Mirrors
// Task 3 (persistCampaignsLive) but for the nightly path.
//
// Tests (3):
//   1. campaigns_daily DELETE fires BEFORE the TikTok UPSERT
//   2. DELETE wipes rows whose store_id is NOT in the target set
//   3. agg_tiktok_spend_per_store_for_date RPC fires AFTER the upsert

import { describe, it, expect, vi, beforeEach } from 'vitest';

const STORE = 'uzoshop';
const DATE = '2026-05-28';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

// TikTok: return a row mapped to usmile360 via storeId (simulating the
// campaign-store-map scenario where a TikTok campaign is attributed to a
// different store than the function-arg storeId=uzoshop).
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE,
    date: DATE,
    spend: 10,
    currency: 'USD',
    impressions: 100,
  }),
  fetchTikTokAdInsights: vi.fn().mockResolvedValue([
    {
      storeId: 'usmile360',
      campaignId: 'C1',
      campaignName: 'X',
      adGroupId: 'AG1',
      adGroupName: 'AG1Name',
      adId: 'A1',
      adName: 'A1Name',
      spend: 10,
      currency: 'USD',
      impressions: 100,
      clicks: 5,
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

// Other fetchers return minimal non-empty data to satisfy cron-daily branches.
vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE, date: DATE, spend: 0, currency: 'ILS', impressions: 0,
  }),
  fetchMetaAdSetInsights: vi.fn().mockResolvedValue([]),
  fetchMetaAdInsights: vi.fn().mockResolvedValue([]),
  fetchMetaBudgets: vi.fn().mockResolvedValue({ currency: 'ILS', campaigns: {}, adSets: {} }),
  META_API_VERSION: 'v23.0',
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn().mockResolvedValue({
    storeId: STORE, date: DATE, spend: 0, currency: 'CAD', impressions: 0,
  }),
  fetchGoogleAdsAdGroupInsights: vi.fn().mockResolvedValue([]),
  fetchGoogleAdsAdInsights: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn().mockResolvedValue({
    storeId: STORE, date: DATE, storeName: 'uzoshop',
    revenueCad: 0, grossRevenueCad: 0, refundDeductionCad: 0,
    productRows: [], customItemRefundCad: 0,
  }),
  fetchShopifyOrdersAttribution: vi.fn().mockResolvedValue([]),
  fetchShopifyProductsCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn().mockResolvedValue({
    fbSpendCad: 0, gaSpendCad: 0, totalSpendCad: 0,
    overridesApplied: { meta: false, google: false },
  }),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn().mockResolvedValue(1.0),
}));

vi.mock('@/lib/platformsByStore', () => ({
  STORES_WITH_TIKTOK_IDS: new Set([STORE]),
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn(
      (opts: { id: string }, _handler: unknown) => ({ id: opts.id }),
    ),
  },
}));

// ---------------------------------------------------------------------------
// Supabase mock — records delete + upsert + rpc calls in order
// ---------------------------------------------------------------------------
type SqlCall =
  | { op: 'delete'; table: string; payload: Record<string, unknown> }
  | { op: 'upsert'; table: string; rows: unknown[]; opts: unknown }
  | { op: 'rpc'; fn: string; args: unknown };

const sqlCalls: SqlCall[] = [];

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => ({
      delete: () => {
        const acc: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, v: unknown) => { acc[col] = v; return chain; },
          in: (col: string, v: unknown[]) => { acc[col] = v; return chain; },
          not: (col: string, _op: string, v: string) => {
            acc[`${col}_not_in`] = v;
            sqlCalls.push({ op: 'delete', table, payload: { ...acc } });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
      upsert: (rows: unknown, opts: unknown = {}) => {
        sqlCalls.push({ op: 'upsert', table, rows: rows as unknown[], opts });
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      sqlCalls.push({ op: 'rpc', fn, args });
      return { error: null };
    },
  })),
}));

// ---------------------------------------------------------------------------
// Step runner stub
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

beforeEach(() => {
  sqlCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Phase A.5 v2 — cronDaily DELETE-then-UPSERT for TikTok', () => {
  it('1. campaigns_daily DELETE fires BEFORE the TikTok UPSERT', async () => {
    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const ttCdDelIdx = sqlCalls.findIndex(
      (c) =>
        c.op === 'delete' &&
        c.table === 'campaigns_daily' &&
        (c as Extract<typeof c, { op: 'delete' }>).payload.platform === 'tiktok',
    );
    const ttCdUpsertIdx = sqlCalls.findIndex(
      (c) =>
        c.op === 'upsert' &&
        c.table === 'campaigns_daily' &&
        (c as Extract<typeof c, { op: 'upsert' }>).rows.some(
          (r) => (r as Record<string, unknown>).platform === 'tiktok',
        ),
    );

    expect(ttCdDelIdx, 'campaigns_daily TikTok DELETE not found').toBeGreaterThanOrEqual(0);
    expect(ttCdUpsertIdx, 'campaigns_daily TikTok UPSERT not found').toBeGreaterThanOrEqual(0);
    expect(ttCdDelIdx, 'DELETE must precede UPSERT').toBeLessThan(ttCdUpsertIdx);
  });

  it('2. DELETE wipes rows whose store_id is NOT in the target set (usmile360)', async () => {
    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const ttCdDel = sqlCalls.find(
      (c) =>
        c.op === 'delete' &&
        c.table === 'campaigns_daily' &&
        (c as Extract<typeof c, { op: 'delete' }>).payload.platform === 'tiktok',
    ) as Extract<SqlCall, { op: 'delete' }> | undefined;

    expect(ttCdDel, 'campaigns_daily TikTok DELETE not found').toBeDefined();
    expect(ttCdDel!.payload.campaign_id).toEqual(['C1']);
    // The NOT IN value must reference the resolved store (usmile360), not
    // the function-arg store (uzoshop), because r.storeId = 'usmile360'.
    expect(ttCdDel!.payload.store_id_not_in).toContain('usmile360');
  });

  it('3. agg_tiktok_spend_per_store_for_date RPC fires AFTER the campaigns_daily upsert', async () => {
    const { runDailyForStore } = await import('../cronDaily');
    const { step } = makeStepStub();
    await runDailyForStore(STORE, DATE, { step });

    const ttCdUpsertIdx = sqlCalls.findIndex(
      (c) =>
        c.op === 'upsert' &&
        c.table === 'campaigns_daily' &&
        (c as Extract<typeof c, { op: 'upsert' }>).rows.some(
          (r) => (r as Record<string, unknown>).platform === 'tiktok',
        ),
    );
    const rpcIdx = sqlCalls.findIndex(
      (c) =>
        c.op === 'rpc' &&
        (c as Extract<typeof c, { op: 'rpc' }>).fn === 'agg_tiktok_spend_per_store_for_date',
    );

    expect(rpcIdx, 'agg RPC not found').toBeGreaterThanOrEqual(0);
    expect(rpcIdx, 'RPC must fire after the TikTok UPSERT').toBeGreaterThan(ttCdUpsertIdx);
    expect(
      ((sqlCalls[rpcIdx] as Extract<SqlCall, { op: 'rpc' }>).args as Record<string, unknown>).d,
    ).toBe(DATE);
  });
});
