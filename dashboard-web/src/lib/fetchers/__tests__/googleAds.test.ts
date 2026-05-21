/**
 * Plan 05.6-05 — Google Ads fetcher (TS port).
 *
 * RED phase: this file is written first and is expected to fail compilation
 * (the import target `../googleAds` does not yet exist). Task 2 makes it GREEN
 * by implementing the fetcher.
 *
 * Test coverage:
 *  1. Non-Google-Ads store short-circuit — `zolplus` (no API call).
 *  2. Non-Google-Ads store short-circuit — `usmile360` (no API call).
 *  3. uzoshop happy path — OAuth refresh THEN GAQL search call.
 *  4. cost_micros → spend conversion (15400000 → 15.40).
 *  5. Missing env-var error message includes the env-var name.
 *  6. Token cache reuse — second call within cache window does NOT re-refresh.
 *
 * Why these tests:
 *  - Test 1+2 enforce the dominant code path (2 of 3 stores skip Google Ads,
 *    matching Config.gs:23 STORES.hasGoogleAds + Phase 05.5-01 stores seed).
 *    This is the single largest API-quota saving in the fetcher.
 *  - Test 3 verifies the OAuth-then-GAQL call sequence (matches GoogleAds.gs).
 *  - Test 4 verifies the micros parsing (cost_micros is in millionths per
 *    GoogleAds.gs:12 docstring + line 91).
 *  - Test 5 ensures the operator gets an actionable error pointing at the
 *    exact env-var to set in Vercel (no leaked refresh-token value — T-05.6-05-I2).
 *  - Test 6 verifies the module-level Map cache strategy (RESEARCH §Don't
 *    Hand-Roll line 1330 + Pitfall 8 line 1456): second invocation reuses
 *    the cached access token, eliminating a wasted OAuth refresh per Inngest
 *    step.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Per-test env snapshot — fetcher reads process.env at call-time, so we mutate it.
const ORIGINAL_ENV = { ...process.env };

function setUzoshopEnv(): void {
  process.env.GOOGLEADS_DEVELOPER_TOKEN = 'dev-tok-test';
  process.env.GOOGLEADS_CLIENT_ID = 'client-id-test';
  process.env.GOOGLEADS_CLIENT_SECRET = 'client-secret-test';
  process.env.GOOGLEADS_REFRESH_TOKEN = 'refresh-tok-test';
  process.env.GOOGLEADS_LOGIN_CUSTOMER_ID = '9999999999';
  process.env.UZOSHOP_GOOGLEADS_CUSTOMER_ID = '4014537400';
}

function clearGoogleAdsEnv(): void {
  delete process.env.GOOGLEADS_DEVELOPER_TOKEN;
  delete process.env.GOOGLEADS_CLIENT_ID;
  delete process.env.GOOGLEADS_CLIENT_SECRET;
  delete process.env.GOOGLEADS_REFRESH_TOKEN;
  delete process.env.GOOGLEADS_LOGIN_CUSTOMER_ID;
  delete process.env.UZOSHOP_GOOGLEADS_CUSTOMER_ID;
  delete process.env.UZOSHOP_GOOGLEADS_REFRESH_TOKEN;
}

/**
 * Build a fetch mock whose responses follow the OAuth-then-GAQL sequence.
 * Returns the spy so tests can inspect call counts and arguments.
 *
 * Response sequence:
 *   call N (OAuth)  → access_token + expires_in
 *   call N+1 (GAQL) → results with metrics.costMicros
 *
 * The mock is stateful — each call peels off the head of the response queue.
 */
function buildOAuthThenGaqlFetchMock(opts?: {
  costMicros?: string;
  currency?: string;
  expiresIn?: number;
}) {
  const costMicros = opts?.costMicros ?? '15400000'; // 15.40 default
  const currency = opts?.currency ?? 'CAD';
  const expiresIn = opts?.expiresIn ?? 3600;

  const responseQueue: Array<{ status: number; body: unknown }> = [
    // OAuth refresh
    {
      status: 200,
      body: { access_token: 'tok-abc', expires_in: expiresIn, token_type: 'Bearer' },
    },
    // GAQL search
    {
      status: 200,
      body: {
        results: [
          {
            campaign: { id: '111', name: 'Campaign One' },
            adGroup: { id: 'g1', name: 'Group 1' },
            metrics: {
              costMicros,
              impressions: '100',
              clicks: '5',
              conversions: '1',
              conversionsValue: '50.00',
            },
            customer: { currencyCode: currency },
          },
        ],
      },
    },
  ];

  const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    const next = responseQueue.shift();
    if (!next) {
      throw new Error(
        `fetch mock exhausted — test asked for more responses than primed (call ${spy.mock.calls.length})`,
      );
    }
    return new Response(JSON.stringify(next.body), { status: next.status });
  });

  return { spy, primeMoreGaql: (body: unknown, status = 200) => responseQueue.push({ status, body }) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  // Reset env to ORIGINAL_ENV before each test — prevents leakage from one test setting
  // GOOGLEADS_* / {STORE}_GOOGLEADS_* env vars and the next test (short-circuit) inheriting them.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GOOGLEADS_') || k.includes('_GOOGLEADS_')) delete process.env[k];
  }
});

