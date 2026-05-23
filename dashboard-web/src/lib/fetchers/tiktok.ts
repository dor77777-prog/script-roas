/**
 * Phase 05.7.5-B (scaffold) — TikTok Marketing API fetcher.
 *
 * This is the I/O wrapper for TikTok Ads reporting. It mirrors `meta.ts`'s
 * shape (paid-platform fetcher with the same three responsibilities):
 *   1. `fetchTikTokSpendForDay(storeId, dateStr)` — store-level daily total
 *      consumed by `cronDaily.ts` → `data_daily.tt_spend_cad`.
 *   2. `fetchTikTokAdInsights(storeId, dateStr)` — per-ad row array for
 *      `campaigns_daily` / ads tab (matching the Meta + Google fetchers).
 *   3. `fetchTikTokAdvertiserInfo(storeId)` — one-shot lookup of the
 *      account's display currency (needed for FX → CAD at writer time).
 *
 * === Scaffold status (commit 2026-05-22) ===
 *
 * TikTok Marketing API App is currently in review at TikTok Developers. The
 * fetcher is built end-to-end against the documented v1.3 API surface, but
 * is NOT yet wired into cronDaily/cronLive. Wiring happens in the Phase B
 * execution commit, once the operator has:
 *   1. App approved by TikTok (~1-3 business days)
 *   2. OAuth handshake completed → permanent advertiser access_token
 *   3. Token + advertiser_id pasted to Vercel env vars
 *
 * The fetcher throws on missing creds (not returns 0/empty) — wiring it
 * into cronDaily prematurely would silently produce zero TikTok spend.
 * Phase B execution opts in explicitly.
 *
 * === API reference ===
 *
 * Base: https://business-api.tiktok.com/open_api/v1.3
 * Auth: Header `Access-Token: <token>` (NOT Bearer; matches Meta in this
 *       quirk — both platforms use custom header names).
 * Reporting endpoint: GET /report/integrated/get/
 *   - report_type: BASIC
 *   - data_level: AUCTION_AD (per-ad granularity) or AUCTION_ADVERTISER
 *     (account-level, just spend)
 *   - dimensions: ['ad_id', 'stat_time_day'] or ['advertiser_id', 'stat_time_day']
 *   - metrics: ['spend', 'impressions', 'clicks', 'conversion',
 *               'conversion_value', 'cpc', 'cpm', 'ctr', 'conversion_rate']
 *   - start_date / end_date: 'YYYY-MM-DD' (TikTok's account timezone, NOT UTC)
 *
 * Currency: advertiser-account-level. Read via `/advertiser/info/` once at
 * cron-fire time; cronDaily applies FX to CAD via the existing fx helper.
 *
 * Env vars (PROPS-MAP additions, Phase B):
 *   ${STORE}_TIKTOK_ADVERTISER_ID  — numeric advertiser_id from TikTok Ads Manager
 *   ${STORE}_TIKTOK_ACCESS_TOKEN   — long-lived OAuth token
 *
 * Currently only uzoshop runs TikTok ads (per operator Phase 05.7.5
 * scoping). zolplus / usmile360 callers will throw "Missing TikTok creds"
 * — caught upstream and translated to "skip TikTok fetch for this store"
 * during Phase B wiring.
 */

export const TIKTOK_API_VERSION = 'v1.3';
const TIKTOK_API_BASE = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * One row of TikTok /report/integrated/get/ at data_level=AUCTION_AD.
 * Mirrors `MetaAdRow` and `GoogleAdRow` shape — same dashboard consumers.
 */
export type TikTokAdRow = {
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adId: string;
  adName: string;
  /** Spend in the advertiser-account currency (currency code in `currency` field). */
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Reported conversion value in advertiser currency; 0 when TikTok cannot attribute. */
  conversionValue: number;
  /** Phase 05.7.x — TikTok ad-group `secondary_status` (campaign delivery
   *  state at fetch time). Possible values: ADGROUP_STATUS_DELIVERY_OK,
   *  ADGROUP_STATUS_DISABLE (paused), ADGROUP_STATUS_BUDGET_EXCEED,
   *  ADGROUP_STATUS_TIMEDOUT, ADGROUP_STATUS_FROZEN, ADGROUP_STATUS_ARCHIVED,
   *  ADGROUP_STATUS_DELETE, ADGROUP_STATUS_AUDIT, etc. Source:
   *  /open_api/v1.3/adgroup/get/. Populated by fetchTikTokAdGroupStatuses
   *  inside fetchTikTokAdInsights — same call site, additional API hop. */
  effectiveStatus: string | null;
};

