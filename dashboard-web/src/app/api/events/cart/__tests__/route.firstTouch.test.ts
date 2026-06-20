import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Cart-endpoint FIRST-TOUCH test (classify-v2 T4b). The beacon now ALSO sends a
// `first_touch` bag (the storefront's `_ft_attr` localStorage value — a UTM/
// click-id query string captured on the first page-view). The route folds its
// params into the classifier as `_ft_*` note_attributes so the classifier's
// existing first-click chain computes `firstTouchSource`, then stores it in
// `raw.first_touch_source`. The last-touch `source` (landing_site/referring_site)
// must stay exactly as before, and the beacon must NEVER 5xx — a malformed
// first_touch is just omitted.
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

describe('events/cart — first-touch (_ft_attr → raw.first_touch_source)', () => {
  it('first_touch with ft_fbclid (query-string form) → raw.first_touch_source = meta-paid', async () => {
    const res = await post({
      store_token: 't',
      event_id: 'ft1',
      product_title: 'P',
      quantity: 1,
      first_touch: '?fbclid=abc123',
    });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.first_touch_source).toBe('meta-paid');
  });

  it('first_touch as a PARSED OBJECT (utm_source=tiktok) → raw.first_touch_source = tiktok-paid', async () => {
    await post({
      store_token: 't',
      event_id: 'ft2',
      product_title: 'P',
      quantity: 1,
      first_touch: { utm_source: 'tiktok', utm_medium: 'cpc' },
    });
    expect(inserted[0].raw.first_touch_source).toBe('tiktok-paid');
  });

  it('first_touch with a Google gclid → raw.first_touch_source = google-paid', async () => {
    await post({
      store_token: 't',
      event_id: 'ft3',
      product_title: 'P',
      quantity: 1,
      first_touch: '?gclid=zzz',
    });
    expect(inserted[0].raw.first_touch_source).toBe('google-paid');
  });

  it('NO first_touch → raw.first_touch_source is null (no regression)', async () => {
    await post({ store_token: 't', event_id: 'ft4', product_title: 'P', quantity: 1, landing_site: '/?fbclid=x' });
    expect(inserted[0].raw.first_touch_source).toBeNull();
    // last-touch source is unaffected — landing_site fbclid still → meta-paid.
    expect(inserted[0].source).toBe('meta-paid');
  });

  it('malformed first_touch (non-string, non-object) → event STILL recorded, no 5xx, first_touch_source null', async () => {
    const res = await post({
      store_token: 't',
      event_id: 'ft5',
      product_title: 'P',
      quantity: 1,
      first_touch: 12345,
    });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.first_touch_source).toBeNull();
  });

  it('first_touch as an invalid JSON string → omitted, event recorded, first_touch_source null', async () => {
    const res = await post({
      store_token: 't',
      event_id: 'ft6',
      product_title: 'P',
      quantity: 1,
      first_touch: '{not json',
    });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].raw.first_touch_source).toBeNull();
  });

  it('last-touch source classification is UNCHANGED — first_touch does not bleed into source', async () => {
    // last-touch direct (no landing tag), first-touch meta → source stays direct,
    // first_touch_source = meta-paid (the two lenses are independent).
    await post({
      store_token: 't',
      event_id: 'ft7',
      product_title: 'P',
      quantity: 1,
      first_touch: '?fbclid=abc',
    });
    expect(inserted[0].source).toBe('direct');
    expect(inserted[0].raw.first_touch_source).toBe('meta-paid');
  });

  // FIX B (#26) — the FIRST_TOUCH_KEYS allowlist must forward the Google
  // iOS/display click IDs gbraid/wbraid/dclid so they reach the classifier and
  // resolve to google-paid (mirroring gclid). Before the fix these keys were
  // dropped by the allowlist → first_touch_source was null.
  for (const key of ['gbraid', 'wbraid', 'dclid']) {
    it(`first_touch with ${key} → raw.first_touch_source = google-paid`, async () => {
      await post({
        store_token: 't',
        event_id: `ftg-${key}`,
        product_title: 'P',
        quantity: 1,
        first_touch: `?${key}=Cj0xyz`,
      });
      expect(inserted[0].raw.first_touch_source).toBe('google-paid');
    });
  }

  it('first_touch with only a non-mappable signal (ft_set_at only) → first_touch_source null', async () => {
    await post({
      store_token: 't',
      event_id: 'ft8',
      product_title: 'P',
      quantity: 1,
      first_touch: '?set_at=2026-06-07T00:00:00Z',
    });
    expect(inserted[0].raw.first_touch_source).toBeNull();
  });
});
