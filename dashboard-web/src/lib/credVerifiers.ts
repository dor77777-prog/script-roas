/**
 * dashboard-web/src/lib/credVerifiers.ts
 *
 * Self-serve stores Phase 6a — Task 1: pure cred-verifiers.
 *
 * Each verifier ACCEPTS the credentials to test as arguments and probes the
 * live platform API with them. It NEVER reads the DB for the creds-under-test
 * (that is the whole point — we are validating creds the operator just typed,
 * BEFORE any DB write). `verifyGoogle` is the one exception that reads the
 * GLOBAL Google Ads OAuth app creds (client id/secret + developer token) via
 * `getGlobalSecret`, because those are shared across stores and are not part of
 * the per-store creds being verified.
 *
 * Return shape: `{ ok, message, currency? }`.
 *   - `ok` — did the probe succeed?
 *   - `message` — Hebrew, user-facing. MUST NOT contain any raw credential
 *     value (token / secret / refresh token). On failure it names the platform
 *     + HTTP status only.
 *   - `currency` — the ad account's reporting currency, when the platform
 *     returns one (Meta / Google). Used by the add-store route to seed display.
 *
 * Code-path sharing (ZERO REGRESSION guarantee): the probes reuse the SAME pure
 * helpers the live pipeline uses —
 *   - Shopify  → `exchangeShopifyClientCredentials` (shopifyAuth.ts)
 *   - Meta     → `normalizeMetaAdAccountId` + `buildMetaAccountInsightsUrl` (meta.ts)
 *   - Google   → `refreshGoogleOAuthToken` + `buildGoogleAdsHeaders` +
 *                `runGaqlQuery` (googleAds.ts)
 * so a verified cred is exercised through the identical request shape the cron
 * path will use.
 *
 * Security: NEVER log, echo, or include a raw secret/token in any message or
 * console output. The Meta probe carries its access token in the URL query
 * string — the full URL is NEVER logged or surfaced.
 */
import { exchangeShopifyClientCredentials } from '@/lib/fetchers/shopifyAuth';
import {
  normalizeMetaAdAccountId,
  buildMetaAccountInsightsUrl,
} from '@/lib/fetchers/meta';
import {
  refreshGoogleOAuthToken,
  runGaqlQuery,
} from '@/lib/fetchers/googleAds';
import { getGlobalSecret } from '@/lib/storeSecretsReader';
import { getTodayInIsraelTz } from '@/lib/dateRange';

export type CredVerifyResult = {
  ok: boolean;
  /** Hebrew, user-facing. NEVER contains a raw credential value. */
  message: string;
  /** ISO 4217 reporting currency, when the platform returns one. */
  currency?: string;
};

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

/**
 * Verify a store's Shopify Dev-Dashboard app creds by performing the OAuth
 * `client_credentials` exchange (the same exchange the live pipeline does).
 *
 * ok = HTTP 200 AND an `access_token` is present in the response.
 */
export async function verifyShopify(args: {
  domain: string;
  clientId: string;
  clientSecret: string;
}): Promise<CredVerifyResult> {
  const { domain, clientId, clientSecret } = args;
  if (!domain || !clientId || !clientSecret) {
    return { ok: false, message: 'חסרים פרטי התחברות ל-Shopify (דומיין / Client ID / Client Secret)' };
  }
  try {
    const result = await exchangeShopifyClientCredentials(domain, clientId, clientSecret);
    if (!result.ok) {
      return {
        ok: false,
        message: `אימות Shopify נכשל (קוד ${result.status}). בדקו את הדומיין, ה-Client ID וה-Client Secret.`,
      };
    }
    if (!result.accessToken) {
      return {
        ok: false,
        message: 'Shopify החזיר תשובה תקינה אך ללא access_token. בדקו את הרשאות האפליקציה.',
      };
    }
    return { ok: true, message: 'החיבור ל-Shopify אומת בהצלחה' };
  } catch {
    // Network / DNS / abort — never leak the inputs in the message.
    return {
      ok: false,
      message: 'אימות Shopify נכשל עקב שגיאת רשת. בדקו את הדומיין ונסו שוב.',
    };
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/**
 * Verify a store's Meta creds by reading one day of account-level /insights
 * with the provided token + ad account id (the same probe shape as
 * `fetchMetaSpendForDayLight`).
 *
 * ok = HTTP 200 AND `body.data` is an array.
 * currency = body.data[0]?.account_currency ?? 'ILS'.
 *
 * The access token rides in the URL query string — the full URL is NEVER
 * logged or included in any message.
 */
export async function verifyMeta(args: {
  token: string;
  adAccountId: string;
}): Promise<CredVerifyResult> {
  const { token } = args;
  const adAccountId = normalizeMetaAdAccountId(args.adAccountId);
  if (!token || !adAccountId) {
    return { ok: false, message: 'חסרים פרטי התחברות ל-Meta (access token / מזהה חשבון מודעות)' };
  }
  try {
    const today = getTodayInIsraelTz();
    const url = buildMetaAccountInsightsUrl(adAccountId, token, today);
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      // NEVER include `url` — it carries the access token in the query string.
      return {
        ok: false,
        message: `אימות Meta נכשל (קוד ${res.status}). בדקו את ה-access token ואת מזהה חשבון המודעות.`,
      };
    }
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) {
      return {
        ok: false,
        message: 'Meta החזיר תשובה לא צפויה (data אינו מערך). בדקו את הרשאות ה-token.',
      };
    }
    const first = body.data[0] as { account_currency?: string } | undefined;
    const currency = first?.account_currency ?? 'ILS';
    return { ok: true, message: 'החיבור ל-Meta אומת בהצלחה', currency };
  } catch {
    return {
      ok: false,
      message: 'אימות Meta נכשל עקב שגיאת רשת. בדקו את הפרטים ונסו שוב.',
    };
  }
}

