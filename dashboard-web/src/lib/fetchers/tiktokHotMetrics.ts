// dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts
//
// TikTok hot-set metrics fetcher for campaigns_daily + ads_daily.
//
// Dimension rules (per TikTok BASIC report_type):
//   AUCTION_ADGROUP — dimensions MUST contain `adgroup_id` and MAY contain
//     `campaign_id`. We send `["campaign_id","adgroup_id"]` so a single row
//     carries both for adset_registry routing via the campaign-store-map.
//   AUCTION_AD — dimensions MUST contain `ad_id` and MUST NOT contain any
//     other ID dimension. TikTok rejects `["adgroup_id","ad_id"]` or
//     `["campaign_id","ad_id"]` with `code=40002 data_level AUCTION_AD and
//     dimension <X> do not match`. Parent IDs are sourced from the caller-
//     provided `adIdToParent` map (built from ad_registry by the worker).
//
// CRIT-B note: AUCTION_CAMPAIGN-level rows are intentionally NOT fetched.
// The campaigns_daily.ad_set_id column is NOT NULL — the TikTok report at
// AUCTION_CAMPAIGN provides no adgroup breakdown, so there's no source
// value to satisfy the constraint. The campaign-aggregate value used by
// Today / Today-Live is computed at read time by the existing aggregators
// reading the per-adgroup rows. `hotCampaignIds` remains in the input
// shape so callers don't have to change; it is now ignored by the fetcher.

import type { StoreId } from '@/lib/registries/types';
import type { AdDailyRow, AdsetDailyRow, CampaignDailyRow } from './metaHotMetrics';

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export type TikTokHotMetricsInput = {
  storeId: StoreId;
  advertiserId: string;
  accessToken: string;
  hotCampaignIds: string[];
  hotAdgroupIds: string[];
  hotAdIds: string[];
  dateStr: string;
  campaignStoreMap: Record<string, string>;
  /**
   * Per-ad parent map sourced from ad_registry by the worker.
   * Required because AUCTION_AD responses cannot carry parent IDs (see
   * file-header). The worker queries ad_registry WHERE ad_id IN (hotAdIds)
   * and builds adId → { adgroup_id, campaign_id }. Ads NOT present in this
   * map are SKIPPED (would otherwise be unattributable in campaigns_daily
   * routing via the campaign-store-map).
   *
   * Optional only for backwards-compat with vitest fixtures that pass no
   * hot ad ids; production callers always provide the map when hotAdIds
   * is non-empty.
   */
  adIdToParent?: Map<string, { adgroup_id: string; campaign_id: string }>;
  /**
   * CRIT-E (TikTok parallel) — TikTok's report endpoint does NOT include
   * `account_currency` in standard BASIC report_type metrics. The
   * advertiser-level currency is resolved once per call via
   * `/advertiser/info/get/` (see tiktok.ts:265). The future TikTok worker
   * resolves it there and passes it down here. Tests can pass 'USD'
   * directly. Hardcoding inside the fetcher would inflate CAD on
   * non-USD TikTok accounts the same way the original Meta bug did.
   */
  accountCurrency: 'USD' | 'CAD' | 'ILS';
  fetcher?: typeof fetch;
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>;
};

