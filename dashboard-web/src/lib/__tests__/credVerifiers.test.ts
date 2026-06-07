/**
 * Self-serve stores Phase 6a — Task 1: pure cred-verifiers.
 *
 * Each verifier ACCEPTS creds (never reads the DB for the creds-under-test) and
 * returns `{ ok, message, currency? }`. The `message` is Hebrew, user-facing,
 * and MUST NOT contain any raw credential value.
 *
 * Test strategy:
 *   - mock `global.fetch` (vi) per platform.
 *   - assert ok:true on a 200-shaped success, ok:false on a 401/error.
 *   - assert the returned `message` contains NO raw credential string (the fake
 *     token/secret/refresh-token we passed in).
 *   - Google: mock `@/lib/storeSecretsReader` getGlobalSecret; when the
 *     developer token is null, assert the SPECIFIC Hebrew message and NO fetch.
 */
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest';

// In-test GLOBAL secret map (only getGlobalSecret is exercised by verifyGoogle).
const globalMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(async (): Promise<string | null> => null),
  getGlobalSecret: vi.fn(
    async (key: string): Promise<string | null> => globalMap.get(key) ?? null,
  ),
  GLOBAL_STORE_ID: '__global__',
}));

// fetchMeta records BUC usage to Supabase + may import Sentry; the verifier uses
// plain global.fetch, but meta.ts (where we extract helpers from) imports
// fetchMeta which transitively pulls these. Stub them so the module loads.
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/notifications/metaBucUsage', () => ({ recordMetaBucUsage: vi.fn() }));

import { verifyShopify, verifyMeta, verifyGoogle } from '../credVerifiers';
import { getGlobalSecret } from '@/lib/storeSecretsReader';

const FAKE_SHOPIFY_SECRET = 'shpss_SUPER_SECRET_VALUE';
const FAKE_SHOPIFY_CLIENT_ID = 'shopify_client_id_VALUE';
const FAKE_META_TOKEN = 'EAA_META_TOKEN_SECRET_VALUE';
const FAKE_GOOGLE_REFRESH = 'google_refresh_token_SECRET_VALUE';

beforeEach(() => {
  globalMap.clear();
  vi.mocked(getGlobalSecret).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// verifyShopify
// ---------------------------------------------------------------------------
describe('verifyShopify', () => {
  it('ok:true when OAuth exchange returns 200 + access_token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'shpat_OK', scope: 'read_orders', expires_in: 86399 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyShopify({
      domain: 'demo.myshopify.com',
      clientId: FAKE_SHOPIFY_CLIENT_ID,
      clientSecret: FAKE_SHOPIFY_SECRET,
    });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://demo.myshopify.com/admin/oauth/access_token',
    );
  });

  it('ok:false on a 401 error and message contains NO raw credential', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"invalid_client"}', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyShopify({
      domain: 'demo.myshopify.com',
      clientId: FAKE_SHOPIFY_CLIENT_ID,
      clientSecret: FAKE_SHOPIFY_SECRET,
    });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_SHOPIFY_SECRET);
    expect(res.message).not.toContain(FAKE_SHOPIFY_CLIENT_ID);
  });

  it('ok:false when 200 but no access_token present', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ scope: 'read_orders' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyShopify({
      domain: 'demo.myshopify.com',
      clientId: FAKE_SHOPIFY_CLIENT_ID,
      clientSecret: FAKE_SHOPIFY_SECRET,
    });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_SHOPIFY_SECRET);
  });

  it('ok:false (no throw) when fetch rejects (network error), no raw cred leak', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyShopify({
      domain: 'demo.myshopify.com',
      clientId: FAKE_SHOPIFY_CLIENT_ID,
      clientSecret: FAKE_SHOPIFY_SECRET,
    });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_SHOPIFY_SECRET);
  });
});

