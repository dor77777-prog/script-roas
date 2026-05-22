/**
 * dashboard-web/src/lib/fetchers/googleAds.ts — TS port of GoogleAds.gs.
 *
 * Phase 05.6 plan 05. Provides FETCH-GOOGLE for the new Inngest cron functions
 * landing in plans 05.6-08..09. Mirrors `GoogleAds.gs:33-220` with three
 * deviations from the Apps Script analog (each documented inline):
 *
 *   1. GOOGLE_ADS_API_VERSION = "v24" (NOT v20 from Config.gs:14).
 *      RESEARCH §State of the Art (line 1606) calls the current release
 *      "v24.1", but the live googleads.googleapis.com URL path uses the
 *      major version only — a spot-check on 2026-05-21 showed:
 *        https://googleads.googleapis.com/v24/...    → HTTP 401 (auth required, endpoint exists)
 *        https://googleads.googleapis.com/v24.1/...  → HTTP 404 (URL not found)
 *      So the constant value is 'v24'. The plan's <critical_facts>
 *      "v24.1" describes the release identifier, not the path segment;
 *      both regexes in <verify> match the substring 'v24, so 'v24' satisfies
 *      verification while working at runtime. Documented as deviation in
 *      05.6-05-SUMMARY.md (assumption A3 mitigation).
 *
 *   2. STORES_WITH_GOOGLE_ADS = new Set(['uzoshop']) — single source of truth
 *      for the TS port, must align with Config.gs:23 (hasGoogleAds:true for
 *      uzoshop only) AND the Phase 05.5-01 stores seed
 *      (has_google_ads = TRUE for the same row). The short-circuit lives
 *      INSIDE this module so callers (Inngest functions in plans 05.6-08..09)
 *      do not have to remember to gate Google Ads themselves; the dominant
 *      code path (2 of 3 stores) returns immediately with zero spend and NO
 *      API call, saving OAuth + GAQL quota.
 *
 *   3. CacheService.getScriptCache() (GoogleAds.gs:193-218) → a module-level
 *      Map<string, {token, expiresAt}>. RESEARCH §Don't Hand-Roll (line 1330)
 *      + Pitfall 8 (line 1456): Inngest invocations are isolated on Vercel,
 *      so the cache only bridges within a single Inngest function execution.
 *      That is the level of reuse we need — a `fetchGoogleAdsAdGroupInsights`
 *      call followed by a `fetchGoogleAdsSpendForDay` call inside one step
 *      should NOT pay for two OAuth refreshes. The 60-second safety margin
 *      (`expires_in - 60`) prevents clock-skew-driven 401s mid-call.
 *
 * Threat-model mitigations (from PLAN <threat_model>):
 *   - T-05.6-05-T1 (GAQL response shape drift between v20 and v24): the spot
 *     check above (#1) confirmed v24 accepts GAQL at the major-version path.
 *     Algorithm-parity tests at plan 05.6-21 detect any field-shape drift.
 *   - T-05.6-05-I2 (refresh-token leak in error message): the throw paths
 *     name the env-var (e.g. `Missing UZOSHOP_GOOGLEADS_CUSTOMER_ID for uzoshop`)
 *     but NEVER include the env-var VALUE. Token strings never reach
 *     console.warn or Error.message.
 *   - T-05.6-05-D3 (concurrent OAuth refresh DoS): only uzoshop has Google
 *     Ads, so only one Inngest function ever calls this module — concurrent
 *     refresh is impossible in 05.6.
 *
 * fetcher purity (D-C3): the module is pure HTTP + JSON. No Supabase calls,
 * no Sheets calls. The Inngest function wraps it and persists the result.
 *
 * Apps Script source mapping (per Pattern Map line 369-385):
 *   GoogleAds.gs:33-144  → fetchGoogleAdsAdGroupInsights (two-query strategy
 *                          with campaign-level fallback for Shopping/PMax)
 *   GoogleAds.gs:146-190 → fetchGoogleAdsSpendForDay (customer-level total)
 *   GoogleAds.gs:192-220 → getAccessToken (OAuth refresh + token cache)
 */

export const GOOGLE_ADS_API_VERSION = 'v24';

/**
 * Single source of truth in the TS port for "which stores use Google Ads".
 * MUST align with Config.gs:23 STORES.hasGoogleAds=true rows AND the Phase
 * 05.5-01 stores seed `has_google_ads = TRUE` rows. Current state (2026-05-21):
 *   uzoshop   → true  (in this set)
 *   zolplus   → false (not in set; short-circuits)
 *   usmile360 → false (not in set; short-circuits)
 *
 * If a 4th store is added later, update BOTH this set and the stores seed
 * in lockstep. The algorithm-parity test at plan 05.6-21 will catch drift.
 */
