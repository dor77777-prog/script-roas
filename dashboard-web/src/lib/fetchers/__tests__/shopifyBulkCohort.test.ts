/**
 * Wave 2 — Shopify Bulk-Operations cohort export helper.
 *
 * Unit-tests the PURE NDJSON parser (no network): given the Bulk export lines
 * {id, createdAt, customer:{id}, totalPriceSet, totalRefundedSet}, map each
 * order to { orderId, createdAt, customerId, grossNative, refundNative,
 * currency } with gid tails normalized. Guest lines (no customer) → null
 * customerId. CAD conversion + ledger join happen in the seed runner, not here.
 *
 * INVARIANT #1 (shopifyRevenueRefunds.ts lines 13-18): store-level gross uses
 * the IMMUTABLE total (`totalPriceSet`, the GraphQL equivalent of REST
 * `total_price`), NOT `currentTotalPriceSet` (which is live and already nets
 * refunds applied so far). Asserting gross stays at the immutable total even
 * when a refund is posted guards against the net-of-refunds double-subtraction
 * downstream (Task 4: net = gross − refund).
 *
 * Privacy: only customer.id (opaque) is read — never name/email/phone.
 */
import { describe, it, expect } from 'vitest';
import { parseBulkCohortNdjson } from '@/lib/fetchers/shopifyBulkCohort';

const ndjson = [
  JSON.stringify({ id:'gid://shopify/Order/10', createdAt:'2025-07-05T10:00:00Z', customer:{id:'gid://shopify/Customer/1'}, totalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'10.00'}} }),
  JSON.stringify({ id:'gid://shopify/Order/11', createdAt:'2025-07-06T10:00:00Z', customer:null, totalPriceSet:{shopMoney:{amount:'40.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'0'}} }),
].join('\n');

describe('parseBulkCohortNdjson', () => {
  it('maps id/createdAt/customer + gross + refund + currency (gid tails)', () => {
    const rows = parseBulkCohortNdjson(ndjson);
    expect(rows).toHaveLength(2);
    // Invariant #1: grossNative is the IMMUTABLE total (100), refundNative the
    // separate refund leg (10) — NOT currentTotalPrice. Downstream net = 90.
    expect(rows[0]).toMatchObject({ orderId:'10', createdAt:'2025-07-05T10:00:00Z', customerId:'1', grossNative:100, refundNative:10, currency:'CAD' });
    expect(rows[1].customerId).toBeNull();
  });

  it('keeps gross at the immutable total when a refund is posted (Invariant #1)', () => {
    // A real refunded order: total stays 100 (immutable), currentTotalPrice
    // would be 90 (net) but is NOT read for gross. Gross MUST be 100 so the
    // downstream net = gross − refund = 90 (not 80 = double subtraction).
    const line = JSON.stringify({
      id: 'gid://shopify/Order/20',
      createdAt: '2025-08-01T10:00:00Z',
      customer: { id: 'gid://shopify/Customer/2' },
      totalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'CAD' } },
      currentTotalPriceSet: { shopMoney: { amount: '90.00', currencyCode: 'CAD' } },
      totalRefundedSet: { shopMoney: { amount: '10.00' } },
    });
    const [row] = parseBulkCohortNdjson(line);
    expect(row.grossNative).toBe(100); // immutable total, refund-unaffected
    expect(row.refundNative).toBe(10);
    expect(row.grossNative - row.refundNative).toBe(90); // net derived downstream
  });
});
