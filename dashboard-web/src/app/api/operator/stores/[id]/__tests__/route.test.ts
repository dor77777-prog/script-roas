import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Self-serve stores Phase 6a — Task 8: GET + PATCH /api/operator/stores/[id].
//
// In-memory fake of the Supabase admin client + verifiers + encryption +
// getStoreSecret. `db` records every write so each test asserts EXACTLY what
// hit the tables — and that NOTHING is written on a validation/verify failure
// (the verify-first invariant: an UNVERIFIED cred must never be persisted).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  secretsUpserts: [] as Row[],
  storesUpdates: [] as Row[],
  webhooksUpdates: [] as Row[],
  adStateUpserts: [] as Row[],
  // pre-check seed state
  existingStoreIds: ['mystore'] as string[],
  // shop_domain -> store_id (for the dup-among-OTHER-stores 409 check)
  shopDomainOwners: {} as Record<string, string>,
  // the store's own existing shop_domain (store_webhooks.shop_domain read)
  ownShopDomain: 'mystore.myshopify.com' as string | null,
  // the store's existing allowed_origins (store_webhooks read; the OLD code
  // inferred headless from this being empty — the bug Fix 2 removes)
  ownAllowedOrigins: ['https://mystore.myshopify.com'] as string[],
  // the store's authoritative is_headless flag (stores row read)
  isHeadless: false as boolean,
  // store_secrets presence rows for the GET (no values)
  secretRows: [] as Array<{ store_id: string; secret_key: string }>,
  // make a write fail (write-error path → 500)
  throwOn: null as null | 'stores' | 'store_webhooks' | 'store_ad_state' | 'store_secrets',
}));

vi.mock('@/lib/supabaseAdmin', () => {
  function fromTable(table: string) {
    return {
      upsert: (rowOrRows: Row | Row[]) => {
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        if (table === 'store_secrets') {
          if (db.throwOn === 'store_secrets') return Promise.resolve({ error: { message: 'boom secrets' } });
          db.secretsUpserts.push(...rows);
        } else if (table === 'store_ad_state') {
          if (db.throwOn === 'store_ad_state') return Promise.resolve({ error: { message: 'boom adstate' } });
          db.adStateUpserts.push(...rows);
        }
        return Promise.resolve({ error: null });
      },
      update: (row: Row) => ({
        eq: (_col: string, _val: unknown) => {
          if (table === 'stores') {
            if (db.throwOn === 'stores') return Promise.resolve({ error: { message: 'boom stores' } });
            db.storesUpdates.push(row);
          } else if (table === 'store_webhooks') {
            if (db.throwOn === 'store_webhooks') return Promise.resolve({ error: { message: 'boom webhooks' } });
            db.webhooksUpdates.push(row);
          }
          return Promise.resolve({ error: null });
        },
      }),
      select: (_cols: string) => {
        // GET: grouped secrets presence read for the [id] store.
        if (table === 'store_secrets') {
          return {
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: db.secretRows, error: null }),
          };
        }
        // pre-check / read chains.
        return {
          eq: (col: string, val: unknown) => ({
            maybeSingle: () => {
              if (table === 'stores' && col === 'id') {
                return Promise.resolve({
                  data: db.existingStoreIds.includes(String(val))
                    ? { id: val, is_headless: db.isHeadless }
                    : null,
                  error: null,
                });
              }
              if (table === 'store_webhooks' && col === 'store_id') {
                return Promise.resolve({
                  data:
                    db.ownShopDomain !== null
                      ? { shop_domain: db.ownShopDomain, allowed_origins: db.ownAllowedOrigins }
                      : null,
                  error: null,
                });
              }
              if (table === 'store_webhooks' && col === 'shop_domain') {
                const owner = db.shopDomainOwners[String(val)];
                return Promise.resolve({ data: owner ? { store_id: owner } : null, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      },
    };
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => fromTable(t) }) };
});

vi.mock('@/lib/secretsEncryption', () => ({
  encryptSecret: (p: string) => ({ ciphertext: 'C:' + p, iv: 'IV', tag: 'TAG' }),
  decryptSecret: (c: string) => String(c).replace(/^C:/, ''),
  maskSecret: (v: string) => (v.length > 4 ? '••••' + v.slice(-4) : '••••'),
}));

const verify = vi.hoisted(() => ({
  shopify: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  meta: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  google: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  shopifyCalls: 0,
  metaCalls: 0,
  googleCalls: 0,
  shopifyArgs: null as null | { domain: string },
}));
vi.mock('@/lib/credVerifiers', () => ({
  verifyShopify: (args: { domain: string }) => { verify.shopifyCalls++; verify.shopifyArgs = args; return Promise.resolve(verify.shopify); },
  verifyMeta: () => { verify.metaCalls++; return Promise.resolve(verify.meta); },
  verifyGoogle: () => { verify.googleCalls++; return Promise.resolve(verify.google); },
}));

// getStoreSecret is used as the fallback source of the EXISTING shop domain
// (when re-verifying Shopify and no new shopDomain was provided). Default: null
// (the route then falls back to store_webhooks.shop_domain).
const secret = vi.hoisted(() => ({
  shopifyDomain: null as string | null,
  // EXISTING Shopify creds the route reads to verify a domain-only change.
  shopifyClientId: null as string | null,
  shopifyClientSecret: null as string | null,
}));
vi.mock('@/lib/storeSecretsReader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storeSecretsReader')>(
    '@/lib/storeSecretsReader',
  );
  return {
    ...actual,
    getStoreSecret: vi.fn(async (_storeId: string, key: string) => {
      if (key === 'SHOPIFY_DOMAIN') return secret.shopifyDomain;
      if (key === 'SHOPIFY_CLIENT_ID') return secret.shopifyClientId;
      if (key === 'SHOPIFY_CLIENT_SECRET') return secret.shopifyClientSecret;
      return null;
    }),
  };
});

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { GET, PATCH } from '../route';

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://x/api/operator/stores/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    ctx(id),
  );
}
function getReq(id: string) {
  return GET(new Request(`http://x/api/operator/stores/${id}`), ctx(id));
}

