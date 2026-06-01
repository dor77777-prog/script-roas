import { describe, it, expect, vi } from 'vitest';
import {
  topicToType,
  normalizeOrderEvent,
  maskCustomerLabel,
} from '../normalizeShopifyEvent';

// ---------------------------------------------------------------------------
// FX: normalizeOrderEvent reuses the existing CAD-convert helper (makeCadConvert
// + getFxRate). We inject a deterministic rate fetcher in the tests so the suite
// never hits Frankfurter. The default (production) path is exercised separately
// at runtime; here we drive the injected `cadConvert` option directly.
// ---------------------------------------------------------------------------

const fxOk = vi.fn(async () => 1.4); // 1 unit foreign = 1.4 CAD
const fxFail = vi.fn(async () => {
  throw new Error('FX timeout');
});

describe('topicToType', () => {
  it("maps 'orders/create' → 'sale'", () => {
    expect(topicToType('orders/create')).toBe('sale');
  });
  it("maps 'refunds/create' → 'refund'", () => {
    expect(topicToType('refunds/create')).toBe('refund');
  });
  it('returns null for an unsurfaced topic', () => {
    expect(topicToType('orders/updated')).toBeNull();
    expect(topicToType('products/create')).toBeNull();
    expect(topicToType('')).toBeNull();
  });
});

describe('maskCustomerLabel', () => {
  it('produces initials from first + last name', () => {
    expect(maskCustomerLabel({ first_name: 'Avi', last_name: 'Cohen' })).toBe('A׳ C׳');
  });
  it('handles Hebrew names', () => {
    expect(maskCustomerLabel({ first_name: 'אבי', last_name: 'כהן' })).toBe('א׳ כ׳');
  });
  it('returns just one initial when only first name present', () => {
    expect(maskCustomerLabel({ first_name: 'Dana', last_name: '' })).toBe('D׳');
  });
  it('returns null when no name fields present', () => {
    expect(maskCustomerLabel(null)).toBeNull();
    expect(maskCustomerLabel({})).toBeNull();
    expect(maskCustomerLabel({ first_name: '', last_name: '' })).toBeNull();
  });
  it('NEVER returns the raw name', () => {
    const out = maskCustomerLabel({ first_name: 'Avi', last_name: 'Cohen' });
    expect(out).not.toContain('Avi');
    expect(out).not.toContain('Cohen');
  });
});

describe('normalizeOrderEvent — sale', () => {
  const salePayload = {
    id: 555,
    total_price: '50.00',
    currency: 'USD',
    created_at: '2026-06-01T10:00:00Z',
    customer: { first_name: 'Avi', last_name: 'Cohen', email: 'avi@example.com' },
    billing_address: { address1: '1 Secret St', city: 'TLV' },
    line_items: [
      { title: 'Blue Widget', quantity: 2 },
      { title: 'Red Widget', quantity: 1 },
    ],
  };

  it('maps the core fields', async () => {
    const ev = await normalizeOrderEvent('sale', salePayload, {
      storeId: 'uzoshop',
      webhookId: 'wh-1',
      cadConvert: fxOk,
    });
    expect(ev).not.toBeNull();
    expect(ev!.store_id).toBe('uzoshop');
    expect(ev!.type).toBe('sale');
    expect(ev!.amount_original).toBe(50);
    expect(ev!.currency).toBe('USD');
    expect(ev!.amount_cad).toBe(70); // 50 * 1.4
    expect(ev!.product_title).toBe('Blue Widget');
    expect(ev!.quantity).toBe(2);
    expect(ev!.occurred_at).toBe('2026-06-01T10:00:00Z');
    expect(ev!.dedupe_key).toBe('webhook:wh-1');
  });

  it('masks the customer label to initials (no raw PII)', async () => {
    const ev = await normalizeOrderEvent('sale', salePayload, {
      storeId: 'uzoshop',
      webhookId: 'wh-1',
      cadConvert: fxOk,
    });
    expect(ev!.customer_label).toBe('A׳ C׳');
  });

  it('NEVER leaks raw name/email/address into the event or its raw blob', async () => {
    const ev = await normalizeOrderEvent('sale', salePayload, {
      storeId: 'uzoshop',
      webhookId: 'wh-1',
      cadConvert: fxOk,
    });
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain('avi@example.com');
    expect(serialized).not.toContain('Avi');
    expect(serialized).not.toContain('Cohen');
    expect(serialized).not.toContain('Secret St');
    expect(serialized).not.toContain('TLV');
    // raw must only carry the non-PII allowlist
    expect(ev!.raw).toEqual({
      id: 555,
      total_price: '50.00',
      currency: 'USD',
      created_at: '2026-06-01T10:00:00Z',
      line_items: [
        { title: 'Blue Widget', quantity: 2 },
        { title: 'Red Widget', quantity: 1 },
      ],
    });
  });

  it('amount_cad is null when FX is unavailable, but original is preserved', async () => {
    const ev = await normalizeOrderEvent('sale', salePayload, {
      storeId: 'uzoshop',
      webhookId: 'wh-1',
      cadConvert: fxFail,
    });
    expect(ev!.amount_cad).toBeNull();
    expect(ev!.amount_original).toBe(50);
    expect(ev!.currency).toBe('USD');
  });

  it('returns null label when the order has no customer', async () => {
    const ev = await normalizeOrderEvent(
      'sale',
      { ...salePayload, customer: undefined },
      { storeId: 'uzoshop', webhookId: 'wh-2', cadConvert: fxOk },
    );
    expect(ev!.customer_label).toBeNull();
  });
});

