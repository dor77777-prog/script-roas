/**
 * Self-serve stores Phase 6a (Task 9) — nightly Google path is DB-aware.
 *
 * Before this task, the nightly Google fetchers in `googleAds.ts` gated on a
 * HARDCODED `STORES_WITH_GOOGLE_ADS = new Set(['uzoshop'])`. A brand-new
 * self-serve store whose Google creds live in `store_secrets` (DB, NOT env)
 * would get its LIVE Google data (the Phase-C workers already gate on the
 * DB-aware `isGoogleConfiguredForStoreAsync`) but ZERO nightly/historical
 * spend + campaigns — because cronDaily's Google path short-circuited on the
 * hardcoded set.
 *
 * These tests pin the new behavior: every Google FETCHER short-circuit now
 * consults `isGoogleConfiguredForStoreAsync(storeId)` (the SAME async DB-aware
 * gate the live googleWorker uses). We mock that gate so we can drive a
 * configured / not-configured store deterministically, independent of env or
 * Supabase, and assert:
 *
 *   1. A store the gate reports CONFIGURED is NOT short-circuited — the
 *      OAuth-then-GAQL fetch path runs.
 *   2. A store the gate reports NOT CONFIGURED IS short-circuited — early
 *      return with the SAME empty/zero result as before (no fetch).
 *   3. uzoshop (gate → true) behaves exactly as before (fetch path runs).
 *
 * ZERO-REGRESSION note: in the real (non-mocked) world the gate returns the
 * SAME boolean it did via the hardcoded set for the current 3 stores —
 * uzoshop has UZOSHOP_GOOGLEADS_CUSTOMER_ID (env → gate true), zolplus +
 * usmile360 have no customer id (gate false). The byte-identical legacy
 * behavior for those 3 stores is covered by the sibling `googleAds.test.ts`
 * (which exercises the REAL gate via env). This file proves the NEW capability
 * (a DB-only store gets nightly data) without breaking the legacy path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the DB-aware gate so we drive configured/not-configured per store.
vi.mock('../googleAccountConfig', () => ({
  isGoogleConfiguredForStoreAsync: vi.fn(async (_storeId: string) => false),
}));

import { isGoogleConfiguredForStoreAsync } from '../googleAccountConfig';
import {
  fetchGoogleAdsSpendForDay,
  fetchGoogleAdsAdGroupInsights,
  fetchGoogleAdsAdInsights,
  fetchGoogleAdsAdGroupStatuses,
} from '../googleAds';

const gate = vi.mocked(isGoogleConfiguredForStoreAsync);

const ORIGINAL_ENV = { ...process.env };

function setGoogleCredEnvFor(storeId: string): void {
  process.env.GOOGLEADS_DEVELOPER_TOKEN = 'dev-tok-test';
  process.env.GOOGLEADS_CLIENT_ID = 'client-id-test';
  process.env.GOOGLEADS_CLIENT_SECRET = 'client-secret-test';
  process.env.GOOGLEADS_REFRESH_TOKEN = 'refresh-tok-test';
  process.env.GOOGLEADS_LOGIN_CUSTOMER_ID = '9999999999';
  process.env[`${storeId.toUpperCase()}_GOOGLEADS_CUSTOMER_ID`] = '4014537400';
}

/** OAuth-then-GAQL fetch mock (mirrors googleAds.test.ts). */
function buildOAuthThenGaqlFetchMock() {
  const responseQueue: Array<{ status: number; body: unknown }> = [
    { status: 200, body: { access_token: 'tok-abc', expires_in: 3600, token_type: 'Bearer' } },
    {
      status: 200,
      body: {
        results: [
          {
            campaign: { id: '111', name: 'Campaign One' },
            adGroup: { id: 'g1', name: 'Group 1' },
            metrics: {
              costMicros: '15400000',
              impressions: '100',
              clicks: '5',
              conversions: '1',
              conversionsValue: '50.00',
            },
            customer: { currencyCode: 'CAD' },
          },
        ],
      },
    },
    // A second GAQL response for the two-query (ad_group + campaign) fetchers.
    { status: 200, body: { results: [] } },
  ];
  return vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    const next = responseQueue.shift();
    if (!next) throw new Error('fetch mock exhausted');
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue(false);
  // Clean Google env between tests so cred presence is explicit per-test.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GOOGLEADS_') || k.includes('_GOOGLEADS_')) delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GOOGLEADS_') || k.includes('_GOOGLEADS_')) delete process.env[k];
  }
  for (const k of Object.keys(ORIGINAL_ENV)) {
    if (k.startsWith('GOOGLEADS_') || k.includes('_GOOGLEADS_')) process.env[k] = ORIGINAL_ENV[k];
  }
});

