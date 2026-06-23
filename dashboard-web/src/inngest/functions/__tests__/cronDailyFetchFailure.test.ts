// dashboard-web/src/inngest/functions/__tests__/cronDailyFetchFailure.test.ts
//
// Bug-fix regression tests (#2 + #16 + #31): cronDaily's per-platform
// soft-fail catch returns a `{ spend: 0, impressions: 0 }` sentinel on ANY
// Meta/Google FETCH failure (token expiry, 5xx, network, parse). Because the
// spend fetchers THROW on failure (no internal try/catch), the catch path is
// UNIQUELY the "we don't know" case — yet the prior sentinel wrote a real 0:
//   - `merged.fbSpendCad` became 0 (not null) → persist gate `!== null` passed
//     → fb_spend_cad + fb_impressions written as 0, OVERWRITING the prior real
//     value via ON CONFLICT.
//   - Derived total/roas/gross/net then recomputed off the deflated spend →
//     ROAS inflated, profit overstated.
//   - is_finalized was still stamped true, and NO transient_error freshness
//     row was recorded — the matrix showed the day healthy despite corruption.
//
// THE FIX mirrors the FX-failure null-preserve doctrine:
//   - The catch returns a sentinel that signals "unknown" (spend: null,
//     impressions: null), so the merge produces merged.fbSpendCad === null.
//   - The existing persist gate (`if (merged.fbSpendCad !== null)`) OMITS BOTH
//     fb_spend_cad AND fb_impressions → ON CONFLICT preserves prior values.
//   - The derived totals (total/roas/gross/net) are omitted too (all-non-null
//     gate), so nothing is recomputed off a deflated spend.
//   - is_finalized is NOT stamped true when a platform fetch failed.
//   - A transient_error freshness row is recorded for the affected scope.
//
// CRUCIAL distinction: a GENUINE successful zero-activity day comes through the
// SUCCESS path (fetch returns spend:0) and STILL WRITES fb_spend_cad=0 — only
// the catch/failure path omits. The final test pins that distinction.
//
// Harness: unlike cronDailyFxFailure.test.ts, this test uses the REAL
// mergeOverridesFromSupabase (stubbing the manual_overrides SELECT to return no
// rows) so the full chain is exercised end-to-end: catch sentinel → real merge
// → null → persist omit. FX always SUCCEEDS here (the failure under test is the
// FETCH, not the FX).

import { describe, it, expect, vi, beforeEach } from 'vitest';

type UpsertCall = { table: string; rows: unknown; opts: { onConflict?: string } };

type MockState = {
  upserts: UpsertCall[];
  /** which platform spend/insight fetchers should throw this run */
  throwIn: 'meta' | 'google' | null;
  /** drives a genuine successful zero-activity day for the success-path test */
  metaZeroActivity: boolean;
  /** error message the Meta fetchers throw when throwIn === 'meta' — lets a
   *  test drive the alert-classification path with a real Meta error body. */
  metaThrowMsg: string;
};

const mockState = vi.hoisted<MockState>(() => ({
  upserts: [],
  throwIn: null,
  metaZeroActivity: false,
  metaThrowMsg: 'meta-token-expired',
}));

// recordFreshness spy (hoisted so the vi.mock factory can close over it).
// Typed with a permissive opts arg so .mock.calls[i][0] reads the recorded
// freshness payload (platform/scope/tableName/status).
const recordFreshnessSpy = vi.hoisted(() =>
  vi.fn(async (_opts: Record<string, unknown>): Promise<void> => undefined),
);

// ---------------------------------------------------------------------------
// Shopify — always succeeds (revenue must always land regardless of ad fetch).
// ---------------------------------------------------------------------------
vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    storeName: 'uzoshop',
    revenueCad: 1234,
    productRows: [],
    customItemRefundCad: 0,
    grossRevenueCad: 1234,
    refundDeductionCad: 0,
  })),
  fetchShopifyOrdersAttribution: vi.fn(async () => []),
  fetchShopifyProductsCatalog: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Meta — spend fetcher THROWS when throwIn === 'meta' (mirrors the real
// fetcher, which has no internal try/catch). metaZeroActivity drives the
// genuine-success 0-spend path.
// ---------------------------------------------------------------------------
vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaSpendForDay: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error(mockState.metaThrowMsg);
    if (mockState.metaZeroActivity) {
      return { storeId: 'uzoshop', date: '2026-05-20', spend: 0, currency: 'ILS', impressions: 0 };
    }
    return { storeId: 'uzoshop', date: '2026-05-20', spend: 100, currency: 'ILS', impressions: 1000 };
  }),
  fetchMetaAdSetInsights: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error(mockState.metaThrowMsg);
    return [];
  }),
  fetchMetaAdInsights: vi.fn(async () => {
    if (mockState.throwIn === 'meta') throw new Error(mockState.metaThrowMsg);
    return [];
  }),
  fetchMetaBudgets: vi.fn(async () => ({ currency: 'ILS', campaigns: {}, adSets: {} })),
}));

