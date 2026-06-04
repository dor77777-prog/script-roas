// dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts
//
// TikTok hot-set metrics fetcher for campaigns_daily + ads_daily.
//
// Dimension rules (per TikTok BASIC report_type, validated empirically
// against the production API 2026-05-30):
//   AUCTION_ADGROUP — dimensions MUST be exactly `["adgroup_id"]`. TikTok
//     rejects `["campaign_id","adgroup_id"]` with
//     `code=40002 data_level AUCTION_ADGROUP and dimension campaign_id do
//     not match`.
//   AUCTION_AD — dimensions MUST be exactly `["ad_id"]`. TikTok rejects any
//     parent ID with `code=40002 data_level AUCTION_AD and dimension <X>
//     do not match`.
//
// Parent IDs are sourced from caller-provided maps:
//   * `adsetIdToCampaignId` (built from adset_registry by the worker) for
//     AUCTION_ADGROUP rows
//   * `adIdToParent` (built from ad_registry by the worker) for AUCTION_AD
//     rows
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
   * Adset → campaign map sourced from adset_registry by the worker.
   * Required because AUCTION_ADGROUP responses cannot carry campaign_id as
   * a dimension. The worker queries `adset_registry WHERE platform='tiktok'
   * AND adset_id IN (hotAdgroupIds)` and builds adgroupId → campaign_id.
   * Adgroups NOT present in this map are SKIPPED (would otherwise route
   * to the worker's storeId fallback, not the campaign-store-map target).
   *
   * Optional only for backwards-compat with vitest fixtures that pass no
   * hot adgroup ids.
   */
  adsetIdToCampaignId?: Map<string, string>;
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
    // Per TikTok: dimensions MUST be exactly the ID matching the
    // data_level. Parent IDs come from caller-provided maps
    // (`adsetIdToCampaignId` for ADGROUP rows, `adIdToParent` for AD rows).
    const dims = dataLevel === 'AUCTION_ADGROUP'
      ? ['adgroup_id']
      : ['ad_id'];
    const dimensions = JSON.stringify(dims);
    // Conversion metrics: `complete_payment` (count of Complete Payment
    // events) + `value_per_complete_payment` (avg value per payment). These
    // are the metrics TikTok Ads Manager surfaces as "Complete Payments" and
    // the operator's "המרות" — and the SAME set the nightly fetcher
    // (tiktok.ts:fetchTikTokAdInsights) already uses. The earlier
    // `purchase`/`total_purchase_value` pair is the APP-event family and
    // returns 0 for this Shopify web-pixel setup (live API probe 2026-06-04:
    // purchase=0 but complete_payment=1 for the same campaign) — which made
    // every TikTok live tick write conversions=0 over the correct nightly value.
    const url = `${TT_BASE}/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&data_level=${dataLevel}&dimensions=${encodeURIComponent(dimensions)}&metrics=${encodeURIComponent(JSON.stringify(['spend','impressions','clicks','conversion','complete_payment','value_per_complete_payment']))}&start_date=${dateStr}&end_date=${dateStr}&page=1&page_size=1000&filtering=${encodeURIComponent(JSON.stringify(filteringArr))}`;
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

  // ADGROUP rows: enrich `dimensions.campaign_id` from the worker-provided
  // `adsetIdToCampaignId` map (sourced from adset_registry). Skip rows we
  // can't enrich — they would land under the wrong store_id via the
  // campaign-store-map fallback.
  const adsetIdToCampaignId = input.adsetIdToCampaignId ?? new Map<string, string>();
  const adsets: AdsetDailyRow[] = [];
  for (const r of adgroupRaw) {
    const d = (r.dimensions ?? {}) as Record<string, unknown>;
    const adgroupId = String(d.adgroup_id ?? '');
    if (!adgroupId) continue;
    const campaignId = adsetIdToCampaignId.get(adgroupId) ?? '';
    if (!campaignId) continue;
    const enriched = { ...r, dimensions: { ...d, campaign_id: campaignId } };
    adsets.push(await toAdsetRow(resolveStore, dateStr, enriched, accountCurrency, getFxCadFor));
  }

  // AD rows: enrich `dimensions.adgroup_id + campaign_id` from the worker-
  // provided `adIdToParent` map (sourced from ad_registry). Skip rows we
  // can't enrich.
  const adIdToParent = input.adIdToParent ?? new Map<string, { adgroup_id: string; campaign_id: string }>();
  const ads: AdDailyRow[] = [];
  for (const r of adRaw) {
    const d = (r.dimensions ?? {}) as Record<string, unknown>;
    const adId = String(d.ad_id ?? '');
    if (!adId) continue;
    const fromMap = adIdToParent.get(adId);
    if (!fromMap?.adgroup_id || !fromMap?.campaign_id) continue;
    const enriched = { ...r, dimensions: { ...d, adgroup_id: fromMap.adgroup_id, campaign_id: fromMap.campaign_id } };
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
  // Conversions = Complete Payment count. Value is synthesized from
  // `complete_payment` × `value_per_complete_payment` (avg value per payment),
  // mirroring tiktok.ts:fetchTikTokAdInsights. `total_purchase_value` is the
  // app-event value field and is empty for this web-pixel setup.
  const purchase = Number(m.complete_payment ?? 0);
  const avgPurchase = Number(m.value_per_complete_payment ?? 0);
  const purchaseValue = purchase * avgPurchase;
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