function noWrites() {
  return (
    db.secretsUpserts.length === 0 &&
    db.storesUpdates.length === 0 &&
    db.webhooksUpdates.length === 0 &&
    db.adStateUpserts.length === 0
  );
}

beforeEach(() => {
  db.secretsUpserts = [];
  db.storesUpdates = [];
  db.webhooksUpdates = [];
  db.adStateUpserts = [];
  db.existingStoreIds = ['mystore'];
  db.shopDomainOwners = {};
  db.ownShopDomain = 'mystore.myshopify.com';
  db.ownAllowedOrigins = ['https://mystore.myshopify.com'];
  db.isHeadless = false;
  db.secretRows = [];
  db.throwOn = null;
  verify.shopify = { ok: true, message: 'ok', currency: 'CAD' };
  verify.meta = { ok: true, message: 'ok', currency: 'ILS' };
  verify.google = { ok: true, message: 'ok', currency: 'CAD' };
  verify.shopifyCalls = 0;
  verify.metaCalls = 0;
  verify.googleCalls = 0;
  verify.shopifyArgs = null;
  secret.shopifyDomain = null;
  secret.shopifyClientId = null;
  secret.shopifyClientSecret = null;
});

// ---------------------------------------------------------------------------
// GET — basics only, no secrets.
// ---------------------------------------------------------------------------
describe('GET /api/operator/stores/[id]', () => {
  it('returns the store basics + configured platforms (presence only), no secrets', async () => {
    db.secretRows = [
      { store_id: 'mystore', secret_key: 'SHOPIFY_DOMAIN' },
      { store_id: 'mystore', secret_key: 'SHOPIFY_CLIENT_SECRET' },
      { store_id: 'mystore', secret_key: 'META_ACCESS_TOKEN' },
    ];
    const res = await getReq('mystore');
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.storeId).toBe('mystore');
    expect(body.shopDomain).toBe('mystore.myshopify.com');
    expect(body.platforms.sort()).toEqual(['meta', 'shopify']);
    // never any ciphertext / value
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('"iv"');
    expect(text).not.toContain('"tag"');
  });

  it('404 when the store does not exist', async () => {
    const res = await getReq('ghost');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH — basics-only (no verify needed).
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — basics only', () => {
  it('updates stores + webhooks for a name/brand/headless change without verifying', async () => {
    const res = await patch('mystore', { name: 'Renamed', brandColor: 'var(--band-blue)', isHeadless: true });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(0);
    expect(verify.metaCalls).toBe(0);
    expect(db.secretsUpserts).toHaveLength(0);
    expect(db.storesUpdates).toHaveLength(1);
    expect(db.storesUpdates[0]).toMatchObject({ name: 'Renamed', brand_color: 'var(--band-blue)', is_headless: true });
    // headless flip → allowed_origins recomputed in store_webhooks
    expect(db.webhooksUpdates).toHaveLength(1);
  });

  it('updates only display_order / has_tiktok when those are the only fields', async () => {
    const res = await patch('mystore', { displayOrder: 9, hasTiktok: true });
    expect([200, 201]).toContain(res.status);
    expect(db.storesUpdates[0]).toMatchObject({ display_order: 9, has_tiktok: true });
    expect(noWrites()).toBe(false);
  });

  it('rejects an empty body (nothing to do) with 400 and no write', async () => {
    const res = await patch('mystore', {});
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('404 when the store does not exist (no write)', async () => {
    const res = await patch('ghost', { name: 'x' });
    expect(res.status).toBe(404);
    expect(noWrites()).toBe(true);
  });

  it('400 for the reserved __global__ id (no write)', async () => {
    db.existingStoreIds = ['__global__'];
    const res = await patch('__global__', { name: 'x' });
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH — shopDomain change.
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — shopDomain', () => {
  it('rejects a malformed shopDomain with 400 and no write', async () => {
    const res = await patch('mystore', { shopDomain: 'evil.com/path.myshopify.com' });
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('409 when the new shopDomain is taken by ANOTHER store (no write)', async () => {
    db.shopDomainOwners = { 'taken.myshopify.com': 'otherstore' };
    const res = await patch('mystore', { shopDomain: 'taken.myshopify.com' });
    expect(res.status).toBe(409);
    expect(noWrites()).toBe(true);
  });

  it('allows a shopDomain owned by THIS store (idempotent) and updates webhooks', async () => {
    db.shopDomainOwners = { 'mystore.myshopify.com': 'mystore' };
    const res = await patch('mystore', { shopDomain: 'mystore.myshopify.com' });
    expect([200, 201]).toContain(res.status);
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0]).toMatchObject({ shop_domain: 'mystore.myshopify.com' });
  });
});

// ---------------------------------------------------------------------------
// PATCH — domain-only change (no creds): re-verify with EXISTING creds +
// keep the SHOPIFY_DOMAIN secret in LOCKSTEP with store_webhooks.shop_domain.
// (Fix 1 — silent live-fetcher drift.)
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — domain-only change (lockstep + re-verify)', () => {
  it('domain change, no creds, existing creds verify OK → updates shop_domain AND re-encrypts SHOPIFY_DOMAIN secret (200 masked)', async () => {
    // existing Shopify creds present so the new domain can be verified
    secret.shopifyClientId = 'EXISTING-CID';
    secret.shopifyClientSecret = 'EXISTING-CSECRET';
    db.ownShopDomain = 'old.myshopify.com';
    verify.shopify = { ok: true, message: 'ok', currency: 'CAD' };

    const res = await patch('mystore', { shopDomain: 'newdomain.myshopify.com' });
    expect([200, 201]).toContain(res.status);
    // verified live against the NEW domain using the EXISTING creds
    expect(verify.shopifyCalls).toBe(1);
    expect(verify.shopifyArgs?.domain).toBe('newdomain.myshopify.com');
    // LOCKSTEP: store_webhooks.shop_domain updated AND SHOPIFY_DOMAIN secret upserted
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0]).toMatchObject({ shop_domain: 'newdomain.myshopify.com' });
    const secretKeys = db.secretsUpserts.map((r) => r.secret_key);
    expect(secretKeys).toContain('SHOPIFY_DOMAIN');
    expect(db.secretsUpserts.find((r) => r.secret_key === 'SHOPIFY_DOMAIN')?.ciphertext).toBe(
      'C:newdomain.myshopify.com',
    );
    // never echo the existing creds we read to verify
    const text = await res.text();
    expect(text).not.toContain('EXISTING-CSECRET');
    expect(text).not.toContain('EXISTING-CID');
  });

  it('domain change, existing creds verify FAIL → 400 + NOTHING written', async () => {
    secret.shopifyClientId = 'EXISTING-CID';
    secret.shopifyClientSecret = 'EXISTING-CSECRET';
    db.ownShopDomain = 'old.myshopify.com';
    verify.shopify = { ok: false, message: 'existing creds reject new domain' };

    const res = await patch('mystore', { shopDomain: 'newdomain.myshopify.com' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.verification?.shopify).toBeTruthy();
    // verify-first: nothing persisted — no webhook update, no SHOPIFY_DOMAIN secret
    expect(noWrites()).toBe(true);
  });

  it('domain change with NO existing Shopify creds → 400 + NOTHING written', async () => {
    secret.shopifyClientId = null;
    secret.shopifyClientSecret = null;
    db.ownShopDomain = 'old.myshopify.com';

    const res = await patch('mystore', { shopDomain: 'newdomain.myshopify.com' });
    expect(res.status).toBe(400);
    expect(verify.shopifyCalls).toBe(0);
    expect(noWrites()).toBe(true);
  });

  it('idempotent same-domain PATCH does NOT re-verify Shopify (not a change)', async () => {
    db.ownShopDomain = 'mystore.myshopify.com';
    secret.shopifyClientId = 'EXISTING-CID';
    secret.shopifyClientSecret = 'EXISTING-CSECRET';
    const res = await patch('mystore', { shopDomain: 'mystore.myshopify.com' });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(0);
    // unchanged domain → SHOPIFY_DOMAIN secret NOT re-upserted
    expect(db.secretsUpserts.map((r) => r.secret_key)).not.toContain('SHOPIFY_DOMAIN');
  });
});

// ---------------------------------------------------------------------------
// PATCH — allowed_origins recompute from the AUTHORITATIVE is_headless.
// (Fix 2 — wrong headless inference.)
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — allowed_origins from is_headless', () => {
  it('themed store (is_headless=false) with empty origins, domain change → origins = [https://<newdomain>] (NOT emptied)', async () => {
    db.isHeadless = false; // authoritative: themed
    db.ownAllowedOrigins = []; // empty origins — the OLD code would misread this as headless
    db.ownShopDomain = 'old.myshopify.com';
    secret.shopifyClientId = 'cid';
    secret.shopifyClientSecret = 'csec';
    verify.shopify = { ok: true, message: 'ok' };

    const res = await patch('mystore', { shopDomain: 'newdomain.myshopify.com' });
    expect([200, 201]).toContain(res.status);
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0].allowed_origins).toEqual(['https://newdomain.myshopify.com']);
  });

  it('headless store (is_headless=true), domain change → origins = []', async () => {
    db.isHeadless = true; // authoritative: headless
    db.ownShopDomain = 'old.myshopify.com';
    secret.shopifyClientId = 'cid';
    secret.shopifyClientSecret = 'csec';
    verify.shopify = { ok: true, message: 'ok' };

    const res = await patch('mystore', { shopDomain: 'newdomain.myshopify.com' });
    expect([200, 201]).toContain(res.status);
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0].allowed_origins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PATCH — cred rotation (verify-first).
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — rotate creds (verify-first)', () => {
  it('rotating Meta with verifyMeta ok:true re-encrypts META_* (UPSERT) + masked return', async () => {
    db.secretRows = [{ store_id: 'mystore', secret_key: 'META_ACCESS_TOKEN' }]; // meta already present
    const res = await patch('mystore', {
      meta: { token: 'NEW-META-TOKEN', adAccountId: 'act_555' },
    });
    expect([200, 201]).toContain(res.status);
    expect(verify.metaCalls).toBe(1);
    const keys = db.secretsUpserts.map((r) => r.secret_key).sort();
    expect(keys).toEqual(['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']);
    for (const r of db.secretsUpserts) expect(String(r.ciphertext)).toMatch(/^C:/);
    const text = await res.text();
    expect(text).not.toContain('NEW-META-TOKEN');
    const body = JSON.parse(text);
    expect(body.secretsMasked).toBeDefined();
    expect(body.updated).toContain('meta');
  });

  it('rotating Meta with verifyMeta ok:false → 400 + NOTHING written', async () => {
    verify.meta = { ok: false, message: 'meta bad' };
    const res = await patch('mystore', { name: 'AlsoRenamed', meta: { token: 't', adAccountId: 'act_1' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.verification?.meta).toBeTruthy();
    // verify-first: even the basics (name) must NOT be written when a cred fails.
    expect(noWrites()).toBe(true);
  });

  it('re-verifies Shopify against the EXISTING shop domain (from store_webhooks) when no new domain given', async () => {
    db.ownShopDomain = 'mystore.myshopify.com';
    const res = await patch('mystore', { shopify: { clientId: 'cid', clientSecret: 'NEW-SHOP-SECRET' } });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(1);
    expect(verify.shopifyArgs?.domain).toBe('mystore.myshopify.com');
    const keys = db.secretsUpserts.map((r) => r.secret_key).sort();
    expect(keys).toEqual(['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET']);
    const text = await res.text();
    expect(text).not.toContain('NEW-SHOP-SECRET');
  });

  it('re-verifies Shopify against the NEW shop domain when one is provided', async () => {
    const res = await patch('mystore', {
      shopDomain: 'newdomain.myshopify.com',
      shopify: { clientId: 'cid', clientSecret: 'sec' },
    });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyArgs?.domain).toBe('newdomain.myshopify.com');
    // SHOPIFY_DOMAIN secret is also re-encrypted on a domain change.
    const keys = db.secretsUpserts.map((r) => r.secret_key);
    expect(keys).toContain('SHOPIFY_DOMAIN');
  });

  it('adding Google (not previously configured) writes secrets + ad_state + has_google_ads flag', async () => {
    db.secretRows = []; // google not present yet
    const res = await patch('mystore', {
      google: { customerId: '111-222-3333', refreshToken: 'gref' },
    });
    expect([200, 201]).toContain(res.status);
    const keys = db.secretsUpserts.map((r) => r.secret_key).sort();
    expect(keys).toEqual(['GOOGLEADS_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN']);
    expect(db.adStateUpserts.map((r) => r.platform)).toContain('google');
    expect(db.storesUpdates[0]).toMatchObject({ has_google_ads: true, google_ads_customer_id: '111-222-3333' });
  });

  it('verifies ALL provided cred objects before ANY write — one failing blocks all', async () => {
    verify.google = { ok: false, message: 'google bad' };
    const res = await patch('mystore', {
      meta: { token: 'mt', adAccountId: 'act_1' },
      google: { customerId: '111-222-3333', refreshToken: 'gref' },
    });
    expect(res.status).toBe(400);
    // Meta verified ok but Google failed → write NOTHING (no Meta secret either).
    expect(noWrites()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH — write-error path.
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — write errors', () => {
  it('a store_secrets write failure → 500, no plaintext leaked', async () => {
    db.throwOn = 'store_secrets';
    const res = await patch('mystore', { meta: { token: 'SECRET-TOKEN', adAccountId: 'act_1' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('SECRET-TOKEN');
  });
});

// ---------------------------------------------------------------------------
// Security — no plaintext echo on any response.
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — never echoes a raw secret', () => {
  it('masks rotated secrets and never returns the raw value', async () => {
    const res = await patch('mystore', {
      shopify: { clientId: 'cid', clientSecret: 'RAW-SHOP-SECRET' },
      meta: { token: 'RAW-META-TOKEN', adAccountId: 'act_9' },
      google: { customerId: '111-222-3333', refreshToken: 'RAW-GOOGLE-REFRESH' },
    });
    const text = await res.text();
    expect(text).not.toContain('RAW-SHOP-SECRET');
    expect(text).not.toContain('RAW-META-TOKEN');
    expect(text).not.toContain('RAW-GOOGLE-REFRESH');
  });
});
