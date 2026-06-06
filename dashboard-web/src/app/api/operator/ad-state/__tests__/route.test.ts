import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ upserts: [] as unknown[], rows: [] as unknown[] }));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: store.rows, error: null }),
      upsert: (v: unknown) => { store.upserts.push(v); return Promise.resolve({ error: null }); },
    }),
  }),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { GET, POST } from '@/app/api/operator/ad-state/route';

beforeEach(() => { store.upserts = []; store.rows = []; });

describe('GET /api/operator/ad-state', () => {
  it('returns the ad-state map', async () => {
    store.rows = [{ store_id: 'zolplus', platform: 'meta', enabled: false }];
    const res = await GET();
    expect(await res.json()).toEqual({ map: { 'zolplus:meta': false } });
  });
});

describe('POST /api/operator/ad-state', () => {
  it('upserts {store_id, platform, enabled}', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'meta', enabled: false }) });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(store.upserts[0]).toMatchObject({ store_id: 'zolplus', platform: 'meta', enabled: false });
  });
  it('400 on a bad platform', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'snapchat', enabled: false }) });
    expect((await POST(req)).status).toBe(400);
  });
  it('400 when enabled is missing or non-boolean (never silently writes OFF)', async () => {
    const missing = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'meta' }) });
    expect((await POST(missing)).status).toBe(400);
    const garbage = new Request('http://x', { method: 'POST', body: JSON.stringify({ storeId: 'zolplus', platform: 'meta', enabled: 'false' }) });
    expect((await POST(garbage)).status).toBe(400);
    expect(store.upserts.length).toBe(0); // no write attempted
  });
});
