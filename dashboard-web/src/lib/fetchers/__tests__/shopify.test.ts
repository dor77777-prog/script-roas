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
import { fetchShopifyDayRows } from '../shopify';

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
  vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
  vi.stubEnv('UZOSHOP_SHOPIFY_TOKEN', 'shpat_test_TOKEN');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ===========================================================================

describe('shopify fetcher — fetchShopifyDayRows', () => {
  it('Test 1: calls Shopify Admin REST 2024-10 with correct day-boundary window (Asia/Jerusalem)', async () => {
    const { fn, calls } = makeFetchMock([{ body: { orders: [] } }, { body: { orders: [] } }]);
    vi.stubGlobal('fetch', fn);

    await fetchShopifyDayRows(STORE_ID, DATE_STR);

    // At least one call must hit the orders.json endpoint with API version 2024-10
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const apiCall = calls.find((c) => c.url.includes('/admin/api/2024-10/orders.json'));
    expect(apiCall, 'expected at least one /admin/api/2024-10/orders.json call').toBeDefined();

    // The lower bound of the window must be 2026-05-19 local midnight in Asia/Jerusalem.
    // Asia/Jerusalem in May is IDT (UTC+3) → 2026-05-19T00:00:00+03:00.
    const createdAtMin = decodeURIComponent(
      /created_at_min=([^&]+)/.exec(apiCall!.url)?.[1] ?? '',
    );
    expect(createdAtMin.startsWith('2026-05-19T00:00:00')).toBe(true);

    // The upper bound must be next-day local midnight (2026-05-20T00:00:00+03:00).
    const createdAtMax = decodeURIComponent(
      /created_at_max=([^&]+)/.exec(apiCall!.url)?.[1] ?? '',
    );
    expect(createdAtMax.startsWith('2026-05-20T00:00:00')).toBe(true);

    // Auth header — X-Shopify-Access-Token (NOT Bearer)
    const headers = apiCall!.init?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Shopify-Access-Token']).toBe('shpat_test_TOKEN');
  });

  it('Test 2: Link header rel="next" triggers a second fetch to that URL', async () => {
    const nextUrl =
      'https://uzoshop.myshopify.com/admin/api/2024-10/orders.json?limit=250&page_info=NEXT_PAGE_TOKEN';
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
    const everPagingLink = `<https://uzoshop.myshopify.com/admin/api/2024-10/orders.json?page_info=KEEP_GOING>; rel="next"`;
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
        return { storeNetCad: 0, byProduct: {}, customItemRefundCad: 0 };
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

  it('Test 6: Missing {STORE}_SHOPIFY_DOMAIN or {STORE}_SHOPIFY_TOKEN env vars throws clear error including storeId', async () => {
    vi.unstubAllEnvs();
    // Re-stub the token only; domain missing
    vi.stubEnv('UZOSHOP_SHOPIFY_TOKEN', 'shpat_test_TOKEN');
    // Ensure domain is unset
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', '');

    const noopFetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', noopFetch);

    await expect(fetchShopifyDayRows(STORE_ID, DATE_STR)).rejects.toThrow(/uzoshop/i);

    // Also: missing token
    vi.unstubAllEnvs();
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
    vi.stubEnv('UZOSHOP_SHOPIFY_TOKEN', '');

    await expect(fetchShopifyDayRows(STORE_ID, DATE_STR)).rejects.toThrow(/uzoshop/i);
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
