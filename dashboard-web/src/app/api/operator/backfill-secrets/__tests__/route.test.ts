import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const up = vi.hoisted(() => ({ rows: [] as Array<{ store_id: string; secret_key: string }>, error: null as null | { message: string } }));
const enc = vi.hoisted(() => ({ encrypt: ((p: string) => ({ ciphertext: 'C:' + p, iv: 'IV', tag: 'TAG' })), decrypt: ((c: string) => c.replace(/^C:/, '')) }));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      upsert: (row: { store_id: string; secret_key: string }) => { up.rows.push(row); return Promise.resolve({ error: up.error }); },
    }),
  }),
}));
vi.mock('@/lib/secretsEncryption', () => ({
  encryptSecret: (p: string) => enc.encrypt(p),
  decryptSecret: (c: string) => enc.decrypt(c),
}));
vi.mock('@/lib/getStores', () => ({ loadActiveStoreIds: () => Promise.resolve(['uzoshop', 'zolplus', 'usmile360']) }));

import { POST } from '../route';

beforeEach(() => { up.rows = []; up.error = null; vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

function req() { return new Request('http://x/api/operator/backfill-secrets', { method: 'POST', body: '{}' }); }

describe('POST /api/operator/backfill-secrets', () => {
  it('encrypts + upserts only the secrets whose env var is PRESENT (skips absent)', async () => {
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzo.myshopify.com');
    vi.stubEnv('UZOSHOP_META_ACCESS_TOKEN', 'tok');
    const res = await POST(req());
    const body = await res.json();
    const written = up.rows.map((r) => `${r.store_id}:${r.secret_key}`);
    expect(written).toContain('uzoshop:SHOPIFY_DOMAIN');
    expect(written).toContain('uzoshop:META_ACCESS_TOKEN');
    expect(written).not.toContain('zolplus:SHOPIFY_DOMAIN');
    expect(body.summary).toBeTruthy();
  });
  it('writes TikTok rows for uzoshop ONLY (never tenant stores)', async () => {
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', 'adv');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tt');
    vi.stubEnv('ZOLPLUS_TIKTOK_ADVERTISER_ID', 'SHOULD_NOT_BE_READ');
    await POST(req());
    const written = up.rows.map((r) => `${r.store_id}:${r.secret_key}`);
    expect(written).toContain('uzoshop:TIKTOK_ADVERTISER_ID');
    expect(written.filter((w) => w.startsWith('zolplus:TIKTOK'))).toHaveLength(0);
  });
  it('backfills GLOBAL secrets under __global__ with the unprefixed env var', async () => {
    vi.stubEnv('GOOGLEADS_CLIENT_ID', 'gid');
    await POST(req());
    const written = up.rows.map((r) => `${r.store_id}:${r.secret_key}`);
    expect(written).toContain('__global__:GOOGLEADS_CLIENT_ID');
  });
  it('NEVER returns plaintext secret values in the response', async () => {
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'SECRET-uzo.myshopify.com');
    const res = await POST(req());
    const text = await res.text();
    expect(text).not.toContain('SECRET-uzo.myshopify.com');
  });
  it('reports a decrypt-roundtrip ok flag per written secret', async () => {
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzo.myshopify.com');
    const res = await POST(req());
    const body = await res.json();
    const entry = body.summary.find((s: { store: string; key: string }) => s.store === 'uzoshop' && s.key === 'SHOPIFY_DOMAIN');
    expect(entry.status).toBe('written');
    expect(entry.verified).toBe(true);
  });
});
