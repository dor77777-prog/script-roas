# Self-Serve Stores — Phase 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the additive foundations for self-serve store management — the DB columns/table, the encryption helper, and the dual-read `getStoreSecret` / `getStores` seams — with **ZERO behavior change** (nothing consumes the new paths yet; the live 3-store dashboard is byte-identical).

**Architecture:** Pure additions. New `stores` columns (defaults + a backfill matching today's hardcoded reality), a new `store_secrets` table (no anon grant), and three new lib modules (`secretsEncryption`, `storeSecretsReader`, `getStores`) that READ DB-first and FALL BACK to the existing source (env vars / hardcoded list). They are dead code until Phase 2 wires them in — exactly like `fetchAdStateFromPostgres` was inert in ads-off Phase 1.

**Tech Stack:** Next.js, Supabase, Node `crypto` (AES-256-GCM), vitest (node).

**Spec:** `docs/superpowers/specs/2026-06-06-self-serve-store-management-design.md` (Phase P1). Verified facts: `stores` columns = id, name, has_google_ads, plan_display_name, shopify_plus, partner_dev, meta_ad_account_id, google_ads_customer_id, last_error, updated_at. Seed: uzoshop('uzoshop', google), zolplus('Zol Plus'), usmile360('360usmile'). anon has SELECT on `stores`. `getSupabaseAdmin()` in `lib/supabaseAdmin.ts`. Latest migration `20260606160000`.

---

## Task 1: Migration — `stores` lifecycle + config columns (+ backfill the 3)

**Files:** Create `supabase/migrations/20260606170000_stores_self_serve_columns.sql`

- [ ] **Step 1: Verify timestamp is newest** — `ls supabase/migrations | sort | tail -3` (confirm `20260606170000` > `20260606160000`).
- [ ] **Step 2: Write the migration**
```sql
-- Self-serve stores Phase 1 — additive lifecycle + config columns. Defaults +
-- backfill keep the 3 existing stores byte-identical to today's hardcoded reality.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brand_color   TEXT,
  ADD COLUMN IF NOT EXISTS is_headless   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_tiktok    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER;

-- Backfill the 3 existing stores to match the current hardcoded config exactly.
UPDATE public.stores SET is_headless = FALSE, has_tiktok = TRUE,  brand_color = 'var(--store-uzo)', display_order = 1 WHERE id = 'uzoshop';
UPDATE public.stores SET is_headless = FALSE, has_tiktok = FALSE, brand_color = 'var(--store-3)',   display_order = 2 WHERE id = 'zolplus';
UPDATE public.stores SET is_headless = TRUE,  has_tiktok = TRUE,  brand_color = 'var(--store-usm)', display_order = 3 WHERE id = 'usmile360';
```
- [ ] **Step 3: Sanity** — `grep -c "ADD COLUMN" supabase/migrations/20260606170000_stores_self_serve_columns.sql` → `6`.
- [ ] **Step 4: Commit** — `git add supabase/migrations/20260606170000_stores_self_serve_columns.sql && git commit -m "feat(stores): self-serve lifecycle+config columns + backfill (Phase 1)"`

> Do NOT apply to prod yet — applied in Task 6 (supervised). Additive + IF NOT EXISTS + defaults ⇒ safe.

---

## Task 2: Migration — `store_secrets` table (no anon grant)

**Files:** Create `supabase/migrations/20260606170100_store_secrets.sql`

- [ ] **Step 1: Write the migration**
```sql
-- Encrypted per-store secrets (AES-256-GCM ciphertext). NO anon grant: encrypted
-- AND ungranted = two walls. Writes via service_role only. Self-serve Phase 1.
CREATE TABLE IF NOT EXISTS public.store_secrets (
  store_id    TEXT NOT NULL,
  secret_key  TEXT NOT NULL,          -- e.g. 'SHOPIFY_DOMAIN', 'META_ACCESS_TOKEN'
  ciphertext  TEXT NOT NULL,          -- base64
  iv          TEXT NOT NULL,          -- base64 (12 bytes)
  tag         TEXT NOT NULL,          -- base64 (GCM auth tag)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, secret_key)
);
COMMENT ON TABLE public.store_secrets IS 'AES-256-GCM encrypted per-store secrets. NO anon grant. self-serve 2026-06-06.';
-- intentionally NO "GRANT SELECT ... TO anon" — service_role only.
```
- [ ] **Step 2: Sanity** — confirm there is NO `GRANT ... anon` line in the file (`! grep -qi "anon" …`).
- [ ] **Step 3: Commit** — `git add … && git commit -m "feat(stores): store_secrets encrypted table (no anon grant) (Phase 1)"`

---

## Task 3: `secretsEncryption.ts` — AES-256-GCM helper

**Files:** Create `dashboard-web/src/lib/secretsEncryption.ts` + test `dashboard-web/src/lib/__tests__/secretsEncryption.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret } from '@/lib/secretsEncryption';

// 32-byte key, base64
const KEY = Buffer.alloc(32, 7).toString('base64');
beforeEach(() => vi.stubEnv('ENCRYPTION_MASTER_KEY', KEY));

describe('secretsEncryption — AES-256-GCM round-trip', () => {
  it('encrypts then decrypts back to the plaintext', () => {
    const enc = encryptSecret('shpat_secret_123');
    expect(enc.ciphertext).not.toContain('shpat_secret_123');
    expect(decryptSecret(enc.ciphertext, enc.iv, enc.tag)).toBe('shpat_secret_123');
  });
  it('different iv each call (no deterministic ciphertext)', () => {
    expect(encryptSecret('x').iv).not.toBe(encryptSecret('x').iv);
  });
  it('decrypt throws on a tampered tag', () => {
    const enc = encryptSecret('x');
    const badTag = Buffer.alloc(16, 1).toString('base64');
    expect(() => decryptSecret(enc.ciphertext, enc.iv, badTag)).toThrow();
  });
  it('throws when the master key is missing', () => {
    vi.stubEnv('ENCRYPTION_MASTER_KEY', '');
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_MASTER_KEY/);
  });
});
```
- [ ] **Step 2: Run → FAIL** (`cd dashboard-web && npx vitest run src/lib/__tests__/secretsEncryption.test.ts`).
- [ ] **Step 3: Implement**
```ts
// dashboard-web/src/lib/secretsEncryption.ts
// AES-256-GCM for per-store secrets at rest. Master key = ENCRYPTION_MASTER_KEY
// (base64, 32 bytes) in Vercel env. Server-only (fetchers/admin routes). Never
// logs plaintext. self-serve 2026-06-06.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';

function masterKey(): Buffer {
  const k = process.env.ENCRYPTION_MASTER_KEY;
  if (!k) throw new Error('ENCRYPTION_MASTER_KEY missing — required to (de)crypt store secrets.');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (base64-encoded).');
  return buf;
}

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: enc.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv(ALG, masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
```
- [ ] **Step 4: Run → PASS** + tsc + eslint.
- [ ] **Step 5: Commit** — `feat(stores): secretsEncryption AES-256-GCM helper (Phase 1)`

---

## Task 4: `storeSecretsReader.ts` — `getStoreSecret` (DB → env fallback)

**Files:** Create `dashboard-web/src/lib/storeSecretsReader.ts` + test `dashboard-web/src/lib/__tests__/storeSecretsReader.test.ts`

- [ ] **Step 1: Failing test** (mock `@/lib/supabaseAdmin` + `@/lib/secretsEncryption`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ row: null as null | { ciphertext: string; iv: string; tag: string } }));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: store.row, error: null }) }) }) }) }) }),
}));
vi.mock('@/lib/secretsEncryption', () => ({ decryptSecret: () => 'DECRYPTED' }));

