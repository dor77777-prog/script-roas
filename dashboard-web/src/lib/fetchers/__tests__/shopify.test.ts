/**
 * Phase 05.6 Plan 03 — fetcher-level tests for src/lib/fetchers/shopify.ts.
 *
 * Why these 7 tests (and not 50): the refund-net-of-refunds algorithm is
 * already covered by 6 vitest fixture-based cases in
 * `src/lib/__tests__/shopifyRevenueRefunds.test.ts` — those guard the
 * 3 load-bearing invariants of Phase 05.2.3.0 (gap-closure 08). This
 * file's job is the I/O wrapper: pagination, dedup across the two
 * orders.created_at vs orders.updated_at windows, the 50-page safety
 * cap, env-var resolution, and — critically — the assertion that the
 * algorithm function is called EXACTLY ONCE per fetch (i.e. proves we
 * delegate to the existing pure-TS implementation, never re-derive it).
 *
 * See:
 *   - 05.6-RESEARCH.md §Pattern 9 (lines 1043-1154) — fetcher integration snippet
 *   - 05.6-PATTERNS.md S-9 §shopify.ts (lines 327-348) — conventions to copy
 *   - 05.6-RESEARCH.md §Pitfall 6 — 50-page safety cap
 *   - 05.2.3.0-REVIEW.md CR-01..CR-03 — invariants the algorithm preserves
 *
 * SPY ASSERTION (Test 7): vi.spyOn(algo, 'computeRevenueWithCrossDayRefunds')
 * with toHaveBeenCalledTimes(1). If a future executor were to re-derive
 * the algorithm inline in shopify.ts, this test would fail. That is the
 * load-bearing "don't hand-roll the algorithm" gate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as algo from '@/lib/shopifyRevenueRefunds';
import * as shopifyAuth from '@/lib/fetchers/shopifyAuth';
import {
  fetchShopifyDayRows,
  fetchShopifyProductsCatalog,
  fetchShopifyOrdersAttribution,
} from '../shopify';

// ---------------------------------------------------------------------------
// Mock helpers — globalThis.fetch + Link header parsing
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit };

function makeFetchMock(
  responses: Array<{
    body: unknown;
    link?: string; // optional Link header for pagination
    status?: number;
  }>,
) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    const headers = new Headers();
    if (r?.link) headers.set('Link', r.link);
    return new Response(JSON.stringify(r?.body ?? { orders: [] }), {
      status: r?.status ?? 200,
      headers,
    });
  });
  return { fn, calls };
}

const STORE_ID = 'uzoshop';
const DATE_STR = '2026-05-19';

beforeEach(() => {
  // Phase 05.7.7: Dev Dashboard apps authenticate via OAuth client_credentials
  // grant — Client ID + Secret exchanged for a 24h access token. Tests
  // bypass the OAuth fetch by mocking getShopifyAccessToken directly so
  // the existing fetch mock queue stays focused on Admin API calls.
  vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_ID', 'test_client_id');
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_SECRET', 'shpss_test_secret');
  shopifyAuth._resetShopifyAuthCacheForTesting();
  vi.spyOn(shopifyAuth, 'getShopifyAccessToken').mockResolvedValue(
    'shpat_test_TOKEN',
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ===========================================================================

describe('shopify fetcher — fetchShopifyDayRows', () => {
  it('Test 1: calls Shopify Admin REST 2026-04 with correct day-boundary window (Asia/Jerusalem)', async () => {
    const { fn, calls } = makeFetchMock([{ body: { orders: [] } }, { body: { orders: [] } }]);
    vi.stubGlobal('fetch', fn);

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    // At least one call must hit the orders.json endpoint with API version 2026-04
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const apiCall = calls.find((c) => c.url.includes('/admin/api/2026-04/orders.json'));
    expect(apiCall, 'expected at least one /admin/api/2026-04/orders.json call').toBeDefined();

    // The lower bound of the window must be 2026-05-19 local midnight in Asia/Jerusalem.
    // Asia/Jerusalem in May is IDT (UTC+3) → MUST be exactly 2026-05-19T00:00:00+03:00.
    //
    // Phase 05.7.6 regression guard: prior tests only checked startsWith('T00:00:00'),
    // letting the +747:00 offset bug ship to prod undetected (Date.UTC month-indexing
    // bug in isoLocalMidnight offset calc). Now we lock the FULL ISO with explicit
    // offset shape.
    const createdAtMin = decodeURIComponent(
      /created_at_min=([^&]+)/.exec(apiCall!.url)?.[1] ?? '',
    );
    expect(createdAtMin).toBe('2026-05-19T00:00:00+03:00');

    // The upper bound must be next-day local midnight (2026-05-20T00:00:00+03:00).
    const createdAtMax = decodeURIComponent(
      /created_at_max=([^&]+)/.exec(apiCall!.url)?.[1] ?? '',
    );
    expect(createdAtMax).toBe('2026-05-20T00:00:00+03:00');

    // Auth header — X-Shopify-Access-Token (NOT Bearer)
    const headers = apiCall!.init?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Shopify-Access-Token']).toBe('shpat_test_TOKEN');
  });

  it('Test 1b (Phase 05.7.6 regression): offset is +03:00 (NOT +747:00) for May IDT', async () => {
    // Direct regression guard for the Date.UTC month-indexing bug that
    // shipped to prod on 2026-05-22. The bug produced offsets like
    // `+747:00` (= 31 days + 3 hours = month-rollover artifact) because
    // Date.UTC treats month as 0-indexed (Jan=0) but the offset calc
    // was passing it 1-indexed. Shopify silently returned empty arrays
    // for the malformed offset, breaking ALL revenue writes on day-of.
    const { fn, calls } = makeFetchMock([{ body: { orders: [] } }, { body: { orders: [] } }]);
    vi.stubGlobal('fetch', fn);

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    const apiCall = calls.find((c) => c.url.includes('/admin/api/2026-04/orders.json'));
    const createdAtMin = decodeURIComponent(
      /created_at_min=([^&]+)/.exec(apiCall!.url)?.[1] ?? '',
    );
    // The MUST-MATCH ending — explicitly NOT '+747:00' or any other broken shape.
    expect(createdAtMin).toMatch(/\+03:00$/);
    expect(createdAtMin).not.toMatch(/\+\d{3}:\d{2}$/); // 3-digit hours = bug
  });

  it('Test 2: Link header rel="next" triggers a second fetch to that URL', async () => {
    const nextUrl =
      'https://uzoshop.myshopify.com/admin/api/2026-04/orders.json?limit=250&page_info=NEXT_PAGE_TOKEN';
    const { fn, calls } = makeFetchMock([
      // Page 1 of window A (created_at): one order + Link rel="next"
      {
        body: {
          orders: [
            {
              id: 'order-p1',
              created_at: '2026-05-19T10:00:00+03:00',
              total_price: '100.00',
              current_total_price: '100.00',
              line_items: [],
              refunds: [],
            },
          ],
        },
        link: `<${nextUrl}>; rel="next"`,
      },
      // Page 2 of window A — empty, no next
      { body: { orders: [] } },
      // Window B (updated_at) — empty single page
      { body: { orders: [] } },
    ]);
    vi.stubGlobal('fetch', fn);

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    // Second call (page 2) must hit the nextUrl from the Link header
    const calledNext = calls.some((c) => c.url === nextUrl);
    expect(calledNext, 'expected second fetch at the Link rel="next" URL').toBe(true);
  });

  it('Test 3: Pagination cap at 50 pages emits console.warn; does NOT throw', async () => {
    // Make 100 responses, each with a "next" link, so the cap is hit.
    const everPagingLink = `<https://uzoshop.myshopify.com/admin/api/2026-04/orders.json?page_info=KEEP_GOING>; rel="next"`;
    const responses = Array.from({ length: 110 }, () => ({
      body: { orders: [] },
      link: everPagingLink,
    }));
    const { fn } = makeFetchMock(responses);
    vi.stubGlobal('fetch', fn);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(fetchShopifyDayRows(STORE_ID, DATE_STR)).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
    const warnedMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnedMessages.some((m) => /50|cap|pagination/i.test(m)),
      'expected console.warn message mentioning pagination cap',
    ).toBe(true);
  });

  it('Test 4: Fetches BOTH created_at=D AND updated_at=D windows; merges deduped by order id', async () => {
    const sharedOrder = {
      id: '1234',
      created_at: '2026-05-19T08:00:00+03:00',
      total_price: '200.00',
      current_total_price: '180.00',
      line_items: [],
      refunds: [
        {
          processed_at: '2026-05-19T20:00:00+03:00',
          refund_line_items: [{ product_id: null, subtotal: '20.00' }],
        },
      ],
    };
    const { fn, calls } = makeFetchMock([
      // Window A response — returns the shared order
      { body: { orders: [sharedOrder] } },
      // Window B response — returns the SAME order (its updated_at also fell on D)
      { body: { orders: [sharedOrder] } },
    ]);
    vi.stubGlobal('fetch', fn);

    // Spy on the algorithm — we want to inspect the orders array it receives.
    const spy = vi
      .spyOn(algo, 'computeRevenueWithCrossDayRefunds')
      .mockImplementation((orders) => {
        // Defensive copy so subsequent asserts can read it
        // The fetcher MUST pass a deduped array.
        const merged = orders;
        // Capture for outer scope assertion via the spy.mock.calls record
        return {
          storeNetCad: 0,
          byProduct: {},
          customItemRefundCad: 0,
          storeGrossCad: 0,
          storeRefundDeductionCad: 0,
        };
        void merged;
      });

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    // Both windows must have been queried.
    expect(calls.some((c) => /created_at_min/.test(c.url))).toBe(true);
    expect(calls.some((c) => /updated_at_min/.test(c.url))).toBe(true);

    // Algorithm received EXACTLY ONE copy of the shared order (deduped).
    const ordersReceived = spy.mock.calls[0]?.[0] ?? [];
    const occurrences = ordersReceived.filter((o) => String(o.id) === '1234').length;
    expect(occurrences).toBe(1);
  });

  it('Test 5: Result includes revenueCad, productRows, customItemRefundCad, storeName', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'order-1',
              created_at: '2026-05-19T10:00:00+03:00',
              total_price: '300.00',
              current_total_price: '300.00',
              line_items: [{ product_id: 'prod-A', price: '300.00', quantity: 1 }],
              refunds: [],
            },
          ],
        },
      },
      { body: { orders: [] } },
    ]);
    vi.stubGlobal('fetch', fn);

    const result = await fetchShopifyDayRows(STORE_ID, DATE_STR);

    expect(result).toMatchObject({
      storeId: STORE_ID,
      date: DATE_STR,
      storeName: 'uzoshop',
    });
    expect(typeof result.revenueCad).toBe('number');
    expect(Array.isArray(result.productRows)).toBe(true);
    expect(typeof result.customItemRefundCad).toBe('number');
    // The product-row shape per RESEARCH §Pattern 9 lines 1147-1150
    if (result.productRows.length > 0) {
      expect(result.productRows[0]).toHaveProperty('product_id');
      expect(result.productRows[0]).toHaveProperty('net_revenue_cad');
    }
  });

  it('Test 6 (Phase 05.7.7): Missing _DOMAIN or _CLIENT_ID/_CLIENT_SECRET throws clear error with storeId', async () => {
    // Restore the real getShopifyAccessToken so we can test its error path.
    vi.restoreAllMocks();

    vi.unstubAllEnvs();
    // Re-stub creds partially — domain missing
    vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_ID', 'test_id');
    vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_SECRET', 'shpss_test');
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', '');

    const noopFetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', noopFetch);

    await expect(fetchShopifyDayRows(STORE_ID, DATE_STR)).rejects.toThrow(/uzoshop/i);

    // Also: missing CLIENT_SECRET (the OAuth helper rejects)
    vi.unstubAllEnvs();
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
    vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_ID', 'test_id');
    vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_SECRET', '');
    shopifyAuth._resetShopifyAuthCacheForTesting();

    await expect(fetchShopifyDayRows(STORE_ID, DATE_STR)).rejects.toThrow(/uzoshop/i);
  });

  it('Test 4b (bug 2026-05-21): Window B (updated_at) is OPEN-ENDED to today, not D+1', async () => {
    // Bug 2026-05-21: 8 of 10 refunds processed on 2026-05-20 for uzoshop
    // were on orders whose updated_at advanced into 2026-05-21 (batch update).
    // The original [D, D+1) window missed all 8 ($832 in refund_line_items).
    // Fix: Window B upper bound = today+1 so subsequent-day updates are still
    // caught. Window A is unchanged (still tight [D, D+1)).
    const { fn, calls } = makeFetchMock([
      { body: { orders: [] } },
      { body: { orders: [] } },
    ]);
    vi.stubGlobal('fetch', fn);

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    // Find the two calls
    const createdCall = calls.find((c) => /created_at_min/.test(c.url));
    const updatedCall = calls.find((c) => /updated_at_min/.test(c.url));
    expect(createdCall).toBeDefined();
    expect(updatedCall).toBeDefined();

    // Window A: both bounds tight to D / D+1
    const createdMin = decodeURIComponent(
      /created_at_min=([^&]+)/.exec(createdCall!.url)?.[1] ?? '',
    );
    const createdMax = decodeURIComponent(
      /created_at_max=([^&]+)/.exec(createdCall!.url)?.[1] ?? '',
    );
    expect(createdMin.startsWith('2026-05-19T00:00:00')).toBe(true);
    expect(createdMax.startsWith('2026-05-20T00:00:00')).toBe(true);

    // Window B: min still = D, but max must extend to TODAY+1 (not D+1).
    // Today depends on when the test runs, but it MUST be > D+1 = 2026-05-20.
    const updatedMin = decodeURIComponent(
      /updated_at_min=([^&]+)/.exec(updatedCall!.url)?.[1] ?? '',
    );
    const updatedMax = decodeURIComponent(
      /updated_at_max=([^&]+)/.exec(updatedCall!.url)?.[1] ?? '',
    );
    expect(updatedMin.startsWith('2026-05-19T00:00:00')).toBe(true);
    // The key assertion: updatedMax is NOT 2026-05-20 (which was the bug).
    // It should be today+1, which since this test runs after 2026-05-20 must
    // be >= 2026-05-21 — i.e. the YYYY-MM-DD prefix must be strictly greater
    // than '2026-05-20'.
    expect(updatedMax.startsWith('2026-05-20')).toBe(false);
    const updatedMaxDatePart = updatedMax.slice(0, 10);
    expect(updatedMaxDatePart > '2026-05-20').toBe(true);
  });

  it('Test 7: computeRevenueWithCrossDayRefunds is called EXACTLY ONCE per invocation (delegation gate)', async () => {
    // This is the load-bearing test. If a future executor re-derives the
    // refund algorithm inline in shopify.ts, the spy will record 0 calls
    // and this assertion fails. RESEARCH §Pattern 9 + §Don't Hand-Roll.
    const { fn } = makeFetchMock([
      { body: { orders: [] } },
      { body: { orders: [] } },
    ]);
    vi.stubGlobal('fetch', fn);

    const spy = vi.spyOn(algo, 'computeRevenueWithCrossDayRefunds');

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    expect(spy).toHaveBeenCalledTimes(1);

    // The TZ must be Asia/Jerusalem (D-A4) — third positional argument.
    const callArgs = spy.mock.calls[0];
    expect(callArgs?.[1]).toBe(DATE_STR);
    expect(callArgs?.[2]).toBe('Asia/Jerusalem');
  });
});

// ===========================================================================
// Phase 05.6.1 — fetchShopifyProductsCatalog (port of Shopify.gs:537)
// ===========================================================================

describe('shopify fetcher — fetchShopifyProductsCatalog', () => {
  it('Catalog Test 1: hits /products.json with status=active and fields list; parses first variant price', async () => {
    const { fn, calls } = makeFetchMock([
      {
        body: {
          products: [
            {
              id: 12345,
              title: 'Test Product',
              handle: 'test-product',
              status: 'active',
              image: { src: 'https://cdn.shopify.com/img.jpg' },
              variants: [{ price: '19.99' }, { price: '29.99' }], // first variant wins
              product_type: 'Widget',
              vendor: 'TestCo',
              updated_at: '2026-05-19T10:00:00Z',
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyProductsCatalog(STORE_ID);

    // URL invariants — products.json endpoint with status=active and the
    // documented fields list (id,title,status,handle,image,variants,
    // product_type,vendor,updated_at).
    const apiCall = calls[0];
    expect(apiCall.url).toContain('/admin/api/2026-04/products.json');
    expect(apiCall.url).toContain('status=active');
    expect(apiCall.url).toContain('limit=250');
    expect(apiCall.url).toMatch(/fields=[^&]*variants/);
    expect(apiCall.url).toMatch(/fields=[^&]*updated_at/);

    // Auth header
    const headers = apiCall.init?.headers as Record<string, string>;
    expect(headers['X-Shopify-Access-Token']).toBe('shpat_test_TOKEN');

    // Row shape
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      storeId: STORE_ID,
      productId: '12345',
      title: 'Test Product',
      handle: 'test-product',
      status: 'active',
      priceCad: 19.99,
      imageUrl: 'https://cdn.shopify.com/img.jpg',
      productType: 'Widget',
      vendor: 'TestCo',
      updatedAt: '2026-05-19T10:00:00Z',
    });
  });

  it('Catalog Test 2: follows Link rel="next" header for pagination across multiple pages', async () => {
    const nextUrl =
      'https://uzoshop.myshopify.com/admin/api/2026-04/products.json?limit=250&page_info=PAGE_TWO';
    const { fn, calls } = makeFetchMock([
      // Page 1 — one product + Link rel="next"
      {
        body: {
          products: [
            {
              id: 1,
              title: 'P1',
              handle: 'p1',
              status: 'active',
              variants: [{ price: '5' }],
            },
          ],
        },
        link: `<${nextUrl}>; rel="next"`,
      },
      // Page 2 — one product, no next
      {
        body: {
          products: [
            {
              id: 2,
              title: 'P2',
              handle: 'p2',
              status: 'active',
              variants: [{ price: '10' }],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyProductsCatalog(STORE_ID);

    // Both pages were fetched, second call hit the Link URL verbatim.
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(nextUrl);
    expect(out.map((p) => p.productId)).toEqual(['1', '2']);
  });

  it('Catalog Test 3: returns priceCad=null when product has no variants', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          products: [
            {
              id: 99,
              title: 'NoVariants',
              handle: 'nv',
              status: 'active',
              variants: [], // empty — Apps Script line 569-570 falls back to 0;
              // we tighten to `null` so the dashboard can distinguish.
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyProductsCatalog(STORE_ID);
    expect(out[0].priceCad).toBeNull();
    expect(out[0].imageUrl).toBeNull();
    expect(out[0].productType).toBeNull();
    expect(out[0].vendor).toBeNull();
    expect(out[0].updatedAt).toBeNull();
  });
});

// ===========================================================================
// Phase 05.6.1 — fetchShopifyOrdersAttribution (port of Shopify.gs:757)
// ===========================================================================

describe('shopify fetcher — fetchShopifyOrdersAttribution', () => {
  it('Orders Test 1: classifies fbclid-bearing landing_site as meta-paid; sets fbclidPresent=true', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'O-1',
              current_total_price: '150.00',
              financial_status: 'paid',
              test: false,
              landing_site:
                '/?utm_source=facebook&utm_medium=cpc&utm_campaign=spring_sale&fbclid=AbCdEf123',
              referring_site: 'https://l.facebook.com/',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('meta-paid');
    expect(out[0].fbclidPresent).toBe(true);
    expect(out[0].gclidPresent).toBe(false);
    expect(out[0].utmSource).toBe('facebook');
    expect(out[0].utmMedium).toBe('cpc');
    expect(out[0].utmCampaign).toBe('spring_sale');
    expect(out[0].totalCad).toBe(150);
  });

  it('Orders Test 2: source priority — source_name=fb beats absent UTM (deterministic platform signal)', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'O-fb',
              current_total_price: '50.00',
              landing_site: '/products/widget', // no UTM tail
              referring_site: '',
              note_attributes: [],
              source_name: 'fb', // Shopify FB channel signal
              line_items: [],
            },
            {
              id: 'O-google',
              current_total_price: '75.00',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'google',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    const byId = new Map(out.map((o) => [o.orderId, o]));
    expect(byId.get('O-fb')?.source).toBe('meta-paid');
    expect(byId.get('O-google')?.source).toBe('google-paid');
  });

  it('Orders Test 3: utm_source unknown → other-paid; referring_site facebook → meta-organic; no signal → direct', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'tiktok',
              current_total_price: '10',
              landing_site: '/?utm_source=tiktok&utm_medium=paid',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'org-fb',
              current_total_price: '10',
              landing_site: '/',
              referring_site: 'https://www.facebook.com/something',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'direct',
              current_total_price: '10',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    const byId = new Map(out.map((o) => [o.orderId, o.source]));
    // Phase 05.7.5: utm_source=tiktok was previously bucketed to 'other-paid';
    // now it's a first-class 'tiktok-paid' source.
    expect(byId.get('tiktok')).toBe('tiktok-paid');
    expect(byId.get('org-fb')).toBe('meta-organic');
    expect(byId.get('direct')).toBe('direct');
  });

  it('Orders Test 3b (Phase 05.7.5): ttclid / source_name=tiktok / utm_source=tiktok all classify as tiktok-paid', async () => {
    // Three independent detection paths for TikTok paid traffic — same
    // structure as the meta-paid (fbclid / source_name=fb / utm=facebook)
    // and google-paid (gclid / source_name=google / utm=google) chains.
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'tt-clickid',
              current_total_price: '50',
              landing_site:
                '/products/widget?ttclid=E.C.P.AbCdEf123&utm_source=somethingelse',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'tt-source-name',
              current_total_price: '60',
              landing_site: '/products/widget', // no UTM tail
              referring_site: '',
              note_attributes: [],
              source_name: 'tiktok', // Shopify TikTok channel signal
              line_items: [],
            },
            {
              id: 'tt-utm-cpc',
              current_total_price: '70',
              landing_site: '/?utm_source=tiktok&utm_medium=cpc&utm_campaign=tt_spring',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'tt-utm-no-medium',
              current_total_price: '80',
              // utm_source=tiktok but no utm_medium — still tiktok-paid per
              // the dedicated fallback branch (creators sometimes set source
              // but omit medium).
              landing_site: '/?utm_source=tiktok',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'tt-organic-referral',
              current_total_price: '90',
              // Referrer-only tiktok.com (organic share) — must NOT classify
              // as tiktok-paid. Keep tiktok-paid for ad-attributed only.
              landing_site: '/',
              referring_site: 'https://www.tiktok.com/@creator/video/123',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    const byId = new Map(out.map((o) => [o.orderId, o.source]));
    expect(byId.get('tt-clickid')).toBe('tiktok-paid');
    expect(byId.get('tt-source-name')).toBe('tiktok-paid');
    expect(byId.get('tt-utm-cpc')).toBe('tiktok-paid');
    expect(byId.get('tt-utm-no-medium')).toBe('tiktok-paid');
    // Organic referrer falls under other-referral, NOT tiktok-paid.
    expect(byId.get('tt-organic-referral')).toBe('other-referral');
  });

  it('Orders Test 4: drops test=true and financial_status=voided orders', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'real',
              current_total_price: '100',
              test: false,
              financial_status: 'paid',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'test',
              current_total_price: '99',
              test: true, // Shopify test mode
              financial_status: 'paid',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
            {
              id: 'voided',
              current_total_price: '88',
              test: false,
              financial_status: 'voided',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    expect(out).toHaveLength(1);
    expect(out[0].orderId).toBe('real');
  });

  it('Orders Test 5: lineItems carries {p,u,r} per item with product_id, dropping items without product_id', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'O-li',
              current_total_price: '100.00', // store-level total (incl. tax/shipping)
              test: false,
              financial_status: 'paid',
              landing_site: '/',
              referring_site: '',
              note_attributes: [],
              source_name: 'web',
              line_items: [
                // Two real products; proportional split allocates the $100 total
                // across ALL lines (incl. the custom one — Apps Script
                // Shopify.gs:863 computes subtotal BEFORE the product_id
                // filter), so subtotal = 40+40+10 = 90; A gets (40/90)×100 ≈ 44.44.
                { product_id: 'A', price: '40.00', quantity: 1 }, // gross 40
                { product_id: 'B', price: '20.00', quantity: 2 }, // gross 40
                // Custom item with null product_id — contributes to subtotal but
                // is dropped from the output (Guard 1, Apps Script Shopify.gs:878).
                { product_id: null, price: '10.00', quantity: 1 },
              ],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    expect(out[0].lineItems).toEqual([
      { p: 'A', u: 1, r: 44.44 },
      { p: 'B', u: 2, r: 44.44 },
    ]);
  });

  it('Orders Test 6: note_attributes _fbc → fbclidPresent=true and meta-paid', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          orders: [
            {
              id: 'O-fbc',
              current_total_price: '25.00',
              test: false,
              financial_status: 'paid',
              landing_site: '/products/x',
              referring_site: '',
              note_attributes: [{ name: '_fbc', value: 'fb.1.123.AbC' }],
              source_name: 'web',
              line_items: [],
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const out = await fetchShopifyOrdersAttribution(STORE_ID, DATE_STR);
    expect(out[0].source).toBe('meta-paid');
    expect(out[0].fbclidPresent).toBe(true);
  });
});