/**
 * Per-day store-level aggregate. `spend` is in the advertiser's currency;
 * the writer at `cronDaily.ts` converts via `getFxRate(currency, 'CAD')`.
 */
export type TikTokDaySpend = {
  storeId: string;
  date: string;
  spend: number;
  currency: string;
};

export type TikTokAdvertiserInfo = {
  advertiserId: string;
  name: string;
  currency: string;
  timezone: string;
};

// ───────────────────────────────────────────────────────────────────────
// Cred resolver — PROPS-MAP convention ${STORE}_TIKTOK_*
// ───────────────────────────────────────────────────────────────────────

function getTikTokCreds(storeId: string): {
  advertiserId: string;
  accessToken: string;
} {
  const upper = storeId.toUpperCase();
  const advertiserId = process.env[`${upper}_TIKTOK_ADVERTISER_ID`];
  const accessToken = process.env[`${upper}_TIKTOK_ACCESS_TOKEN`];
  const missing: string[] = [];
  if (!advertiserId) missing.push(`${upper}_TIKTOK_ADVERTISER_ID`);
  if (!accessToken) missing.push(`${upper}_TIKTOK_ACCESS_TOKEN`);
  if (missing.length) {
    throw new Error(
      `Missing TikTok creds for store "${storeId}": ${missing.join(', ')} ` +
        `(set in Vercel env vars after App approval + OAuth handshake — ` +
        `see User Manual § TikTok integration).`,
    );
  }
  return { advertiserId: advertiserId!, accessToken: accessToken! };
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

type TikTokEnvelope<T> = {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
};

async function tiktokGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${TIKTOK_API_BASE}${path}?${qs}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Access-Token': accessToken,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `TikTok ${path} HTTP ${res.status}: ${body.slice(0, 600)}`,
    );
  }
  const env = (await res.json()) as TikTokEnvelope<T>;
  // TikTok wraps every response in { code, message, data }. code !== 0 is
  // an application-level error (auth expired, advertiser_id mismatch, etc.).
  if (env.code !== 0) {
    throw new Error(
      `TikTok ${path} code=${env.code}: ${env.message ?? '(no message)'} ` +
        `(request_id=${env.request_id ?? 'n/a'})`,
    );
  }
  if (!env.data) {
    throw new Error(`TikTok ${path} returned envelope with code=0 but no data`);
  }
  return env.data;
}

function parseNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ───────────────────────────────────────────────────────────────────────
// Public entry points
// ───────────────────────────────────────────────────────────────────────

/**
 * One-shot lookup of the advertiser's display info — currency in
 * particular, used by the writer to FX-convert spend to CAD.
 *
 * Caches in-memory per process via a Map<storeId, info>. The advertiser
 * currency is effectively immutable (TikTok doesn't let you change it
 * after the account is created), so a process-lifetime cache is safe.
 */
const advertiserInfoCache = new Map<string, TikTokAdvertiserInfo>();

/**
 * Test-only helper — clears the in-memory advertiser-info cache so each
 * unit test starts fresh. Production code never calls this; the cache
 * is intentionally process-lifetime in normal operation.
 */
export function _resetAdvertiserInfoCacheForTesting(): void {
  advertiserInfoCache.clear();
}

export async function fetchTikTokAdvertiserInfo(
  storeId: string,
): Promise<TikTokAdvertiserInfo> {
  const cached = advertiserInfoCache.get(storeId);
  if (cached) return cached;

  const { advertiserId, accessToken } = getTikTokCreds(storeId);
  type AdvertiserInfoPayload = {
    list?: Array<{
      advertiser_id?: string | number;
      name?: string;
      currency?: string;
      timezone?: string;
    }>;
  };
  const data = await tiktokGet<AdvertiserInfoPayload>(
    '/advertiser/info/',
    accessToken,
    {
      // Phase 05.7.8 FIX (root cause of "TikTok shows 0"): the advertiser_ids
      // param must be a JSON-encoded array of STRINGS. Previously this used a
      // template literal `[${advertiserId}]` which produced an UNQUOTED number
      // array like `[7012345678901234567]`. TikTok's API rejects that with
      // `code=40002 advertiser_ids.0: Not a valid string`, the .catch in
      // cron-live/cron-daily silently swallowed the error → tt_spend_cad
      // stayed 0 for every day since the integration shipped, no campaigns,
      // no ads. Quoting the ID restores the entire TikTok data plane.
      advertiser_ids: JSON.stringify([String(advertiserId)]),
      fields: '["advertiser_id","name","currency","timezone"]',
    },
  );
  const row = (data.list ?? [])[0];
  if (!row) {
    throw new Error(
      `TikTok /advertiser/info/ returned empty list for ${advertiserId} — ` +
        `verify the access_token is bound to that advertiser_id.`,
    );
  }
  const info: TikTokAdvertiserInfo = {
    advertiserId: String(row.advertiser_id ?? advertiserId),
    name: String(row.name ?? ''),
    currency: String(row.currency ?? 'USD').toUpperCase(),
    timezone: String(row.timezone ?? 'UTC'),
  };
  advertiserInfoCache.set(storeId, info);
  return info;
}

