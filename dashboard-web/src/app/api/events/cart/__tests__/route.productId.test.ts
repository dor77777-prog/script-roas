import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Cart-endpoint PRODUCT-ID test (PPJ-T1). The ATC beacon now ALSO sends a
// `product_id` field (the Shopify Custom Pixel exposes the product id as a GID,
// e.g. `gid://shopify/Product/7654321`; the headless cart may send the bare
// numeric id). The route NORMALIZES it to the bare NUMERIC Shopify Product id
// so it matches `orders_attribution.line_items` productId (= `String(li.product_id)`
// — pure digits) and `products_daily.product_id` (= `String(p.id)` — pure digits),
// enabling an exact per-product ATC↔purchase join by id (not fragile title-match).
//
// It is stored in `raw.product_id` (NO new DB column). A missing / unparseable
// product_id is simply OMITTED (absent in raw) — the event is still recorded and
// the beacon never 5xxes. Last-touch `source` + first_touch behavior unchanged.
// ---------------------------------------------------------------------------

const inserted: any[] = [];
vi.mock('@/lib/webhooks/store', () => ({
  lookupStoreByCartToken: vi.fn(async () => ({ store_id: 'uzoshop', allowed_origins: [], enabled: true })),
  insertStoreEvent: vi.fn(async (e: any) => { inserted.push(e); }),
}));
beforeEach(() => { inserted.length = 0; vi.clearAllMocks(); });

async function post(body: unknown) {
  const { POST } = await import('@/app/api/events/cart/route');
  return POST(new Request('https://x/api/events/cart', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('events/cart — product_id (GID → numeric, raw.product_id)', () => {
  it('GID product_id → raw.product_id is the bare numeric tail', async () => {
    const res = await post({
      store_token: 't',
      event_id: 'p1',
      product_title: 'P',
      quantity: 1,
      product_id: 'gid://shopify/Product/7654321',
    });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.product_id).toBe('7654321');
  });

  it('already-numeric product_id (string) → stored as-is', async () => {
    await post({
      store_token: 't',
      event_id: 'p2',
      product_title: 'P',
      quantity: 1,
      product_id: '7654321',
    });
    expect(inserted[0].raw.product_id).toBe('7654321');
  });

  it('numeric product_id (number) → coerced to the digit string', async () => {
    await post({
      store_token: 't',
      event_id: 'p3',
      product_title: 'P',
      quantity: 1,
      product_id: 7654321,
    });
    expect(inserted[0].raw.product_id).toBe('7654321');
  });

  it('matches the line_items / products_daily id format (bare digits, no gid prefix)', async () => {
    await post({
      store_token: 't',
      event_id: 'p4',
      product_title: 'P',
      quantity: 1,
      product_id: 'gid://shopify/Product/9988776655',
    });
    const pid = inserted[0].raw.product_id;
    // line_items writer stores String(li.product_id); products_daily stores String(p.id) — both pure digits.
    expect(pid).toMatch(/^\d+$/);
    expect(pid).not.toContain('gid://');
  });

  it('missing product_id → raw.product_id absent (null), event STILL recorded, 204', async () => {
    const res = await post({ store_token: 't', event_id: 'p5', product_title: 'P', quantity: 1 });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.product_id ?? null).toBeNull();
  });

  it('junk product_id (no digits) → omitted (null), event STILL recorded, no 5xx', async () => {
    const res = await post({
      store_token: 't',
      event_id: 'p6',
      product_title: 'P',
      quantity: 1,
      product_id: 'not-an-id',
    });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.product_id ?? null).toBeNull();
  });

  it('product_id does not disturb last-touch source or first_touch behavior', async () => {
    await post({
      store_token: 't',
      event_id: 'p7',
      product_title: 'P',
      quantity: 1,
      product_id: 'gid://shopify/Product/123',
      landing_site: '/?fbclid=x',
      first_touch: '?gclid=zzz',
    });
    // last-touch from landing_site fbclid → meta-paid; first-touch gclid → google-paid.
    expect(inserted[0].source).toBe('meta-paid');
    expect(inserted[0].raw.first_touch_source).toBe('google-paid');
    // product id still captured alongside.
    expect(inserted[0].raw.product_id).toBe('123');
  });
});
