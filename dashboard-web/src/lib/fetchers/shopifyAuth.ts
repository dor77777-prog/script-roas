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

export async function getShopifyAccessToken(storeId: string): Promise<string> {
  const cached = tokenCache.get(storeId);
  // Refresh 60 seconds before expiry to avoid races during the exchange.
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const upper = storeId.toUpperCase();
  const domain = process.env[`${upper}_SHOPIFY_DOMAIN`];
  const clientId = process.env[`${upper}_SHOPIFY_CLIENT_ID`];
  const clientSecret = process.env[`${upper}_SHOPIFY_CLIENT_SECRET`];

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

  const url = `https://${domain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId!,
    client_secret: clientSecret!,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Shopify OAuth token exchange failed for "${storeId}" (HTTP ${res.status}): ${errBody.slice(0, 400)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token || !data.expires_in) {
    throw new Error(
      `Shopify OAuth response missing access_token/expires_in for "${storeId}": ${JSON.stringify(data)}`,
    );
  }
  const entry: TokenCacheEntry = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  tokenCache.set(storeId, entry);
  return entry.accessToken;
}