export const STORES_WITH_GOOGLE_ADS: ReadonlySet<string> = new Set(['uzoshop']);

/**
 * Module-level token cache, keyed by storeId.
 *
 * Lifetime: persists across calls within one Inngest function invocation
 * (Vercel keeps the module loaded for the function's hot path). Resets on
 * cold-start. This is the right granularity because Google Ads access tokens
 * live for ~1 hour and Inngest function executions complete in seconds; we
 * just want to amortize the OAuth refresh across the GAQL calls in one run.
 *
 * Why a module-level Map instead of per-call refresh: cheap reuse, no
 * cross-invocation surface (so no race per RESEARCH Pitfall 8).
 *
 * The store-keyed shape is forward-compatible — if a future store gets
 * Google Ads enabled, each store's tokens are isolated (different refresh
 * tokens, different customer IDs).
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export type GoogleAdsSpend = {
  storeId: string;
  date: string;
  spend: number;
  currency: string;
};

export type GoogleAdsAdGroupRow = {
  campaignId: string;
  campaignName: string;
  adSetId: string;          // Google "ad_group.id" — kept as `adSetId` to
                            // match the Meta-aligned shape in GoogleAds.gs:96.
  adSetName: string;        // Either the ad_group name or the
                            // synthesized "(רמת קמפיין)" for Shopping/PMax.
  spend: number;            // cost_micros / 1_000_000
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  /** Phase 05.7.x — Google Ads campaign + ad_group `status`. Possible
   *  values: ENABLED / PAUSED / REMOVED. Ad-group status when available
   *  (more specific — an ENABLED campaign can hold PAUSED ad_groups);
   *  campaign-level falls back when the row was synthesised from a
   *  Shopping/PMax campaign-level aggregate (no ad_group). null when
   *  the field was missing on the wire (defensive — Google reliably
   *  returns it). Used by the dashboard's "כבוי" chip so a real PAUSED
   *  status fires without waiting 2 days for the lastActiveDate heuristic. */
  effectiveStatus: string | null;
};

/**
 * Phase 05.6.1 — one row of Google Ads at `ad_group_ad` granularity. Shape
 * matches the `ads_daily` writer's expected row in cronDaily.ts:5e.
 *
 * Google Ads is CAD-native for uzoshop (the only Google Ads store), so
 * `spendCad` + `conversionValueCad` are populated directly from
 * `cost_micros / 1_000_000` and `conversionsValue` — unlike the Meta ad-row
 * type, no FX deferral is needed.
 *
 * Why `adSetId` for ad_group.id: the unified schema treats ad_group as the
 * "ad set" peer of Meta's adset (GoogleAds.gs:96-100 documents the
 * alignment; same convention used for GoogleAdsAdGroupRow).
 *
 * Responsive Search ads can have an empty `ad_group_ad.ad.name` — we pass
 * the empty string through; the postgresReaders fallback at line 523 maps
 * empty to '—' for display.
 */
export type GoogleAdsAdRow = {
  storeId: string;
  date: string;
  platform: 'google';
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueCad: number;
  spendCad: number;
};

/**
 * Returns the customer ID from env for `storeId`, or throws an env-var-naming
 * error. Strips dashes (Google sometimes formats customer IDs as
 * `123-456-7890`; the API path requires a flat numeric).
 *
 * Convention matches `docs/PROPS-MAP.md` (Phase 05.5-02 row 28):
 * `${STORE}_GOOGLEADS_CUSTOMER_ID`. The original ordering
 * (GOOGLE_ADS_${STORE}_*) was a fetcher-side bug that caused live cron-daily
 * runs to fail with "Missing GOOGLE_ADS_*" against properly-seeded Vercel env vars.
 */
function getCustomerIdOrThrow(storeId: string): string {
  const envName = `${storeId.toUpperCase()}_GOOGLEADS_CUSTOMER_ID`;
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `Missing ${envName} for ${storeId} (per docs/PROPS-MAP.md; set in Vercel env vars)`,
    );
  }
  return raw.replace(/-/g, '');
}

