# Self-Serve Stores — Phase 3 (Secrets Backfill + Credential-Reader Cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 3 stores' platform credentials from Vercel env vars into the encrypted `store_secrets` table and cut every credential read point over to `getStoreSecret`/`getGlobalSecret` (DB-first, env fallback), with ZERO behavior change for the live pipeline.

**Architecture:** Dual-read everywhere — `getStoreSecret(storeId, key)` reads encrypted DB then falls back to the existing `${STORE}_${KEY}` env var; a new `getGlobalSecret(key)` does the same for shared secrets under a synthetic `__global__` store_id with an *unprefixed* env fallback. An operator-triggered, auth-protected backfill route encrypts the current env values into `store_secrets`. The env vars stay as fallback until Phase 7. Ships in two sub-phases with an operator gate between them: **3A** (reader hardening + secret registry + backfill route) ships and the operator runs the backfill; **3B** (cut the ~12 credential readers over) ships after the backfill is verified.

**Tech Stack:** Next.js App Router (route handlers), Supabase service-role (`getSupabaseAdmin`), Node `crypto` AES-256-GCM (`secretsEncryption.ts`), Vitest (node + jsdom).

---

## Decisions locked by the 2026-06-07 grounding workflow (8-agent read-only sweep + design critic)

These supersede the spec's sketch where they differ — the spec's "5 credential files" undercounted; the real surface is ~12 files. Evidence: `docs/superpowers/specs/2026-06-06-self-serve-store-management-design.md` §"Credential read points" + the grounding critic.

1. **`getGlobalSecret(key)` + `__global__` row are REQUIRED, not optional.** `getStoreSecret`'s env fallback is `process.env[\`${storeId.toUpperCase()}_${key}\`]` — correct for per-store vars, but for a *global* secret it would synthesize a non-existent prefixed name (`UZOSHOP_GOOGLEADS_CLIENT_ID`), return `null`, and the reader (which `throw`s on missing) would break. So global secrets get a synthetic `store_id = '__global__'` row and an **unprefixed** env fallback (`process.env[key]` verbatim). Without this, cutting over any Google/Meta global reader is a guaranteed regression.
2. **Empty-string DB value must fall through to env.** Today `getStoreSecret` returns `decryptSecret(...)` directly; a `''` would shadow the env fallback. Fix: only return a *non-empty* decrypted value, else fall through.
3. **Backfill never writes empty/absent secrets.** For each `(store, key)`: if the env var is present → encrypt + UPSERT; if absent → SKIP (no empty row). An empty row would return `''` (short-circuiting the env fallback) and brick the reader.
4. **TikTok rows are uzoshop-only.** TikTok is ONE shared ad account owned by uzoshop; zolplus/usmile360 are tenants via `campaignStoreMap`. Backfill TikTok keys for uzoshop only; never write TikTok rows for the other two.
5. **Google global-vs-per-store precedence preserved exactly:** per-store DB → per-store env → global DB → global env (the existing 2-tier refresh-token fallback).
6. **COGS_RATE is config, NOT a secret.** `${STORE}_COGS_RATE` (cronDaily.ts:290, cronLive.ts:189, analytics.ts:33) is calibration with a 0.25 default and is already editable via the client `cogs-settings` state ([[editable-cogs-percent-pending]]). It is explicitly OUT of `store_secrets`. P7's env-removal must treat it as independent legacy config (safe to drop — client + default cover it).
7. **Sync Boolean feature-gates stay env-based in P3.** `isTikTokConfiguredForStore` (tiktokAccountConfig.ts:82-83), `googleAccountConfig.ts:84-85`, run in store-enumeration loops; awaiting per-store inside a filter would ripple. They check "does this store have creds" — for the 3 existing stores (all have env) the env check stays correct, so leaving them is zero-regression. **Known follow-up (Phase 4/6):** once new stores are added with DB-only creds, these gates MUST consult DB or a once-resolved config map, else a new store is silently skipped. Documented, not done here.
8. **Async ripple = LOW.** Every credential reader is async or a sync private helper called only from already-async functions. The 3 sync helpers (`getMetaToken`, `getMetaAdAccountId`, `getCustomerIdOrThrow`+`buildGoogleAdsHeaders`) become async with `await` added at their existing call sites — no consumer flips sync→async; no async reaches render/client code.
9. **`ENCRYPTION_MASTER_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are bootstrap secrets** that can never live in `store_secrets` (chicken-and-egg). They stay env-only forever; P7's sweep must exempt them.
10. **Two-sub-phase ship with an operator gate.** 3A code is inert in the pipeline (only the on-demand backfill route uses the new writers) → ships safely even before `ENCRYPTION_MASTER_KEY` is set (no rows ⇒ no decrypt ⇒ env fallback). The operator then sets the key + runs the backfill + verifies. Only then does 3B (reader cutover) ship.

### Canonical secret-key inventory (grounding-confirmed; `secret_key` = env-var suffix)
| Platform | Logical key (`secret_key`) | Env var | Scope | Stores |
|---|---|---|---|---|
| Shopify | `SHOPIFY_DOMAIN` | `${STORE}_SHOPIFY_DOMAIN` | per-store | all 3 |
| Shopify | `SHOPIFY_CLIENT_ID` | `${STORE}_SHOPIFY_CLIENT_ID` | per-store | all 3 |
| Shopify | `SHOPIFY_CLIENT_SECRET` | `${STORE}_SHOPIFY_CLIENT_SECRET` | per-store | all 3 |
| Meta | `META_ACCESS_TOKEN` | `${STORE}_META_ACCESS_TOKEN` | per-store | all 3 |
| Meta | `META_AD_ACCOUNT_ID` | `${STORE}_META_AD_ACCOUNT_ID` | per-store | all 3 |
| Meta | `META_GLOBAL_TOKEN` | `META_GLOBAL_TOKEN` | global | fallback |
| Google | `GOOGLEADS_CUSTOMER_ID` | `${STORE}_GOOGLEADS_CUSTOMER_ID` | per-store | uzoshop (skip-absent) |
| Google | `GOOGLEADS_REFRESH_TOKEN` | `${STORE}_GOOGLEADS_REFRESH_TOKEN` | per-store override | uzoshop (skip-absent) |
| Google | `GOOGLEADS_DEVELOPER_TOKEN` | `GOOGLEADS_DEVELOPER_TOKEN` | global | shared |
| Google | `GOOGLEADS_CLIENT_ID` | `GOOGLEADS_CLIENT_ID` | global | shared |
| Google | `GOOGLEADS_CLIENT_SECRET` | `GOOGLEADS_CLIENT_SECRET` | global | shared |
| Google | `GOOGLEADS_LOGIN_CUSTOMER_ID` | `GOOGLEADS_LOGIN_CUSTOMER_ID` | global (optional) | shared |
| Google | `GOOGLEADS_REFRESH_TOKEN` | `GOOGLEADS_REFRESH_TOKEN` | global | shared |
| TikTok | `TIKTOK_ADVERTISER_ID` | `${STORE}_TIKTOK_ADVERTISER_ID` | shared-account | uzoshop only |
| TikTok | `TIKTOK_ACCESS_TOKEN` | `${STORE}_TIKTOK_ACCESS_TOKEN` | shared-account | uzoshop only |

### Credential read points to cut over (grounding-confirmed; full surface)
- **Primary (must cut over in 3B):** `lib/fetchers/shopifyAuth.ts:79-81`, `shopify.ts:612` + `:680` (domain), `meta.ts:244-276` (getMetaToken/getMetaAdAccountId), `metaAccountConfig.ts:22-48`, `fetchMeta.ts:75`, `googleAds.ts:178/202-208/263/277`, `tiktok.ts:133-134` (getTikTokCreds) + `tiktokAccountConfig.ts:53-54` (readTikTokCredsFromEnv), `postgresReaders.ts:1810` (hardcoded `UZOSHOP_TIKTOK_ADVERTISER_ID`), `store-meta/route.ts:25` (client-facing advertiser-id echo).
- **Secondary (cut over in 3B-T8):** `shopifyBulkFirstOrder.ts:248`, `shopifyBulkCohort.ts:254` (domain in bulk utilities).
- **Out of scope (config/gates — documented, not moved):** COGS_RATE readers (cronDaily.ts:290, cronLive.ts:189, analytics.ts:33); Boolean feature-gates (tiktokAccountConfig.ts:82-83, googleAccountConfig.ts:84-85).

---

# SUB-PHASE 3A — Reader hardening + secret registry + backfill route (ships first, inert in pipeline)

## Task 1: Harden `getStoreSecret` + add `getGlobalSecret` + reserved-id constants

**Files:**
- Modify: `dashboard-web/src/lib/storeSecretsReader.ts`
- Test: `dashboard-web/src/lib/__tests__/storeSecretsReader.test.ts` (create or extend if present)

- [ ] **Step 1: Write the failing tests** — `dashboard-web/src/lib/__tests__/storeSecretsReader.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the admin client + the crypto so we control DB rows and decrypt outcomes.
const db = vi.hoisted(() => ({ row: null as null | { ciphertext: string; iv: string; tag: string }, error: null as null | { message: string } }));
const crypto = vi.hoisted(() => ({ decrypt: (() => '') as (c: string, i: string, t: string) => string }));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: db.row, error: db.error }) }) }) }) }),
  }),
}));
vi.mock('@/lib/secretsEncryption', () => ({ decryptSecret: (c: string, i: string, t: string) => crypto.decrypt(c, i, t) }));