// ---------------------------------------------------------------------------
// Google — spend fetcher THROWS when throwIn === 'google'.
// ---------------------------------------------------------------------------
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-oauth-expired');
    return { storeId: 'uzoshop', date: '2026-05-20', spend: 50, currency: 'CAD', impressions: 500 };
  }),
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-oauth-expired');
    return [];
  }),
  fetchGoogleAdsAdInsights: vi.fn(async () => {
    if (mockState.throwIn === 'google') throw new Error('google-oauth-expired');
    return [];
  }),
}));

// ---------------------------------------------------------------------------
// TikTok — uzoshop in prod, but here we keep it a no-op zero so the test
// isolates the Meta/Google fetch-failure behavior.
// ---------------------------------------------------------------------------
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 0,
    currency: 'USD',
    impressions: 0,
  })),
  fetchTikTokAdInsights: vi.fn(async () => []),
  fetchTikTokAdvertiserInfo: vi.fn(async () => ({
    advertiserId: '7306450983905787906',
    name: 'DOD',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  })),
}));

// FX always succeeds — the failure under test is the FETCH, not the FX.
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => 0.36),
}));

// Supabase stub: upsert records the call; select (used by the REAL merge to
// read manual_overrides) returns NO rows so the merge falls through to the
// fetched spend path; rpc/delete resolve cleanly.
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        mockState.upserts.push({ table, rows, opts });
        return Promise.resolve({ error: null });
      },
      select: (_cols?: string) => {
        const chain = {
          eq: () => chain,
          // merge uses .eq().eq() then awaits the thenable for { data, error }.
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        };
        return chain;
      },
      delete: () => {
        const c = {
          eq: () => c,
          in: () => c,
          not: () => Promise.resolve({ error: null }),
        };
        return c;
      },
    }),
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

// recordFreshness spy — assert the transient_error rows here.
vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: recordFreshnessSpy,
}));

// BUC pre-flight: never skip.
vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn().mockResolvedValue({ alerted: false, throttled: false, dbWritten: true }),
}));

vi.mock('@/lib/sentry/capture', () => ({
  captureCronFetchError: vi.fn().mockResolvedValue(undefined),
  captureStepError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/postgresReaders', async (orig) => ({
  ...(await orig<typeof import('@/lib/postgresReaders')>()),
  fetchAdStateFromPostgres: vi.fn(async () => ({})),
}));

import { runDailyForStore } from '../cronDaily';
import { captureCronFetchError } from '@/lib/sentry/capture';

const captureCronFetchErrorMock = vi.mocked(captureCronFetchError);

function makeMockStep() {
  return {
    step: {
      run: async (_id: string, cb: () => Promise<unknown>) => cb(),
    },
  };
}

beforeEach(() => {
  mockState.upserts = [];
  mockState.throwIn = null;
  mockState.metaZeroActivity = false;
  mockState.metaThrowMsg = 'meta-token-expired';
  recordFreshnessSpy.mockClear();
  captureCronFetchErrorMock.mockClear();
});

/** The `advice` argument cronDaily passed to captureCronFetchError for Meta. */
function metaAlertAdvice(): string {
  const call = captureCronFetchErrorMock.mock.calls.find(
    (c) => (c[0] as { platform?: string }).platform === 'meta',
  );
  expect(call).toBeDefined();
  return String(call![2] ?? '');
}

function dataDailyRow(): Record<string, unknown> {
  const call = mockState.upserts.find((u) => u.table === 'data_daily');
  expect(call).toBeDefined();
  return call!.rows as Record<string, unknown>;
}