afterEach(() => {
  // Restore any GOOGLEADS_* / {STORE}_GOOGLEADS_* env vars that existed before this test file ran.
  for (const k of Object.keys(ORIGINAL_ENV)) {
    if (k.startsWith('GOOGLEADS_') || k.includes('_GOOGLEADS_')) process.env[k] = ORIGINAL_ENV[k];
  }
});

describe('googleAds fetcher — short-circuit for non-Google-Ads stores', () => {
  it('returns zero spend for zolplus WITHOUT calling fetch (Config.gs:24 hasGoogleAds:false)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // Dynamic import AFTER stubbing so the module captures the stubbed fetch.
    const { fetchGoogleAdsSpendForDay } = await import('../googleAds');

    const out = await fetchGoogleAdsSpendForDay('zolplus', '2026-05-19');
    expect(out).toEqual({
      storeId: 'zolplus',
      date: '2026-05-19',
      spend: 0,
      currency: 'CAD',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns zero spend for usmile360 WITHOUT calling fetch (Config.gs:25 hasGoogleAds:false)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchGoogleAdsSpendForDay, fetchGoogleAdsAdGroupInsights } = await import('../googleAds');

    const spendOut = await fetchGoogleAdsSpendForDay('usmile360', '2026-05-19');
    expect(spendOut).toEqual({
      storeId: 'usmile360',
      date: '2026-05-19',
      spend: 0,
      currency: 'CAD',
    });

    // Ad-group fetcher also short-circuits to an empty array (no API call).
    const rows = await fetchGoogleAdsAdGroupInsights('usmile360', '2026-05-19');
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('googleAds fetcher — uzoshop happy path', () => {
  it('performs OAuth refresh THEN GAQL search for uzoshop', async () => {
    setUzoshopEnv();
    const { spy } = buildOAuthThenGaqlFetchMock();
    vi.stubGlobal('fetch', spy);

    const { fetchGoogleAdsSpendForDay } = await import('../googleAds');
    const out = await fetchGoogleAdsSpendForDay('uzoshop', '2026-05-19');

    expect(spy).toHaveBeenCalledTimes(2);

    // Call 1: OAuth token endpoint.
    const oauthCall = spy.mock.calls[0];
    expect(String(oauthCall[0])).toBe('https://oauth2.googleapis.com/token');
    expect(oauthCall[1]?.method).toBe('POST');
    // The body must be x-www-form-urlencoded with the OAuth params.
    const oauthBody = String(oauthCall[1]?.body ?? '');
    expect(oauthBody).toContain('grant_type=refresh_token');
    expect(oauthBody).toContain('client_id=client-id-test');
    expect(oauthBody).toContain('refresh_token=refresh-tok-test');

    // Call 2: GAQL search endpoint — must use major-version-only path segment
    // (the live API exposes v24, not v24.1; see SUMMARY for the spot-check
    // result and DEV-NOTE).
    const gaqlCall = spy.mock.calls[1];
    expect(String(gaqlCall[0])).toMatch(
      /^https:\/\/googleads\.googleapis\.com\/v24\/customers\/4014537400\/googleAds:search$/,
    );
    expect(gaqlCall[1]?.method).toBe('POST');
    const headers = gaqlCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-abc');
    expect(headers['developer-token']).toBe('dev-tok-test');
    expect(headers['login-customer-id']).toBe('9999999999');

    // Return shape — spend = 15400000 / 1_000_000 = 15.40
    expect(out.storeId).toBe('uzoshop');
    expect(out.date).toBe('2026-05-19');
    expect(out.spend).toBeCloseTo(15.4, 5);
    expect(out.currency).toBe('CAD');
  });

  it('parses cost_micros correctly — 15400000 micros → 15.40 spend', async () => {
    setUzoshopEnv();
    const { spy } = buildOAuthThenGaqlFetchMock({ costMicros: '15400000' });
    vi.stubGlobal('fetch', spy);

    const { fetchGoogleAdsSpendForDay } = await import('../googleAds');
    const out = await fetchGoogleAdsSpendForDay('uzoshop', '2026-05-19');
    expect(out.spend).toBeCloseTo(15.4, 5);
  });
});

describe('googleAds fetcher — env-var error path', () => {
  it('throws a clear error naming the missing env-var (no token leak — T-05.6-05-I2)', async () => {
    clearGoogleAdsEnv();
    // Set everything EXCEPT the customer ID for uzoshop — the operator's
    // most likely Vercel misconfiguration after a fresh deploy.
    process.env.GOOGLEADS_DEVELOPER_TOKEN = 'dev-tok';
    process.env.GOOGLEADS_CLIENT_ID = 'cid';
    process.env.GOOGLEADS_CLIENT_SECRET = 'csec';
    process.env.GOOGLEADS_REFRESH_TOKEN = 'super-secret-refresh-token-value-xyz';
    // UZOSHOP_GOOGLEADS_CUSTOMER_ID intentionally unset.

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchGoogleAdsSpendForDay } = await import('../googleAds');

    let caught: unknown = null;
    try {
      await fetchGoogleAdsSpendForDay('uzoshop', '2026-05-19');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    // The env-var name MUST appear (operator-actionable) and the actual
    // refresh-token VALUE must NOT appear (info-disclosure mitigation).
    expect(msg).toMatch(/UZOSHOP_GOOGLEADS_CUSTOMER_ID/);
    expect(msg).not.toContain('super-secret-refresh-token-value-xyz');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('googleAds fetcher — token cache reuse (RESEARCH §Don\'t Hand-Roll line 1330)', () => {
  it('caches the access token across calls within the cache window', async () => {
    setUzoshopEnv();
    const { spy, primeMoreGaql } = buildOAuthThenGaqlFetchMock({ expiresIn: 3600 });
    vi.stubGlobal('fetch', spy);

    const { fetchGoogleAdsSpendForDay } = await import('../googleAds');

    // First call — primes 2 fetch calls (OAuth + GAQL).
    await fetchGoogleAdsSpendForDay('uzoshop', '2026-05-19');
    expect(spy).toHaveBeenCalledTimes(2);

    // Second call — token cache is hot, so ONLY the GAQL call should fire.
    // We prime a second GAQL response (NOT an OAuth response).
    primeMoreGaql({
      results: [
        {
          campaign: { id: '222', name: 'Campaign Two' },
          adGroup: { id: 'g2', name: 'Group 2' },
          metrics: {
            costMicros: '2000000',
            impressions: '50',
            clicks: '2',
            conversions: '0',
            conversionsValue: '0',
          },
          customer: { currencyCode: 'CAD' },
        },
      ],
    });

    const out2 = await fetchGoogleAdsSpendForDay('uzoshop', '2026-05-20');
    expect(spy).toHaveBeenCalledTimes(3); // 2 (first call) + 1 (just the GAQL on second call)
    expect(out2.spend).toBeCloseTo(2.0, 5);

    // The third fetch call must be the GAQL endpoint (not OAuth).
    const thirdCallUrl = String(spy.mock.calls[2][0]);
    expect(thirdCallUrl).toMatch(/googleAds:search$/);
    expect(thirdCallUrl).not.toContain('oauth2.googleapis.com');
  });
});

// ===========================================================================
// Phase 05.6.1 — fetchGoogleAdsAdInsights (ad_group_ad GAQL port)
// ===========================================================================

describe('googleAds fetcher — fetchGoogleAdsAdInsights', () => {
  it('Ad Test 1: returns [] for non-uzoshop stores WITHOUT calling fetch (short-circuit)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchGoogleAdsAdInsights } = await import('../googleAds');

    const z = await fetchGoogleAdsAdInsights('zolplus', '2026-05-19');
    const u = await fetchGoogleAdsAdInsights('usmile360', '2026-05-19');
    expect(z).toEqual([]);
    expect(u).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Ad Test 2: uzoshop happy path — issues ad_group_ad GAQL query and maps response to GoogleAdsAdRow', async () => {
    setUzoshopEnv();
    // OAuth + one ad_group_ad GAQL response with a single ad.
    const responseQueue: Array<{ status: number; body: unknown }> = [
      {
        status: 200,
        body: { access_token: 'tok-abc', expires_in: 3600, token_type: 'Bearer' },
      },
      {
        status: 200,
        body: {
          results: [
            {
              campaign: { id: '111', name: 'Camp 1' },
              adGroup: { id: 'g1', name: 'Group 1' },
              adGroupAd: { ad: { id: 'ad-99', name: 'Ad Ninety-Nine' } },
              metrics: {
                costMicros: '12000000', // 12.00 CAD
                impressions: '500',
                clicks: '25',
                conversions: '2',
                conversionsValue: '80.00',
              },
              customer: { currencyCode: 'CAD' },
            },
          ],
        },
      },
    ];
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      const next = responseQueue.shift();
      if (!next) throw new Error('mock exhausted');
      return new Response(JSON.stringify(next.body), { status: next.status });
    });
    vi.stubGlobal('fetch', spy);

    const { fetchGoogleAdsAdInsights } = await import('../googleAds');
    const out = await fetchGoogleAdsAdInsights('uzoshop', '2026-05-19');

    // Sequence: OAuth call → GAQL call.
    expect(spy).toHaveBeenCalledTimes(2);
    const gaqlCall = spy.mock.calls[1];
    expect(String(gaqlCall[0])).toMatch(
      /^https:\/\/googleads\.googleapis\.com\/v24\/customers\/4014537400\/googleAds:search$/,
    );
    // The query body must target ad_group_ad and include the date predicate.
    const gaqlBody = JSON.parse(String(gaqlCall[1]?.body ?? '{}'));
    expect(gaqlBody.query).toContain('FROM ad_group_ad');
    expect(gaqlBody.query).toContain("WHERE segments.date = '2026-05-19'");
    expect(gaqlBody.query).toContain("ad_group_ad.status = 'ENABLED'");
    expect(gaqlBody.query).toContain('ad_group_ad.ad.id');
    expect(gaqlBody.query).toContain('ad_group_ad.ad.name');

    // Row shape.
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      storeId: 'uzoshop',
      date: '2026-05-19',
      platform: 'google',
      campaignId: '111',
      campaignName: 'Camp 1',
      adSetId: 'g1',
      adSetName: 'Group 1',
      adId: 'ad-99',
      adName: 'Ad Ninety-Nine',
      impressions: 500,
      clicks: 25,
      conversions: 2,
      conversionValueCad: 80,
      spendCad: 12,
    });
  });

  it('Ad Test 3: drops rows with spend=0 AND impressions=0 AND conversions=0', async () => {
    setUzoshopEnv();
    const responseQueue: Array<{ status: number; body: unknown }> = [
      {
        status: 200,
        body: { access_token: 'tok-abc', expires_in: 3600, token_type: 'Bearer' },
      },
      {
        status: 200,
        body: {
          results: [
            // Drop — fully inactive ad.
            {
              campaign: { id: 'c', name: 'C' },
              adGroup: { id: 'g', name: 'G' },
              adGroupAd: { ad: { id: 'dead', name: 'Dead Ad' } },
              metrics: {
                costMicros: '0',
                impressions: '0',
                clicks: '0',
                conversions: '0',
                conversionsValue: '0',
              },
              customer: { currencyCode: 'CAD' },
            },
            // Keep — has spend.
            {
              campaign: { id: 'c', name: 'C' },
              adGroup: { id: 'g', name: 'G' },
              adGroupAd: { ad: { id: 'live', name: 'Live Ad' } },
              metrics: {
                costMicros: '1000000', // 1.00 CAD
                impressions: '0',
                clicks: '0',
                conversions: '0',
                conversionsValue: '0',
              },
              customer: { currencyCode: 'CAD' },
            },
          ],
        },
      },
    ];
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      const next = responseQueue.shift();
      if (!next) throw new Error('mock exhausted');
      return new Response(JSON.stringify(next.body), { status: next.status });
    });
    vi.stubGlobal('fetch', spy);

    const { fetchGoogleAdsAdInsights } = await import('../googleAds');
    const out = await fetchGoogleAdsAdInsights('uzoshop', '2026-05-19');

    expect(out).toHaveLength(1);
    expect(out[0].adId).toBe('live');
    expect(out[0].spendCad).toBe(1);
  });
});
