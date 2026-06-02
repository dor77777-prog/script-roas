/**
 * P0-2 regression — orders_attribution.totalCad MUST use immutable
 * `total_price`, NOT `current_total_price`.
 *
 * Bug (audit-2026-05-27-data-consistency A4-02/A4-03):
 *   `fetchShopifyOrdersAttribution` was deriving `totalCad` from
 *   `current_total_price`, which mutates downward as refunds post.
 *   For uzoshop May 1-10 this produced ~$7,250 vs ~$72,275 expected
 *   (≈10:1 undercount).
 *
 * Fix: use `total_price` (immutable, set at order creation per Shopify
 * Admin REST invariant documented in shopify.ts:17-26 and Invariant 1).
 *
 * This test feeds a mock Shopify order where the two fields diverge
 * (total_price="100.00" vs current_total_price="40.00" after a refund)
 * and asserts the resulting row's `totalCad` equals 100 (total_price)
 * not 40 (current_total_price).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Response that returns the given orders and
// no Link header (single-page).
// ---------------------------------------------------------------------------
function mockOrdersResponse(orders: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ orders }),
    headers: {
      get: (_: string) => null, // no Link header → single page
    },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Fixture: order where total_price and current_total_price diverge.
// A refund of $60 was applied after the order was placed, dropping
// current_total_price from $100 to $40.
// ---------------------------------------------------------------------------
const MOCK_ORDER_WITH_REFUND = {
  id: 'order-001',
  total_price: '100.00',          // immutable — set at order creation
  current_total_price: '40.00',   // mutated down by a $60 refund
  financial_status: 'partially_refunded',
  test: false,
  landing_site: '/',
  referring_site: '',
  note_attributes: [],
  source_name: 'web',
  line_items: [
    { product_id: 'prod-1', quantity: 2, price: '50.00' },
  ],
};

describe('fetchShopifyOrdersAttribution — P0-2 immutable totalCad', () => {
  it('totalCad derives from total_price (100), NOT current_total_price (40)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockOrdersResponse([MOCK_ORDER_WITH_REFUND]),
    ) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    const row = rows[0];

    // P0-2 assertion: must be 100 (total_price), not 40 (current_total_price)
    expect(row.totalCad).toBe(100);
    expect(row.orderId).toBe('order-001');
    expect(row.storeId).toBe('uzoshop');
    expect(row.date).toBe('2026-05-01');
  });

  it('lineItems proportional split is computed against total_price (100)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockOrdersResponse([MOCK_ORDER_WITH_REFUND]),
    ) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');

    expect(rows).toHaveLength(1);
    const row = rows[0];

    // lineItems CAD sum must equal total_price (100), not current_total_price (40)
    const lineSum = (row.lineItems ?? []).reduce((s, li) => s + li.r, 0);
    expect(lineSum).toBeCloseTo(100, 2);
  });

  it('voided orders are still excluded regardless of total_price field used', async () => {
    const voidedOrder = {
      ...MOCK_ORDER_WITH_REFUND,
      id: 'order-voided',
      financial_status: 'voided',
    };

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockOrdersResponse([voidedOrder]),
    ) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');
    expect(rows).toHaveLength(0);
  });

  it('test orders are still excluded regardless of total_price field used', async () => {
    const testOrder = {
      ...MOCK_ORDER_WITH_REFUND,
      id: 'order-test',
      test: true,
    };

    global.fetch = vi.fn().mockResolvedValueOnce(
      mockOrdersResponse([testOrder]),
    ) as unknown as typeof fetch;

    const rows = await fetchShopifyOrdersAttribution('uzoshop', '2026-05-01');
    expect(rows).toHaveLength(0);
  });
});
