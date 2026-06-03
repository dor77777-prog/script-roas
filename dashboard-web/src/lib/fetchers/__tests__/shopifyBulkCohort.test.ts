/**
 * Wave 2 — Shopify Bulk-Operations cohort export helper.
 *
 * Unit-tests the PURE NDJSON parser (no network): given the Bulk export lines
 * {id, createdAt, customer:{id}, currentTotalPriceSet, totalRefundedSet}, map
 * each order to { orderId, createdAt, customerId, grossNative, refundNative,
 * currency } with gid tails normalized. Guest lines (no customer) → null
 * customerId. CAD conversion + ledger join happen in the seed runner, not here.
 *
 * Privacy: only customer.id (opaque) is read — never name/email/phone.
 */
import { describe, it, expect } from 'vitest';
import { parseBulkCohortNdjson } from '@/lib/fetchers/shopifyBulkCohort';

const ndjson = [
  JSON.stringify({ id:'gid://shopify/Order/10', createdAt:'2025-07-05T10:00:00Z', customer:{id:'gid://shopify/Customer/1'}, currentTotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'10.00'}} }),
  JSON.stringify({ id:'gid://shopify/Order/11', createdAt:'2025-07-06T10:00:00Z', customer:null, currentTotalPriceSet:{shopMoney:{amount:'40.00',currencyCode:'CAD'}}, totalRefundedSet:{shopMoney:{amount:'0'}} }),
].join('\n');

describe('parseBulkCohortNdjson', () => {
  it('maps id/createdAt/customer + gross + refund + currency (gid tails)', () => {
    const rows = parseBulkCohortNdjson(ndjson);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderId:'10', createdAt:'2025-07-05T10:00:00Z', customerId:'1', grossNative:100, refundNative:10, currency:'CAD' });
    expect(rows[1].customerId).toBeNull();
  });
});