/**
 * Fetch one day's store-level TikTok spend. Returns spend in the
 * advertiser's CURRENCY (not CAD) — cronDaily handles FX conversion via
 * the existing `getFxRate` helper.
 *
 * Implementation: paginates `/report/integrated/get/` at
 * data_level=AUCTION_ADVERTISER (cheapest call — single row per day).
 * For per-ad granularity, see `fetchTikTokAdInsights` below.
 */
export async function fetchTikTokSpendForDay(
  storeId: string,
  dateStr: string,
): Promise<TikTokDaySpend> {
  const { advertiserId, accessToken } = getTikTokCreds(storeId);
  const info = await fetchTikTokAdvertiserInfo(storeId);

  type ReportPayload = {
    list?: Array<{
      metrics?: { spend?: string | number };
      dimensions?: { advertiser_id?: string | number };
    }>;
  };

  const data = await tiktokGet<ReportPayload>(
    '/report/integrated/get/',
    accessToken,
    {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: '["advertiser_id"]',
      metrics: '["spend"]',
      start_date: dateStr,
      end_date: dateStr,
      page_size: '1',
    },
  );

  const row = (data.list ?? [])[0];
  const spend = parseNum(row?.metrics?.spend ?? 0);
  return {
    storeId,
    date: dateStr,
    spend,
    currency: info.currency,
  };
}

/**
 * Fetch one day of per-ad insights. Mirrors `fetchMetaAdInsights` /
 * `fetchGoogleAdsAdInsights` — returns the unified `TikTokAdRow[]` shape
 * the campaigns table reads.
 *
 * Paginated via TikTok's `page` + `page_size` (max 1000/page; we use 200).
 * Pagination cap mirrors the Shopify fetcher's 50-page safety guard.
 */
const TIKTOK_PAGINATION_CAP = 50;

/**
 * Phase 05.7.x — pull ad-group `secondary_status` for every ad-group
 * under this advertiser, returning a Map<adgroup_id, status>. Status
 * values: ADGROUP_STATUS_DELIVERY_OK (delivering), ADGROUP_STATUS_DISABLE
 * (paused by operator), ADGROUP_STATUS_BUDGET_EXCEED, ADGROUP_STATUS_TIMEDOUT,
 * ADGROUP_STATUS_FROZEN, ADGROUP_STATUS_ARCHIVED, ADGROUP_STATUS_DELETE,
 * ADGROUP_STATUS_AUDIT (in review), and several more.
 *
 * Two API hops because TikTok's /report/integrated/get/ does NOT carry
 * delivery status — it's a metrics endpoint, not an entity endpoint. We
 * separately query /adgroup/get/ which exposes the entity-level state.
 * fetchTikTokAdInsights then merges the status into each TikTokAdRow by
 * adgroup_id.
 *
 * Soft-fail: on any error we return an empty Map so the insights flow
 * still completes (status is a nice-to-have signal; the spend / value
 * data must not depend on it). Errors logged for the Inngest run log.
 *
 * Paginates with TikTok's `page` / `page_size` semantics — same shape
 * as the report endpoint. 50-page cap (1000 ad-groups max for this
 * advertiser, way above realistic counts).
 */
/**
 * Phase 05.7.x (2026-05-23) — extended return value: each entry now
 * carries `campaignId`, names, and the status. cron-live consumes this
 * to write placeholder rows for ad-groups that haven't yet served any
 * impressions — so newly-created ad-groups show up in the dashboard
 * within 10 min instead of waiting for the report endpoint to start
 * carrying their metrics.
 */