// ---------------------------------------------------------------------------
// verifyMeta
// ---------------------------------------------------------------------------
describe('verifyMeta', () => {
  it('ok:true + currency when 200 + data is an array', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ spend: '12.34', impressions: '100', account_currency: 'ILS' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyMeta({ token: FAKE_META_TOKEN, adAccountId: 'act_123456789' });
    expect(res.ok).toBe(true);
    expect(res.currency).toBe('ILS');
  });

  it('currency defaults to ILS when data is empty', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyMeta({ token: FAKE_META_TOKEN, adAccountId: '123456789' });
    expect(res.ok).toBe(true);
    expect(res.currency).toBe('ILS');
  });

  it('ok:false on a 401 error; message + thrown URL never leak the token', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":{"message":"Invalid OAuth access token"}}', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyMeta({ token: FAKE_META_TOKEN, adAccountId: 'act_123456789' });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_META_TOKEN);
  });

  it('strips a leading act_ from the ad account id before building the URL', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await verifyMeta({ token: FAKE_META_TOKEN, adAccountId: 'act_999000111' });
    const calledUrl = (fetchMock.mock.calls[0] as unknown as [string])[0];
    // exactly one act_ prefix (no double act_act_), with the numeric id
    expect(calledUrl).toContain('/act_999000111/insights');
    expect(calledUrl).not.toContain('act_act_');
  });

  it('ok:false (no throw) when fetch rejects, no token leak', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await verifyMeta({ token: FAKE_META_TOKEN, adAccountId: '123' });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_META_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// verifyGoogle
// ---------------------------------------------------------------------------
describe('verifyGoogle', () => {
  it('returns the SPECIFIC "global dev-token missing" message and makes NO fetch', async () => {
    globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    // GOOGLEADS_DEVELOPER_TOKEN intentionally absent.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyGoogle({ customerId: '123-456-7890', refreshToken: FAKE_GOOGLE_REFRESH });
    expect(res.ok).toBe(false);
    expect(res.message).toBe('הגדרות Google הגלובליות (developer token) חסרות');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the dev-token-missing message when client id is missing too', async () => {
    globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    // GOOGLEADS_CLIENT_ID absent.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyGoogle({ customerId: '1234567890', refreshToken: FAKE_GOOGLE_REFRESH });
    expect(res.ok).toBe(false);
    expect(res.message).toBe('הגדרות Google הגלובליות (developer token) חסרות');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ok:true when both OAuth refresh + GAQL search return 200', async () => {
    globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev');

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access_OK', expires_in: 3600 }), {
          status: 200,
        });
      }
      // googleAds:search
      return new Response(JSON.stringify({ results: [{ customer: { currencyCode: 'CAD' } }] }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyGoogle({ customerId: '123-456-7890', refreshToken: FAKE_GOOGLE_REFRESH });
    expect(res.ok).toBe(true);
    expect(res.currency).toBe('CAD');
  });

  it('ok:false when the OAuth refresh fails (401); message + thrown body never leak the refresh token', async () => {
    globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev');

    const fetchMock = vi.fn(
      async () => new Response('{"error":"invalid_grant"}', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyGoogle({ customerId: '1234567890', refreshToken: FAKE_GOOGLE_REFRESH });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_GOOGLE_REFRESH);
  });

  it('ok:false when the GAQL search fails (403) after a successful refresh', async () => {
    globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev');

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access_OK', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response('{"error":"PERMISSION_DENIED"}', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyGoogle({ customerId: '1234567890', refreshToken: FAKE_GOOGLE_REFRESH });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(FAKE_GOOGLE_REFRESH);
  });

  it('strips dashes from the customer id in the GAQL search URL', async () => {
    globalMap.set('GOOGLEADS_CLIENT_ID', 'cid');
    globalMap.set('GOOGLEADS_CLIENT_SECRET', 'csecret');
    globalMap.set('GOOGLEADS_DEVELOPER_TOKEN', 'dev');

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access_OK', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await verifyGoogle({ customerId: '123-456-7890', refreshToken: FAKE_GOOGLE_REFRESH });
    const searchCall = fetchMock.mock.calls.find((c) =>
      String((c as unknown[])[0]).includes('googleAds:search'),
    );
    expect(searchCall).toBeDefined();
    expect(String((searchCall as unknown[])[0])).toContain('/customers/1234567890/googleAds:search');
  });
});
