import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ row: null as null | { ciphertext: string; iv: string; tag: string } }));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: store.row, error: null }) }) }) }) }),
  }),
}));
vi.mock('@/lib/secretsEncryption', () => ({ decryptSecret: () => 'DECRYPTED' }));

import { getStoreSecret } from '@/lib/storeSecretsReader';

beforeEach(() => { store.row = null; vi.unstubAllEnvs(); });

describe('getStoreSecret — DB-first then env fallback', () => {
  it('returns the decrypted DB value when a row exists', async () => {
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