export type TikTokAdGroupMeta = {
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  status: string;
};

export async function fetchTikTokAdGroupStatuses(
  storeId: string,
): Promise<Map<string, TikTokAdGroupMeta>> {
  const out = new Map<string, TikTokAdGroupMeta>();
  let advertiserId: string;
  let accessToken: string;
  try {
    ({ advertiserId, accessToken } = getTikTokCreds(storeId));
  } catch {
    // No creds → no statuses. Caller already short-circuits via
    // STORES_WITH_TIKTOK; reaching here is a soft-fail edge case.
    return out;
  }

  type AdGroupRow = {
    adgroup_id?: string | number;
    adgroup_name?: string;
    campaign_id?: string | number;
    campaign_name?: string;
    secondary_status?: string;
    operation_status?: string;
  };
  type ListPayload = {
    list?: AdGroupRow[];
    page_info?: { total_page?: number; page?: number };
  };

  let page = 1;
  while (page <= TIKTOK_PAGINATION_CAP) {
    let data: ListPayload;
    try {
      data = await tiktokGet<ListPayload>('/adgroup/get/', accessToken, {
        advertiser_id: advertiserId,
        // Phase 05.7.x (2026-05-23) — added campaign_id + campaign_name +
        // adgroup_name so the writer can create placeholder rows with
        // proper labels (operator sees the actual campaign name, not just
        // a numeric ID, even before the ad-group has spent its first $).
        fields:
          '["adgroup_id","adgroup_name","campaign_id","campaign_name",' +
          '"secondary_status","operation_status"]',
        page_size: '200',
        page: String(page),
      });
    } catch (e) {
      console.warn(
        `TikTok adgroup statuses ${storeId} page ${page} failed (soft): ` +
          `${(e as Error).message ?? String(e)}`,
      );
      return out; // partial map > throw — same policy as Meta budgets.
    }

    for (const r of data.list ?? []) {
      const id = String(r.adgroup_id ?? '').trim();
      if (!id) continue;
      // Prefer secondary_status (granular delivery state); fall back to
      // operation_status (operator-set enable/disable, less specific).
      const status = (r.secondary_status || r.operation_status || '').trim();
      if (!status) continue;
      out.set(id, {
        campaignId: String(r.campaign_id ?? '').trim(),
        campaignName: (r.campaign_name || '').trim(),
        adGroupName: (r.adgroup_name || '').trim(),
        status,
      });
    }

    const totalPages = Number(data.page_info?.total_page ?? 1);
    if (page >= totalPages) break;
    page++;
  }
  if (page >= TIKTOK_PAGINATION_CAP) {
    console.warn(
      `TikTok adgroup statuses ${storeId}: hit pagination cap of ` +
        `${TIKTOK_PAGINATION_CAP} pages — some ad-groups may be missing.`,
    );
  }
  return out;
}

