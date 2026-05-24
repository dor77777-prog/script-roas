/**
 * Phase 12.5 — CC-01 Cross-fetcher contract test.
 *
 * The four ad-platform / store fetchers (meta.ts, googleAds.ts, tiktok.ts,
 * shopify.ts) each have their own paginate-and-throw loops. Per-file tests
 * cover the happy path on each, but until now no single test asserted the
 * three CROSS-CUTTING contracts that bind all four:
 *
 *   (a) Multi-page pagination terminates correctly — when the API hands
 *       back several pages and then null/empty, the fetcher returns the
 *       AGGREGATED rows (not just page 1, not duplicated).
 *
 *   (b) Token leakage in error messages — when the API returns a non-2xx
 *       body containing token-shaped strings, the thrown Error message
 *       does NOT contain `access_token` / `refresh_token` / `client_secret`
 *       substrings. Apps Script-era operators have grepped Inngest job
 *       logs for these substrings to spot leaks; a fetcher regression
 *       that echoes a 401 body verbatim could surface the token.
 *
 *   (c) Paging-cap warning false-positive at the EXACT last page —
 *       fetchers should not log a "hit pagination cap" warning when the
 *       API legitimately returned exactly `MAX_PAGES` pages with the
 *       last page being terminal. Several fetchers historically used a
 *       `page <= MAX_PAGES` loop condition + a post-loop `page >= MAX_PAGES`
 *       warn check, which fires the warn at exactly the last page even
 *       when there's nothing more to fetch. Operator-visible noise in
 *       Inngest job logs.
 *
 * Each fetcher gets one row in the parametrized table. The table is
 * tightly scoped (4 platforms × 3 contracts = 12 tests) and lives in
 * this single file rather than three per-fetcher additions because the
 * value of CC-01 is the unified contract — a future contributor adding a
 * 5th fetcher (e.g. Pinterest) needs only to add one row here.
 *
 * NOTE: this file complements (does not replace) the per-fetcher tests in
 *   src/lib/fetchers/__tests__/{meta,googleAds,tiktok,shopify}.test.ts.
 *   Those tests pin per-platform business logic (purchase priority chain,
 *   GAQL query strings, etc.); CC-01 pins the cross-platform invariants.
 *
 * Refs:
 *   - .planning/phases/12-codebase-audit-baseline/12-tests-needed.md
 *     §Cross-cutting tooling gaps CC-01
 *   - HP-09 (TikTok pagination), HP-10 (Meta/Google token-leak invariant)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// =========================================================================
// (b) token-leak invariant — current-state pinning
// =========================================================================
// HP-10 in 12-tests-needed.md flagged that all 4 fetchers echo the upstream
// API error body verbatim into the thrown Error.message (meta.ts:344, 533;
// googleAds.ts:234, 319; tiktok.ts:159; shopify.ts:91, multiple lines). A
// 401/400 body that LITERALLY contains the operator's secret would surface
// in Inngest job logs. The fix is backlogged for Phase 12.x.
//
// CC-01's (b) tests PIN the current (leak-prone) behavior so:
//   - The gap is visible in test output (test name + comment makes the
//     security boundary discoverable to any contributor reading the file).
//   - A future fix (body-sanitiser) is a single focused commit that flips
//     `.toContain(...)` → `.not.toContain(...)` per test.
//   - A future WORSENING (e.g. echoing token VALUES across MORE call paths
//     than the audited ones) would either widen the leak surface beyond
//     pinned tests, or break the pin — both are loud signals.
//
// The injected leak values are tagged `cc01-…` so a grep on production
// logs would never collide with a real operator token.

// =========================================================================
// Meta fetcher — multi-page paging via body.paging.next URL; safety cap = 50.
// =========================================================================

describe('CC-01 cross-fetcher contract — meta.ts', () => {
  const STORE = 'uzoshop';
  const DATE = '2026-05-22';
  const TOKEN_ENV = `${STORE.toUpperCase()}_META_ACCESS_TOKEN`;
  const ACCT_ENV = `${STORE.toUpperCase()}_META_AD_ACCOUNT_ID`;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[TOKEN_ENV] = 'cc01-meta-secret-access-token';
    process.env[ACCT_ENV] = '12345678901234567';
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    delete process.env[TOKEN_ENV];
    delete process.env[ACCT_ENV];
    vi.restoreAllMocks();
  });

  it('(a) pagination terminates and aggregates rows across multiple pages', async () => {
    const { fetchMetaAdSetInsights } = await import('@/lib/fetchers/meta');
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                campaign_id: 'c1',
                adset_id: 'a1',
                spend: '1',
                impressions: '10',
                actions: [],
                action_values: [],
                account_currency: 'ILS',
              },
            ],
            paging: { next: 'https://graph.facebook.com/page-2-cc01' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                campaign_id: 'c2',
                adset_id: 'a2',
                spend: '2',
                impressions: '20',
                actions: [],
                action_values: [],
                account_currency: 'ILS',
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const rows = await fetchMetaAdSetInsights(STORE, DATE);
    expect(rows.map(r => r.adSetId).sort()).toEqual(['a1', 'a2']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('(b) error message currently DOES echo API body verbatim (CURRENT-STATE PIN — HP-10 backlog fix flips this assertion)', async () => {
    const { fetchMetaAdSetInsights } = await import('@/lib/fetchers/meta');
    fetchSpy.mockResolvedValueOnce(
      new Response(
        'Invalid OAuth: access_token="cc01-leaked-meta-token"',
        { status: 401 },
      ),
    );
    let caught: Error | null = null;
    try {
      await fetchMetaAdSetInsights(STORE, DATE);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // CURRENT-STATE PIN: meta.ts:344 throws `…failed (${res.status}): ${body}` → leak surfaces.
    // After HP-10 fix swap to: .not.toContain('cc01-leaked-meta-token')
    expect(caught!.message).toContain('cc01-leaked-meta-token');
  });

  it('(c) paging-cap warning fires only when MORE rows exist beyond cap (not at exact-last-page boundary)', async () => {
    const { fetchMetaAdSetInsights } = await import('@/lib/fetchers/meta');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Return exactly the cap (50) pages where the FINAL page has NO
    // paging.next — i.e. the API legitimately stopped at the cap. The
    // fetcher should treat this as a clean end-of-data, not a cap-hit.
    const CAP = 50;
    for (let i = 0; i < CAP - 1; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                campaign_id: `c${i}`,
                adset_id: `a${i}`,
                spend: '0.01',
                impressions: '1',
                actions: [],
                action_values: [],
                account_currency: 'ILS',
              },
            ],
            paging: { next: `https://graph.facebook.com/page-${i + 2}` },
          }),
          { status: 200 },
        ),
      );
    }
    // Last (50th) page — no paging.next.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              campaign_id: 'cLast',
              adset_id: 'aLast',
              spend: '0.01',
              impressions: '1',
              actions: [],
              action_values: [],
              account_currency: 'ILS',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await fetchMetaAdSetInsights(STORE, DATE);
    // Meta uses `while (url && safety < 50)`, then post-loop checks
    // `if (safety >= 50 && url)` — `url` is null after the last page
    // returned `paging: undefined`, so the warn does NOT fire at the
    // exact-last-page boundary. This is the contract being pinned.
    expect(fetchSpy).toHaveBeenCalledTimes(CAP);
    const warnedMsg = warnSpy.mock.calls.map(c => String(c[0])).join('|');
    expect(warnedMsg.toLowerCase()).not.toContain('pagination cap');
  });
});

// =========================================================================
// Google Ads fetcher — paging via body.nextPageToken; cap = GAQL_PAGE_CAP (50).
// =========================================================================

describe('CC-01 cross-fetcher contract — googleAds.ts', () => {
  const STORE = 'uzoshop';
  const DATE = '2026-05-22';
  const CUST_ENV = `${STORE.toUpperCase()}_GOOGLEADS_CUSTOMER_ID`;

  beforeEach(() => {
    // googleAds.ts has a module-scoped tokenCache with NO test-reset helper.
    // `vi.resetModules()` forces a fresh import per test so the cache is
    // re-initialised, OAuth refresh fires, and the test order doesn't
    // matter. (Other fetchers expose `_reset*ForTesting` helpers; this
    // one doesn't, and we are NOT touching production code in 12.5.)
    vi.resetModules();
    process.env[CUST_ENV] = '1234567890';
    process.env.GOOGLEADS_CLIENT_ID = 'cc01-client-id';
    process.env.GOOGLEADS_CLIENT_SECRET = 'cc01-secret-shhh';
    process.env.GOOGLEADS_REFRESH_TOKEN = 'cc01-refresh-shhh';
    process.env.GOOGLEADS_DEVELOPER_TOKEN = 'cc01-dev-token';
  });

  afterEach(() => {
    delete process.env[CUST_ENV];
    delete process.env.GOOGLEADS_CLIENT_ID;
    delete process.env.GOOGLEADS_CLIENT_SECRET;
    delete process.env.GOOGLEADS_REFRESH_TOKEN;
    delete process.env.GOOGLEADS_DEVELOPER_TOKEN;
    vi.restoreAllMocks();
  });

  // Helper to make an OAuth-token-refresh canned response (the fetcher
  // calls oauth2.googleapis.com/token before any GAQL request).
  function oauthOk() {
    return new Response(
      JSON.stringify({ access_token: 'ya29.cc01-access', expires_in: 3600 }),
      { status: 200 },
    );
  }

  it('(a) pagination terminates and aggregates rows across multiple pages', async () => {
    const { fetchGoogleAdsSpendForDay } = await import('@/lib/fetchers/googleAds');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy
      .mockResolvedValueOnce(oauthOk())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { metrics: { costMicros: '5000000' }, customer: { currencyCode: 'CAD' } },
            ],
            nextPageToken: 'cursor-page-2',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { metrics: { costMicros: '7000000' }, customer: { currencyCode: 'CAD' } },
            ],
          }),
          { status: 200 },
        ),
      );
    const result = await fetchGoogleAdsSpendForDay(STORE, DATE);
    // 5_000_000 + 7_000_000 micros = 12 CAD.
    expect(result.spend).toBe(12);
    expect(result.currency).toBe('CAD');
    // OAuth + 2 GAQL pages = 3 fetches.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('(b) error message currently DOES echo GAQL body verbatim (CURRENT-STATE PIN — HP-10 backlog fix flips this assertion)', async () => {
    const { fetchGoogleAdsSpendForDay } = await import('@/lib/fetchers/googleAds');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy
      .mockResolvedValueOnce(oauthOk())
      .mockResolvedValueOnce(
        new Response(
          'GAQL failed: refresh_token=ya29.cc01-leaked-refresh access_token=ya29.cc01-leaked-access',
          { status: 401 },
        ),
      );
    let caught: Error | null = null;
    try {
      await fetchGoogleAdsSpendForDay(STORE, DATE);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // CURRENT-STATE PIN: googleAds.ts:319 throws `…: ${text}` → leak surfaces.
    // After HP-10 fix swap to: .not.toContain('cc01-leaked-access')
    expect(caught!.message).toContain('cc01-leaked-access');
  });

  it('(c) paging-cap warning does NOT fire at exact-last-page (Phase 12.5 fix)', async () => {
    // Regression guard for the false-positive that Phase 12.5 closed:
    // pre-fix, `pageToken` was assigned only when truthy, so after a
    // terminal 50th page (no nextPageToken) `pageToken` still carried
    // page-49's cursor and the post-loop `pages >= CAP && pageToken`
    // check fired a spurious "pagination cap hit" warn. Fix swapped
    // the order so `pageToken = body.nextPageToken` runs FIRST, then
    // `if (!pageToken) break` — terminal pages leave pageToken
    // undefined as expected.
    const { fetchGoogleAdsSpendForDay } = await import('@/lib/fetchers/googleAds');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(oauthOk());
    const CAP = 50;
    // First 49 pages: each carries nextPageToken (sets pageToken closure).
    for (let i = 0; i < CAP - 1; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { metrics: { costMicros: '1' }, customer: { currencyCode: 'CAD' } },
            ],
            nextPageToken: `cursor-${i + 2}`,
          }),
          { status: 200 },
        ),
      );
    }
    // 50th page: NO nextPageToken → terminal. Post-fix, pageToken is
    // undefined here so no warn fires.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{ metrics: { costMicros: '1' }, customer: { currencyCode: 'CAD' } }],
        }),
        { status: 200 },
      ),
    );
    await fetchGoogleAdsSpendForDay(STORE, DATE);
    const warnedMsg = warnSpy.mock.calls.map(c => String(c[0])).join('|');
    expect(warnedMsg.toLowerCase()).not.toContain('pagination cap');
  });

  it('(c2) paging-cap warning DOES fire when MORE rows exist beyond cap', async () => {
    // Symmetric to (c): if the 50th page DOES carry nextPageToken,
    // there's genuinely more data beyond the cap → warn must fire.
    const { fetchGoogleAdsSpendForDay } = await import('@/lib/fetchers/googleAds');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(oauthOk());
    const CAP = 50;
    // ALL 50 pages carry nextPageToken → terminate by cap, more data left.
    for (let i = 0; i < CAP; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { metrics: { costMicros: '1' }, customer: { currencyCode: 'CAD' } },
            ],
            nextPageToken: `cursor-${i + 2}`,
          }),
          { status: 200 },
        ),
      );
    }
    await fetchGoogleAdsSpendForDay(STORE, DATE);
    const warnedMsg = warnSpy.mock.calls.map(c => String(c[0])).join('|');
    expect(warnedMsg.toLowerCase()).toContain('pagination cap');
  });
});

// =========================================================================
// TikTok fetcher — paging via page_info.total_page; cap = 50.
// =========================================================================

describe('CC-01 cross-fetcher contract — tiktok.ts', () => {
  const STORE = 'uzoshop';
  const DATE = '2026-05-22';
  const ADV_ENV = `${STORE.toUpperCase()}_TIKTOK_ADVERTISER_ID`;
  const TOK_ENV = `${STORE.toUpperCase()}_TIKTOK_ACCESS_TOKEN`;

  beforeEach(async () => {
    process.env[ADV_ENV] = '7012345678901234567';
    process.env[TOK_ENV] = 'cc01-tiktok-access-token';
    const { _resetAdvertiserInfoCacheForTesting } = await import('@/lib/fetchers/tiktok');
    _resetAdvertiserInfoCacheForTesting();
  });

  afterEach(() => {
    delete process.env[ADV_ENV];
    delete process.env[TOK_ENV];
    vi.restoreAllMocks();
  });

  // Helper — TikTok envelope shape: { code, message, data }.
  function tt<T>(data: T) {
    return new Response(JSON.stringify({ code: 0, message: 'OK', data }), {
      status: 200,
    });
  }

  // URL-routed mock — TikTok fetcher fires advertiser/info + adgroup/get
  // (sidecar) + report/integrated/get pages in parallel/sequential mix.
  // FIFO mockResolvedValueOnce ordering is unreliable here; route by path.
  type TtRoute = { match: (url: string) => boolean; pages: Response[] };
  function makeTtRouter(routes: TtRoute[]) {
    return vi.fn(async (input: RequestInfo): Promise<Response> => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      for (const r of routes) {
        if (r.match(url)) {
          const next = r.pages.shift();
          if (!next) throw new Error(`TtRouter: queue empty for ${url}`);
          return next.clone();
        }
      }
      throw new Error(`TtRouter: no match for ${url}`);
    });
  }

  it('(a) pagination terminates and aggregates rows across multiple pages', async () => {
    const { fetchTikTokAdInsights } = await import('@/lib/fetchers/tiktok');
    const routed = makeTtRouter([
      {
        match: u => u.includes('/advertiser/info/'),
        pages: [
          tt({ list: [{ advertiser_id: '7012345678901234567', currency: 'USD', name: 'X', timezone: 'UTC' }] }),
        ],
      },
      {
        match: u => u.includes('/adgroup/get/'),
        pages: [tt({ list: [], page_info: { total_page: 1, page: 1 } })],
      },
      {
        match: u => u.includes('/report/integrated/get/'),
        pages: [
          tt({
            list: [
              {
                metrics: {
                  spend: 1, impressions: 100, clicks: 5, conversion: 1,
                  complete_payment: 1, value_per_complete_payment: 50,
                  campaign_id: 'c1', campaign_name: 'C1',
                  adgroup_id: 'g1', adgroup_name: 'G1', ad_name: 'A1',
                },
                dimensions: { ad_id: 'ad1' },
              },
            ],
            page_info: { total_page: 2, page: 1 },
          }),
          tt({
            list: [
              {
                metrics: {
                  spend: 2, impressions: 200, clicks: 10, conversion: 2,
                  complete_payment: 2, value_per_complete_payment: 25,
                  campaign_id: 'c2', campaign_name: 'C2',
                  adgroup_id: 'g2', adgroup_name: 'G2', ad_name: 'A2',
                },
                dimensions: { ad_id: 'ad2' },
              },
            ],
            page_info: { total_page: 2, page: 2 },
          }),
        ],
      },
    ]);
    vi.stubGlobal('fetch', routed);
    const rows = await fetchTikTokAdInsights(STORE, DATE);
    expect(rows.map(r => r.adId).sort()).toEqual(['ad1', 'ad2']);
  });

  it('(b) error message currently DOES echo API body verbatim (CURRENT-STATE PIN — HP-10 backlog fix flips this assertion)', async () => {
    const { fetchTikTokAdvertiserInfo } = await import('@/lib/fetchers/tiktok');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(
      new Response(
        'TikTok: access_token=cc01-leaked-tiktok-token refresh_token=cc01-leaked-refresh',
        { status: 401 },
      ),
    );
    let caught: Error | null = null;
    try {
      await fetchTikTokAdvertiserInfo(STORE);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // CURRENT-STATE PIN: tiktok.ts:159 throws `…HTTP ${res.status}: ${body.slice(0,600)}` → leak surfaces.
    // After HP-10 fix swap to: .not.toContain('cc01-leaked-tiktok-token')
    expect(caught!.message).toContain('cc01-leaked-tiktok-token');
  });

  it('(c) paging-cap warning false-positive at exact-last-page (CURRENT BEHAVIOR PINNED: warn DOES fire)', async () => {
    // TikTok intentionally pinned: the current implementation uses
    // `while (page <= TIKTOK_PAGINATION_CAP)` PLUS `if (page >= totalPages)
    // break;` PLUS post-loop `if (page >= TIKTOK_PAGINATION_CAP)`. When
    // total_page exactly equals 50 and `break` fires on the last iteration,
    // `page === 50 >= 50` → the warn DOES fire even though there's nothing
    // beyond cap. This test PINS the current behaviour so a future fix
    // (e.g. tracking a separate `morePages` flag) is a deliberate, traceable
    // commit instead of an accidental cleanup.
    const { fetchTikTokAdInsights } = await import('@/lib/fetchers/tiktok');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const CAP = 50;
    const reportPages: Response[] = [];
    for (let i = 0; i < CAP; i++) {
      reportPages.push(
        tt({
          list: [
            {
              metrics: {
                spend: 1, impressions: 10, clicks: 1, conversion: 1,
                complete_payment: 1, value_per_complete_payment: 1,
                campaign_id: 'c', campaign_name: 'C',
                adgroup_id: `g${i}`, adgroup_name: `G${i}`, ad_name: `A${i}`,
              },
              dimensions: { ad_id: `ad${i}` },
            },
          ],
          page_info: { total_page: CAP, page: i + 1 },
        }),
      );
    }
    const routed = makeTtRouter([
      {
        match: u => u.includes('/advertiser/info/'),
        pages: [
          tt({ list: [{ advertiser_id: '7012345678901234567', currency: 'USD', name: 'X', timezone: 'UTC' }] }),
        ],
      },
      {
        match: u => u.includes('/adgroup/get/'),
        pages: [tt({ list: [], page_info: { total_page: 1, page: 1 } })],
      },
      { match: u => u.includes('/report/integrated/get/'), pages: reportPages },
    ]);
    vi.stubGlobal('fetch', routed);
    await fetchTikTokAdInsights(STORE, DATE);
    const warnedMsg = warnSpy.mock.calls.map(c => String(c[0])).join('|');
    // PIN the false-positive: warn DOES fire at exact-last-page (current
    // impl). When this is fixed, swap `.toContain` → `.not.toContain`.
    expect(warnedMsg.toLowerCase()).toContain('pagination cap');
  });
});

// =========================================================================
// Shopify fetcher — paging via Link header rel="next"; cap = 50.
// =========================================================================

describe('CC-01 cross-fetcher contract — shopify.ts', () => {
  const STORE = 'uzoshop';
  const DATE = '2026-05-22';
  const DOMAIN_ENV = `${STORE.toUpperCase()}_SHOPIFY_DOMAIN`;
  const CID_ENV = `${STORE.toUpperCase()}_SHOPIFY_CLIENT_ID`;
  const CSEC_ENV = `${STORE.toUpperCase()}_SHOPIFY_CLIENT_SECRET`;

  beforeEach(async () => {
    process.env[DOMAIN_ENV] = 'cc01-shop.myshopify.com';
    process.env[CID_ENV] = 'cc01-shopify-client-id';
    process.env[CSEC_ENV] = 'cc01-shopify-client-secret';
    const { _resetShopifyAuthCacheForTesting } = await import('@/lib/fetchers/shopifyAuth');
    _resetShopifyAuthCacheForTesting();
  });

  afterEach(() => {
    delete process.env[DOMAIN_ENV];
    delete process.env[CID_ENV];
    delete process.env[CSEC_ENV];
    vi.restoreAllMocks();
  });

  function oauthOk() {
    return new Response(
      JSON.stringify({ access_token: 'shpat_cc01-access', expires_in: 86400, scope: 'read_orders' }),
      { status: 200 },
    );
  }

  it('(a) pagination terminates and aggregates rows across multiple pages', async () => {
    const { fetchShopifyDayRows } = await import('@/lib/fetchers/shopify');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Shopify fetcher runs OAuth + 2 Windows (created_at + updated_at), each
    // paginated. For the contract test, give each window a 2-page response
    // sequence so we exercise the pagination join while keeping the test
    // tractable. We don't assert row aggregates here — only that pagination
    // terminates cleanly (no infinite loop, no throw, finite call count).
    fetchSpy
      // OAuth exchange (per-store getShopifyAccessToken)
      .mockResolvedValueOnce(oauthOk())
      // Window A — created_at page 1 (with Link rel=next) then page 2 (terminal)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [] }), {
          status: 200,
          headers: { Link: '<https://cc01-shop.myshopify.com/page-a2>; rel="next"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [] }), { status: 200 }),
      )
      // Window B — updated_at page 1 (with Link rel=next) then page 2 (terminal)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [] }), {
          status: 200,
          headers: { Link: '<https://cc01-shop.myshopify.com/page-b2>; rel="next"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [] }), { status: 200 }),
      );
    const result = await fetchShopifyDayRows(STORE, DATE);
    expect(result.storeId).toBe(STORE);
    expect(result.date).toBe(DATE);
    // Empty orders → revenue 0, no products.
    expect(result.revenueCad).toBe(0);
    expect(result.productRows).toEqual([]);
    // OAuth + 2-page Window A + 2-page Window B = 5 calls. Pin the count
    // so a future refactor that re-paginates needlessly doesn't drift.
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('(b) error message currently DOES echo OAuth body verbatim (CURRENT-STATE PIN — HP-10 backlog fix flips this assertion)', async () => {
    const { fetchShopifyDayRows } = await import('@/lib/fetchers/shopify');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(
      new Response(
        'OAuth failed: client_secret=cc01-leaked-shopify-secret access_token=shpat_cc01-leaked',
        { status: 400 },
      ),
    );
    let caught: Error | null = null;
    try {
      await fetchShopifyDayRows(STORE, DATE);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // CURRENT-STATE PIN: shopifyAuth.ts:91 throws `…(HTTP ${status}): ${errBody.slice(0,400)}` → leak surfaces.
    // After HP-10 fix swap to: .not.toContain('cc01-leaked-shopify-secret')
    expect(caught!.message).toContain('cc01-leaked-shopify-secret');
  });

  it('(c) paging-cap warning fires only when MORE rows exist beyond cap (not at exact-last-page boundary)', async () => {
    const { fetchShopifyDayRows } = await import('@/lib/fetchers/shopify');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(oauthOk());
    const CAP = 50;
    // Window A — 49 pages with Link rel=next, then 50th terminal
    for (let i = 0; i < CAP - 1; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [] }), {
          status: 200,
          headers: { Link: `<https://cc01-shop.myshopify.com/page-a${i + 2}>; rel="next"` },
        }),
      );
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ orders: [] }), { status: 200 }),
    );
    // Window B — single terminal page (we only need to exercise Window A's cap)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ orders: [] }), { status: 200 }),
    );
    await fetchShopifyDayRows(STORE, DATE);
    // Shopify uses `while (nextUrl && safetyPages < PAGINATION_CAP)` and
    // breaks on `parseNextLink` returning undefined. Post-loop check uses
    // `if (safetyPages >= PAGINATION_CAP && nextUrl)` — nextUrl is
    // undefined after the terminal page, so warn does NOT fire.
    const warnedMsg = warnSpy.mock.calls.map(c => String(c[0])).join('|');
    expect(warnedMsg.toLowerCase()).not.toContain('pagination cap');
  });
});
