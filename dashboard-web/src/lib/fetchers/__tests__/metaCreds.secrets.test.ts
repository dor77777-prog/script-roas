/**
 * Phase 3B (Task 6) — Meta creds via getStoreSecret + META_GLOBAL_TOKEN via
 * getGlobalSecret (DB→env dual-read).
 *
 * Verifies the credential SOURCE switched from `process.env[...]` to the
 * dual-read helpers while preserving ZERO behavior change. Asserted through
 * `metaAccountConfig`'s async exports (`getMetaAccessTokenForStore` +
 * `getAdAccountIdForStore`), which share the exact resolution pattern with
 * `meta.ts:getMetaToken` / `getMetaAdAccountId`:
 *   (a) per-store token wins (getStoreSecret(storeId, 'META_ACCESS_TOKEN'));
 *   (b) when the per-store token is null, falls back to
 *       getGlobalSecret('META_GLOBAL_TOKEN');
 *   (c) getAdAccountIdForStore strips a leading `act_` and trims
 *       (DB value 'act_12345 ' → '12345');
 *   (d) the EXACT same throw strings as before when no token / no account id
 *       resolves anywhere.
 */
import { it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-test secret maps: per-store keyed by `${storeId}|${key}`; global by key.
const secretMap = new Map<string, string>();
const globalMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
  getGlobalSecret: vi.fn(
    async (key: string): Promise<string | null> => globalMap.get(key) ?? null,
  ),
}));

import {
  getMetaAccessTokenForStore,
  getAdAccountIdForStore,
} from '../metaAccountConfig';
import { getStoreSecret, getGlobalSecret } from '@/lib/storeSecretsReader';

const STORE = 'uzoshop';

beforeEach(() => {
  secretMap.clear();
  globalMap.clear();
  vi.mocked(getStoreSecret).mockClear();
  vi.mocked(getGlobalSecret).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('(a) uses the per-store token first via getStoreSecret', async () => {
  secretMap.set(`${STORE}|META_ACCESS_TOKEN`, 'tok_PER_STORE');
  globalMap.set('META_GLOBAL_TOKEN', 'tok_GLOBAL');

  const token = await getMetaAccessTokenForStore(STORE);
  expect(token).toBe('tok_PER_STORE');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'META_ACCESS_TOKEN');
  // Global fallback not consulted when the per-store token resolves.
  expect(getGlobalSecret).not.toHaveBeenCalled();
});

it('(b) falls back to getGlobalSecret(META_GLOBAL_TOKEN) when per-store is null', async () => {
  // secretMap has no per-store token → getStoreSecret returns null.
  globalMap.set('META_GLOBAL_TOKEN', 'tok_GLOBAL');

  const token = await getMetaAccessTokenForStore(STORE);
  expect(token).toBe('tok_GLOBAL');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'META_ACCESS_TOKEN');
  expect(getGlobalSecret).toHaveBeenCalledWith('META_GLOBAL_TOKEN');
});

it('(c) getAdAccountIdForStore strips act_ and trims', async () => {
  secretMap.set(`${STORE}|META_AD_ACCOUNT_ID`, 'act_12345 ');
  const id = await getAdAccountIdForStore(STORE);
  expect(id).toBe('12345');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'META_AD_ACCOUNT_ID');
});

it('(d) throws the EXACT error when no token resolves anywhere', async () => {
  // Both maps empty → getStoreSecret + getGlobalSecret return null.
  await expect(getMetaAccessTokenForStore(STORE)).rejects.toThrow(
    `Missing Meta access token for ${STORE}. ` +
      `Set ${STORE.toUpperCase()}_META_ACCESS_TOKEN (per docs/PROPS-MAP.md) or ` +
      `META_GLOBAL_TOKEN as a Vercel environment variable.`,
  );
});

it('(d) throws the EXACT error when no ad account id resolves', async () => {
  await expect(getAdAccountIdForStore(STORE)).rejects.toThrow(
    `Missing Meta ad account id for ${STORE}. ` +
      `Set ${STORE.toUpperCase()}_META_AD_ACCOUNT_ID (per docs/PROPS-MAP.md; numeric, optionally with act_ prefix).`,
  );
});
