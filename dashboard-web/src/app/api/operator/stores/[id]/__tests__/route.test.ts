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
  // the store's existing webhook signing_secret (store_webhooks read; the GET
  // maps presence → hasWebhookSecret boolean — D0 — and NEVER returns the value).
  ownSigningSecret: null as string | null,
  // the store's authoritative is_headless flag (stores row read)
  isHeadless: false as boolean,
  // the store's authoritative has_tiktok flag (stores row read; GET derives the
  // 'tiktok' platform from it — Fix B4 — since TikTok is a shared account with no
  // per-store secret).
  hasTiktok: false as boolean,
  // the store's enable_customer_journey flag (stores row read; GET returns it as
  // enableCustomerJourney; PATCH sets it when the body includes the field).
  enableCustomerJourney: false as boolean,
  // store_secrets presence rows for the GET (no values)
  secretRows: [] as Array<{ store_id: string; secret_key: string }>,
  // make a write fail (write-error path → 500)
  throwOn: null as null | 'stores' | 'store_webhooks' | 'store_ad_state' | 'store_secrets',
  // ---- DELETE-route state (Phase 6b T2) ----
  // the store's status ('active' | 'archived') for the stores-row read.
  status: 'active' as string,
  // ordered record of every .delete().eq(col,val) call: { table, col, val }
  deletes: [] as Array<{ table: string; col: string; val: unknown }>,
  // tables whose .delete() should return an error (best-effort: logged + failed[])
  deleteErrorOn: [] as string[],
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
      // DELETE-route (Phase 6b T2): record each .delete().eq(col,val) in order so
      // tests can assert the full table coverage + that `stores` is last. A table
      // listed in deleteErrorOn returns an error (best-effort: route logs + pushes
      // to failed[] and continues).
      delete: () => ({
        eq: (col: string, val: unknown) => {
          db.deletes.push({ table, col, val });
          if (db.deleteErrorOn.includes(table)) {
            return Promise.resolve({ error: { message: `boom ${table}` } });
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
                    ? { id: val, name: String(val), brand_color: 'var(--store-uzo)', is_headless: db.isHeadless, has_tiktok: db.hasTiktok, display_order: 1, status: db.status, enable_customer_journey: db.enableCustomerJourney }
                    : null,
                  error: null,
                });
              }
              if (table === 'store_webhooks' && col === 'store_id') {
                return Promise.resolve({
                  data:
                    db.ownShopDomain !== null
                      ? {
                          shop_domain: db.ownShopDomain,
                          allowed_origins: db.ownAllowedOrigins,
                          signing_secret: db.ownSigningSecret,
                        }
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

import { GET, PATCH, DELETE, STORE_SCOPED_WIPE_TABLES } from '../route';

// the ordered table NAMES the route wipes (source of truth = the {table,keyCol}
// array). `stores` (the FK parent) is last.
const WIPE_TABLE_NAMES = STORE_SCOPED_WIPE_TABLES.map((t) => t.table);

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://x/api/operator/stores/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    ctx(id),
  );
}
function del(id: string, body: unknown) {
  return DELETE(
    new Request(`http://x/api/operator/stores/${id}`, { method: 'DELETE', body: JSON.stringify(body) }),
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
  db.ownSigningSecret = null;
  db.isHeadless = false;
  db.hasTiktok = false;
  db.enableCustomerJourney = false;
  db.secretRows = [];
  db.throwOn = null;
  db.status = 'active';
  db.deletes = [];
  db.deleteErrorOn = [];
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

  it('returns hasWebhookSecret=true when signing_secret is set (presence only, no value) [D0]', async () => {
    db.ownSigningSecret = 'a-real-signing-secret-value';
    db.secretRows = [{ store_id: 'mystore', secret_key: 'SHOPIFY_DOMAIN' }];
    const res = await getReq('mystore');
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.hasWebhookSecret).toBe(true);
    // PRESENCE only — the raw value must NEVER be echoed.
    expect(text).not.toContain('a-real-signing-secret-value');
    expect(text).not.toContain('signing_secret');
  });

  it('returns hasWebhookSecret=false when signing_secret is null [D0]', async () => {
    db.ownSigningSecret = null;
    const res = await getReq('mystore');
    const body = await res.json();
    expect(body.hasWebhookSecret).toBe(false);
  });

  it('returns hasWebhookSecret=false when signing_secret is an empty string [D0]', async () => {
    db.ownSigningSecret = '';
    const res = await getReq('mystore');
    const body = await res.json();
    expect(body.hasWebhookSecret).toBe(false);
  });

  it('400 for the reserved __global__ id (Fix B3 — defensive short-circuit, no DB read)', async () => {
    const res = await getReq('__global__');
    expect(res.status).toBe(400);
  });

  it('includes tiktok in platforms when has_tiktok=true even with no TIKTOK_ secret (Fix B4)', async () => {
    db.hasTiktok = true;
    db.secretRows = [{ store_id: 'mystore', secret_key: 'SHOPIFY_DOMAIN' }];
    const res = await getReq('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toContain('tiktok');
    expect(body.platforms.sort()).toEqual(['shopify', 'tiktok']);
  });

  it('does NOT include tiktok when has_tiktok=false (Fix B4)', async () => {
    db.hasTiktok = false;
    db.secretRows = [{ store_id: 'mystore', secret_key: 'SHOPIFY_DOMAIN' }];
    const res = await getReq('mystore');
    const body = await res.json();
    expect(body.platforms).not.toContain('tiktok');
  });

  it('returns enableCustomerJourney=false by default', async () => {
    db.enableCustomerJourney = false;
    const res = await getReq('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enableCustomerJourney).toBe(false);
  });

  it('returns enableCustomerJourney=true when the column is true', async () => {
    db.enableCustomerJourney = true;
    const res = await getReq('mystore');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enableCustomerJourney).toBe(true);
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

  it('PATCH { enableCustomerJourney: true } sets enable_customer_journey in stores and is returned by GET', async () => {
    const res = await patch('mystore', { enableCustomerJourney: true });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(0);
    expect(db.storesUpdates).toHaveLength(1);
    expect(db.storesUpdates[0]).toMatchObject({ enable_customer_journey: true });
    const body = await res.json();
    expect(body.updated).toContain('enableCustomerJourney');
  });

  it('PATCH { enableCustomerJourney: false } sets enable_customer_journey=false (no verify, no creds)', async () => {
    db.enableCustomerJourney = true;
    const res = await patch('mystore', { enableCustomerJourney: false });
    expect([200, 201]).toContain(res.status);
    expect(db.storesUpdates).toHaveLength(1);
    expect(db.storesUpdates[0]).toMatchObject({ enable_customer_journey: false });
  });

  it('GET returns enableCustomerJourney matching the stored value after a PATCH', async () => {
    db.enableCustomerJourney = true;
    const res = await getReq('mystore');
    const body = await res.json();
    expect(body.enableCustomerJourney).toBe(true);
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
// PATCH — webhookSecret (Fix B1 / MF-2): operator-entered signing secret.
// signing_secret is NO LONGER derived from the Shopify client_secret on a creds
// rotation; it is only ever set when the operator provides webhookSecret.
// ---------------------------------------------------------------------------
describe('PATCH /api/operator/stores/[id] — webhookSecret (Fix B1)', () => {
  it('webhookSecret-only PATCH updates store_webhooks.signing_secret (no creds verify)', async () => {
    const res = await patch('mystore', { webhookSecret: 'NEW-SIGNING-SECRET' });
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(0);
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0]).toMatchObject({ signing_secret: 'NEW-SIGNING-SECRET' });
  });

  it('a Shopify creds rotation ALONE does NOT touch signing_secret (Fix B1: no client_secret default)', async () => {
    db.ownShopDomain = 'mystore.myshopify.com';
    const res = await patch('mystore', { shopify: { clientId: 'cid', clientSecret: 'ROTATED-SECRET' } });
    expect([200, 201]).toContain(res.status);
    // store_webhooks may or may not be updated, but if it IS, signing_secret must
    // NOT be present (we no longer write client_secret into it).
    for (const wh of db.webhooksUpdates) {
      expect(wh).not.toHaveProperty('signing_secret');
    }
    // and the rotated client_secret must never appear as a signing_secret value.
    const sawClientSecretAsSigning = db.webhooksUpdates.some((wh) => wh.signing_secret === 'ROTATED-SECRET');
    expect(sawClientSecretAsSigning).toBe(false);
  });

  it('webhookSecret + Shopify rotation: signing_secret = webhookSecret (not client_secret)', async () => {
    db.ownShopDomain = 'mystore.myshopify.com';
    const res = await patch('mystore', {
      shopify: { clientId: 'cid', clientSecret: 'ROTATED-SECRET' },
      webhookSecret: 'EXPLICIT-WEBHOOK-SECRET',
    });
    expect([200, 201]).toContain(res.status);
    const withSigning = db.webhooksUpdates.find((wh) => 'signing_secret' in wh);
    expect(withSigning?.signing_secret).toBe('EXPLICIT-WEBHOOK-SECRET');
  });

  it('webhookSecret applies on a domain change too (store_webhooks update carries it)', async () => {
    db.ownShopDomain = 'old.myshopify.com';
    secret.shopifyClientId = 'cid';
    secret.shopifyClientSecret = 'csec';
    verify.shopify = { ok: true, message: 'ok' };
    const res = await patch('mystore', {
      shopDomain: 'newdomain.myshopify.com',
      webhookSecret: 'WS-ON-DOMAIN-CHANGE',
    });
    expect([200, 201]).toContain(res.status);
    expect(db.webhooksUpdates).toHaveLength(1);
    expect(db.webhooksUpdates[0]).toMatchObject({
      shop_domain: 'newdomain.myshopify.com',
      signing_secret: 'WS-ON-DOMAIN-CHANGE',
    });
  });

  it('NEVER echoes the webhookSecret in the response', async () => {
    const res = await patch('mystore', { webhookSecret: 'SECRET-WS-XYZ-9999' });
    const text = await res.text();
    expect(text).not.toContain('SECRET-WS-XYZ-9999');
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

// ===========================================================================
// DELETE — hard, irreversible store wipe (Phase 6b T2). The MOST dangerous
// route in the project: double-gated (archived-only 409 + exact typed-name
// 400). NOTHING is deleted unless BOTH guards pass. Then an exhaustive,
// FK-safe wipe (children → config → `stores` LAST) of every store_id table.
// ===========================================================================
describe('DELETE /api/operator/stores/[id] — validation guards', () => {
  it('400 for a reserved id (no delete)', async () => {
    db.existingStoreIds = ['__global__'];
    const res = await del('__global__', { confirmName: '__global__' });
    expect(res.status).toBe(400);
    expect(db.deletes).toHaveLength(0);
  });

  it('404 when the store does not exist (no delete)', async () => {
    const res = await del('ghost', { confirmName: 'ghost' });
    expect(res.status).toBe(404);
    expect(db.deletes).toHaveLength(0);
  });

  it('GUARD A: an ACTIVE store with the correct confirmName → 409 must_archive_first, NOTHING deleted', async () => {
    db.status = 'active';
    const res = await del('mystore', { confirmName: 'mystore' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('must_archive_first');
    expect(db.deletes).toHaveLength(0);
  });

  it('GUARD B: an ARCHIVED store with the WRONG confirmName → 400 confirm_mismatch, NOTHING deleted', async () => {
    db.status = 'archived';
    const res = await del('mystore', { confirmName: 'WRONG-NAME' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('confirm_mismatch');
    expect(db.deletes).toHaveLength(0);
  });

  it('GUARD B: an ARCHIVED store with a MISSING confirmName → 400 confirm_mismatch, NOTHING deleted', async () => {
    db.status = 'archived';
    const res = await del('mystore', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('confirm_mismatch');
    expect(db.deletes).toHaveLength(0);
  });

  it('GUARD ORDER: an ACTIVE store with the WRONG confirmName → 409 (archive-first checked first), NOTHING deleted', async () => {
    db.status = 'active';
    const res = await del('mystore', { confirmName: 'WRONG-NAME' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('must_archive_first');
    expect(db.deletes).toHaveLength(0);
  });
});

describe('DELETE /api/operator/stores/[id] — wipe (both guards passed)', () => {
  it('archived + correct confirmName → wipes EVERY store-scoped table by store_id + stores LAST by id; 200', async () => {
    db.status = 'archived';
    const res = await del('mystore', { confirmName: 'mystore' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe('mystore');
    expect(body.failed).toEqual([]);

    // every store-scoped data/config table was deleted by store_id='mystore'.
    const storeScoped = db.deletes.filter((d) => d.table !== 'stores');
    for (const d of storeScoped) {
      expect(d.col).toBe('store_id');
      expect(d.val).toBe('mystore');
    }
    // the deleted-tables list EQUALS the route's exported wipe list, IN ORDER
    // (no extras, no omissions) — including `stores`.
    const deletedTables = db.deletes.map((d) => d.table);
    expect(deletedTables).toEqual(WIPE_TABLE_NAMES);
    expect(deletedTables).toHaveLength(WIPE_TABLE_NAMES.length);

    // `stores` is the VERY LAST delete (FK parent — deleted after all children).
    expect(deletedTables[deletedTables.length - 1]).toBe('stores');
    // and `stores` is deleted by `id`, NOT store_id.
    const storesDelete = db.deletes.find((d) => d.table === 'stores');
    expect(storesDelete?.col).toBe('id');
    expect(storesDelete?.val).toBe('mystore');

    // tablesWiped reflects the successful tables (all of them here), in order.
    expect(body.tablesWiped).toEqual(WIPE_TABLE_NAMES);
  });

  it('best-effort: a mid-wipe table error is logged + pushed to failed[], the rest CONTINUE, 200', async () => {
    db.status = 'archived';
    // make two child-data tables fail — the wipe must not abort.
    db.deleteErrorOn = ['ads_daily', 'campaign_registry'];
    const res = await del('mystore', { confirmName: 'mystore' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // the failures are reported.
    expect(body.failed.sort()).toEqual(['ads_daily', 'campaign_registry']);
    // EVERY table was still attempted (best-effort continue, not abort).
    expect(db.deletes.map((d) => d.table)).toEqual(WIPE_TABLE_NAMES);
    // `stores` (the parent) was still deleted last even though children failed.
    expect(db.deletes[db.deletes.length - 1].table).toBe('stores');
    // tablesWiped excludes the failed tables.
    expect(body.tablesWiped).not.toContain('ads_daily');
    expect(body.tablesWiped).not.toContain('campaign_registry');
  });

  it('NEVER returns a secret/value in any DELETE response', async () => {
    db.status = 'archived';
    db.secretRows = [{ store_id: 'mystore', secret_key: 'SHOPIFY_CLIENT_SECRET' }];
    const res = await del('mystore', { confirmName: 'mystore' });
    const text = await res.text();
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('"iv"');
    expect(text).not.toContain('"tag"');
    expect(text).not.toContain('signing_secret');
  });

  it('rejects bad JSON with 400 and no delete', async () => {
    db.status = 'archived';
    const res = await DELETE(
      new Request('http://x/api/operator/stores/mystore', { method: 'DELETE', body: '{not json' }),
      ctx('mystore'),
    );
    expect(res.status).toBe(400);
    expect(db.deletes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EXHAUSTIVENESS GUARD — the route's wipe list MUST equal the set of every
// table that has a `store_id` column in the schema (+ `stores` itself, keyed
// by id). Derived live from supabase/migrations so a future store_id table
// can't be silently missed from the wipe.
// ---------------------------------------------------------------------------
describe('DELETE wipe-list exhaustiveness vs the schema', () => {
  it('STORE_SCOPED_WIPE_TABLES == {every CREATE TABLE with a store_id column} ∪ {stores}', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    // .../src/app/api/operator/stores/[id]/__tests__ → repo's supabase/migrations
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(here, '../../../../../../../../supabase/migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

    const storeIdTables = new Set<string>();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      // Split each CREATE TABLE [IF NOT EXISTS] [schema.]<name> ( ... ); body and
      // record the table name iff its body contains a `store_id` column.
      const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const name = m[1];
        const body = m[2];
        // a real `store_id` COLUMN definition (line starting with store_id), not a
        // PK/index/comment mention.
        if (/(^|\n)\s*store_id\b/i.test(body)) storeIdTables.add(name);
      }
    }

    expect(storeIdTables.size).toBeGreaterThan(0);

    // The route wipes every store_id table + `stores` itself (the FK parent).
    const expected = new Set<string>(storeIdTables);
    expected.add('stores');

    const actual = new Set<string>(WIPE_TABLE_NAMES);

    // Symmetric diff must be empty: no store_id table missing from the wipe, and
    // nothing in the wipe that isn't a real store_id table (or `stores`).
    const missingFromWipe = [...expected].filter((t) => !actual.has(t));
    const extraInWipe = [...actual].filter((t) => !expected.has(t));
    expect(missingFromWipe).toEqual([]);
    expect(extraInWipe).toEqual([]);
  });
});
