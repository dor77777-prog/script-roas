import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as storeMod from '@/lib/webhooks/store';

import { POST, OPTIONS } from '../route';

// ---------------------------------------------------------------------------
// Cart-endpoint route test. We mock ONLY the DB boundary (lookupStoreByCartToken
// + insertStoreEvent). The route's CORS + auth + normalization logic runs for
// real. This endpoint is browser-called cross-origin → every response (success
// AND every drop/error path) must carry the CORS headers, or the browser drops
// the response and the storefront console fills with CORS errors.
// ---------------------------------------------------------------------------

const TOKEN = 'tok_cart_123';
const ORIGIN = 'https://uzoshop.com';

function makeReq(opts: {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
}): Request {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  if (opts.origin !== null && opts.origin !== undefined) headers.set('origin', opts.origin);
  const body =
    opts.rawBody !== undefined ? opts.rawBody : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  return new Request('https://example.com/api/events/cart', {
    method: 'POST',
    headers,
    body,
  });
}

let lookupSpy: ReturnType<typeof makeLookupSpy>;
let insertSpy: ReturnType<typeof makeInsertSpy>;

function makeLookupSpy() {
  return vi.spyOn(storeMod, 'lookupStoreByCartToken').mockResolvedValue({
    store_id: 'uzoshop',
    allowed_origins: [ORIGIN],
    enabled: true,
  });
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

describe('OPTIONS /api/events/cart (CORS preflight)', () => {
  it('responds 204 with the CORS preflight headers echoing the request Origin', async () => {
    const req = new Request('https://example.com/api/events/cart', {
      method: 'OPTIONS',
      headers: new Headers({ origin: ORIGIN }),
    });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('falls back to * when no Origin header is present', async () => {
    const req = new Request('https://example.com/api/events/cart', { method: 'OPTIONS' });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('POST /api/events/cart', () => {
  it('valid token + event_id + allowed origin → inserts add_to_cart + 204 + CORS header present', async () => {
    const res = await POST(
      makeReq({
        body: {
          store_token: TOKEN,
          product_title: 'Blue Widget',
          quantity: 2,
          event_id: 'evt-1',
          occurred_at: '2026-06-01T10:00:00Z',
        },
        origin: ORIGIN,
      }),
    );
    expect(res.status).toBe(204);
    // CORS present on the success path too.
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const arg = insertSpy.mock.calls[0][0];
    expect(arg.store_id).toBe('uzoshop');
    expect(arg.type).toBe('add_to_cart');
    // MT-0 (2026-06-11): store-scoped — eventId is client-generated, so an
    // unprefixed key let two stores' identical ids collide on the global
    // UNIQUE (second event silently dropped, cross-store poisonable).
    expect(arg.dedupe_key).toBe('cart:uzoshop:evt-1');
    expect(arg.product_title).toBe('Blue Widget');
    expect(arg.quantity).toBe(2);
    expect(arg.amount_cad).toBeNull();
    expect(arg.currency).toBeNull();
    expect(arg.amount_original).toBeNull();
    expect(arg.customer_label).toBeNull();
    expect(arg.occurred_at).toBe('2026-06-01T10:00:00Z');
  });

  it('raw contains no PII — display-safe fields + PII-free diag probe', async () => {
    await POST(
      makeReq({
        body: { store_token: TOKEN, product_title: 'Blue Widget', quantity: 2, event_id: 'evt-pii' },
        origin: ORIGIN,
      }),
    );
    const arg = insertSpy.mock.calls[0][0];
    // No landing_site / first_touch sent → diag is all-empty (PII-free: marketing
    // labels + length + first-click booleans only; permanent diagnostic, see
    // route.ts). No raw landing/referrer/PII. first_touch_source null (no signal).
    expect(arg.raw).toEqual({
      product_title: 'Blue Widget',
      quantity: 2,
      event_id: 'evt-pii',
      first_touch_source: null,
      // PPJ-T1: no product_id sent → normalized to null (still keyed in raw).
      product_id: null,
      diag: {
        utmSource: null,
        utmMedium: null,
        fbclid: false,
        gclid: false,
        landingLen: 0,
        firstTouch: null,
        firstFbclid: false,
        firstGclid: false,
        firstTtclid: false,
      },
    });
  });

  it('missing event_id → 204 ack+drop, no insert, CORS present', async () => {
    const res = await POST(
      makeReq({ body: { store_token: TOKEN, product_title: 'X' }, origin: ORIGIN }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('missing store_token → 204 ack+drop, no insert, no lookup', async () => {
    const res = await POST(makeReq({ body: { event_id: 'evt-x' }, origin: ORIGIN }));
    expect(res.status).toBe(204);
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('unparseable JSON → 204 ack+drop, no insert', async () => {
    const res = await POST(makeReq({ rawBody: '{not json', origin: ORIGIN }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('unknown token → 204 ack+drop, no insert', async () => {
    lookupSpy.mockResolvedValue(null);
    const res = await POST(
      makeReq({ body: { store_token: 'tok_bad', event_id: 'evt-2' }, origin: ORIGIN }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('disabled store → 204 ack+drop, no insert', async () => {
    lookupSpy.mockResolvedValue({ store_id: 'uzoshop', allowed_origins: [ORIGIN], enabled: false });
    const res = await POST(
      makeReq({ body: { store_token: TOKEN, event_id: 'evt-3' }, origin: ORIGIN }),
    );
    expect(res.status).toBe(204);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('bad origin (allowlist non-empty, origin NOT in it) → 204 drop, no insert', async () => {
    const res = await POST(
      makeReq({ body: { store_token: TOKEN, event_id: 'evt-4' }, origin: 'https://evil.example.com' }),
    );
    expect(res.status).toBe(204);
    // CORS still echoes the (rejected) origin so the browser doesn't surface a CORS error.
    expect(res.headers.get('access-control-allow-origin')).toBe('https://evil.example.com');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('origin absent → allowed (token is primary auth; Custom Pixel Origin is unreliable)', async () => {
    const res = await POST(makeReq({ body: { store_token: TOKEN, event_id: 'evt-5' }, origin: null }));
    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('literal "Origin: null" (sandboxed Web Pixel) → allowed even with a non-empty allowlist', async () => {
    // A Shopify Custom Pixel iframe sends the LITERAL string "null", not an
    // absent header. With allowed_origins configured this MUST still insert
    // (opaque origin → token-primary), else the pixel stores silently drop.
    const res = await POST(makeReq({ body: { store_token: TOKEN, event_id: 'evt-5b' }, origin: 'null' }));
    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('allowed origin with a trailing slash in config still matches (normalized)', async () => {
    lookupSpy.mockResolvedValue({ store_id: 'uzoshop', allowed_origins: ['https://uzoshop.com/'], enabled: true });
    const res = await POST(makeReq({ body: { store_token: TOKEN, event_id: 'evt-5c' }, origin: ORIGIN }));
    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('allowed_origins empty → any origin allowed (token is primary auth)', async () => {
    lookupSpy.mockResolvedValue({ store_id: 'uzoshop', allowed_origins: [], enabled: true });
    const res = await POST(
      makeReq({ body: { store_token: TOKEN, event_id: 'evt-6' }, origin: 'https://anything.example.com' }),
    );
    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('dedup: same event_id twice → same dedupe_key (DB collapses to one row)', async () => {
    await POST(makeReq({ body: { store_token: TOKEN, event_id: 'evt-dup' }, origin: ORIGIN }));
    await POST(makeReq({ body: { store_token: TOKEN, event_id: 'evt-dup' }, origin: ORIGIN }));
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0].dedupe_key).toBe('cart:uzoshop:evt-dup');
    expect(insertSpy.mock.calls[1][0].dedupe_key).toBe('cart:uzoshop:evt-dup');
  });

  it('insert throwing (DB blip) → STILL 204 (never block the storefront), CORS present', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertSpy.mockRejectedValue(new Error('insertStoreEvent failed: transient'));
    const res = await POST(
      makeReq({ body: { store_token: TOKEN, event_id: 'evt-throw' }, origin: ORIGIN }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    errSpy.mockRestore();
  });

  it('invalid occurred_at → falls back to a valid ISO now (not the garbage value)', async () => {
    await POST(
      makeReq({
        body: { store_token: TOKEN, event_id: 'evt-iso', occurred_at: 'not-a-date' },
        origin: ORIGIN,
      }),
    );
    const arg = insertSpy.mock.calls[0][0];
    expect(arg.occurred_at).not.toBe('not-a-date');
    expect(Number.isNaN(Date.parse(arg.occurred_at))).toBe(false);
  });

  it('non-finite quantity → null; over-long product_title → trimmed to ~200 chars', async () => {
    const longTitle = 'x'.repeat(500);
    await POST(
      makeReq({
        body: { store_token: TOKEN, event_id: 'evt-coerce', quantity: 'NaN', product_title: longTitle },
        origin: ORIGIN,
      }),
    );
    const arg = insertSpy.mock.calls[0][0];
    expect(arg.quantity).toBeNull();
    expect(arg.product_title!.length).toBeLessThanOrEqual(200);
  });
});