import { getStoreSecret, getGlobalSecret, GLOBAL_STORE_ID } from '@/lib/storeSecretsReader';

beforeEach(() => { db.row = null; db.error = null; crypto.decrypt = () => 'DECRYPTED'; vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('getStoreSecret — DB-first, env fallback, decrypt-safe', () => {
  it('returns the decrypted DB value when the row exists and decrypts non-empty', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => 'from-db';
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBe('from-db');
  });
  it('falls back to the prefixed env var when no DB row', async () => {
    db.row = null; vi.stubEnv('UZOSHOP_META_ACCESS_TOKEN', 'from-env');
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBe('from-env');
  });
  it('falls back to env when the DB read errors', async () => {
    db.error = { message: 'boom' }; vi.stubEnv('UZOSHOP_META_ACCESS_TOKEN', 'from-env');
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBe('from-env');
  });
  it('falls back to env when decrypt THROWS (bad tag / wrong key)', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => { throw new Error('bad tag'); };
    vi.stubEnv('UZOSHOP_META_ACCESS_TOKEN', 'from-env');
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBe('from-env');
  });
  it('treats an empty-string DB value as fall-through to env (never returns "")', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => '';
    vi.stubEnv('UZOSHOP_META_ACCESS_TOKEN', 'from-env');
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBe('from-env');
  });
  it('returns null when neither DB nor env has the secret', async () => {
    db.row = null;
    expect(await getStoreSecret('uzoshop', 'META_ACCESS_TOKEN')).toBeNull();
  });
});

describe('getGlobalSecret — __global__ row with UNPREFIXED env fallback', () => {
  it('falls back to the UNPREFIXED env var (process.env[key] verbatim)', async () => {
    db.row = null; vi.stubEnv('GOOGLEADS_CLIENT_ID', 'global-env');
    expect(await getGlobalSecret('GOOGLEADS_CLIENT_ID')).toBe('global-env');
  });
  it('does NOT synthesize a prefixed name for the global id', async () => {
    db.row = null; vi.stubEnv('__GLOBAL___GOOGLEADS_CLIENT_ID', 'WRONG');
    expect(await getGlobalSecret('GOOGLEADS_CLIENT_ID')).toBeNull(); // no unprefixed var set → null, not the wrong prefixed one
  });
  it('returns the decrypted __global__ DB value when present', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => 'global-db';
    expect(await getGlobalSecret('META_GLOBAL_TOKEN')).toBe('global-db');
  });
  it('GLOBAL_STORE_ID is the reserved literal', () => { expect(GLOBAL_STORE_ID).toBe('__global__'); });
});
```

- [ ] **Step 2: Run them, confirm they FAIL.** `cd dashboard-web && npx vitest run src/lib/__tests__/storeSecretsReader.test.ts` — the `getGlobalSecret`/`GLOBAL_STORE_ID` import fails (not exported) and the empty-string test fails (current code returns `''`).

- [ ] **Step 3: Implement** — replace `dashboard-web/src/lib/storeSecretsReader.ts` body:
```ts
// dashboard-web/src/lib/storeSecretsReader.ts
// Per-store secret resolution: encrypted DB (store_secrets) FIRST, then the
// existing Vercel env var as fallback, then null. The fallback keeps every store
// working during the env→DB migration. Server-only. store_secrets has NO anon
// grant → read via the service-role admin client.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { decryptSecret } from '@/lib/secretsEncryption';

