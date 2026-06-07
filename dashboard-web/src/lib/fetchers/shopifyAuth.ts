/**
 * Shopify OAuth Client Credentials Grant — exchanges per-store Client ID
 * + Client Secret for a short-lived (24h) Admin API access_token, with
 * in-memory caching so each invocation refetches at most once per day.
 *
 * Phase 05.7.7 (2026-05-22 ~04:00 IL) — replaces the legacy static
 * `${STORE}_SHOPIFY_TOKEN` env var approach. The user's stores use
 * Shopify Dev Dashboard apps which authenticate via OAuth client
 * credentials (per https://shopify.dev/docs/apps/build/dev-dashboard/
 * get-api-access-tokens). The static-token model (`shpat_…`) from
 * Store Admin "Custom apps" is a SEPARATE older mechanism that doesn't
 * apply here.
 *
 * What this module DOES:
 *   1. Reads `${STORE}_SHOPIFY_DOMAIN`, `${STORE}_SHOPIFY_CLIENT_ID`,
 *      `${STORE}_SHOPIFY_CLIENT_SECRET` from env per store.
 *   2. POSTs to `https://{domain}/admin/oauth/access_token` with
 *      `grant_type=client_credentials` to receive `{access_token,
 *      scope, expires_in}`.
 *   3. Caches the token in-process keyed by storeId. Returns the
 *      cached value until 60 seconds before its declared expiry.
 *   4. On expiry / cache miss, re-exchanges and updates the cache.
 *
 * The cache lives at module scope (not per-request) so a warm Vercel
 * function instance does ONE OAuth exchange per ~24h. Cold starts re-
 * exchange — acceptable because the OAuth call adds ~300ms one-time.
 *
 * Why caching at module scope is safe even though credentials change:
 *   - Token rotation (e.g., operator clicks "Rotate" on Client Secret
 *     in Dev Dashboard) invalidates the cached token AND the underlying
 *     secret. The next refresh attempt would fail with 401 from the
 *     OAuth endpoint, the cache entry is dropped, the operator updates
 *     the env var, redeploys, and a fresh process starts with the new
 *     secret. Worst-case window: until the next deploy.
 */

import { getStoreSecret } from '@/lib/storeSecretsReader';

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number; // unix ms
};

const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * Test-only helper — clears the in-memory token cache so each unit test
 * starts fresh. Production code never calls this; the cache is process-
 * lifetime by design in normal operation.
 */
export function _resetShopifyAuthCacheForTesting(): void {
  tokenCache.clear();
}

/**
 * Drop the cached token for ONE store so the next `getShopifyAccessToken`
 * call re-exchanges (picking up the app's CURRENT scopes).
 *
 * Why this exists (2026-06-03 incident): the 24h module-scope cache means a
 * warm Vercel/Inngest instance keeps serving a token minted BEFORE an app
 * scope change. After the operator added `read_customers` to enable the
 * NC-ROAS backfill, warm instances kept their pre-grant token, so any fetch
 * requesting the `customer` field got a 400 "Access denied for customer
 * field. Required access: read_customers" for up to 24h. Callers detect that
 * scope/auth error, call this to invalidate, and retry once — the re-exchange
 * returns a token carrying the new scope, so the pipeline self-heals within a
 * single cron tick instead of waiting out the 24h TTL.
 */
export function invalidateShopifyToken(storeId: string): void {
  tokenCache.delete(storeId);
}

/**
 * Result of a single Shopify OAuth `client_credentials` exchange.
 *
 * `ok` mirrors `Response.ok` (HTTP 2xx). On a non-2xx response, `errorBody`
 * carries the response body (already sliced/`.catch`-guarded by the caller's
 * convention). On 2xx, `accessToken` / `expiresIn` / `scope` are populated from
 * the JSON body (any may be absent if Shopify returns a malformed 200).
 */
export type ShopifyClientCredentialsResult = {
  ok: boolean;
  status: number;
  accessToken?: string;
  expiresIn?: number;
  scope?: string;
  /** Raw parsed JSON body on a 2xx (for the caller's exact error stringify). */
  rawBody?: unknown;
  /** Raw response text when `ok` is false (for the caller's error message). */
  errorBody?: string;
};

/**
 * Pure helper — POSTs the Shopify OAuth `client_credentials` grant to
 * `https://{domain}/admin/oauth/access_token` and returns the parsed result.
 *
 * This is the SINGLE code path for the exchange, reused by both
 * `getShopifyAccessToken` (the live cron/pipeline) and the Phase-6a
 * `verifyShopify` cred-verifier. It accepts creds as arguments (no DB / no env
 * read) so it stays pure and testable, and it NEVER throws on a non-2xx — the
 * caller decides whether a non-2xx is fatal (cron throws) or a verification
 * failure (verifier returns ok:false). Network errors DO reject; callers wrap.
 *
 * NEVER include a raw credential value in any thrown error or log — the body of
 * a Shopify OAuth error response does not echo the client secret, but callers
 * must still avoid logging the inputs.
 */
export async function exchangeShopifyClientCredentials(
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<ShopifyClientCredentialsResult> {
  const url = `https://${domain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    return { ok: false, status: res.status, errorBody };
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    ok: true,
    status: res.status,
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    rawBody: data,
  };
}

export async function getShopifyAccessToken(storeId: string): Promise<string> {
  const cached = tokenCache.get(storeId);
  // Refresh 60 seconds before expiry to avoid races during the exchange.
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const upper = storeId.toUpperCase();
  // Phase 3B: source creds via getStoreSecret (encrypted DB FIRST, then the
  // ${STORE}_SHOPIFY_* env var as fallback, then null). A DB miss is
  // byte-identical to the previous process.env read.
  const domain = await getStoreSecret(storeId, 'SHOPIFY_DOMAIN');
  const clientId = await getStoreSecret(storeId, 'SHOPIFY_CLIENT_ID');
  const clientSecret = await getStoreSecret(storeId, 'SHOPIFY_CLIENT_SECRET');

  const missing: string[] = [];
  if (!domain) missing.push(`${upper}_SHOPIFY_DOMAIN`);
  if (!clientId) missing.push(`${upper}_SHOPIFY_CLIENT_ID`);
  if (!clientSecret) missing.push(`${upper}_SHOPIFY_CLIENT_SECRET`);
  if (missing.length > 0) {
    throw new Error(
      `Missing Shopify env vars for store "${storeId}": ${missing.join(', ')} ` +
        `(Phase 05.7.7: Dev Dashboard apps use Client ID + Client Secret via ` +
        `OAuth client_credentials grant — see PROPS-MAP.md).`,
    );
  }

  // Phase 6a: the exchange itself is the extracted pure helper
  // `exchangeShopifyClientCredentials` — the SINGLE code path shared with the
  // `verifyShopify` cred-verifier. This caller keeps the existing storeId-named
  // throw messages (byte-identical behavior vs the inline version).
  const result = await exchangeShopifyClientCredentials(domain!, clientId!, clientSecret!);
  if (!result.ok) {
    throw new Error(
      `Shopify OAuth token exchange failed for "${storeId}" (HTTP ${result.status}): ${(result.errorBody ?? '').slice(0, 400)}`,
    );
  }
  if (!result.accessToken || !result.expiresIn) {
    throw new Error(
      `Shopify OAuth response missing access_token/expires_in for "${storeId}": ${JSON.stringify(result.rawBody)}`,
    );
  }
  const entry: TokenCacheEntry = {
    accessToken: result.accessToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
  };
  tokenCache.set(storeId, entry);
  return entry.accessToken;
}