describe('cronDaily — FETCH failure preserves prior spend/impressions (#2/#16/#31)', () => {
  // Use a PAST date so is_finalized would normally be true — proves the fix
  // gates is_finalized on no-fetch-failure (not on the date alone).
  const PAST_DATE = '2026-05-20';

  it('Meta fetch THROWS (FX ok) → data_daily OMITS fb_spend_cad + fb_impressions + derived totals; is_finalized NOT true', async () => {
    mockState.throwIn = 'meta';

    const { step } = makeMockStep();
    await expect(
      runDailyForStore('uzoshop', PAST_DATE, { step }),
    ).resolves.toBeDefined();

    const row = dataDailyRow();
    // Spend + impressions pair omitted → ON CONFLICT preserves prior real value.
    expect('fb_spend_cad' in row).toBe(false);
    expect('fb_impressions' in row).toBe(false);
    // Derived totals NOT recomputed off a deflated spend.
    expect('total_spend_cad' in row).toBe(false);
    expect('roas' in row).toBe(false);
    expect('gross_profit_cad' in row).toBe(false);
    expect('net_profit_cad' in row).toBe(false);
    // is_finalized must NOT be true when a platform fetch failed.
    expect(row.is_finalized).not.toBe(true);
    // Revenue (and the un-failed Google leg) still land.
    expect(row.revenue_cad).toBe(1234);
    expect(row.ga_spend_cad).toBe(50);
  });

  it('Meta fetch THROWS → records a transient_error freshness row for the kpi_daily/data_daily scope (#31)', async () => {
    mockState.throwIn = 'meta';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    const metaTransient = recordFreshnessSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find(
        (a) =>
          a.platform === 'meta' &&
          a.scope === 'kpi_daily' &&
          a.tableName === 'data_daily' &&
          a.status === 'transient_error',
      );
    expect(metaTransient).toBeDefined();
  });

  it('Google fetch THROWS (FX ok) → data_daily OMITS ga_spend_cad + ga_impressions + derived totals; is_finalized NOT true', async () => {
    mockState.throwIn = 'google';

    const { step } = makeMockStep();
    await expect(
      runDailyForStore('uzoshop', PAST_DATE, { step }),
    ).resolves.toBeDefined();

    const row = dataDailyRow();
    expect('ga_spend_cad' in row).toBe(false);
    expect('ga_impressions' in row).toBe(false);
    expect('total_spend_cad' in row).toBe(false);
    expect('roas' in row).toBe(false);
    expect('gross_profit_cad' in row).toBe(false);
    expect('net_profit_cad' in row).toBe(false);
    expect(row.is_finalized).not.toBe(true);
    expect(row.revenue_cad).toBe(1234);
    // Meta leg succeeded → fb columns DO land.
    expect(row.fb_spend_cad).toBe(36); // 100 ILS @ 0.36
    expect(row.fb_impressions).toBe(1000);
  });

  it('Google fetch THROWS → records a transient_error freshness row for the kpi_daily/data_daily scope (#31)', async () => {
    mockState.throwIn = 'google';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    const gaTransient = recordFreshnessSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find(
        (a) =>
          a.platform === 'google' &&
          a.scope === 'kpi_daily' &&
          a.tableName === 'data_daily' &&
          a.status === 'transient_error',
      );
    expect(gaTransient).toBeDefined();
  });

  it('GENUINE successful zero-activity day (fetch SUCCEEDS, returns 0) STILL writes fb_spend_cad=0', async () => {
    mockState.throwIn = null;
    mockState.metaZeroActivity = true;

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    const row = dataDailyRow();
    // A real zero must be WRITTEN, not omitted — the catch path is unique.
    expect('fb_spend_cad' in row).toBe(true);
    expect(row.fb_spend_cad).toBe(0);
    expect('fb_impressions' in row).toBe(true);
    expect(row.fb_impressions).toBe(0);
    // Derived totals present (all spend known) and is_finalized true (past date,
    // no fetch failure).
    expect('total_spend_cad' in row).toBe(true);
    expect(row.is_finalized).toBe(true);
  });
});

// 2026-06-23 — alert classification at the cronDaily Meta catch. Previously
// the catch ALWAYS passed "Refresh the Meta access token … and redeploy" advice
// to captureCronFetchError for ANY Meta error, so transient/rate-limit blips
// (which self-heal on retry) told the operator to refresh a perfectly good
// token. Now the advice is classified by the error body.
describe('cronDaily — Meta alert advice is classified, not always "refresh token"', () => {
  const PAST_DATE = '2026-05-20';
  const TOKEN_REFRESH_RE = /refresh.*access token/i;

  it('code 190 (real token failure) → advice INCLUDES refresh-token guidance', async () => {
    mockState.throwIn = 'meta';
    mockState.metaThrowMsg =
      'Meta spend failed: {"error":{"type":"OAuthException","code":190,"message":"Invalid OAuth access token"}}';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    expect(metaAlertAdvice()).toMatch(TOKEN_REFRESH_RE);
  });

  it('code 2 / subcode 1504044 "Service temporarily unavailable" → advice does NOT mention refreshing the token', async () => {
    mockState.throwIn = 'meta';
    mockState.metaThrowMsg =
      'Meta spend failed (code=400): {"error":{"message":"Service temporarily unavailable","type":"OAuthException","is_transient":false,"code":2,"error_subcode":1504044}}';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    expect(metaAlertAdvice()).not.toMatch(TOKEN_REFRESH_RE);
  });

  it('code 4 / subcode 1504022 "Application request limit reached" → advice does NOT mention refreshing the token', async () => {
    mockState.throwIn = 'meta';
    mockState.metaThrowMsg =
      'Meta spend failed: {"error":{"message":"Application request limit reached","type":"OAuthException","is_transient":true,"code":4,"error_subcode":1504022}}';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    expect(metaAlertAdvice()).not.toMatch(TOKEN_REFRESH_RE);
  });

  it('an unknown error (network) → neutral advice, NO refresh-token guidance', async () => {
    mockState.throwIn = 'meta';
    mockState.metaThrowMsg = 'fetch failed: ETIMEDOUT';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', PAST_DATE, { step });

    expect(metaAlertAdvice()).not.toMatch(TOKEN_REFRESH_RE);
  });
});
