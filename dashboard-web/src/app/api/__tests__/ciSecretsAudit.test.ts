// dashboard-web/src/app/api/__tests__/ciSecretsAudit.test.ts
//
// Self-serve stores Phase 5c — repo-wide secret-echo CI audit.
//
// Generalises the per-route "NEVER returns plaintext" assertion (originally
// only in backfill-secrets/__tests__/route.test.ts) into a single guard over
// EVERY secret-touching route we can import + invoke hermetically.
//
// For each covered route we:
//   1. Mock its DB / external deps exactly as that route's own test does
//      (so the call is hermetic — no network, no Supabase, no real secrets).
//   2. Stub every secret-shaped env var to a recognisable SENTINEL value.
//   3. Invoke the handler and read the FULL response body as text.
//   4. Assert the body contains NONE of the sentinels AND matches no
//      secret-shaped VALUE-leak pattern. (Secret-shaped KEY NAMES alone —
//      e.g. the backfill summary listing "META_ACCESS_TOKEN" — are NOT a
//      leak; only a name paired with a value is.)
//
// A new route that echoes a secret will trip this audit. New secret-touching
// routes SHOULD be added to the COVERED list below as they ship (Phase 6).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — shared across the route mocks below.
// ---------------------------------------------------------------------------

// backfill-secrets: capture upserts + provide an encrypt/decrypt round-trip
// that does NOT echo plaintext into the response (mirrors the route's own test).
const up = vi.hoisted(() => ({
  rows: [] as Array<{ store_id: string; secret_key: string }>,
  error: null as null | { message: string },
}));
const enc = vi.hoisted(() => ({
  encrypt: (p: string) => ({ ciphertext: 'C:' + p, iv: 'IV', tag: 'TAG' }),
  decrypt: (c: string) => c.replace(/^C:/, ''),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      upsert: (row: { store_id: string; secret_key: string }) => {
        up.rows.push(row);
        return Promise.resolve({ error: up.error });
      },
    }),
  }),
}));
vi.mock('@/lib/secretsEncryption', () => ({
  encryptSecret: (p: string) => enc.encrypt(p),
  decryptSecret: (c: string) => enc.decrypt(c),
}));
vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: () => Promise.resolve(['uzoshop', 'zolplus', 'usmile360']),
}));

// store-meta: mock the postgres reader, Sentry, and getStoreSecret. The secret
// reader returns a SENTINEL for TIKTOK_ADVERTISER_ID — which IS client-safe and
// IS returned — so we explicitly exclude that one client-safe value from the
// sentinel set below (it is the documented exception, not a leak).
vi.mock('@/lib/postgresReaders', () => ({
  fetchStoreMetaFromPostgres: vi.fn(async () => [
    {
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      planDisplayName: '',
      shopifyPlus: false,
      partnerDevelopment: false,
      updatedAt: null,
      lastError: null,
      metaAdAccountId: null,
      googleAdsCustomerId: null,
      tiktokAdvertiserId: null,
    },
  ]),
}));
vi.mock('@/lib/sentry/capture', () => ({
  captureRouteError: vi.fn(),
}));
vi.mock('@/lib/storeSecretsReader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storeSecretsReader')>(
    '@/lib/storeSecretsReader',
  );
  return {
    ...actual,
    // store-meta resolves only TIKTOK_ADVERTISER_ID (the one client-safe key).
    getStoreSecret: vi.fn(async (_storeId: string, key: string) =>
      key === 'TIKTOK_ADVERTISER_ID' ? 'CLIENT_SAFE_ADV_ID_7777' : null,
    ),
  };
});

import { POST as backfillSecretsPOST } from '../operator/backfill-secrets/route';
import { GET as storeMetaGET } from '../store-meta/route';

// ---------------------------------------------------------------------------
// Sentinels — every secret-shaped env var stubbed to a uniquely-grep-able token.
// If any of these strings appears in a response body, a secret leaked.
// ---------------------------------------------------------------------------
const SECRET_ENV_SENTINELS: Record<string, string> = {
  // Per-store credentials (UZOSHOP-prefixed — the backfill reads these).
  UZOSHOP_SHOPIFY_DOMAIN: 'SENTINEL_UZO_SHOPIFY_DOMAIN',
  UZOSHOP_SHOPIFY_CLIENT_ID: 'SENTINEL_UZO_SHOPIFY_CLIENT_ID',
  UZOSHOP_SHOPIFY_CLIENT_SECRET: 'SENTINEL_UZO_SHOPIFY_CLIENT_SECRET',
  UZOSHOP_META_ACCESS_TOKEN: 'SENTINEL_UZO_META_ACCESS_TOKEN',
  UZOSHOP_META_AD_ACCOUNT_ID: 'SENTINEL_UZO_META_AD_ACCOUNT_ID',
  UZOSHOP_GOOGLEADS_CUSTOMER_ID: 'SENTINEL_UZO_GADS_CUSTOMER_ID',
  UZOSHOP_GOOGLEADS_REFRESH_TOKEN: 'SENTINEL_UZO_GADS_REFRESH_TOKEN',
  UZOSHOP_TIKTOK_ACCESS_TOKEN: 'SENTINEL_UZO_TIKTOK_ACCESS_TOKEN',
  // Global / shared credentials.
  GOOGLEADS_DEVELOPER_TOKEN: 'SENTINEL_GADS_DEVELOPER_TOKEN',
  GOOGLEADS_CLIENT_ID: 'SENTINEL_GADS_CLIENT_ID',
  GOOGLEADS_CLIENT_SECRET: 'SENTINEL_GADS_CLIENT_SECRET',
  GOOGLEADS_LOGIN_CUSTOMER_ID: 'SENTINEL_GADS_LOGIN_CUSTOMER_ID',
  GOOGLEADS_REFRESH_TOKEN: 'SENTINEL_GADS_REFRESH_TOKEN',
  META_GLOBAL_TOKEN: 'SENTINEL_META_GLOBAL_TOKEN',
  // Infra secrets.
  OPERATOR_SECRET: 'SENTINEL_OPERATOR_SECRET',
  DASHBOARD_PASSWORD: 'SENTINEL_DASHBOARD_PASSWORD',
  AUTH_SIGNING_SECRET: 'SENTINEL_AUTH_SIGNING_SECRET',
  ENCRYPTION_MASTER_KEY: 'SENTINEL_ENCRYPTION_MASTER_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL_SUPABASE_SERVICE_ROLE_KEY',
  INNGEST_SIGNING_KEY: 'SENTINEL_INNGEST_SIGNING_KEY',
};