export type TikTokHotMetricsResult = {
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchTikTokHotMetricsForStore(input: TikTokHotMetricsInput): Promise<TikTokHotMetricsResult> {
  const { storeId, advertiserId, accessToken, dateStr, campaignStoreMap, accountCurrency, fetcher = fetch, getFxCadFor } = input;

  // hotCampaignIds is intentionally ignored — see file-header CRIT-B note.
  if (input.hotAdgroupIds.length === 0 && input.hotAdIds.length === 0) {
    return { adsets: [], ads: [] };
  }

  const resolveStore = (campaignId: string): StoreId => {
    const key = `tiktok::${advertiserId}::${campaignId}`;
    return (campaignStoreMap[key] as StoreId) ?? storeId;
  };

  const fetchLevel = async (
    dataLevel: 'AUCTION_ADGROUP' | 'AUCTION_AD',
    filterField: 'adgroup_ids' | 'ad_ids',
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> => {
    if (ids.length === 0) return [];
    // `filter_value` MUST be a JSON-stringified array (TikTok rejects raw
    // arrays with `40002 Invalid filter_value type`).
    const filteringArr = [{ field_name: filterField, filter_type: 'IN', filter_value: JSON.stringify(ids) }];
    // Per TikTok docs: dimensions MUST match the data_level. At ADGROUP
    // we can additionally include `campaign_id` (validated in production);
    // at AD we can ONLY include `ad_id`. Parent IDs for AD rows come from
    // the caller-provided `adIdToParent` map.
    const dims = dataLevel === 'AUCTION_ADGROUP'
      ? ['campaign_id', 'adgroup_id']
      : ['ad_id'];
    const dimensions = JSON.stringify(dims);
    const url = `${TT_BASE}/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&data_level=${dataLevel}&dimensions=${encodeURIComponent(dimensions)}&metrics=${encodeURIComponent(JSON.stringify(['spend','impressions','clicks','conversion','purchase','total_purchase_value']))}&start_date=${dateStr}&end_date=${dateStr}&page=1&page_size=1000&filtering=${encodeURIComponent(JSON.stringify(filteringArr))}`;
    const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
    if (!res.ok) throw new Error(`TikTok report ${dataLevel}: ${res.status}`);
    const body = await res.json() as { code?: number; message?: string; data?: { list?: unknown[] } };
    // Surface TikTok's envelope error codes instead of silently returning
    // []. code !== 0 means an API-level failure (rate limit / token
    // expired / invalid params); the worker's outer try/catch records
    // transient_error and Inngest retries.
    if (body.code !== undefined && body.code !== 0) {
      throw new Error(`TikTok report ${dataLevel}: code=${body.code} message=${body.message ?? ''}`);
    }
    return (body.data?.list as Array<Record<string, unknown>>) ?? [];
  };

  const [adgroupRaw, adRaw] = await Promise.all([
    fetchLevel('AUCTION_ADGROUP', 'adgroup_ids', input.hotAdgroupIds),
    fetchLevel('AUCTION_AD', 'ad_ids', input.hotAdIds),
  ]);

  // Build adgroup_id → campaign_id map from ADGROUP rows. Used as a
  // secondary lookup for AD rows whose ad_id isn't in `adIdToParent`
  // but whose adgroup is (rare race during a registry-refresh tick).
  const adgroupToCampaign = new Map<string, string>();
  for (const r of adgroupRaw) {
    const d = (r.dimensions ?? {}) as Record<string, unknown>;
    const agid = String(d.adgroup_id ?? '');
    const cid = String(d.campaign_id ?? '');
    if (agid && cid) adgroupToCampaign.set(agid, cid);
  }

  const adsets = await Promise.all(adgroupRaw.map(r => toAdsetRow(resolveStore, dateStr, r, accountCurrency, getFxCadFor)));

  // For AD rows: enrich `dimensions.campaign_id` + `dimensions.adgroup_id`
  // from the worker-provided map (primary) or the ADGROUP-derived map
  // (secondary). Skip rows we can't enrich — they would land under the
  // wrong store_id via the campaign-store-map fallback.
  const adIdToParent = input.adIdToParent ?? new Map<string, { adgroup_id: string; campaign_id: string }>();
  const ads: AdDailyRow[] = [];
  for (const r of adRaw) {
    const d = (r.dimensions ?? {}) as Record<string, unknown>;
    const adId = String(d.ad_id ?? '');
    if (!adId) continue;
    const fromMap = adIdToParent.get(adId);
    const adgroupId = fromMap?.adgroup_id ?? '';
    const campaignId = fromMap?.campaign_id ?? adgroupToCampaign.get(adgroupId) ?? '';
    if (!adgroupId || !campaignId) continue;
    const enriched = { ...r, dimensions: { ...d, adgroup_id: adgroupId, campaign_id: campaignId } };
    ads.push(await toAdRow(resolveStore, dateStr, enriched, accountCurrency, getFxCadFor));
  }

  return { adsets, ads };
}

async function toCampaignRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>,
  accountCurrency: TikTokHotMetricsInput['accountCurrency'],
  getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<CampaignDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const cid = String(d.campaign_id ?? '');
  const spend = Number(m.spend ?? 0);
  // CRIT-E (TikTok parallel): use per-call accountCurrency, not hardcoded USD.
  const spendCad = await getFx(spend, accountCurrency);
  const purchase = Number(m.purchase ?? 0);
  const purchaseValue = Number(m.total_purchase_value ?? 0);
  const purchaseValueCad = await getFx(purchaseValue, accountCurrency);
  return {
    store_id: resolveStore(cid), platform: 'tiktok',
    campaign_id: cid,
    // IMP-A note: TikTok's BASIC report_type does NOT expose entity names.
    // Name preservation for TikTok deferred — Phase D will revisit (likely
    // requires a separate /campaign|adgroup|ad/get/ lookup keyed by ids).
    campaign_name: null,
    date: dateStr,
    spend_cad: spendCad,
    impressions: Math.round(Number(m.impressions ?? 0)),
    clicks: Math.round(Number(m.clicks ?? 0)),
    conversions: Math.round(purchase),
    conversion_value_cad: purchaseValueCad,
  };
}

async function toAdsetRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>,
  accountCurrency: TikTokHotMetricsInput['accountCurrency'],
  getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<AdsetDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  return {
    ...(await toCampaignRow(resolveStore, dateStr, r, accountCurrency, getFx)),
    ad_set_id: String(d.adgroup_id ?? ''),
    ad_set_name: null,
  };
}

async function toAdRow(
  resolveStore: (cid: string) => StoreId, dateStr: string,
  r: Record<string, unknown>,
  accountCurrency: TikTokHotMetricsInput['accountCurrency'],
  getFx: TikTokHotMetricsInput['getFxCadFor'],
): Promise<AdDailyRow> {
  const d = (r.dimensions ?? {}) as Record<string, unknown>;
  return {
    ...(await toAdsetRow(resolveStore, dateStr, r, accountCurrency, getFx)),
    ad_id: String(d.ad_id ?? ''),
    ad_name: null,
  };
}
