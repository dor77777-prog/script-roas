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
      advertiser_ids: `[${advertiserId}]`,
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

export async function fetchTikTokAdInsights(
  storeId: string,
  dateStr: string,
): Promise<TikTokAdRow[]> {
  const { advertiserId, accessToken } = getTikTokCreds(storeId);
  const info = await fetchTikTokAdvertiserInfo(storeId);

  type AdReportRow = {
    metrics?: {
      spend?: string | number;
      impressions?: string | number;
      clicks?: string | number;
      conversion?: string | number;
      conversion_value?: string | number;
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
        metrics:
          '["spend","impressions","clicks","conversion","conversion_value",' +
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
      // Drop empty rows (no spend, no impressions, no conversion) — matches
      // meta.ts:fetchMetaAdSetInsights line 57 convention.
      const spend = parseNum(m.spend);
      const impressions = parseNum(m.impressions);
      const conversions = parseNum(m.conversion);
      if (spend === 0 && impressions === 0 && conversions === 0) continue;

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
        conversionValue: parseNum(m.conversion_value),
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
  return out;
}