export async function fetchTikTokAdInsights(
  storeId: string,
  dateStr: string,
): Promise<TikTokAdRow[]> {
  const { advertiserId, accessToken } = getTikTokCreds(storeId);
  const info = await fetchTikTokAdvertiserInfo(storeId);

  // Phase 05.7.x — fetch ad-group statuses in parallel with the
  // first report page. /adgroup/get/ is an entity endpoint (status
  // doesn't change per-day), so one call serves the whole day.
  const statusesPromise = fetchTikTokAdGroupStatuses(storeId);

  type AdReportRow = {
    metrics?: {
      spend?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversion?: string | number;
      /**
       * Phase 05.7.8 — TikTok Marketing API does NOT have a generic
       * `conversion_value` metric (the prior code used that name and got
       * `40002 Invalid metric fields`). For e-commerce, the canonical
       * "revenue attributed to the ad" metric is `total_complete_payment_rate`
       * × spend → no, that's a rate. The real value field is
       * `complete_payment` count × `value_per_complete_payment` per row,
       * but TikTok also exposes `total_complete_payment_value` directly
       * (= sum of purchase event values reported via Web Events / Pixel).
       * We map this onto the existing `conversionValue` shape so
       * CampaignsTable / aiReport / Pixel-vs-Shopify reconciliation
       * surfaces TikTok like Meta + Google without code changes downstream.
       */
      complete_payment?: string | number;
      total_complete_payment_rate?: string | number;
      value_per_complete_payment?: string | number;
      campaign_id?: string;
      campaign_name?: string;
      adgroup_id?: string;
      adgroup_name?: string;
      ad_name?: string;
    };
    dimensions?: { ad_id?: string | number; stat_time_day?: string };
  };
  type ReportPayload = {
    list?: AdReportRow[];
    page_info?: { total_number?: number; total_page?: number; page?: number };
  };

  const out: TikTokAdRow[] = [];
  let page = 1;
  while (page <= TIKTOK_PAGINATION_CAP) {
    const data = await tiktokGet<ReportPayload>(
      '/report/integrated/get/',
      accessToken,
      {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_AD',
        dimensions: '["ad_id"]',
        // Phase 05.7.8 — replaced invalid `conversion_value` with TikTok's
        // real metric names: `complete_payment` (count of purchase events)
        // and `value_per_complete_payment` (avg purchase value). Multiplied
        // together they give the TikTok-attributed revenue equivalent of
        // Meta's `action_value:purchase`. See TikTok Marketing API v1.3
        // metrics reference: business-api.tiktok.com/portal/docs?id=1738864915188737
        metrics:
          '["spend","impressions","clicks","conversion","complete_payment",' +
          '"value_per_complete_payment",' +
          '"campaign_id","campaign_name","adgroup_id","adgroup_name","ad_name"]',
        start_date: dateStr,
        end_date: dateStr,
        page_size: '200',
        page: String(page),
      },
    );

    const rows = data.list ?? [];
    for (const r of rows) {
      const m = r.metrics ?? {};
      const d = r.dimensions ?? {};
      // Phase 05.7.x — purchase-specific count is the operator's mental
      // model of "המרות" in this dashboard (matches what TikTok Ads
      // Manager displays under "Complete Payments"). The generic
      // `m.conversion` metric counts ALL optimisation events depending
      // on the campaign objective (could include Add-to-Cart, View
      // Content, etc.) — which mismatches what we use to compute
      // conversionValue (purchase-specific). Mapping both to
      // complete_payment keeps the columns internally consistent.
      const spend = parseNum(m.spend);
      const impressions = parseNum(m.impressions);
      const purchases = parseNum(m.complete_payment);
      // Drop empty rows (no spend, no impressions, no purchases) — matches
      // meta.ts:fetchMetaAdSetInsights line 57 convention.
      if (spend === 0 && impressions === 0 && purchases === 0) continue;

      // Phase 05.7.8 — synthesize conversionValue from the two TikTok
      // primitives: complete_payment (count) × value_per_complete_payment
      // (avg value per purchase). When TikTok returns 0 for either,
      // conversionValue → 0, matching Meta/Google's behavior on rows with
      // no purchase events tracked.
      const avgPurchase = parseNum(m.value_per_complete_payment);
      const conversionValue = purchases * avgPurchase;
      const conversions = purchases;

      out.push({
        campaignId: String(m.campaign_id ?? ''),
        campaignName: String(m.campaign_name ?? ''),
        adGroupId: String(m.adgroup_id ?? ''),
        adGroupName: String(m.adgroup_name ?? ''),
        adId: String(d.ad_id ?? ''),
        adName: String(m.ad_name ?? ''),
        spend,
        currency: info.currency,
        impressions,
        clicks: parseNum(m.clicks),
        conversions,
        conversionValue,
        // Patched below after statuses resolve. Placeholder keeps the
        // shape consistent so TypeScript doesn't see an optional gap.
        effectiveStatus: null,
      });
    }

    const totalPages = Number(data.page_info?.total_page ?? 1);
    if (page >= totalPages) break;
    page++;
  }
  if (page >= TIKTOK_PAGINATION_CAP) {
    console.warn(
      `TikTok ad insights for ${storeId} ${dateStr}: hit pagination cap of ` +
        `${TIKTOK_PAGINATION_CAP} pages — more rows may exist. Bump cap or ` +
        `investigate ad volume.`,
    );
  }

  // Phase 05.7.x — merge ad-group statuses into the rows. /adgroup/get/
  // returns the current state at fetch time (no per-day dimension), so
  // each ad's row carries the same status as every other ad in the same
  // ad-group. Soft-fail policy: empty map → all rows keep effectiveStatus
  // null, which downstream UI treats as "fall back to lastActiveDate
  // heuristic" — same posture as Meta when budgets soft-failed.
  const statuses = await statusesPromise;
  if (statuses.size > 0) {
    for (const row of out) {
      const meta = statuses.get(row.adGroupId);
      if (meta?.status) row.effectiveStatus = meta.status;
    }
  }

  return out;
}