// Synthetic store_id for shared/global secrets (GOOGLEADS_*, META_GLOBAL_TOKEN).
// Reserved: must never be a real store id (guard in the Phase-6 create route).
export const GLOBAL_STORE_ID = '__global__';
export const RESERVED_STORE_IDS = [GLOBAL_STORE_ID] as const;

export async function getStoreSecret(storeId: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('store_secrets')
      .select('ciphertext, iv, tag')
      .eq('store_id', storeId)
      .eq('secret_key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const val = decryptSecret(data.ciphertext as string, data.iv as string, data.tag as string);
      if (val) return val; // non-empty DB value wins; empty/'' falls through to env
    }
  } catch (e) {
    // DB read or decrypt failure → fall through to env (never throw; never log the value)
    console.warn(
      `getStoreSecret(${storeId}, ${key}) DB read failed, using env fallback:`,
      e instanceof Error ? e.message : e,
    );
  }
  // Global secrets fall back to the UNPREFIXED env var; per-store to ${STORE}_${KEY}.
  const envName = storeId === GLOBAL_STORE_ID ? key : `${storeId.toUpperCase()}_${key}`;
  const env = process.env[envName];
  return env ?? null;
}

// Shared/global secret: same DB-then-env resolution under the __global__ id, with
// an unprefixed env fallback (process.env[key] verbatim).
export function getGlobalSecret(key: string): Promise<string | null> {
  return getStoreSecret(GLOBAL_STORE_ID, key);
}
```

- [ ] **Step 4: Run the tests, confirm PASS.** `npx vitest run src/lib/__tests__/storeSecretsReader.test.ts` → all green. `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit.**
```bash
git add dashboard-web/src/lib/storeSecretsReader.ts dashboard-web/src/lib/__tests__/storeSecretsReader.test.ts
git commit -m "feat(secrets): harden getStoreSecret (empty→env) + add getGlobalSecret/__global__ (Phase 3A)"
```
(Trailing blank line + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` on every commit in this plan.)

---

## Task 2: Secret-key registry (single source of truth for the backfill)

**Files:**
- Create: `dashboard-web/src/lib/secretsRegistry.ts`
- Test: `dashboard-web/src/lib/__tests__/secretsRegistry.test.ts`

- [ ] **Step 1: Write the failing test** — `dashboard-web/src/lib/__tests__/secretsRegistry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PER_STORE_SECRET_KEYS, GLOBAL_SECRET_KEYS, perStoreKeysForStore } from '@/lib/secretsRegistry';

