import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fake of the Supabase admin client + the verifiers + encryption.
// `db` records every write/delete so each test can assert exactly what hit the
// four tables (and that NOTHING was written on a validation/verify failure).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  // per-table recorded writes
  secretsUpserts: [] as Row[],
  storesInserts: [] as Row[],
  webhooksInserts: [] as Row[],
  adStateUpserts: [] as Row[],
  // recorded DELETEs (rollback): table -> store_ids deleted
  deletes: [] as Array<{ table: string; storeId: unknown }>,
  // pre-check seed state
  existingStoreIds: [] as string[],
  existingShopDomains: [] as string[],
  existingDisplayOrders: [] as number[],
  // store_secrets rows returned by the grouped GET select
  secretRows: [] as Array<{ store_id: string; secret_key: string }>,
  // toggle: make a specific table's insert/upsert return an error (rollback path)
  throwOn: null as null | 'stores' | 'store_webhooks' | 'store_ad_state' | 'store_secrets',
  // optional Postgres-style error code attached to the throwOn error (e.g. '23505'
  // PK conflict on the `stores` insert → concurrency backstop returns 409).
  throwOnCode: null as null | string,
  // toggle: when decryptSecret would return this plaintext, return a WRONG value
  // instead → upsertSecret's roundtrip-verify fails (mismatch → rollback, no leak).
  decryptMismatchPlaintext: null as null | string,
}));

