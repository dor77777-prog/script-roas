import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('events/cart — source', () => {
  it('classifies TikTok from first-touch ttclid in landing_site', async () => {
    await post({ store_token: 't', event_id: 'e1', product_title: 'P', quantity: 1, landing_site: '/?ttclid=zzz' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].source).toBe('tiktok-paid');
  });
  it('classifies Meta from fbclid', async () => {
    await post({ store_token: 't', event_id: 'e2', product_title: 'P', quantity: 1, landing_site: '/?fbclid=abc' });
    expect(inserted[0].source).toBe('meta-paid');
  });
  it('no attribution → direct', async () => {
    await post({ store_token: 't', event_id: 'e3', product_title: 'P', quantity: 1 });
    expect(inserted[0].source).toBe('direct');
  });
  it('coerces a non-string landing_site to direct (low-trust input guard)', async () => {
    await post({ store_token: 't', event_id: 'e4', product_title: 'P', quantity: 1, landing_site: 12345 });
    expect(inserted[0].source).toBe('direct');
  });
  it('classifies meta-organic from a facebook referring_site', async () => {
    await post({ store_token: 't', event_id: 'e5', product_title: 'P', quantity: 1, referring_site: 'https://www.facebook.com/' });
    expect(inserted[0].source).toBe('meta-organic');
  });
});
