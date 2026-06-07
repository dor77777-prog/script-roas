import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── NEW (Phase 3A) mocks ─────────────────────────────────────────────────────
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

// ── Original tests (Phase 1 regression) ─────────────────────────────────────
describe('getStoreSecret — DB-first then env fallback (original)', () => {
  it('returns the decrypted DB value when a row exists', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => 'DECRYPTED';
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

// ── New Phase 3A tests ───────────────────────────────────────────────────────
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
    expect(await getGlobalSecret('GOOGLEADS_CLIENT_ID')).toBeNull();
  });
  it('returns the decrypted __global__ DB value when present', async () => {
    db.row = { ciphertext: 'c', iv: 'i', tag: 't' }; crypto.decrypt = () => 'global-db';
    expect(await getGlobalSecret('META_GLOBAL_TOKEN')).toBe('global-db');
  });
  it('GLOBAL_STORE_ID is the reserved literal', () => { expect(GLOBAL_STORE_ID).toBe('__global__'); });
});
