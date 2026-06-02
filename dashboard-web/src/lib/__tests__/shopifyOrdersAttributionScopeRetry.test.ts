/**
 * 2026-06-03 incident regression — fetchShopifyOrdersAttribution must
 * SELF-HEAL a stale-scope cached token instead of throwing.
 *
 * Root cause: shopifyAuth caches the OAuth token at module scope for ~24h.
 * After the operator added the `read_customers` scope, warm Vercel/Inngest
 * instances kept serving a pre-grant token, so requesting the `customer`
 * field returned 400 "Access denied for customer field. Required access:
 * read_customers". The throw made cron-live skip the entire
 * orders_attribution write → new orders went unclassified for up to 24h.
 *
 * Fix: on a scope/auth error, invalidate the cached token, re-exchange, and
 * retry the SAME page once. The re-exchange carries the new scope, so the
 * pipeline recovers within a single cron tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';
import {
  getShopifyAccessToken,
  invalidateShopifyToken,
} from '@/lib/fetchers/shopifyAuth';

vi.mock('@/lib/fetchers/shopifyAuth', () => ({
  getShopifyAccessToken: vi.fn(),
  invalidateShopifyToken: vi.fn(),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
  vi.mocked(getShopifyAccessToken).mockReset();
  vi.mocked(invalidateShopifyToken).mockReset();
  process.env.UZOSHOP_SHOPIFY_DOMAIN = 'test.myshopify.com';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.UZOSHOP_SHOPIFY_DOMAIN;
});

const ORDER = {
  id: 'order-1',
  total_price: '52.45',
  financial_status: 'paid',
  test: false,
  created_at: '2026-06-03T00:10:19+03:00',
  customer: { id: 901234 },
  note_attributes: [],
  source_name: 'web',
  line_items: [{ product_id: 'p-1', quantity: 1, price: '52.45' }],
};

function okResponse(orders: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ orders }),
    headers: { get: (_: string) => null },
  } as unknown as Response;
}

function scopeErrorResponse(): Response {
  return {
    ok: false,
    status: 400,
    text: async () =>
      'Access denied for customer field. Required access: read_customers',
    headers: { get: (_: string) => null },
  } as unknown as Response;
}

function badParamResponse(): Response {
  return {
    ok: false,
    status: 400,
    text: async () => 'created_at_min is not a valid date',
    headers: { get: (_: string) => null },
  } as unknown as Response;
}

describe('fetchShopifyOrdersAttribution — stale-scope token self-heal', () => {
  it('400 read_customers scope error → invalidate token, re-exchange, retry once, recover', async () => {
    vi.mocked(getShopifyAccessToken)
      .mockResolvedValueOnce('stale_token') // initial getShopifyCreds
      .mockResolvedValueOnce('fresh_token'); // after invalidate

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(scopeErrorResponse()) // page 1: stale token → 400
      .mockResolvedValueOnce(okResponse([ORDER])); // retry: fresh token → 200
    global.fetch = fetchSpy as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-06-03');

    expect(invalidateShopifyToken).toHaveBeenCalledTimes(1);
    expect(invalidateShopifyToken).toHaveBeenCalledWith('uzoshop');
    expect(getShopifyAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // the retry must carry the FRESH token
    expect(fetchSpy.mock.calls[1][1].headers['X-Shopify-Access-Token']).toBe(
      'fresh_token',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe('901234');
    expect(rows[0].createdAt).toBe('2026-06-03T00:10:19+03:00');
  });

  it('scope error STILL failing after one retry → throws (no infinite loop)', async () => {
    vi.mocked(getShopifyAccessToken).mockResolvedValue('any_token');
    global.fetch = vi
      .fn()
      .mockResolvedValue(scopeErrorResponse()) as unknown as typeof fetch;

    await expect(
      fetchShopifyOrdersAttribution('uzoshop', '2026-06-03'),
    ).rejects.toThrow(/read_customers|400/);
    // invalidated exactly once, not in a loop
    expect(invalidateShopifyToken).toHaveBeenCalledTimes(1);
  });

  it('non-scope 400 (bad params) → does NOT invalidate, throws immediately', async () => {
    vi.mocked(getShopifyAccessToken).mockResolvedValue('any_token');
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(badParamResponse());
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      fetchShopifyOrdersAttribution('uzoshop', '2026-06-03'),
    ).rejects.toThrow(/400/);
    expect(invalidateShopifyToken).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