describe('normalizeOrderEvent — refund', () => {
  const refundPayload = {
    id: 999,
    order_id: 555,
    created_at: '2026-06-01T12:00:00Z',
    refund_line_items: [
      {
        quantity: 1,
        subtotal: '25.00',
        line_item: { title: 'Blue Widget' },
      },
    ],
    transactions: [{ amount: '25.00', currency: 'USD' }],
  };

  it('produces a negative amount for a refund', async () => {
    const ev = await normalizeOrderEvent('refund', refundPayload, {
      storeId: 'zolplus',
      webhookId: 'wh-r1',
      cadConvert: fxOk,
    });
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('refund');
    expect(ev!.amount_original).toBe(-25);
    expect(ev!.amount_cad).toBe(-35); // -25 * 1.4
    expect(ev!.currency).toBe('USD');
    expect(ev!.product_title).toBe('Blue Widget');
    expect(ev!.quantity).toBe(1);
    expect(ev!.dedupe_key).toBe('webhook:wh-r1');
  });

  // Task A (Phase 3, 2026-06-01) — real refunds arrive with the FIRST
  // transaction lacking a currency. We must (a) scan ALL transactions for the
  // first available currency, then (b) — since all 3 stores are CAD and the
  // feed is display-only — fall back to treating a still-null currency as CAD
  // for `amount_cad` so a refund still shows a CAD figure.
  it('derives currency from a LATER transaction when transactions[0] lacks one', async () => {
    const ev = await normalizeOrderEvent(
      'refund',
      {
        id: 1001,
        order_id: 700,
        created_at: '2026-06-01T12:00:00Z',
        refund_line_items: [{ quantity: 1, subtotal: '40.00', line_item: { title: 'Salmon Set' } }],
        transactions: [
          { amount: '40.00' }, // no currency on the first txn
          { amount: '0.00', currency: 'USD' }, // a later txn carries it
        ],
      },
      { storeId: 'zolplus', webhookId: 'wh-r2', cadConvert: fxOk },
    );
    expect(ev!.currency).toBe('USD');
    expect(ev!.amount_original).toBe(-40);
    expect(ev!.amount_cad).toBe(-56); // -40 * 1.4
  });

  it('falls back to a CAD amount_cad when NO transaction carries a currency (display-only, all stores CAD)', async () => {
    const ev = await normalizeOrderEvent(
      'refund',
      {
        id: 1002,
        order_id: 701,
        created_at: '2026-06-01T13:00:00Z',
        refund_line_items: [{ quantity: 1, subtotal: '85.00', line_item: { title: 'Hair Serum' } }],
        transactions: [{ amount: '85.00' }], // currency entirely absent (the prod bug)
      },
      { storeId: 'uzoshop', webhookId: 'wh-r3', cadConvert: fxOk },
    );
    // currency stays null (we don't fabricate the presentment currency)…
    expect(ev!.currency).toBeNull();
    expect(ev!.amount_original).toBe(-85);
    // …but amount_cad falls back to the raw amount treated as CAD so the row
    // still shows a CAD figure instead of a bare "—".
    expect(ev!.amount_cad).toBe(-85);
  });

  it('does NOT call the FX fetcher for the CAD fallback (no Frankfurter round-trip)', async () => {
    const spy = vi.fn(async () => 1.4);
    await normalizeOrderEvent(
      'refund',
      {
        id: 1003,
        order_id: 702,
        created_at: '2026-06-01T14:00:00Z',
        refund_line_items: [{ quantity: 1, subtotal: '10.00', line_item: { title: 'X' } }],
        transactions: [{ amount: '10.00' }], // no currency
      },
      { storeId: 'uzoshop', webhookId: 'wh-r4', cadConvert: spy },
    );
    // The fallback treats the amount as already-CAD → no rate lookup.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('normalizeOrderEvent — occurred_at sanity (Review #6)', () => {
  it('falls back to a valid ISO when created_at is garbage (no bad timestamptz insert)', async () => {
    const ev = await normalizeOrderEvent(
      'sale',
      { id: 9, total_price: '10.00', currency: 'CAD', created_at: 'not-a-date', line_items: [] },
      { storeId: 's', webhookId: 'wh-bad-date', cadConvert: fxOk },
    );
    expect(ev).not.toBeNull();
    // occurred_at must be a parseable ISO timestamp, never the raw garbage.
    expect(ev!.occurred_at).not.toBe('not-a-date');
    expect(Number.isNaN(Date.parse(ev!.occurred_at))).toBe(false);
  });

  it('keeps a valid created_at verbatim', async () => {
    const ev = await normalizeOrderEvent(
      'sale',
      { id: 9, total_price: '10.00', currency: 'CAD', created_at: '2026-06-01T10:00:00Z', line_items: [] },
      { storeId: 's', webhookId: 'wh-ok-date', cadConvert: fxOk },
    );
    expect(ev!.occurred_at).toBe('2026-06-01T10:00:00Z');
  });
});
