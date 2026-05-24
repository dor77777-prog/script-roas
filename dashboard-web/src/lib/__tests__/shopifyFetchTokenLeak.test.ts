import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-10:
 * /api/debug/shopify-fetch tokenPrefix leak.
 *
 *   Original bug (API-10):
 *     route.ts:103 emitted `tokenPrefix: token.slice(0, 10) + '...'` in the
 *     JSON response body — leaking the Shopify API token scheme prefix
 *     (`shpat_`) PLUS the first 4 characters of the secret to any caller
 *     of /api/debug/shopify-fetch. Under the URL-obscurity trust model this
 *     is belt-and-suspenders — but any logged copy of the response
 *     (browser dev-tools, deploy logs, screenshots) preserved that prefix
 *     indefinitely.
 *
 *   12.3 fix:
 *     Replace `tokenPrefix: ...` with `hasToken: true`. Preserve `hasDomain`
 *     + `domainVal` (domain identifiers, not secrets).
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_debug_shopifyFetch.json (API-10 lines 7-16)
 */

describe('/api/debug/shopify-fetch — token leak (Phase 12.3 / API-10)', () => {
  const originalFetch = global.fetch;
  const originalDomain = process.env.UZOSHOP_SHOPIFY_DOMAIN;
  const originalToken = process.env.UZOSHOP_SHOPIFY_TOKEN;
  const originalDebugFlag = process.env.ENABLE_DEBUG_ROUTES;

  beforeEach(() => {
    vi.resetModules();
    // Phase 13.2 P1-02 — the route is now env-gated (returns 404 unless
    // ENABLE_DEBUG_ROUTES=1). Enable it for these regression tests since
    // they verify the response body content, not the gate itself.
    process.env.ENABLE_DEBUG_ROUTES = '1';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDomain === undefined) delete process.env.UZOSHOP_SHOPIFY_DOMAIN;
    else process.env.UZOSHOP_SHOPIFY_DOMAIN = originalDomain;
    if (originalToken === undefined) delete process.env.UZOSHOP_SHOPIFY_TOKEN;
    else process.env.UZOSHOP_SHOPIFY_TOKEN = originalToken;
    if (originalDebugFlag === undefined) delete process.env.ENABLE_DEBUG_ROUTES;
    else process.env.ENABLE_DEBUG_ROUTES = originalDebugFlag;
  });

  it('Test 1: response body MUST NOT contain `tokenPrefix` field or any `shpat_` substring', async () => {
    process.env.UZOSHOP_SHOPIFY_DOMAIN = 'example.myshopify.com';
    process.env.UZOSHOP_SHOPIFY_TOKEN = 'shpat_TESTTOKEN1234567890';

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ orders: [] }),
    }) as unknown as typeof fetch;

    const { GET } = await import('@/app/api/debug/shopify-fetch/route');
    const req = new Request(
      'http://localhost/api/debug/shopify-fetch?storeId=uzoshop&date=2026-05-22',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.tokenPrefix).toBeUndefined();
    expect(JSON.stringify(body).includes('shpat_')).toBe(false);
    expect(body.hasToken).toBe(true);
    expect(body.domain).toBe('example.myshopify.com');
    expect(body.response.ok).toBe(true);
  });

  it('Test 2: missing token still returns no `shpat_` substring in response body', async () => {
    process.env.UZOSHOP_SHOPIFY_DOMAIN = 'example.myshopify.com';
    delete process.env.UZOSHOP_SHOPIFY_TOKEN;

    const { GET } = await import('@/app/api/debug/shopify-fetch/route');
    const req = new Request(
      'http://localhost/api/debug/shopify-fetch?storeId=uzoshop&date=2026-05-22',
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.hasToken).toBe(false);
    expect(JSON.stringify(body).includes('shpat_')).toBe(false);
  });
});
