/**
 * Phase 3 — fetchShopifyOrdersAttribution must carry customer + created_at.
 *
 * The ATTRIBUTION fetch (shopify.ts:1011) already pulls every order daily;
 * Phase 3 adds `customer` (read o.customer?.id → customerId) and `created_at`
 * (read o.created_at → createdAt) to the field allowlist (shopify.ts:1019,
 * NOT the revenue/refund allowlist at :404). Guest checkouts have no
 * customer object → customerId must be null (NOT '').
 *
 * Privacy: only the opaque numeric customer.id is read — never name/email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';

vi.mock('@/lib/fetchers/shopifyAuth', () => ({
  getShopifyAccessToken: vi.fn().mockResolvedValue('shpat_TESTTOKEN'),
  invalidateShopifyToken: vi.fn(),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
  process.env.UZOSHOP_SHOPIFY_DOMAIN = 'test.myshopify.com';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.UZOSHOP_SHOPIFY_DOMAIN;
});

function mockOrdersResponse(orders: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ orders }),
    headers: { get: (_: string) => null },
  } as unknown as Response;
}

const ORDER_WITH_CUSTOMER = {
  id: 'order-100',
  total_price: '80.00',
  current_total_price: '80.00',
  financial_status: 'paid',
  test: false,
  created_at: '2026-05-01T09:30:00-04:00',
  customer: { id: 778899 },
  note_attributes: [],
  source_name: 'web',
  line_items: [{ product_id: 'p-1', quantity: 1, price: '80.00' }],
};

const GUEST_ORDER = {
  id: 'order-200',
  total_price: '40.00',
  current_total_price: '40.00',
  financial_status: 'paid',
  test: false,
  created_at: '2026-05-01T11:00:00-04:00',
  // no `customer` key — guest checkout
  note_attributes: [],
  source_name: 'web',
  line_items: [{ product_id: 'p-2', quantity: 1, price: '40.00' }],
};

describe('fetchShopifyOrdersAttribution — customer + created_at', () => {
  it('requests customer,created_at in the field allowlist', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([ORDER_WITH_CUSTOMER]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('customer');
    expect(url).toContain('created_at');
  });

  it('maps o.customer.id → customerId and o.created_at → createdAt', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([ORDER_WITH_CUSTOMER])) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe('778899');
    expect(rows[0].createdAt).toBe('2026-05-01T09:30:00-04:00');
  });

  it('guest checkout (no customer object) → customerId null, createdAt preserved', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockOrdersResponse([GUEST_ORDER])) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBeNull();
    expect(rows[0].createdAt).toBe('2026-05-01T11:00:00-04:00');
  });
});