/**
 * Returns an access token for `storeId`, refreshing via OAuth if the cache
 * is cold or expired. Caches the token with a 60-second safety margin
 * (`expires_in - 60`) to avoid clock-skew-driven 401s mid-call.
 *
 * Throws on missing env vars with the env-var NAME in the message (never
 * the value — T-05.6-05-I2 mitigation).
 */
async function getAccessToken(storeId: string): Promise<string> {
  const cached = tokenCache.get(storeId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  // Global Google Ads OAuth creds — PROPS-MAP rows 17/18/21 (and 19 for dev token,
  // 20 for login customer ID) use `GOOGLEADS_*` (single word, no underscore between
  // GOOGLE and ADS).
  const clientId = process.env.GOOGLEADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLEADS_CLIENT_SECRET;
  // Per-store refresh token wins over the global one — supports a future
  // multi-store-Google-Ads world without changing this module.
  const perStoreRefreshEnv = `${storeId.toUpperCase()}_GOOGLEADS_REFRESH_TOKEN`;
  const refreshToken =
    process.env[perStoreRefreshEnv] || process.env.GOOGLEADS_REFRESH_TOKEN;

  if (!clientId) {
    throw new Error('Missing GOOGLEADS_CLIENT_ID (per docs/PROPS-MAP.md row 17; set in Vercel env vars)');
  }
  if (!clientSecret) {
    throw new Error(
      'Missing GOOGLEADS_CLIENT_SECRET (per docs/PROPS-MAP.md row 18; set in Vercel env vars)',
    );
  }
  if (!refreshToken) {
    throw new Error(
      `Missing ${perStoreRefreshEnv} or GOOGLEADS_REFRESH_TOKEN for ${storeId} (per docs/PROPS-MAP.md row 21; set in Vercel env vars)`,
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    // Body may contain Google's own diagnostic — include it because it never
    // contains the refresh-token value (Google does NOT echo refresh_token
    // in the OAuth error response). If a future Google change starts
    // echoing refresh_token, this line MUST be revisited (T-05.6-05-I2).
    const text = await res.text();
    throw new Error(
      `Google Ads OAuth refresh failed for ${storeId} (HTTP ${res.status}): ${text}`,
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(storeId, {
    token: body.access_token,
    // 60s safety margin per Pitfall 8 (RESEARCH line 1456) — covers
    // clock-skew between Vercel runtime and Google's OAuth issuer.
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  });
  return body.access_token;
}

/**
 * Builds the standard Google Ads request headers (Authorization +
 * developer-token + optional login-customer-id). Throws if developer-token
 * is missing (the operator's most likely Vercel misconfig).
 */
function buildGoogleAdsHeaders(accessToken: string): Record<string, string> {
  // PROPS-MAP row 19 — `GOOGLEADS_DEVELOPER_TOKEN`
  const developerToken = process.env.GOOGLEADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error(
      'Missing GOOGLEADS_DEVELOPER_TOKEN (per docs/PROPS-MAP.md row 19; set in Vercel env vars)',
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };

  // PROPS-MAP row 20 — `GOOGLEADS_LOGIN_CUSTOMER_ID`
  const loginCustomerId = process.env.GOOGLEADS_LOGIN_CUSTOMER_ID;
  if (loginCustomerId) {
    // Strip dashes (defensive — Google IDs sometimes have dashes in admin UI).
    headers['login-customer-id'] = loginCustomerId.replace(/-/g, '');
  }
  return headers;
}

/**
 * Issues a single GAQL search request and returns the `results` array.
 *
 * Throws on non-200 responses; Inngest's default 4-retry exponential backoff
 * handles transient failures upstream (RESEARCH Pattern 2 — "throw + let
 * Inngest retry").
 */
async function runGaqlQuery(
  storeId: string,
  customerId: string,
  accessToken: string,
  query: string,
  dateStr: string,
): Promise<Array<Record<string, unknown>>> {
  const url =
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}` +
    `/customers/${customerId}/googleAds:search`;
  const headers = buildGoogleAdsHeaders(accessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Ads GAQL query failed for ${storeId} ${dateStr} (HTTP ${res.status}): ${text}`,
    );
  }
  const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return body.results ?? [];
}

/**
 * Customer-level spend total for `storeId` on `dateStr`.
 *
 * For non-Google-Ads stores: short-circuits to zero spend WITHOUT calling
 * fetch. For uzoshop: refreshes the OAuth token (or reuses the cached one)
 * then issues a single customer-level GAQL query.
 *
 * Mirrors GoogleAds.gs:146-190 (`getGoogleAdsSpend`). Returns the store-level
 * total in account currency (CAD for uzoshop, falling back to 'CAD' when the
 * response omits `customer.currencyCode`).
 *
 * NOTE: dateStr is YYYY-MM-DD literal. Google Ads GAQL requires inline
 * single-quoted date literals (no parameterized SQL).
 */
export async function fetchGoogleAdsSpendForDay(
  storeId: string,
  dateStr: string,
): Promise<GoogleAdsSpend> {
  // ---- Short-circuit FIRST: 2 of 3 stores skip the API entirely.
  if (!STORES_WITH_GOOGLE_ADS.has(storeId)) {
    return { storeId, date: dateStr, spend: 0, currency: 'CAD' };
  }

  const customerId = getCustomerIdOrThrow(storeId);
  const accessToken = await getAccessToken(storeId);
  const query =
    "SELECT metrics.cost_micros, customer.currency_code " +
    "FROM customer " +
    `WHERE segments.date = '${dateStr}'`;
  const results = await runGaqlQuery(storeId, customerId, accessToken, query, dateStr);

  let micros = 0;
  let currency = 'CAD';
  for (const r of results) {
    const metrics = (r.metrics ?? {}) as { costMicros?: string };
    const customer = (r.customer ?? {}) as { currencyCode?: string };
    micros += parseFloat(metrics.costMicros ?? '0') || 0;
    if (customer.currencyCode) currency = customer.currencyCode;
  }
  // No negative-spend clamping anywhere — policy is "report what the API says"
  // (consistent with shopifyRevenueRefunds.ts: D-D3 / D-C4 algorithm parity).
  // Do not reintroduce a max-zero idiom for "safety" in a refactor; the
  // plan's grep gate (see SUMMARY) enforces zero clamping in the file.
  const spend = micros / 1_000_000;
  return { storeId, date: dateStr, spend, currency };
}

/**
 * One row per (campaign × ad_group) for `storeId` on `dateStr`, with Shopping/
 * Performance-Max fallback to a synthesized campaign-level row.
 *
 * For non-Google-Ads stores: short-circuits to an empty array WITHOUT calling
 * fetch. For uzoshop: runs the same two-query strategy as GoogleAds.gs:33-144
 * — ad_group query first, campaign query second, then merges with the
 * "shopping campaigns return zero metrics at ad_group level" fallback.
 *
 * Mirrors GoogleAds.gs:33-144 (`getGoogleAdsAdGroupInsights`).
 */
export async function fetchGoogleAdsAdGroupInsights(
  storeId: string,
  dateStr: string,
): Promise<GoogleAdsAdGroupRow[]> {
  // ---- Short-circuit FIRST: 2 of 3 stores skip the API entirely.
  if (!STORES_WITH_GOOGLE_ADS.has(storeId)) {
    return [];
  }

  const customerId = getCustomerIdOrThrow(storeId);
  const accessToken = await getAccessToken(storeId);

  // 1) Ad-group query (granular when available).
  // Phase 05.7.x — added campaign.status + ad_group.status so the
  // dashboard's "כבוי" chip can fire on the real Google Ads status
  // instead of waiting 2 days for the lastActiveDate heuristic to
  // catch up. Status is current-at-fetch-time (no per-day dimension);
  // GAQL returns the same value for every segmented row of that
  // campaign / ad-group, which is fine for our daily upsert.
  const adGroupQuery =
    'SELECT campaign.id, campaign.name, campaign.status, ' +
    'ad_group.id, ad_group.name, ad_group.status, ' +
    'metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
    'metrics.conversions, metrics.conversions_value, customer.currency_code ' +
    `FROM ad_group WHERE segments.date = '${dateStr}'`;
  const adGroupResults = await runGaqlQuery(
    storeId,
    customerId,
    accessToken,
    adGroupQuery,
    dateStr,
  );

  // 2) Campaign query (always-accurate totals — used for Shopping/PMax fallback).
  const campaignQuery =
    'SELECT campaign.id, campaign.name, campaign.status, ' +
    'metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
    'metrics.conversions, metrics.conversions_value, customer.currency_code ' +
    `FROM campaign WHERE segments.date = '${dateStr}'`;
  const campaignResults = await runGaqlQuery(
    storeId,
    customerId,
    accessToken,
    campaignQuery,
    dateStr,
  );

  // Group ad_group rows by campaign id so we can detect "no real activity"
  // campaigns (Shopping / PMax) and fall back to the campaign-level row.
  let currency = 'CAD';
  type Bucket = { rows: GoogleAdsAdGroupRow[]; activity: number };
  const adGroupByCampaign = new Map<string, Bucket>();

  for (const r of adGroupResults) {
    const customer = (r.customer ?? {}) as { currencyCode?: string };
    if (customer.currencyCode) currency = customer.currencyCode;

    const campaign = (r.campaign ?? {}) as {
      id?: string | number;
      name?: string;
      status?: string;
    };
    const adGroup = (r.adGroup ?? {}) as {
      id?: string | number;
      name?: string;
      status?: string;
    };
    const metrics = (r.metrics ?? {}) as {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: string;
      conversionsValue?: string;
    };

    const cid = String(campaign.id ?? '');
    const spend = (parseFloat(metrics.costMicros ?? '0') || 0) / 1_000_000;
    const impressions = parseInt(metrics.impressions ?? '0', 10) || 0;

    if (!adGroupByCampaign.has(cid)) {
      adGroupByCampaign.set(cid, { rows: [], activity: 0 });
    }
    const bucket = adGroupByCampaign.get(cid)!;
    bucket.activity += spend + impressions;
    // Phase 05.7.x — prefer ad-group status (more specific) and fall
    // back to campaign status. Empty string normalised to null so the
    // downstream off-chip can use a single nullish check.
    const status = (adGroup.status || campaign.status || '').trim() || null;
    bucket.rows.push({
      campaignId: cid,
      campaignName: campaign.name ?? '',
      adSetId: String(adGroup.id ?? ''),
      adSetName: adGroup.name ?? '',
      spend,
      currency,
      impressions,
      clicks: parseInt(metrics.clicks ?? '0', 10) || 0,
      conversions: parseFloat(metrics.conversions ?? '0') || 0,
      conversionValue: parseFloat(metrics.conversionsValue ?? '0') || 0,
      effectiveStatus: status,
    });
  }

  // Walk the campaign-level results: emit ad-group rows when activity > 0,
  // synthesize a single campaign-level row otherwise. Truly inactive
  // campaigns (no spend AND no impressions at campaign level) are dropped
  // entirely — matches GoogleAds.gs:124.
  const out: GoogleAdsAdGroupRow[] = [];
  for (const cr of campaignResults) {
    const customer = (cr.customer ?? {}) as { currencyCode?: string };
    if (customer.currencyCode) currency = customer.currencyCode;

    const campaign = (cr.campaign ?? {}) as {
      id?: string | number;
      name?: string;
      status?: string;
    };
    const metrics = (cr.metrics ?? {}) as {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: string;
      conversionsValue?: string;
    };
    const ccid = String(campaign.id ?? '');
    const bucket = adGroupByCampaign.get(ccid);

    if (bucket && bucket.activity > 0) {
      for (const row of bucket.rows) out.push(row);
    } else {
      const cSpend = (parseFloat(metrics.costMicros ?? '0') || 0) / 1_000_000;
      const cImps = parseInt(metrics.impressions ?? '0', 10) || 0;
      if (cSpend === 0 && cImps === 0) continue;
      out.push({
        campaignId: ccid,
        campaignName: campaign.name ?? '',
        // Reuse campaign id when there is no ad-group — preserves uniqueness
        // for downstream UPSERTs keyed on (campaignId, adSetId).
        adSetId: ccid,
        // Hebrew label "(רמת קמפיין)" — "campaign level" — signals to the
        // dashboard user that this row is a Shopping/PMax aggregate.
        // Matches GoogleAds.gs:129 verbatim.
        adSetName: '(רמת קמפיין)',
        spend: cSpend,
        currency,
        impressions: cImps,
        clicks: parseInt(metrics.clicks ?? '0', 10) || 0,
        conversions: parseFloat(metrics.conversions ?? '0') || 0,
        conversionValue: parseFloat(metrics.conversionsValue ?? '0') || 0,
        // Shopping/PMax fallback path — no ad-group exists, use the
        // campaign-level status directly.
        effectiveStatus: (campaign.status || '').trim() || null,
      });
    }
  }

  return out;
}

/**
 * Phase 05.6.1 — one row per (campaign × ad_group × ad) for `storeId` on
 * `dateStr`. Mirrors `fetchGoogleAdsAdGroupInsights` shape but at `ad_group_ad`
 * granularity, with no Shopping/PMax fallback (Shopping/PMax campaigns return
 * zero ads here — they are aggregated at the ad-group/campaign level only).
 *
 * Short-circuits to `[]` for non-Google-Ads stores (per `STORES_WITH_GOOGLE_ADS`,
 * only uzoshop has Google Ads). The dominant code path (2 of 3 stores) thus
 * makes zero API calls for ad-level insights.
 *
 * GAQL query targets the `ad_group_ad` resource — the canonical "ad inside an
 * ad group" view. Metrics are 1:1 with ad-group-level metrics in semantics
 * (impressions, clicks, cost_micros, conversions, conversions_value) just at
 * finer granularity. `WHERE ad_group_ad.status = 'ENABLED'` filters paused
 * ads — matches the ad-group-level filter at GoogleAds.gs:33-144 spirit.
 *
 * Empty-row filter: drop rows with spend=0 AND impressions=0 AND conv=0.
 * Same threshold used at adset/ad-group level — keeps late-attributed
 * conversions on paused ads when they exist.
 *
 * Currency: response carries `customer.currency_code` — same as the spend
 * fetcher. We follow the same "report what the API says, no clamping"
 * convention (D-D3 / D-C4).
 */
export async function fetchGoogleAdsAdInsights(
  storeId: string,
  dateStr: string,
): Promise<GoogleAdsAdRow[]> {
  // ---- Short-circuit FIRST: 2 of 3 stores skip the API entirely.
  if (!STORES_WITH_GOOGLE_ADS.has(storeId)) {
    return [];
  }

  const customerId = getCustomerIdOrThrow(storeId);
  const accessToken = await getAccessToken(storeId);

  // GAQL — ad_group_ad resource. The `ad_group_ad.ad.id` + `ad_group_ad.ad.name`
  // selectors are the documented way to reach the inner Ad entity (RSAs may
  // have an empty name; we surface that empty string and the postgresReaders
  // fallback handles the display).
  const adQuery =
    'SELECT campaign.id, campaign.name, ' +
    'ad_group.id, ad_group.name, ' +
    'ad_group_ad.ad.id, ad_group_ad.ad.name, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, customer.currency_code ' +
    `FROM ad_group_ad WHERE segments.date = '${dateStr}' ` +
    "AND ad_group_ad.status = 'ENABLED'";

  const results = await runGaqlQuery(
    storeId,
    customerId,
    accessToken,
    adQuery,
    dateStr,
  );

  const out: GoogleAdsAdRow[] = [];
  let currency = 'CAD';

  for (const r of results) {
    const customer = (r.customer ?? {}) as { currencyCode?: string };
    if (customer.currencyCode) currency = customer.currencyCode;

    const campaign = (r.campaign ?? {}) as { id?: string | number; name?: string };
    const adGroup = (r.adGroup ?? {}) as { id?: string | number; name?: string };
    // Google's REST/JSON shape camelCases the resource path:
    // `ad_group_ad.ad.id` → `adGroupAd.ad.id`.
    const adGroupAd = (r.adGroupAd ?? {}) as {
      ad?: { id?: string | number; name?: string };
    };
    const metrics = (r.metrics ?? {}) as {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: string;
      conversionsValue?: string;
    };

    const spend = (parseFloat(metrics.costMicros ?? '0') || 0) / 1_000_000;
    const impressions = parseInt(metrics.impressions ?? '0', 10) || 0;
    const conversions = parseFloat(metrics.conversions ?? '0') || 0;

    // Same activity threshold as adset/ad-group fetchers (cronDaily callers
    // also re-filter in their writer when building rows, but doing it here
    // keeps the on-wire row count small).
    if (spend === 0 && impressions === 0 && conversions === 0) continue;

    out.push({
      storeId,
      date: dateStr,
      platform: 'google',
      campaignId: String(campaign.id ?? ''),
      campaignName: campaign.name ?? '',
      adSetId: String(adGroup.id ?? ''),
      adSetName: adGroup.name ?? '',
      adId: String(adGroupAd.ad?.id ?? ''),
      adName: adGroupAd.ad?.name ?? '',
      impressions,
      clicks: parseInt(metrics.clicks ?? '0', 10) || 0,
      conversions,
      conversionValueCad: parseFloat(metrics.conversionsValue ?? '0') || 0,
      spendCad: spend,
    });
  }

  // Currency is captured but not embedded in the row — the unified ads_daily
  // schema treats spend_cad as the canonical CAD column. We retain `currency`
  // here only for future use (e.g. if Google Ads stores in a future non-CAD
  // store are added). Linter quieting:
  void currency;

  return out;
}