// Secret-shaped LEAK patterns. These target a secret-shaped key paired with an
// emitted VALUE — i.e. the actual leak shape — NOT a bare key NAME. The backfill
// route legitimately lists secret key NAMES (e.g. `"key":"META_ACCESS_TOKEN"`,
// `"key":"GOOGLEADS_CLIENT_SECRET"`) in its summary; those are not credentials.
// What must NEVER appear is a credential-named field carrying a value, e.g.
// `"access_token":"<value>"` or an `Authorization: Bearer <token>` line.
const SECRET_SHAPED_LEAKS: RegExp[] = [
  // JSON value pairs: a credential-shaped field name followed by a non-empty value.
  /"(access[_-]?token|refresh[_-]?token|client[_-]?secret|operator[_-]?secret|dashboard[_-]?password|encryption[_-]?master[_-]?key|service[_-]?role[_-]?key|signing[_-]?key)"\s*:\s*"[^"]+"/i,
  // Authorization bearer tokens.
  /Bearer\s+[A-Za-z0-9._-]+/i,
  // Any of the literal infra-secret env NAMES appearing with an attached value.
  /(OPERATOR_SECRET|ENCRYPTION_MASTER_KEY|SUPABASE_SERVICE_ROLE_KEY|INNGEST_SIGNING_KEY|DASHBOARD_PASSWORD)["']?\s*[:=]\s*["']?\S/,
];

function stubAllSecretEnvs(): void {
  for (const [name, value] of Object.entries(SECRET_ENV_SENTINELS)) {
    vi.stubEnv(name, value);
  }
}

function assertNoSecretLeak(label: string, body: string): void {
  // Authoritative check: no raw sentinel VALUE may appear in the body. With
  // every secret env var stubbed to a unique grep-able sentinel, a real value
  // leak is caught here regardless of how it was serialised.
  for (const sentinel of Object.values(SECRET_ENV_SENTINELS)) {
    expect(body, `${label} leaked env sentinel ${sentinel}`).not.toContain(sentinel);
  }
  // Defense-in-depth: no secret-shaped value-leak pattern may appear, even for
  // a value we did not anticipate stubbing.
  for (const pat of SECRET_SHAPED_LEAKS) {
    expect(body, `${label} body matched secret-shaped leak ${pat}`).not.toMatch(pat);
  }
}

// Each entry: a human label + an async fn that invokes the route and returns
// the FULL response body text. Add new secret-touching routes here as they ship.
const COVERED: Array<{ label: string; run: () => Promise<string> }> = [
  {
    label: 'POST /api/operator/backfill-secrets',
    run: async () => {
      const req = new Request('http://x/api/operator/backfill-secrets', {
        method: 'POST',
        body: '{}',
      });
      const res = await backfillSecretsPOST(req);
      return res.text();
    },
  },
  {
    label: 'GET /api/store-meta',
    run: async () => {
      const res = await storeMetaGET();
      return res.text();
    },
  },
];

describe('CI secret-echo audit — no secret-touching route echoes a secret', () => {
  beforeEach(() => {
    up.rows = [];
    up.error = null;
    vi.unstubAllEnvs();
    stubAllSecretEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const route of COVERED) {
    it(`${route.label} returns NO secret in its response body`, async () => {
      const body = await route.run();
      assertNoSecretLeak(route.label, body);
    });
  }

  it('covers at least the two baseline secret-touching routes (regression: list not silently emptied)', () => {
    const labels = COVERED.map((c) => c.label);
    expect(labels).toContain('POST /api/operator/backfill-secrets');
    expect(labels).toContain('GET /api/store-meta');
  });

  it('the secret-shaped patterns catch a known leak shape (guard self-test)', () => {
    // Bodies that DID leak a credential VALUE must be caught — proves the
    // matchers work, so a future weakening of SECRET_SHAPED_LEAKS is visible.
    const leaks = [
      '{"access_token":"shpat_realvalue"}',
      '{"client_secret":"abc123"}',
      'Authorization: Bearer abc.def.ghi',
      'OPERATOR_SECRET=topsecret',
    ];
    for (const leak of leaks) {
      expect(SECRET_SHAPED_LEAKS.some((p) => p.test(leak)), `should flag: ${leak}`).toBe(true);
    }
    // A summary that lists secret key NAMES (no values) must NOT be flagged —
    // this is the backfill route's legitimate response shape.
    const safe = [
      '{"rows":[]}',
      '{"summary":[{"key":"META_ACCESS_TOKEN","status":"written"}]}',
      '{"summary":[{"key":"GOOGLEADS_CLIENT_SECRET","status":"skipped-absent"}]}',
    ];
    for (const ok of safe) {
      expect(SECRET_SHAPED_LEAKS.some((p) => p.test(ok)), `should NOT flag: ${ok}`).toBe(false);
    }
  });
});