describe('googleAds nightly path — DB-aware gate (Phase 6a T9)', () => {
  it('a NEW configured store (gate → true) is NOT short-circuited — the GAQL fetch runs (fetchGoogleAdsSpendForDay)', async () => {
    gate.mockResolvedValue(true);
    setGoogleCredEnvFor('newstore'); // creds present (simulates DB-resolved creds)
    const fetchSpy = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', fetchSpy);

    const out = await fetchGoogleAdsSpendForDay('newstore', '2026-06-07');

    // The gate was consulted with the store id.
    expect(gate).toHaveBeenCalledWith('newstore');
    // The fetch path ran (OAuth + GAQL) — proof of NO short-circuit.
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/googleAds:search$/);
    // 15400000 micros → 15.40 spend (real fetch result, not the zero stub).
    expect(out.spend).toBeCloseTo(15.4, 5);
    expect(out.storeId).toBe('newstore');
  });

  it('a NEW configured store (gate → true) runs the ad-group fetch (fetchGoogleAdsAdGroupInsights)', async () => {
    gate.mockResolvedValue(true);
    setGoogleCredEnvFor('newstore');
    const fetchSpy = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', fetchSpy);

    await fetchGoogleAdsAdGroupInsights('newstore', '2026-06-07');

    expect(gate).toHaveBeenCalledWith('newstore');
    expect(fetchSpy).toHaveBeenCalled(); // NOT short-circuited
  });

  it('a NEW configured store (gate → true) runs the ad-level fetch (fetchGoogleAdsAdInsights)', async () => {
    gate.mockResolvedValue(true);
    setGoogleCredEnvFor('newstore');
    const fetchSpy = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', fetchSpy);

    await fetchGoogleAdsAdInsights('newstore', '2026-06-07');

    expect(gate).toHaveBeenCalledWith('newstore');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('a NEW configured store (gate → true) runs the ad-group-status fetch (fetchGoogleAdsAdGroupStatuses)', async () => {
    gate.mockResolvedValue(true);
    setGoogleCredEnvFor('newstore');
    const fetchSpy = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', fetchSpy);

    await fetchGoogleAdsAdGroupStatuses('newstore');

    expect(gate).toHaveBeenCalledWith('newstore');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('a NOT-configured store (gate → false) IS short-circuited — SAME empty/zero result, NO fetch', async () => {
    gate.mockResolvedValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const spend = await fetchGoogleAdsSpendForDay('zolplus', '2026-06-07');
    const adGroups = await fetchGoogleAdsAdGroupInsights('zolplus', '2026-06-07');
    const ads = await fetchGoogleAdsAdInsights('zolplus', '2026-06-07');
    const statuses = await fetchGoogleAdsAdGroupStatuses('zolplus');

    // Same short-circuit shapes as the legacy hardcoded path.
    expect(spend).toEqual({
      storeId: 'zolplus',
      date: '2026-06-07',
      spend: 0,
      currency: 'CAD',
      impressions: 0,
    });
    expect(adGroups).toEqual([]);
    expect(ads).toEqual([]);
    expect(statuses).toEqual([]);

    // Gate consulted, but NO network call.
    expect(gate).toHaveBeenCalledWith('zolplus');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uzoshop (gate → true) behaves exactly as before — fetch path runs', async () => {
    gate.mockResolvedValue(true);
    setGoogleCredEnvFor('uzoshop');
    const fetchSpy = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', fetchSpy);

    const out = await fetchGoogleAdsSpendForDay('uzoshop', '2026-06-07');

    expect(gate).toHaveBeenCalledWith('uzoshop');
    expect(fetchSpy).toHaveBeenCalled();
    expect(out.spend).toBeCloseTo(15.4, 5);
  });
});