// ---------------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------------

/**
 * Verify a store's Google Ads creds via a two-step probe:
 *   (1) OAuth refresh-token exchange (using the GLOBAL OAuth app client
 *       id/secret) → access_token.
 *   (2) A customer-level GAQL `googleAds:search` with the developer token.
 *
 * ok = both calls HTTP 200.
 *
 * The GLOBAL Google Ads app creds (client id/secret + developer token) are
 * read from `getGlobalSecret` INSIDE this verifier — they are not per-store
 * creds. If the developer token (or client id/secret) is missing, returns a
 * SPECIFIC Hebrew message and makes NO network call.
 */
export async function verifyGoogle(args: {
  customerId: string;
  refreshToken: string;
}): Promise<CredVerifyResult> {
  const { customerId, refreshToken } = args;
  if (!customerId || !refreshToken) {
    return { ok: false, message: 'חסרים פרטי התחברות ל-Google (מזהה לקוח / refresh token)' };
  }

  // Global OAuth app creds — these are NOT per-store. A missing developer token
  // (or client id/secret) is an operator-wide config gap, NOT a bad store cred,
  // so it gets its own SPECIFIC message and we make NO probe call. (The developer
  // token is read again inside runGaqlQuery→buildGoogleAdsHeaders; this earlier
  // read exists purely to emit the specific message before any network call.)
  const clientId = await getGlobalSecret('GOOGLEADS_CLIENT_ID');
  const clientSecret = await getGlobalSecret('GOOGLEADS_CLIENT_SECRET');
  const developerToken = await getGlobalSecret('GOOGLEADS_DEVELOPER_TOKEN');
  if (!clientId || !clientSecret || !developerToken) {
    return { ok: false, message: 'הגדרות Google הגלובליות (developer token) חסרות' };
  }

  try {
    // (1) OAuth refresh → access_token (shared helper with the live pipeline).
    const refresh = await refreshGoogleOAuthToken(clientId, clientSecret, refreshToken);
    if (!refresh.ok || !refresh.accessToken) {
      return {
        ok: false,
        message: `אימות Google נכשל בשלב ה-OAuth (קוד ${refresh.status}). בדקו את ה-refresh token.`,
      };
    }

    // (2) Customer-level GAQL search (shared helper — runGaqlQuery builds
    // headers via buildGoogleAdsHeaders + runs the search; throws on non-200,
    // caught below). The API path requires a flat numeric customer id, so we
    // strip dashes here before passing it in (mirrors getCustomerIdOrThrow).
    const flatCustomerId = customerId.replace(/-/g, '');
    // INTENTIONAL DIVERGENCE from the live fetcher's GAQL: the live path filters
    // `segments.date = '<date>'`, but this is only a reachability/auth probe so it
    // uses `DURING TODAY`. Do NOT "align" this to the live query — they serve
    // different purposes and the live date-equality must stay untouched.
    const query =
      'SELECT customer.currency_code FROM customer WHERE segments.date DURING TODAY';
    const results = await runGaqlQuery(
      'verify-creds',
      flatCustomerId,
      refresh.accessToken,
      query,
      getTodayInIsraelTz(),
    );

    let currency: string | undefined;
    for (const r of results) {
      const customer = (r.customer ?? {}) as { currencyCode?: string };
      if (customer.currencyCode) {
        currency = customer.currencyCode;
        break;
      }
    }
    return { ok: true, message: 'החיבור ל-Google אומת בהצלחה', currency };
  } catch {
    // runGaqlQuery throws on a non-200 search (its message names the storeId
    // 'verify-creds' + HTTP status + Google body, never the refresh token) and
    // buildGoogleAdsHeaders (called inside it) throws if the dev token is
    // missing — both are surfaced here as a clean Hebrew message; we never echo
    // the caught error.
    return {
      ok: false,
      message: 'אימות Google נכשל בשלב הקריאה ל-API. בדקו את מזהה הלקוח וההרשאות.',
    };
  }
}