vi.mock('@/lib/supabaseAdmin', () => {
  function fromTable(table: string) {
    return {
      // ---- store_secrets.upsert (via upsertSecret) ----
      upsert: (rowOrRows: Row | Row[]) => {
        if (table === 'store_secrets') {
          if (db.throwOn === 'store_secrets') return Promise.resolve({ error: { message: 'boom secrets' } });
          db.secretsUpserts.push(...(Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]));
        } else if (table === 'store_ad_state') {
          if (db.throwOn === 'store_ad_state') return Promise.resolve({ error: { message: 'boom adstate' } });
          db.adStateUpserts.push(...(Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]));
        }
        return Promise.resolve({ error: null });
      },
      // ---- stores / store_webhooks .insert ----
      insert: (rowOrRows: Row | Row[]) => {
        if (table === 'stores') {
          if (db.throwOn === 'stores') {
            return Promise.resolve({ error: { message: 'boom stores', ...(db.throwOnCode ? { code: db.throwOnCode } : {}) } });
          }
          db.storesInserts.push(...(Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]));
        } else if (table === 'store_webhooks') {
          if (db.throwOn === 'store_webhooks') return Promise.resolve({ error: { message: 'boom webhooks' } });
          db.webhooksInserts.push(...(Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]));
        }
        return Promise.resolve({ error: null });
      },
      // ---- SELECT chains ----
      select: (cols: string) => {
        // grouped secrets read for GET: .select('store_id, secret_key') -> awaited directly
        if (table === 'store_secrets') {
          return Promise.resolve({ data: db.secretRows, error: null });
        }
        // stores .select('display_order') -> awaited directly (max calc)
        if (table === 'stores' && cols.includes('display_order') && !cols.includes('id')) {
          return Promise.resolve({ data: db.existingDisplayOrders.map((n) => ({ display_order: n })), error: null });
        }
        // pre-check chains: stores .select('id').eq('id', x).maybeSingle()
        //                   store_webhooks .select(...).eq('shop_domain', x).maybeSingle()
        return {
          eq: (col: string, val: unknown) => ({
            maybeSingle: () => {
              if (table === 'stores' && col === 'id') {
                return Promise.resolve({
                  data: db.existingStoreIds.includes(String(val)) ? { id: val } : null,
                  error: null,
                });
              }
              if (table === 'store_webhooks' && col === 'shop_domain') {
                return Promise.resolve({
                  data: db.existingShopDomains.includes(String(val)) ? { store_id: 'x' } : null,
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      },
      // ---- DELETE (rollback) ----
      delete: () => ({
        eq: (_col: string, val: unknown) => {
          db.deletes.push({ table, storeId: val });
          return Promise.resolve({ error: null });
        },
      }),
    };
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => fromTable(t) }) };
});

// Encryption: deterministic, no real master key needed.
vi.mock('@/lib/secretsEncryption', () => ({
  encryptSecret: (p: string) => ({ ciphertext: 'C:' + p, iv: 'IV', tag: 'TAG' }),
  decryptSecret: (c: string) => {
    const plaintext = String(c).replace(/^C:/, '');
    // Simulate a corrupt-at-rest secret: decrypt returns a value ≠ the plaintext
    // for the targeted secret so upsertSecret's roundtrip-verify throws.
    if (db.decryptMismatchPlaintext !== null && plaintext === db.decryptMismatchPlaintext) {
      return 'WRONG:' + plaintext;
    }
    return plaintext;
  },
  maskSecret: (v: string) => (v.length > 4 ? '••••' + v.slice(-4) : '••••'),
}));

// Verifiers: drive ok/fail per test via these holders.
const verify = vi.hoisted(() => ({
  shopify: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  meta: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  google: { ok: true, message: 'ok' } as { ok: boolean; message: string; currency?: string },
  shopifyCalls: 0,
  metaCalls: 0,
  googleCalls: 0,
}));
vi.mock('@/lib/credVerifiers', () => ({
  verifyShopify: () => { verify.shopifyCalls++; return Promise.resolve(verify.shopify); },
  verifyMeta: () => { verify.metaCalls++; return Promise.resolve(verify.meta); },
  verifyGoogle: () => { verify.googleCalls++; return Promise.resolve(verify.google); },
}));

vi.mock('@/lib/getStores', () => ({
  getStores: () => Promise.resolve([
    { storeId: 'uzoshop', storeName: 'uzoshop', brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true, status: 'active', displayOrder: 1 },
    { storeId: 'zolplus', storeName: 'Zol Plus', brandColor: 'var(--store-3)', isHeadless: false, hasTikTok: false, status: 'archived', displayOrder: 2 },
  ]),
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { POST, GET } from '../route';

beforeEach(() => {
  db.secretsUpserts = [];
  db.storesInserts = [];
  db.webhooksInserts = [];
  db.adStateUpserts = [];
  db.deletes = [];
  db.existingStoreIds = [];
  db.existingShopDomains = [];
  db.existingDisplayOrders = [1, 2, 3];
  db.secretRows = [];
  db.throwOn = null;
  db.throwOnCode = null;
  db.decryptMismatchPlaintext = null;
  verify.shopify = { ok: true, message: 'ok', currency: 'CAD' };
  verify.meta = { ok: true, message: 'ok', currency: 'ILS' };
  verify.google = { ok: true, message: 'ok', currency: 'CAD' };
  verify.shopifyCalls = 0;
  verify.metaCalls = 0;
  verify.googleCalls = 0;
});

function post(body: unknown) {
  return POST(new Request('http://x/api/operator/stores', { method: 'POST', body: JSON.stringify(body) }));
}

function validBody(extra: Record<string, unknown> = {}) {
  return {
    storeId: 'newstore',
    name: 'New Store',
    shopDomain: 'newstore.myshopify.com',
    isHeadless: false,
    brandColor: '#1d4ed8',
    hasTiktok: false,
    shopify: { clientId: 'cid', clientSecret: 'csecret' },
    ...extra,
  };
}

function noWrites() {
  return (
    db.secretsUpserts.length === 0 &&
    db.storesInserts.length === 0 &&
    db.webhooksInserts.length === 0 &&
    db.adStateUpserts.length === 0
  );
}

describe('POST /api/operator/stores — validation (writes NOTHING on failure)', () => {
  it('rejects the reserved __global__ id with 400 and no write', async () => {
    const res = await post(validBody({ storeId: '__global__' }));
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('rejects a non-slug storeId with 400 and no write', async () => {
    const res = await post(validBody({ storeId: 'Bad Store!' }));
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('rejects a non-.myshopify.com shopDomain with 400 and no write', async () => {
    const res = await post(validBody({ shopDomain: 'newstore.example.com' }));
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('rejects malformed *.myshopify.com hosts (strict single-label) with 400 and no write', async () => {
    const bad = [
      'evil.com/path.myshopify.com',
      '.myshopify.com',
      'a b.myshopify.com',
      '<script>.myshopify.com',
      'sub.domain.myshopify.com', // multi-label: extra dot before the suffix
      '-leadinghyphen.myshopify.com',
    ];
    for (const shopDomain of bad) {
      const res = await post(validBody({ shopDomain }));
      expect(res.status, `expected 400 for ${shopDomain}`).toBe(400);
      // verify never runs on a rejected domain (no SSRF surface reached)
      expect(verify.shopifyCalls).toBe(0);
      expect(noWrites()).toBe(true);
    }
  });

  it('accepts a valid single-label *.myshopify.com host (regression: legit domains still pass)', async () => {
    const res = await post(validBody({ storeId: 'okstore', shopDomain: 'ok-store123.myshopify.com' }));
    expect([200, 201]).toContain(res.status);
    expect(verify.shopifyCalls).toBe(1);
  });

  it('rejects missing required fields with 400 and no write', async () => {
    const res = await post({ storeId: 'newstore' });
    expect(res.status).toBe(400);
    expect(noWrites()).toBe(true);
  });

  it('returns 409 when a store with this id already exists (no write)', async () => {
    db.existingStoreIds = ['newstore'];
    const res = await post(validBody());
    expect(res.status).toBe(409);
    expect(noWrites()).toBe(true);
  });

  it('returns 409 when a store_webhooks row with this shop_domain exists (no write)', async () => {
    db.existingShopDomains = ['newstore.myshopify.com'];
    const res = await post(validBody());
    expect(res.status).toBe(409);
    expect(noWrites()).toBe(true);
  });
});

describe('POST /api/operator/stores — server-side re-verify', () => {
  it('400 + nothing written when verifyMeta returns ok:false', async () => {
    verify.meta = { ok: false, message: 'meta bad' };
    const res = await post(validBody({ meta: { token: 't', adAccountId: 'act_1' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.verification?.meta).toBeTruthy();
    expect(noWrites()).toBe(true);
  });

  it('always re-verifies Shopify even when a client said it was ok', async () => {
    await post(validBody());
    expect(verify.shopifyCalls).toBe(1);
  });
});

describe('POST /api/operator/stores — happy path (shopify+meta+google)', () => {
  it('writes secrets, stores, webhooks, ad_state and never echoes plaintext', async () => {
    const res = await post(validBody({
      storeId: 'fullstore',
      shopDomain: 'fullstore.myshopify.com',
      hasTiktok: true,
      meta: { token: 'META-PLAINTEXT-TOKEN', adAccountId: 'act_999' },
      google: { customerId: '111-222-3333', refreshToken: 'GOOGLE-REFRESH-PLAINTEXT' },
    }));
    expect([200, 201]).toContain(res.status);

    // store_secrets — all expected keys, encrypted (never raw).
    const secretKeys = db.secretsUpserts.map((r) => r.secret_key);
    expect(secretKeys).toEqual(expect.arrayContaining([
      'SHOPIFY_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET',
      'META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID',
      'GOOGLEADS_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN',
    ]));
    expect(secretKeys).not.toContain('TIKTOK_ADVERTISER_ID');
    for (const r of db.secretsUpserts) {
      expect(String(r.ciphertext)).toMatch(/^C:/); // encrypted, not raw
      expect(r).not.toHaveProperty('plaintext');
    }

    // stores row
    expect(db.storesInserts).toHaveLength(1);
    expect(db.storesInserts[0]).toMatchObject({
      id: 'fullstore', name: 'New Store', status: 'active',
      has_google_ads: true, has_tiktok: true, is_headless: false,
      meta_ad_account_id: 'act_999', google_ads_customer_id: '111-222-3333',
    });

    // store_webhooks row — has a cart_public_token + signing_secret
    expect(db.webhooksInserts).toHaveLength(1);
    const wh = db.webhooksInserts[0];
    expect(wh.shop_domain).toBe('fullstore.myshopify.com');
    expect(typeof wh.cart_public_token).toBe('string');
    expect(String(wh.cart_public_token).length).toBeGreaterThan(0);
    expect(wh.signing_secret).toBe('csecret');

    // store_ad_state — meta + google + tiktok per flags
    const platforms = db.adStateUpserts.map((r) => r.platform).sort();
    expect(platforms).toEqual(['google', 'meta', 'tiktok']);
    for (const r of db.adStateUpserts) expect(r.enabled).toBe(true);

    // response never leaks plaintext secrets
    const text = await res.text();
    expect(text).not.toContain('META-PLAINTEXT-TOKEN');
    expect(text).not.toContain('GOOGLE-REFRESH-PLAINTEXT');
    expect(text).not.toContain('csecret');
  });

  it('shopify-only store writes no meta/google secrets and only the implied ad_state', async () => {
    await post(validBody({ hasTiktok: false }));
    const secretKeys = db.secretsUpserts.map((r) => r.secret_key);
    expect(secretKeys).not.toContain('META_ACCESS_TOKEN');
    expect(secretKeys).not.toContain('GOOGLEADS_CUSTOMER_ID');
    expect(db.adStateUpserts).toHaveLength(0); // no ad platforms
    expect(db.storesInserts[0]).toMatchObject({ has_google_ads: false });
  });

  it('defaults display_order to max(existing)+1 when not provided', async () => {
    db.existingDisplayOrders = [1, 2, 7];
    await post(validBody());
    expect(db.storesInserts[0].display_order).toBe(8);
  });
});

describe('POST /api/operator/stores — rollback on partial failure', () => {
  it('a store_webhooks insert failure rolls back all 4 tables by store_id and returns 500', async () => {
    db.throwOn = 'store_webhooks';
    const res = await post(validBody({
      storeId: 'rollbackstore',
      shopDomain: 'rollbackstore.myshopify.com',
      meta: { token: 't', adAccountId: 'act_1' },
    }));
    expect(res.status).toBe(500);
    const deletedTables = db.deletes.filter((d) => d.storeId === 'rollbackstore').map((d) => d.table).sort();
    expect(deletedTables).toEqual(['store_ad_state', 'store_secrets', 'store_webhooks', 'stores']);
    const text = await res.text();
    expect(text).not.toContain('csecret');
  });

  it('a store_secrets failure DURING the secrets loop rolls back all 4 tables and returns 500', async () => {
    db.throwOn = 'store_secrets';
    const res = await post(validBody({
      storeId: 'secretsfail',
      shopDomain: 'secretsfail.myshopify.com',
      meta: { token: 'META-PLAINTEXT-TOKEN', adAccountId: 'act_1' },
    }));
    expect(res.status).toBe(500);
    const deletedTables = db.deletes.filter((d) => d.storeId === 'secretsfail').map((d) => d.table).sort();
    expect(deletedTables).toEqual(['store_ad_state', 'store_secrets', 'store_webhooks', 'stores']);
    const text = await res.text();
    expect(text).not.toContain('csecret');
    expect(text).not.toContain('META-PLAINTEXT-TOKEN');
  });

  it('a store_ad_state failure (the LAST write) rolls back all 4 tables and returns 500', async () => {
    db.throwOn = 'store_ad_state';
    const res = await post(validBody({
      storeId: 'adstatefail',
      shopDomain: 'adstatefail.myshopify.com',
      meta: { token: 't', adAccountId: 'act_1' }, // ensures an ad platform → store_ad_state write
    }));
    expect(res.status).toBe(500);
    const deletedTables = db.deletes.filter((d) => d.storeId === 'adstatefail').map((d) => d.table).sort();
    expect(deletedTables).toEqual(['store_ad_state', 'store_secrets', 'store_webhooks', 'stores']);
  });

  it('a decrypt-roundtrip MISMATCH throws in upsertSecret → rollback + 500, no plaintext leaked', async () => {
    // Make decryptSecret return a value ≠ the Shopify client secret plaintext.
    db.decryptMismatchPlaintext = 'csecret';
    const res = await post(validBody({
      storeId: 'mismatchstore',
      shopDomain: 'mismatchstore.myshopify.com',
    }));
    expect(res.status).toBe(500);
    const deletedTables = db.deletes.filter((d) => d.storeId === 'mismatchstore').map((d) => d.table).sort();
    expect(deletedTables).toEqual(['store_ad_state', 'store_secrets', 'store_webhooks', 'stores']);
    const text = await res.text();
    expect(text).not.toContain('csecret');
  });

  it('concurrency backstop: a stores PK-conflict (23505) returns 409 and does NOT roll back (loser never wipes the winner)', async () => {
    db.throwOn = 'stores';
    db.throwOnCode = '23505';
    const res = await post(validBody({
      storeId: 'racestore',
      shopDomain: 'racestore.myshopify.com',
      meta: { token: 't', adAccountId: 'act_1' },
    }));
    expect(res.status).toBe(409);
    // The loser created nothing → rollbackStore must NOT have run for ANY table.
    expect(db.deletes).toHaveLength(0);
    // And the loser must not have written secrets either (stores is the first write).
    expect(db.secretsUpserts).toHaveLength(0);
  });

  it('a non-conflict stores insert error returns 500 and does NOT roll back (request owns nothing yet)', async () => {
    db.throwOn = 'stores';
    db.throwOnCode = null; // generic failure, no 23505
    const res = await post(validBody({
      storeId: 'storesfail',
      shopDomain: 'storesfail.myshopify.com',
    }));
    expect(res.status).toBe(500);
    expect(db.deletes).toHaveLength(0);
    expect(db.secretsUpserts).toHaveLength(0);
  });
});

describe('GET /api/operator/stores', () => {
  it('returns the mapped store list with per-store configured platforms and no secret values', async () => {
    db.secretRows = [
      { store_id: 'uzoshop', secret_key: 'SHOPIFY_DOMAIN' },
      { store_id: 'uzoshop', secret_key: 'META_ACCESS_TOKEN' },
      { store_id: 'uzoshop', secret_key: 'GOOGLEADS_CUSTOMER_ID' },
      { store_id: 'zolplus', secret_key: 'SHOPIFY_DOMAIN' },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    const uzo = body.stores.find((s: { storeId: string }) => s.storeId === 'uzoshop');
    expect(uzo.platforms.sort()).toEqual(['google', 'meta', 'shopify']);
    const zol = body.stores.find((s: { storeId: string }) => s.storeId === 'zolplus');
    expect(zol.platforms).toEqual(['shopify']);
    expect(zol.status).toBe('archived'); // includeArchived
    // no ciphertext / iv / tag anywhere in the payload
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('"iv"');
    expect(text).not.toContain('"tag"');
  });
});
