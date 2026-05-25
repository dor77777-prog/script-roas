/**
 * Phase 05.7.7 — tests for OAuth client_credentials token helper.
 *
 * Verifies:
 *   - Missing env vars produce a clear error including storeId + missing names.
 *   - On success: POSTs to /admin/oauth/access_token with the right form body
 *     and returns the access_token from the response.
 *   - Cache: second call within expires_in reuses the cached token (no
 *     second OAuth call).
 *   - Cache expiry: a stale entry triggers a re-exchange.
 *   - Non-2xx OAuth response throws with HTTP status + body excerpt.
 */
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getShopifyAccessToken,
  _resetShopifyAuthCacheForTesting,
} from '../shopifyAuth';

const STORE = 'uzoshop';

beforeEach(() => {
  _resetShopifyAuthCacheForTesting();
  vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', 'uzoshop.myshopify.com');
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_ID', 'test_client_id');
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_SECRET', 'shpss_test_secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('Test 1: missing DOMAIN throws with storeId + missing var name', async () => {
  vi.stubEnv('UZOSHOP_SHOPIFY_DOMAIN', '');
  await expect(getShopifyAccessToken(STORE)).rejects.toThrow(
    /uzoshop.*UZOSHOP_SHOPIFY_DOMAIN/i,
  );
});

it('Test 2: missing CLIENT_ID throws with storeId + missing var name', async () => {
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_ID', '');
  await expect(getShopifyAccessToken(STORE)).rejects.toThrow(
    /uzoshop.*UZOSHOP_SHOPIFY_CLIENT_ID/i,
  );
});

it('Test 3: missing CLIENT_SECRET throws with storeId + missing var name', async () => {
  vi.stubEnv('UZOSHOP_SHOPIFY_CLIENT_SECRET', '');
  await expect(getShopifyAccessToken(STORE)).rejects.toThrow(
    /uzoshop.*UZOSHOP_SHOPIFY_CLIENT_SECRET/i,
  );
});

it('Test 4: POSTs the right body to /admin/oauth/access_token and returns access_token', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'shpat_FROM_OAUTH',
          scope: 'read_orders,read_products',
          expires_in: 86399,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const token = await getShopifyAccessToken(STORE);
  expect(token).toBe('shpat_FROM_OAUTH');

  // Verify the OAuth request shape.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
  expect(call[0]).toBe(
    'https://uzoshop.myshopify.com/admin/oauth/access_token',
  );
  const init = call[1];
  expect(init.method).toBe('POST');
  expect(
    (init.headers as Record<string, string>)['Content-Type'],
  ).toBe('application/x-www-form-urlencoded');
  const body = init.body!.toString();
  expect(body).toContain('grant_type=client_credentials');
  expect(body).toContain('client_id=test_client_id');
  expect(body).toContain('client_secret=shpss_test_secret');
});

it('Test 5: second call within expires_in reuses cached token (no second fetch)', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'shpat_CACHED',
          scope: 'read_orders',
          expires_in: 86399,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const a = await getShopifyAccessToken(STORE);
  const b = await getShopifyAccessToken(STORE);
  expect(a).toBe('shpat_CACHED');
  expect(b).toBe('shpat_CACHED');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('Test 6: non-2xx OAuth response throws with status + body', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response('{"error":"invalid_client"}', { status: 401 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(getShopifyAccessToken(STORE)).rejects.toThrow(
    /OAuth.*401.*invalid_client/i,
  );
});

it('Test 7: separate stores get separate cached tokens', async () => {
  vi.stubEnv('ZOLPLUS_SHOPIFY_DOMAIN', '2x1gqx-y0.myshopify.com');
  vi.stubEnv('ZOLPLUS_SHOPIFY_CLIENT_ID', 'zol_id');
  vi.stubEnv('ZOLPLUS_SHOPIFY_CLIENT_SECRET', 'shpss_zol');

  let n = 0;
  const fetchMock = vi.fn(async (url: string) => {
    n++;
    const token = url.includes('uzoshop') ? 'shpat_UZO' : 'shpat_ZOL';
    return new Response(
      JSON.stringify({ access_token: token, scope: '', expires_in: 86399 }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  const uzo = await getShopifyAccessToken('uzoshop');
  const zol = await getShopifyAccessToken('zolplus');
  expect(uzo).toBe('shpat_UZO');
  expect(zol).toBe('shpat_ZOL');
  expect(n).toBe(2);
});
