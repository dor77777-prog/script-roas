/**
 * Phase 3B (Task 7) — Google Ads creds via getStoreSecret (per-store) +
 * getGlobalSecret (global), DB→env dual-read.
 *
 * Verifies the credential SOURCE switched from `process.env[...]` to the
 * dual-read helpers while preserving ZERO behavior change. Asserted through
 * `googleAds`'s exported async surface:
 *   - getCustomerIdOrThrow (per-store GOOGLEADS_CUSTOMER_ID; strips dashes; throws)
 *   - getAccessToken        (refresh-token per-store→global precedence;
 *                            client id/secret from getGlobalSecret; throws)
 *   - runGaqlQuery          (exercises buildGoogleAdsHeaders: developer-token
 *                            from getGlobalSecret REQUIRED→throw;
 *                            login-customer-id from getGlobalSecret OPTIONAL→omit)
 *
 * Behavior contract preserved:
 *   (a) getCustomerIdOrThrow uses per-store getStoreSecret(storeId,'GOOGLEADS_CUSTOMER_ID');
 *   (b) refresh-token precedence: per-store wins; null per-store → global fallback;
 *   (c) developer token + client id/secret come from getGlobalSecret;
 *   (d) GOOGLEADS_LOGIN_CUSTOMER_ID absent → NO throw (header omitted);
 *   (e) the EXACT same throw strings as before when required ones are missing.
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
  getCustomerIdOrThrow,
  getAccessToken,
  runGaqlQuery,
} from '../googleAds';
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

// ---------------------------------------------------------------------------
// (a) getCustomerIdOrThrow — per-store GOOGLEADS_CUSTOMER_ID
// ---------------------------------------------------------------------------
it('(a) getCustomerIdOrThrow uses per-store getStoreSecret and strips dashes', async () => {
  secretMap.set(`${STORE}|GOOGLEADS_CUSTOMER_ID`, '123-456-7890');
  const id = await getCustomerIdOrThrow(STORE);
  expect(id).toBe('1234567890');
  expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'GOOGLEADS_CUSTOMER_ID');
});

it('(e) getCustomerIdOrThrow throws the EXACT error when customer id is absent', async () => {
  await expect(getCustomerIdOrThrow(STORE)).rejects.toThrow(
    `Missing ${STORE.toUpperCase()}_GOOGLEADS_CUSTOMER_ID for ${STORE} (per docs/PROPS-MAP.md; set in Vercel env vars)`,
  );
});

// ---------------------------------------------------------------------------
// (b)/(c) getAccessToken — refresh-token precedence + global client id/secret
// ---------------------------------------------------------------------------
function mockTokenExchange(accessToken = 'access_OK') {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      new Response(
        JSON.stringify({ access_token: accessToken, expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Each getAccessToken test uses a DISTINCT store id so the module-level
// tokenCache (keyed by storeId, persists across tests within the module) never
// hands back a warm token to a later test that expects a fresh refresh/throw.

it('(b) refresh token: per-store getStoreSecret wins over global', async () => {
  const store = 'gacc_perstore';
  secretMap.set(`${store}|GOOGLEADS_REFRESH_TOKEN`, 'refresh_PER_STORE');
  globalMap.set('GOOGLEADS_REFRESH_TOKEN', 'refresh_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
  globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
  const fetchMock = mockTokenExchange();

  const tok = await getAccessToken(store);
  expect(tok).toBe('access_OK');
  expect(getStoreSecret).toHaveBeenCalledWith(store, 'GOOGLEADS_REFRESH_TOKEN');

  // The per-store refresh token (not the global one) hit the OAuth body.
  const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
  expect(body).toContain('refresh_token=refresh_PER_STORE');
  expect(body).not.toContain('refresh_GLOBAL');
});

it('(b) refresh token: falls back to getGlobalSecret when per-store is null', async () => {
  const store = 'gacc_global';
  globalMap.set('GOOGLEADS_REFRESH_TOKEN', 'refresh_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
  globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
  const fetchMock = mockTokenExchange();

  const tok = await getAccessToken(store);
  expect(tok).toBe('access_OK');
  expect(getStoreSecret).toHaveBeenCalledWith(store, 'GOOGLEADS_REFRESH_TOKEN');
  expect(getGlobalSecret).toHaveBeenCalledWith('GOOGLEADS_REFRESH_TOKEN');

  const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
  expect(body).toContain('refresh_token=refresh_GLOBAL');
});

it('(c) getAccessToken reads client id + secret from getGlobalSecret', async () => {
  const store = 'gacc_clientcreds';
  globalMap.set('GOOGLEADS_REFRESH_TOKEN', 'refresh_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_ID', 'cid_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret_GLOBAL');
  const fetchMock = mockTokenExchange();

  await getAccessToken(store);
  expect(getGlobalSecret).toHaveBeenCalledWith('GOOGLEADS_CLIENT_ID');
  expect(getGlobalSecret).toHaveBeenCalledWith('GOOGLEADS_CLIENT_SECRET');

  const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
  expect(body).toContain('client_id=cid_GLOBAL');
  expect(body).toContain('client_secret=csecret_GLOBAL');
});

it('(e) getAccessToken throws EXACT error when client id missing', async () => {
  const store = 'gacc_nocid';
  globalMap.set('GOOGLEADS_REFRESH_TOKEN', 'refresh_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
  mockTokenExchange();
  await expect(getAccessToken(store)).rejects.toThrow(
    'Missing GOOGLEADS_CLIENT_ID (per docs/PROPS-MAP.md row 17; set in Vercel env vars)',
  );
});

it('(e) getAccessToken throws EXACT error when client secret missing', async () => {
  const store = 'gacc_nocsecret';
  globalMap.set('GOOGLEADS_REFRESH_TOKEN', 'refresh_GLOBAL');
  globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
  mockTokenExchange();
  await expect(getAccessToken(store)).rejects.toThrow(
    'Missing GOOGLEADS_CLIENT_SECRET (per docs/PROPS-MAP.md row 18; set in Vercel env vars)',
  );
});

it('(e) getAccessToken throws EXACT error when no refresh token resolves anywhere', async () => {
  const store = 'gacc_norefresh';
  globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
  globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
  mockTokenExchange();
  await expect(getAccessToken(store)).rejects.toThrow(
    `Missing ${store.toUpperCase()}_GOOGLEADS_REFRESH_TOKEN or GOOGLEADS_REFRESH_TOKEN for ${store} (per docs/PROPS-MAP.md row 21; set in Vercel env vars)`,
  );
});

// ---------------------------------------------------------------------------
// (c)/(d) buildGoogleAdsHeaders via runGaqlQuery — developer-token REQUIRED,
//          login-customer-id OPTIONAL
// ---------------------------------------------------------------------------
function mockGaqlResponse() {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('(c) developer token comes from getGlobalSecret and is sent as a header', async () => {
  globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev_GLOBAL');
  const fetchMock = mockGaqlResponse();

  await runGaqlQuery(STORE, '1234567890', 'access_OK', 'SELECT x', '2026-06-07');
  expect(getGlobalSecret).toHaveBeenCalledWith('GOOGLEADS_DEVELOPER_TOKEN');

  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  expect(headers['developer-token']).toBe('dev_GLOBAL');
});

it('(e) runGaqlQuery throws EXACT error when developer token missing', async () => {
  mockGaqlResponse();
  await expect(
    runGaqlQuery(STORE, '1234567890', 'access_OK', 'SELECT x', '2026-06-07'),
  ).rejects.toThrow(
    'Missing GOOGLEADS_DEVELOPER_TOKEN (per docs/PROPS-MAP.md row 19; set in Vercel env vars)',
  );
});

it('(d) GOOGLEADS_LOGIN_CUSTOMER_ID absent → NO throw, header omitted', async () => {
  globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev_GLOBAL');
  // No login customer id set in globalMap.
  const fetchMock = mockGaqlResponse();

  await expect(
    runGaqlQuery(STORE, '1234567890', 'access_OK', 'SELECT x', '2026-06-07'),
  ).resolves.toEqual([]);
  expect(getGlobalSecret).toHaveBeenCalledWith('GOOGLEADS_LOGIN_CUSTOMER_ID');

  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  expect(headers['login-customer-id']).toBeUndefined();
});

it('(d) GOOGLEADS_LOGIN_CUSTOMER_ID present → header set with dashes stripped', async () => {
  globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev_GLOBAL');
  globalMap.set('GOOGLEADS_LOGIN_CUSTOMER_ID', '987-654-3210');
  const fetchMock = mockGaqlResponse();

  await runGaqlQuery(STORE, '1234567890', 'access_OK', 'SELECT x', '2026-06-07');

  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  expect(headers['login-customer-id']).toBe('9876543210');
});
