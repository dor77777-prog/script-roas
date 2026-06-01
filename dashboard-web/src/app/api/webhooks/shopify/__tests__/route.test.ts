import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import * as storeMod from '@/lib/webhooks/store';

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Route test. We mock ONLY the DB boundary (lookupStoreByShopDomain +
// insertStoreEvent) and inject a deterministic FX fetcher via the payload path
// (normalizeOrderEvent's default would hit Frankfurter — but the route's CAD
// conversion goes through getFxRate; to keep the suite hermetic we use a CAD
// amount which short-circuits the FX call). verifyShopifyHmac, topicToType and
// normalizeOrderEvent run for real so we exercise the real raw-body→HMAC path.
// ---------------------------------------------------------------------------

const SECRET = 'shpss_route_secret';
const SHOP = 'uzoshop.myshopify.com';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function makeReq(opts: {
  body: string;
  shop?: string | null;
  topic?: string | null;
  webhookId?: string | null;
  sig?: string | null;
}): Request {
  const headers = new Headers();
  if (opts.shop !== null && opts.shop !== undefined) headers.set('x-shopify-shop-domain', opts.shop);
  if (opts.topic !== null && opts.topic !== undefined) headers.set('x-shopify-topic', opts.topic);
  if (opts.webhookId !== null && opts.webhookId !== undefined)
    headers.set('x-shopify-webhook-id', opts.webhookId);
  if (opts.sig !== null && opts.sig !== undefined) headers.set('x-shopify-hmac-sha256', opts.sig);
  return new Request('https://example.com/api/webhooks/shopify', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

// A CAD order body — currency 'CAD' makes makeCadConvert short-circuit the FX
// call, so the route test never touches Frankfurter.
const orderBody = JSON.stringify({
  id: 555,
  total_price: '50.00',
  currency: 'CAD',
  created_at: '2026-06-01T10:00:00Z',
  customer: { first_name: 'Avi', last_name: 'Cohen', email: 'avi@example.com' },
  line_items: [{ title: 'Blue Widget', quantity: 2 }],
});

let lookupSpy: ReturnType<typeof makeLookupSpy>;
let insertSpy: ReturnType<typeof makeInsertSpy>;

function makeLookupSpy() {
  return vi
    .spyOn(storeMod, 'lookupStoreByShopDomain')
    .mockResolvedValue({ store_id: 'uzoshop', signing_secret: SECRET, enabled: true });
}
function makeInsertSpy() {
  return vi.spyOn(storeMod, 'insertStoreEvent').mockResolvedValue(undefined);
}

beforeEach(() => {
  lookupSpy = makeLookupSpy();
  insertSpy = makeInsertSpy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/shopify', () => {
  it('valid signature + known shop + surfaced topic → 200 and inserts', async () => {
    const res = await POST(
      makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-1', sig: sign(orderBody) }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const arg = insertSpy.mock.calls[0][0];
    expect(arg.store_id).toBe('uzoshop');
    expect(arg.type).toBe('sale');
    expect(arg.dedupe_key).toBe('webhook:wh-1');
    // PII masking enforced end-to-end:
    expect(arg.customer_label).toBe('A׳ C׳');
    expect(JSON.stringify(arg)).not.toContain('avi@example.com');
    expect(JSON.stringify(arg)).not.toContain('Cohen');
  });

  it('bad signature → 401 and no insert', async () => {
    const res = await POST(
      makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-1', sig: 'AAAA' }),
    );
    expect(res.status).toBe(401);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('unknown shop → 200 ack and no insert (HMAC never checked)', async () => {
    lookupSpy.mockResolvedValue(null);
    const res = await POST(
      makeReq({ body: orderBody, shop: 'nope.myshopify.com', topic: 'orders/create', webhookId: 'wh-1', sig: sign(orderBody) }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('disabled shop → 200 ack and no insert', async () => {
    lookupSpy.mockResolvedValue({ store_id: 'uzoshop', signing_secret: SECRET, enabled: false });
    const res = await POST(
      makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-1', sig: sign(orderBody) }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('non-surfaced topic → 200 and no insert (signature still valid)', async () => {
    const res = await POST(
      makeReq({ body: orderBody, shop: SHOP, topic: 'orders/updated', webhookId: 'wh-1', sig: sign(orderBody) }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('missing required headers → 200 ack+drop, no DB lookup', async () => {
    const res = await POST(makeReq({ body: orderBody, shop: null, topic: 'orders/create', webhookId: 'wh-1', sig: sign(orderBody) }));
    expect(res.status).toBe(200);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('insert throwing (DB blip) → STILL 200 ack, not 500 (no Shopify retry-storm)', async () => {
    // A valid, signature-passing webhook whose DB insert throws must NOT surface
    // a 500 — that would make Shopify retry the same delivery for ~48h. (Review #1.)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertSpy.mockRejectedValue(new Error('insertStoreEvent failed: transient'));
    const res = await POST(
      makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-throw', sig: sign(orderBody) }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('idempotent: same webhook delivered twice → insert called per-delivery with the same dedupe_key', async () => {
    const req1 = makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-dup', sig: sign(orderBody) });
    const req2 = makeReq({ body: orderBody, shop: SHOP, topic: 'orders/create', webhookId: 'wh-dup', sig: sign(orderBody) });
    await POST(req1);
    await POST(req2);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    const k1 = insertSpy.mock.calls[0][0].dedupe_key;
    const k2 = insertSpy.mock.calls[1][0].dedupe_key;
    expect(k1).toBe('webhook:wh-dup');
    expect(k2).toBe(k1); // dedupe at the DB layer collapses these to one row
  });
});