describe('secretsRegistry', () => {
  it('lists the per-store secret keys with their env suffix == secret_key', () => {
    const keys = PER_STORE_SECRET_KEYS.map((k) => k.key);
    expect(keys).toEqual(expect.arrayContaining([
      'SHOPIFY_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET',
      'META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID',
      'GOOGLEADS_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN',
      'TIKTOK_ADVERTISER_ID', 'TIKTOK_ACCESS_TOKEN',
    ]));
  });
  it('lists the global secret keys', () => {
    expect(GLOBAL_SECRET_KEYS).toEqual(expect.arrayContaining([
      'GOOGLEADS_DEVELOPER_TOKEN', 'GOOGLEADS_CLIENT_ID', 'GOOGLEADS_CLIENT_SECRET',
      'GOOGLEADS_LOGIN_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN', 'META_GLOBAL_TOKEN',
    ]));
  });
  it('TikTok keys apply to uzoshop ONLY (shared-account owner)', () => {
    expect(perStoreKeysForStore('uzoshop')).toEqual(expect.arrayContaining(['TIKTOK_ADVERTISER_ID', 'TIKTOK_ACCESS_TOKEN']));
    expect(perStoreKeysForStore('zolplus')).not.toContain('TIKTOK_ADVERTISER_ID');
    expect(perStoreKeysForStore('usmile360')).not.toContain('TIKTOK_ACCESS_TOKEN');
  });
  it('Shopify + Meta keys apply to every store', () => {
    for (const s of ['uzoshop', 'zolplus', 'usmile360']) {
      expect(perStoreKeysForStore(s)).toEqual(expect.arrayContaining(['SHOPIFY_DOMAIN', 'META_ACCESS_TOKEN']));
    }
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (module missing). `npx vitest run src/lib/__tests__/secretsRegistry.test.ts`.

- [ ] **Step 3: Implement** — `dashboard-web/src/lib/secretsRegistry.ts`:
```ts
// dashboard-web/src/lib/secretsRegistry.ts
// Single source of truth for WHICH secret keys exist, per platform/scope. Used by
// the backfill route to know what env vars to encrypt into store_secrets. The
// `key` IS the store_secrets.secret_key AND the env-var suffix (${STORE}_${key}).
// Readers reference specific keys inline; this registry is the backfill's contract.

export type SecretScope = 'all' | string[];

export interface PerStoreSecretKey {
  platform: 'shopify' | 'meta' | 'google' | 'tiktok';
  key: string;
  appliesTo: SecretScope; // 'all' = every active store; or an explicit store-id list
}

// Per-store secret keys. Backfill SKIPS any whose env var is absent, so 'all' is
// safe for google (only uzoshop has the vars today). TikTok is restricted to
// uzoshop because it is the shared-account owner — never write TikTok rows for
// the tenant stores (would shadow the env fallback with an empty/foreign value).
export const PER_STORE_SECRET_KEYS: PerStoreSecretKey[] = [
  { platform: 'shopify', key: 'SHOPIFY_DOMAIN', appliesTo: 'all' },
  { platform: 'shopify', key: 'SHOPIFY_CLIENT_ID', appliesTo: 'all' },
  { platform: 'shopify', key: 'SHOPIFY_CLIENT_SECRET', appliesTo: 'all' },
  { platform: 'meta', key: 'META_ACCESS_TOKEN', appliesTo: 'all' },
  { platform: 'meta', key: 'META_AD_ACCOUNT_ID', appliesTo: 'all' },
  { platform: 'google', key: 'GOOGLEADS_CUSTOMER_ID', appliesTo: 'all' },
  { platform: 'google', key: 'GOOGLEADS_REFRESH_TOKEN', appliesTo: 'all' },
  { platform: 'tiktok', key: 'TIKTOK_ADVERTISER_ID', appliesTo: ['uzoshop'] },
  { platform: 'tiktok', key: 'TIKTOK_ACCESS_TOKEN', appliesTo: ['uzoshop'] },
];

// Shared/global secrets, stored under store_id '__global__' (unprefixed env name).
export const GLOBAL_SECRET_KEYS: string[] = [
  'GOOGLEADS_DEVELOPER_TOKEN',
  'GOOGLEADS_CLIENT_ID',
  'GOOGLEADS_CLIENT_SECRET',
  'GOOGLEADS_LOGIN_CUSTOMER_ID',
  'GOOGLEADS_REFRESH_TOKEN',
  'META_GLOBAL_TOKEN',
];

export function perStoreKeysForStore(storeId: string): string[] {
  return PER_STORE_SECRET_KEYS
    .filter((k) => k.appliesTo === 'all' || k.appliesTo.includes(storeId))
    .map((k) => k.key);
}
```

- [ ] **Step 4: Run, confirm PASS.** `npx vitest run src/lib/__tests__/secretsRegistry.test.ts`. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit.**
```bash
git add dashboard-web/src/lib/secretsRegistry.ts dashboard-web/src/lib/__tests__/secretsRegistry.test.ts
git commit -m "feat(secrets): secret-key registry (per-store + global) for backfill (Phase 3A)"
```

---

## Task 3: Operator backfill route `/api/operator/backfill-secrets`

**Files:**
- Create: `dashboard-web/src/app/api/operator/backfill-secrets/route.ts`
- Test: `dashboard-web/src/app/api/operator/backfill-secrets/__tests__/route.test.ts`

**Context (grounding-confirmed):** `/api/operator/*` routes are auto-gated by middleware (dash_auth cookie + `x-operator-secret` header) — NO in-route auth, NO allowlist entry. Use `getSupabaseAdmin()` for the UPSERT. Declare `export const dynamic = 'force-dynamic'` + `export const runtime = 'nodejs'`. Use `userFacingError` + `captureRouteError` like sibling routes.

- [ ] **Step 1: Write the failing route test** — `dashboard-web/src/app/api/operator/backfill-secrets/__tests__/route.test.ts`:
```ts
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
    // everything else absent → must be skipped
    const res = await POST(req());
    const body = await res.json();
    const written = up.rows.map((r) => `${r.store_id}:${r.secret_key}`);
    expect(written).toContain('uzoshop:SHOPIFY_DOMAIN');
    expect(written).toContain('uzoshop:META_ACCESS_TOKEN');
    expect(written).not.toContain('zolplus:SHOPIFY_DOMAIN'); // env absent → skipped
    expect(body.summary).toBeTruthy();
  });
  it('writes TikTok rows for uzoshop ONLY (never tenant stores)', async () => {
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', 'adv');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tt');
    vi.stubEnv('ZOLPLUS_TIKTOK_ADVERTISER_ID', 'SHOULD_NOT_BE_READ'); // not in registry for zolplus
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
```

- [ ] **Step 2: Run it, confirm FAIL** (route missing). `npx vitest run src/app/api/operator/backfill-secrets/__tests__/route.test.ts`.

- [ ] **Step 3: Implement** — `dashboard-web/src/app/api/operator/backfill-secrets/route.ts`:
```ts
// dashboard-web/src/app/api/operator/backfill-secrets/route.ts
// Operator-triggered, auth-gated (middleware: dash_auth cookie + x-operator-secret)
// backfill of Vercel env secrets into the encrypted store_secrets table. Runs on
// Vercel (the only place env secrets + ENCRYPTION_MASTER_KEY + service-role coexist).
// Idempotent UPSERT. Skips absent env vars (never writes empty rows). Decrypt-
// roundtrip verifies each write WITHOUT echoing any plaintext.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { encryptSecret, decryptSecret } from '@/lib/secretsEncryption';
import { loadActiveStoreIds } from '@/lib/getStores';
import { perStoreKeysForStore, GLOBAL_SECRET_KEYS } from '@/lib/secretsRegistry';
import { GLOBAL_STORE_ID } from '@/lib/storeSecretsReader';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Entry = { store: string; key: string; status: 'written' | 'skipped-absent' | 'error'; verified?: boolean };

async function upsertSecret(storeId: string, key: string, plaintext: string): Promise<Entry> {
  const { ciphertext, iv, tag } = encryptSecret(plaintext);
  const { error } = await getSupabaseAdmin()
    .from('store_secrets')
    .upsert({ store_id: storeId, secret_key: key, ciphertext, iv, tag, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  // Roundtrip-verify without echoing plaintext: decrypt and compare in-memory.
  const verified = decryptSecret(ciphertext, iv, tag) === plaintext;
  return { store: storeId, key, status: 'written', verified };
}

export async function POST(): Promise<NextResponse> {
  try {
    // Fail fast + clean if the master key is misconfigured: encrypt a probe so we
    // never write a partial/half-encrypted backfill. Throws → caught below → 500.
    encryptSecret('__probe__');

    const storeIds = await loadActiveStoreIds();
    const summary: Entry[] = [];

    for (const storeId of storeIds) {
      for (const key of perStoreKeysForStore(storeId)) {
        const val = process.env[`${storeId.toUpperCase()}_${key}`];
        if (val) summary.push(await upsertSecret(storeId, key, val));
        else summary.push({ store: storeId, key, status: 'skipped-absent' });
      }
    }
    for (const key of GLOBAL_SECRET_KEYS) {
      const val = process.env[key];
      if (val) summary.push(await upsertSecret(GLOBAL_STORE_ID, key, val));
      else summary.push({ store: GLOBAL_STORE_ID, key, status: 'skipped-absent' });
    }

    const written = summary.filter((s) => s.status === 'written').length;
    const failedVerify = summary.filter((s) => s.status === 'written' && !s.verified).length;
    return NextResponse.json({ written, failedVerify, summary }, { status: 200 });
  } catch (err) {
    captureRouteError('operator/backfill-secrets', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/backfill-secrets POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run, confirm PASS.** `npx vitest run src/app/api/operator/backfill-secrets/__tests__/route.test.ts`. `npx tsc --noEmit` → 0. `npm run lint` → no new errors.

- [ ] **Step 5: Commit.**
```bash
git add dashboard-web/src/app/api/operator/backfill-secrets/
git commit -m "feat(secrets): operator backfill-secrets route (encrypt env→store_secrets, idempotent, verify) (Phase 3A)"
```

---

## Task 4: 3A docs + gate, ship 3A

**Files:** `docs/ARCHITECTURE.md` (extend §45). **No User Manual** — the docs-currency gate's UX rule fires only for `components/*.tsx` / `app/**/page|layout.tsx`; 3A touches only `lib/*` + an `app/api/**/route.ts`, so neither the UX rule nor the Arch rule (inngest/migrations/fetchers/postgresReaders) requires a doc. ARCHITECTURE §45 is good practice, not gate-mandated; a UM entry would be misleading UX noise for a backend-only change.

- [ ] **Step 1: ARCHITECTURE §45 (part 1).** Add "Self-serve stores Phase 3A — secrets infra". Cover: `getStoreSecret` hardened (empty→env, decrypt-throw→env) + `getGlobalSecret`/`__global__` with unprefixed env fallback; `secretsRegistry` (TikTok uzoshop-only); the backfill route (middleware auth, idempotent UPSERT `onConflict store_id,secret_key`, skip-absent, decrypt-roundtrip-verify, no plaintext echo, probe-fail-fast); state that 3A is inert in the pipeline (only the on-demand route uses the writers) so it ships before `ENCRYPTION_MASTER_KEY` is set with zero risk.
- [ ] **Step 2: Full local gate.** `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green.
- [ ] **Step 3: Commit.** `git commit -m "docs(secrets): ARCHITECTURE §45 — Phase 3A secrets infra"`.

---

# 🔒 OPERATOR GATE (between 3A and 3B) — must complete before 3B

> 3A code is inert; 3B (reader cutover) must NOT ship until this gate is done and verified.

1. **Operator sets `ENCRYPTION_MASTER_KEY` in Vercel** — a base64-encoded 32-byte key. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Add to Vercel Project → Settings → Environment Variables (Production). Redeploy so the running functions pick it up.
2. **Push 3A** (`git push origin main`) — operator-gated per project rule.
3. **Run the backfill** (authenticated, production — never localhost):
   ```bash
   curl -X POST https://roas-dashboard-smoky.vercel.app/api/operator/backfill-secrets \
     -H "x-operator-secret: $OPERATOR_SECRET" \
     -H "Cookie: dash_auth=$DASH_AUTH_TOKEN" \
     -H "Content-Type: application/json" -d '{}'
   ```
   Expect JSON: `{ written: N, failedVerify: 0, summary: [...] }` with `failedVerify === 0` and every present secret `status:'written', verified:true`. (`OPERATOR_SECRET` + a valid `dash_auth` cookie from a logged-in browser session are required.)
4. **Verify in the DB** (service-role, e.g. Supabase SQL editor): `select store_id, secret_key, updated_at from store_secrets order by store_id, secret_key;` — confirm: each store has its Shopify(3)+Meta(2) rows; uzoshop also has Google(2)+TikTok(2); `__global__` has the present GOOGLEADS_* + META_GLOBAL_TOKEN rows; **zolplus/usmile360 have NO TikTok rows**.
5. **Confirm `failedVerify === 0`.** If any verify failed, STOP — do not proceed to 3B; investigate the master key / encoding.

Only after this gate passes does 3B begin.

---

# SUB-PHASE 3B — Cut credential readers over to getStoreSecret/getGlobalSecret

> Every reader keeps its EXACT current error message + degradation. With the DB populated (gate above), readers now read DB-first; the env fallback remains, so even a DB miss is byte-identical to today. Each task ships independently and is reversible (revert the file).

## Task 5: Shopify readers → `getStoreSecret`

**Files:** `dashboard-web/src/lib/fetchers/shopifyAuth.ts` (lines 79-93), `dashboard-web/src/lib/fetchers/shopify.ts` (612, 680). Tests: `dashboard-web/src/lib/fetchers/__tests__/shopifyAuth.secrets.test.ts`.

- [ ] **Step 1: READ** `shopifyAuth.ts:71-128` (`getShopifyAccessToken` is async; reads `${upper}_SHOPIFY_DOMAIN/_CLIENT_ID/_CLIENT_SECRET`, collects missing into an array, throws the combined message). Read `shopify.ts:604-619` (`fetchShopifyDayRows`, async, reads `_SHOPIFY_DOMAIN`) + `shopify.ts:676-688` (`getShopifyCreds`, async, reads `_SHOPIFY_DOMAIN`).

- [ ] **Step 2: Write the failing test** — `dashboard-web/src/lib/fetchers/__tests__/shopifyAuth.secrets.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sec = vi.hoisted(() => ({ map: {} as Record<string, string | null> }));
vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: (storeId: string, key: string) => Promise.resolve(sec.map[`${storeId}:${key}`] ?? null),
}));
import { _resetShopifyAuthCacheForTesting } from '@/lib/fetchers/shopifyAuth';
// (import the function under test; if getShopifyAccessToken does the OAuth exchange,
//  mock global fetch to return a token so the test asserts only the credential source.)

beforeEach(() => { sec.map = {}; _resetShopifyAuthCacheForTesting?.(); vi.unstubAllEnvs(); });

describe('Shopify creds come from getStoreSecret (DB→env)', () => {
  it('reads SHOPIFY_DOMAIN/CLIENT_ID/CLIENT_SECRET via getStoreSecret for the store', async () => {
    sec.map['uzoshop:SHOPIFY_DOMAIN'] = 'uzo.myshopify.com';
    sec.map['uzoshop:SHOPIFY_CLIENT_ID'] = 'cid';
    sec.map['uzoshop:SHOPIFY_CLIENT_SECRET'] = 'csec';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'shpat_x', expires_in: 3600 }) }) as unknown as typeof fetch;
    const { getShopifyAccessToken } = await import('@/lib/fetchers/shopifyAuth');
    expect(await getShopifyAccessToken('uzoshop')).toBe('shpat_x');
  });
  it('throws the EXACT same combined-missing message when all three are absent', async () => {
    const { getShopifyAccessToken } = await import('@/lib/fetchers/shopifyAuth');
    await expect(getShopifyAccessToken('uzoshop')).rejects.toThrow(
      /Missing Shopify env vars for store "uzoshop": .*SHOPIFY_DOMAIN.*SHOPIFY_CLIENT_ID.*SHOPIFY_CLIENT_SECRET.*Phase 05\.7\.7/,
    );
  });
});
```
(Adapt the assertion to the real exact error string read in Step 1.)

- [ ] **Step 3: Run, confirm FAIL.** `npx vitest run src/lib/fetchers/__tests__/shopifyAuth.secrets.test.ts`.

- [ ] **Step 4: Implement.** In `shopifyAuth.ts`, replace the three `process.env[...]` reads inside `getShopifyAccessToken` with `await getStoreSecret(storeId, 'SHOPIFY_DOMAIN')` etc. (the function is already async). Keep the missing-collection + the EXACT throw message verbatim. Add `import { getStoreSecret } from '@/lib/storeSecretsReader';`. In `shopify.ts:612` and `:680`, replace `process.env[\`${upper}_SHOPIFY_DOMAIN\`]` with `await getStoreSecret(storeId, 'SHOPIFY_DOMAIN')` (both call sites are async).
```ts
// shopifyAuth.ts — inside getShopifyAccessToken(storeId), after computing `upper`:
const domain = await getStoreSecret(storeId, 'SHOPIFY_DOMAIN');
const clientId = await getStoreSecret(storeId, 'SHOPIFY_CLIENT_ID');
const clientSecret = await getStoreSecret(storeId, 'SHOPIFY_CLIENT_SECRET');
const missing: string[] = [];
if (!domain) missing.push(`${upper}_SHOPIFY_DOMAIN`);
if (!clientId) missing.push(`${upper}_SHOPIFY_CLIENT_ID`);
if (!clientSecret) missing.push(`${upper}_SHOPIFY_CLIENT_SECRET`);
if (missing.length) {
  throw new Error(
    `Missing Shopify env vars for store "${storeId}": ${missing.join(', ')} (Phase 05.7.7: Dev Dashboard apps use Client ID + Client Secret via OAuth client_credentials grant — see PROPS-MAP.md).`,
  );
}
```

- [ ] **Step 5: Run the new test + the existing shopify suites.** `npx vitest run src/lib/fetchers/__tests__/` (all shopify tests) → green. `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(secrets): Shopify creds via getStoreSecret (DB→env) (Phase 3B)"`.

---

## Task 6: Meta readers → `getStoreSecret` + `getGlobalSecret`

**Files:** `dashboard-web/src/lib/fetchers/meta.ts` (getMetaToken 244-259, getMetaAdAccountId 261-276), `metaAccountConfig.ts` (22-48), `fetchMeta.ts` (75). Tests: `dashboard-web/src/lib/fetchers/__tests__/metaCreds.secrets.test.ts`.

- [ ] **Step 1: READ** the two sync helpers in `meta.ts` (`getMetaToken`: per-store `${upper}_META_ACCESS_TOKEN` `||` `process.env.META_GLOBAL_TOKEN`; `getMetaAdAccountId`: `${upper}_META_AD_ACCOUNT_ID` with `act_` strip + trim) and their 5 callers (`fetchMetaAdSetInsights`, `fetchMetaSpendForDay`, `fetchMetaSpendForDayLight`, `fetchMetaAdInsights`, `fetchMetaBudgets` — all async). Read `metaAccountConfig.ts` wrappers (already async) and `fetchMeta.ts:75` (`${storeId.toUpperCase()}_META_AD_ACCOUNT_ID`). Note the EXACT error messages + the `act_` normalization (`raw.replace(/^act_/, '').trim()`).

- [ ] **Step 2: Write the failing test** — `metaCreds.secrets.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sec = vi.hoisted(() => ({ store: {} as Record<string, string | null>, global: {} as Record<string, string | null> }));
vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: (s: string, k: string) => Promise.resolve(sec.store[`${s}:${k}`] ?? null),
  getGlobalSecret: (k: string) => Promise.resolve(sec.global[k] ?? null),
}));
beforeEach(() => { sec.store = {}; sec.global = {}; });

describe('Meta creds via getStoreSecret/getGlobalSecret', () => {
  it('uses the per-store token first', async () => {
    sec.store['uzoshop:META_ACCESS_TOKEN'] = 'per-store-tok';
    sec.store['uzoshop:META_AD_ACCOUNT_ID'] = 'act_12345';
    const { getMetaAccessTokenForStore, getAdAccountIdForStore } = await import('@/lib/fetchers/metaAccountConfig');
    expect(await getMetaAccessTokenForStore('uzoshop')).toBe('per-store-tok');
    expect(await getAdAccountIdForStore('uzoshop')).toBe('12345'); // act_ stripped
  });
  it('falls back to the GLOBAL meta token when per-store absent', async () => {
    sec.global['META_GLOBAL_TOKEN'] = 'global-tok';
    const { getMetaAccessTokenForStore } = await import('@/lib/fetchers/metaAccountConfig');
    expect(await getMetaAccessTokenForStore('zolplus')).toBe('global-tok');
  });
  it('throws the exact message when no token anywhere', async () => {
    const { getMetaAccessTokenForStore } = await import('@/lib/fetchers/metaAccountConfig');
    await expect(getMetaAccessTokenForStore('zolplus')).rejects.toThrow(/Missing Meta access token for zolplus/);
  });
});
```

- [ ] **Step 3: Run, confirm FAIL.**

- [ ] **Step 4: Implement.** Make `getMetaToken` + `getMetaAdAccountId` (meta.ts) `async`; replace env reads with `await getStoreSecret(storeId, 'META_ACCESS_TOKEN')` and the global fallback `await getGlobalSecret('META_GLOBAL_TOKEN')`; for the account id, `await getStoreSecret(storeId, 'META_AD_ACCOUNT_ID')` then apply the SAME `replace(/^act_/, '').trim()` normalization. Add `await` at the 5 call sites (all already async). Do the same in `metaAccountConfig.ts` (already async) and `fetchMeta.ts:75`. Preserve the EXACT error strings:
```ts
// meta.ts getMetaToken (now async):
const perStore = await getStoreSecret(storeId, 'META_ACCESS_TOKEN');
const token = perStore || (await getGlobalSecret('META_GLOBAL_TOKEN'));
if (!token) throw new Error(`Missing Meta access token for ${storeId}. Set ${upper}_META_ACCESS_TOKEN (per docs/PROPS-MAP.md) or META_GLOBAL_TOKEN as a Vercel environment variable.`);
return token;
// meta.ts getMetaAdAccountId (now async):
const raw = (await getStoreSecret(storeId, 'META_AD_ACCOUNT_ID')) || '';
const stripped = raw.replace(/^act_/, '').trim();
if (!stripped) throw new Error(`Missing Meta ad account id for ${storeId}. Set ${upper}_META_AD_ACCOUNT_ID (per docs/PROPS-MAP.md; numeric, optionally with act_ prefix).`);
return stripped;
```

- [ ] **Step 5: Run the meta suites + tsc.** `npx vitest run src/lib/fetchers/__tests__/` → green. Verify the 5 call sites compile (tsc 0).

- [ ] **Step 6: Commit.** `git commit -m "feat(secrets): Meta creds via getStoreSecret + META_GLOBAL_TOKEN via getGlobalSecret (Phase 3B)"`.

---

## Task 7: Google readers → `getStoreSecret` (per-store) + `getGlobalSecret` (global)

**Files:** `dashboard-web/src/lib/fetchers/googleAds.ts` (getCustomerIdOrThrow 178, getAccessToken 202-208, buildGoogleAdsHeaders 263/277). Test: `dashboard-web/src/lib/fetchers/__tests__/googleCreds.secrets.test.ts`.

- [ ] **Step 1: READ** the readers. `getCustomerIdOrThrow` (sync, `${STORE}_GOOGLEADS_CUSTOMER_ID`). `getAccessToken` (async, refresh token: `process.env[perStoreRefreshEnv] || process.env.GOOGLEADS_REFRESH_TOKEN`; client id/secret global). `buildGoogleAdsHeaders` (sync, `GOOGLEADS_DEVELOPER_TOKEN` required, `GOOGLEADS_LOGIN_CUSTOMER_ID` optional). Note the EXACT error messages + which 7 call sites are async.

- [ ] **Step 2: Write the failing test** asserting: per-store customer id via `getStoreSecret`; refresh token precedence per-store→global (`getStoreSecret(store,'GOOGLEADS_REFRESH_TOKEN') ?? getGlobalSecret('GOOGLEADS_REFRESH_TOKEN')`); developer token + client id/secret via `getGlobalSecret`; `GOOGLEADS_LOGIN_CUSTOMER_ID` optional (no throw when absent); exact error messages preserved. (Mock `getStoreSecret`/`getGlobalSecret` + `global.fetch` for the token exchange.)

- [ ] **Step 3: Run, confirm FAIL.**

- [ ] **Step 4: Implement.** Make `getCustomerIdOrThrow` + `buildGoogleAdsHeaders` async; `await` at their call sites (all async). Replace:
```ts
// getCustomerIdOrThrow (now async):
const customerId = await getStoreSecret(storeId, 'GOOGLEADS_CUSTOMER_ID');
if (!customerId) throw new Error(`Missing ${storeId.toUpperCase()}_GOOGLEADS_CUSTOMER_ID for ${storeId} (per docs/PROPS-MAP.md; set in Vercel env vars)`);
// getAccessToken refresh-token precedence (per-store DB→env, then global DB→env):
const refreshToken = (await getStoreSecret(storeId, 'GOOGLEADS_REFRESH_TOKEN')) || (await getGlobalSecret('GOOGLEADS_REFRESH_TOKEN'));
const clientId = await getGlobalSecret('GOOGLEADS_CLIENT_ID');
const clientSecret = await getGlobalSecret('GOOGLEADS_CLIENT_SECRET');
// buildGoogleAdsHeaders (now async):
const developerToken = await getGlobalSecret('GOOGLEADS_DEVELOPER_TOKEN');
const loginCustomerId = await getGlobalSecret('GOOGLEADS_LOGIN_CUSTOMER_ID'); // optional — skip header when null
```
Preserve every existing throw message verbatim (read them in Step 1; reuse the exact strings).

- [ ] **Step 5: Run the google suites + tsc.** `npx vitest run src/lib/fetchers/__tests__/` → green; tsc 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(secrets): Google Ads creds via getStoreSecret + getGlobalSecret (per-store→global precedence) (Phase 3B)"`.

---

## Task 8: TikTok readers + the two missed read points → `getStoreSecret`

**Files:** `dashboard-web/src/lib/fetchers/tiktok.ts` (getTikTokCreds 133-134), `tiktokAccountConfig.ts` (readTikTokCredsFromEnv 53-54 — keep the sync Boolean `isTikTokConfiguredForStore` env-based per Decision 7), `postgresReaders.ts:1810` (hardcoded `UZOSHOP_TIKTOK_ADVERTISER_ID`), `app/api/store-meta/route.ts:25` (client-facing advertiser-id echo). Test: `dashboard-web/src/lib/fetchers/__tests__/tiktokCreds.secrets.test.ts`.

- [ ] **Step 1: READ** all four. `getTikTokCreds`/`readTikTokCredsFromEnv` are inside async fetchers (read `${upper}_TIKTOK_ADVERTISER_ID/_ACCESS_TOKEN`, throw on missing). `postgresReaders.ts:1810` is in an async fn but hardcodes `UZOSHOP_` literally — replace with `await getStoreSecret('uzoshop', 'TIKTOK_ADVERTISER_ID')`. `store-meta/route.ts:25` reads inside an array `.map()` building the JSON response — convert that map to `await Promise.all(rows.map(async (row) => ({...row, tiktokAdvertiserId: await getStoreSecret(row.storeId, 'TIKTOK_ADVERTISER_ID') })))`.

- [ ] **Step 2: Write the failing test** — assert getTikTokCreds reads via `getStoreSecret('uzoshop', 'TIKTOK_ADVERTISER_ID'/'TIKTOK_ACCESS_TOKEN')`, preserves the exact throw, and that `postgresReaders` resolves the uzoshop advertiser id via `getStoreSecret`. (Mock `getStoreSecret`.)

- [ ] **Step 3: Run, confirm FAIL.**

- [ ] **Step 4: Implement** the four cutovers; preserve exact error messages; `isTikTokConfiguredForStore` STAYS env-based (Decision 7 — add a one-line comment pointing at the Phase-4/6 follow-up). Confirm `store-meta/route.ts` stays a valid (now `Promise.all`) async handler.

- [ ] **Step 5: Run tiktok + store-meta + postgresReaders suites + tsc.** Green; tsc 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(secrets): TikTok creds + postgresReaders/store-meta read points via getStoreSecret (Phase 3B)"`.

---

## Task 9: Secondary bulk utilities + verification + docs (close 3B)

**Files:** `dashboard-web/src/lib/fetchers/shopifyBulkFirstOrder.ts:248`, `shopifyBulkCohort.ts:254` (domain). Docs: `docs/ARCHITECTURE.md` §45 (part 2), `docs/ROAS-Dashboard-User-Manual.md`.

- [ ] **Step 1:** Cut the two bulk-utility domain reads over to `await getStoreSecret(storeId, 'SHOPIFY_DOMAIN')` (both inside async fns). Preserve the exact missing-env throw. Add/extend a test mocking `getStoreSecret`.
- [ ] **Step 2: COGS + feature-gates note (no code).** In ARCHITECTURE §45, explicitly record: `${STORE}_COGS_RATE` (cronDaily/cronLive/analytics) is calibration config (default 0.25, client-editable via `cogs-settings`) — NOT in `store_secrets`; P7 may drop these env vars independently. The sync Boolean feature-gates (`isTikTokConfiguredForStore`, `googleAccountConfig`) stay env-based in P3; **Phase 4/6 follow-up:** they must consult DB/a config map before a DB-only new store can be enabled, else it is silently skipped.
- [ ] **Step 3: ARCHITECTURE §45 (part 2)** — the full reader cutover list (Shopify/Meta/Google/TikTok + postgresReaders + store-meta + bulk utilities), the per-store→global precedence, the `__global__` model, and that env fallback stays until P7. (3B touches `lib/fetchers/*` + `lib/postgresReaders.ts` → the docs-currency **Arch rule** REQUIRES `docs/ARCHITECTURE.md` in the push; no component/`page`/`layout` files change so the User Manual is NOT required — `app/api/store-meta/route.ts` is a `route.ts`, not a UX file.)
- [ ] **Step 4: Full gate.** `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green. Then run the live harness `npm run audit:reconcile` (production data) and confirm pipeline parity unchanged (campaigns_daily SUM == data_daily) — i.e. the credentials still fetch identically. Confirm Shopify token self-heal (`invalidateShopifyToken`) still works with DB-sourced creds.
- [ ] **Step 5: Commit.** `git commit -m "feat(secrets): bulk-utility creds via getStoreSecret + ARCHITECTURE §45 + User Manual (Phase 3B close)"`.

---

## 🔒 SHIP 3B (operator-gated)
`git push origin main` only on operator OK (per project rule). Post-deploy: re-run `npm run audit:reconcile` against prod; confirm the next nightly + live ticks fetch all platforms for all stores (data_freshness green); spot-check that pulling `ENCRYPTION_MASTER_KEY` is NOT required for read paths that have no DB row (env fallback). Revert path for any single reader = revert that file (env fallback was always intact).

---

## Self-review

- **Spec coverage (P3):** backfill the 3 stores' secrets into `store_secrets` (T3 + gate) ✅; verify each store's Meta/Google/TikTok/Shopify fetch succeeds reading from DB (T5–T9 cutover + T9 reconcile) ✅; behavior change none (env fallback throughout) ✅; revert = delete rows / revert file ✅. The spec's "5 files" is corrected to the real ~12 read points (enumerated, grounding-confirmed) — gap closed.
- **No placeholders:** every code step shows the exact code or the exact transformation + the test code; exact error strings are reproduced from the grounding; exact commands + expected results given.
- **Zero-regression:** `getStoreSecret`/`getGlobalSecret` fall back to env at every miss/decrypt-failure/empty; backfill skips absent (no empty rows); each reader keeps its exact error + normalization; 3A is inert until the backfill runs; 3B ships only after the backfill verifies; full suite + `audit:reconcile` parity gate at the end.
- **Type/name consistency:** `getStoreSecret`/`getGlobalSecret`/`GLOBAL_STORE_ID`/`PER_STORE_SECRET_KEYS`/`GLOBAL_SECRET_KEYS`/`perStoreKeysForStore`/`/api/operator/backfill-secrets` are used identically across tasks; `secret_key` == env-var suffix throughout.
- **Known follow-ups recorded (not silently dropped):** COGS_RATE (config, P7-independent); sync feature-gates (Phase 4/6 must consult DB); `ENCRYPTION_MASTER_KEY` + `SUPABASE_SERVICE_ROLE_KEY` exempt from P7 env-removal; Phase-6 create-route must reject reserved id `__global__`.
- **Open verifications for the implementer:** the EXACT current throw strings at each reader (reproduce verbatim — Step 1 of each cutover task); the EXACT `act_`/trim normalization in all three Meta ad-account read sites (must stay identical); that `getShopifyAccessToken`'s module-scope token cache still behaves after the async cred read; that `store-meta/route.ts`'s `Promise.all` conversion preserves the response shape.