import { getStoreSecret } from '@/lib/storeSecretsReader';

beforeEach(() => { store.row = null; vi.unstubAllEnvs(); });

describe('getStoreSecret — DB-first then env fallback', () => {
  it('returns decrypted DB value when a row exists', async () => {
    store.row = { ciphertext: 'c', iv: 'i', tag: 't' };
    expect(await getStoreSecret('uzoshop', 'SHOPIFY_DOMAIN')).toBe('DECRYPTED');
  });
  it('falls back to ${STORE}_${KEY} env when no DB row', async () => {
    vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
    expect(await getStoreSecret('uzoshop', 'SHOPIFY_DOMAIN')).toBe('uzoshop.myshopify.com');
  });
  it('returns null when neither DB nor env has it', async () => {
    expect(await getStoreSecret('uzoshop', 'NOPE')).toBeNull();
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// dashboard-web/src/lib/storeSecretsReader.ts
// Per-store secret resolution: encrypted DB (store_secrets) FIRST, then the
// existing Vercel env var ${STORE_UPPER}_${KEY} as fallback, then null. The
// fallback keeps every store working during the env→DB migration. Server-only.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { decryptSecret } from '@/lib/secretsEncryption';

export async function getStoreSecret(storeId: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('store_secrets')
      .select('ciphertext, iv, tag')
      .eq('store_id', storeId)
      .eq('secret_key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return decryptSecret(data.ciphertext as string, data.iv as string, data.tag as string);
  } catch (e) {
    // DB/decrypt failure → fall through to env (never throw; never log the value)
    console.warn(`getStoreSecret(${storeId}, ${key}) DB read failed, using env fallback:`, e instanceof Error ? e.message : e);
  }
  const env = process.env[`${storeId.toUpperCase()}_${key}`];
  return env ?? null;
}
```
- [ ] **Step 4: Run → PASS** + tsc + eslint.
- [ ] **Step 5: Commit** — `feat(stores): getStoreSecret DB→env dual-read (Phase 1)`

---

## Task 5: `getStores.ts` — data-driven store list (DB → hardcoded fallback)

**Files:** Create `dashboard-web/src/lib/getStores.ts` + test `dashboard-web/src/lib/__tests__/getStores.test.ts`

- [ ] **Step 1: Failing test** (mock `@/lib/supabase`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => ({ data: null as null | unknown[], error: null as null | { message: string } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }) }) }));
import { getStores, loadActiveStoreIds } from '@/lib/getStores';
beforeEach(() => { db.data = null; db.error = null; });

describe('getStores — DB then hardcoded fallback', () => {
  it('falls back to the hardcoded 3 when DB read fails', async () => {
    db.error = { message: 'down' };
    const s = await getStores();
    expect(s.map(x => x.storeId)).toEqual(['uzoshop', 'zolplus', 'usmile360']);
  });
  it('falls back to hardcoded when DB returns empty', async () => {
    db.data = [];
    expect((await getStores()).length).toBe(3);
  });
  it('returns active DB stores sorted by display_order, excluding archived by default', async () => {
    db.data = [
      { id: 'b', name: 'B', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 2 },
      { id: 'a', name: 'A', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 1 },
      { id: 'z', name: 'Z', brand_color: null, is_headless: false, has_tiktok: false, status: 'archived', display_order: 3 },
    ];
    expect((await getStores()).map(x => x.storeId)).toEqual(['a', 'b']);
    expect((await getStores({ includeArchived: true })).map(x => x.storeId)).toEqual(['a', 'b', 'z']);
  });
  it('loadActiveStoreIds returns just the ids', async () => {
    db.error = { message: 'down' };
    expect(await loadActiveStoreIds()).toEqual(['uzoshop', 'zolplus', 'usmile360']);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// dashboard-web/src/lib/getStores.ts
// THE single source for the store list. Reads active stores from the `stores`
// table; FALLS BACK to the canonical hardcoded 3 if the read fails/empty — so a
// DB blip never changes behavior. Consumed (Phase 2+) by every store-list site.
import { getSupabase } from '@/lib/supabase';

export type StoreStatus = 'active' | 'archived';
export interface StoreInfo {
  storeId: string;
  storeName: string;
  brandColor: string | null;
  isHeadless: boolean;
  hasTikTok: boolean;
  status: StoreStatus;
  displayOrder: number;
}

/** Canonical fallback — matches the seeded DB rows exactly (zero-regression). */
const HARDCODED: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1 },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2 },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3 },
];

export async function getStores(opts?: { includeArchived?: boolean }): Promise<StoreInfo[]> {
  try {
    const { data, error } = await getSupabase()
      .from('stores')
      .select('id, name, brand_color, is_headless, has_tiktok, status, display_order');
    if (error) throw new Error(error.message);
    if (data && data.length) {
      const rows: StoreInfo[] = data.map((r) => ({
        storeId: String((r as Record<string, unknown>).id),
        storeName: String((r as Record<string, unknown>).name ?? ''),
        brandColor: ((r as Record<string, unknown>).brand_color as string) ?? null,
        isHeadless: (r as Record<string, unknown>).is_headless === true,
        hasTikTok: (r as Record<string, unknown>).has_tiktok === true,
        status: ((r as Record<string, unknown>).status === 'archived' ? 'archived' : 'active') as StoreStatus,
        displayOrder: Number((r as Record<string, unknown>).display_order ?? 999),
      })).sort((a, b) => a.displayOrder - b.displayOrder || a.storeId.localeCompare(b.storeId));
      const filtered = opts?.includeArchived ? rows : rows.filter((s) => s.status === 'active');
      if (filtered.length) return filtered;
    }
  } catch (e) {
    console.warn('getStores: DB read failed, using hardcoded fallback:', e instanceof Error ? e.message : e);
  }
  return opts?.includeArchived ? HARDCODED : HARDCODED.filter((s) => s.status === 'active');
}

/** Cron-side convenience: just the active store ids (DB → hardcoded fallback). */
export async function loadActiveStoreIds(): Promise<string[]> {
  return (await getStores()).map((s) => s.storeId);
}
```
- [ ] **Step 4: Run → PASS** + tsc + eslint + the full `src/lib/__tests__/` suite (no regression from the new modules).
- [ ] **Step 5: Commit** — `feat(stores): getStores + loadActiveStoreIds DB→hardcoded fallback (Phase 1)`

---

## Task 6: Docs + apply migrations (supervised) + full gate

**Files:** Modify `docs/ARCHITECTURE.md` (§43) + `docs/ROAS-Dashboard-User-Manual.md` (only if operator-facing — Phase 1 is invisible, so a 1-line "infra" note or skip the UM bump).

- [ ] **Step 1: ARCHITECTURE §43** — "Self-serve stores — Phase 1 foundations": the new `stores` columns + `store_secrets` (encrypted, no anon grant) + the three dual-read seams (`getStoreSecret` DB→env, `getStores` DB→hardcoded, `secretsEncryption`), and a clear note: **inert until Phase 2+** (nothing consumes them yet; live behavior unchanged). Reference the spec + note `ENCRYPTION_MASTER_KEY` is required only from Phase 3 (backfill) onward.
- [ ] **Step 2: Full local gate** — `cd dashboard-web && npm test && npx tsc --noEmit && npm run lint` (unit green, tsc clean, lint 0 errors).
- [ ] **Step 3: Apply both migrations to prod (supervised)** — per `reference_supabase_migration_procedure` (hide root `.env`, move the 2 duplicate-timestamp gap files, `npx supabase db push --dry-run` → confirm ONLY the 2 new migrations pend → real `db push`, restore). Verify: `stores` has the 6 new columns + the 3 rows backfilled (status='active', correct is_headless/has_tiktok/brand_color); `store_secrets` exists + is empty; `select count(*) from store_secrets` = 0.
- [ ] **Step 4: Commit + push (deploy)** — Phase 1 is additive/inert; safe to deploy. `git add docs/ARCHITECTURE.md && git commit -m "docs(stores): ARCHITECTURE §43 — self-serve Phase 1 foundations" && git push origin main` (operator-gated push, like the ads-off phases).

---

## Self-review

- **Spec coverage (P1):** stores columns (T1) ✓ · store_secrets (T2) ✓ · secretsEncryption (T3) ✓ · getStoreSecret DB→env (T4) ✓ · getStores DB→hardcoded + loadActiveStoreIds (T5) ✓ · docs + supervised apply (T6) ✓.
- **Zero-regression:** every new module is dead code until Phase 2; migrations are additive (IF NOT EXISTS + defaults) + backfill the 3 to match today; `store_secrets` starts empty so `getStoreSecret` always hits the env fallback (no decryption path exercised in prod yet); `getStores` fallback == the hardcoded 3.
- **Security:** `store_secrets` has NO anon grant; secrets never logged (values); `ENCRYPTION_MASTER_KEY` validated (32 bytes) and only needed from Phase 3.
- **Type/name consistency:** `encryptSecret`/`decryptSecret`, `getStoreSecret`, `getStores`/`loadActiveStoreIds`, `StoreInfo`, `ENCRYPTION_MASTER_KEY`, `store_secrets(store_id, secret_key, ciphertext, iv, tag)` identical across tasks + spec.
- **Open verifications for the implementer:** (a) `getStoreSecret` uses the ADMIN client (store_secrets has no anon grant) — confirm `getSupabaseAdmin` is correct in the worker/Node runtime; (b) `getStores` uses the anon `getSupabase` (stores has anon SELECT) — fine for client+server; (c) the supervised migration procedure's current gap-file list.
