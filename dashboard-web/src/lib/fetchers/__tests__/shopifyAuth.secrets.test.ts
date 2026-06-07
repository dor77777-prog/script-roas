/**
 * Phase 3B (Task 5) — Shopify creds via getStoreSecret (DB→env dual-read).
 *
 * Verifies the credential SOURCE in getShopifyAccessToken switched from
 * `process.env[...]` to `getStoreSecret(storeId, key)` while preserving
 * ZERO behavior change:
 *   (a) DOMAIN / CLIENT_ID / CLIENT_SECRET are resolved via getStoreSecret
 *       (mocked from an in-test map); the OAuth exchange (mocked fetch) then
 *       succeeds and the function returns the minted access_token.
 *   (b) When all three resolve to null, the EXACT same combined-missing error
 *       string as before is thrown (still naming the ${STORE}_SHOPIFY_* env
 *       vars + the Phase 05.7.7 / PROPS-MAP.md reference).
 *
 * The token cache is reset between tests so each starts from a cold exchange.
 */
import { it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-test secret map: keyed by `${storeId}|${key}` → value (or undefined → null).
const secretMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
}));

import {
  getShopifyAccessToken,
  _resetShopifyAuthCacheForTesting,
} from '../shopifyAuth';
import { getStoreSecret } from '@/lib/storeSecretsReader';

const STORE = 'uzoshop';

beforeEach(() => {
  _resetShopifyAuthCacheForTesting();
  secretMap.clear();
  vi.mocked(getStoreSecret).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reads DOMAIN/CLIENT_ID/CLIENT_SECRET via getStoreSecret and returns the minted token', async () => {
  secretMap.set(`${STORE}|SHOPIFY_DOMAIN`, 'uzoshop.myshopify.com');
  secretMap.set(`${STORE}|SHOPIFY_CLIENT_ID`, 'db_client_id');
  secretMap.set(`${STORE}|SHOPIFY_CLIENT_SECRET`, 'shpss_db_secret');

  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'shpat_FROM_DB',
          scope: 'read_orders',
          expires_in: 86399,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const token = await getShopifyAccessToken(STORE);
  expect(token).toBe('shpat_FROM_DB');

  // All three creds resolved through the dual-read helper.
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_DOMAIN');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_CLIENT_ID');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_CLIENT_SECRET');

  // OAuth exchange used the DB-sourced domain + creds.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
  expect(call[0]).toBe('https://uzoshop.myshopify.com/admin/oauth/access_token');
  const body = call[1].body!.toString();
  expect(body).toContain('client_id=db_client_id');
  expect(body).toContain('client_secret=shpss_db_secret');
});

it('throws the EXACT combined-missing error when all three resolve to null', async () => {
  // secretMap empty → getStoreSecret returns null for all three.
  await expect(getShopifyAccessToken(STORE)).rejects.toThrow(
    /Missing Shopify env vars for store "uzoshop": UZOSHOP_SHOPIFY_DOMAIN, UZOSHOP_SHOPIFY_CLIENT_ID, UZOSHOP_SHOPIFY_CLIENT_SECRET \(Phase 05\.7\.7: Dev Dashboard apps use Client ID \+ Client Secret via OAuth client_credentials grant — see PROPS-MAP\.md\)\./,
  );
});
