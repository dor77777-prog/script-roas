// dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts
//
// Phase C — TikTok report fetch for hot ids at adgroup/ad levels.
// campaign-store-map resolves per-row store_id same as tiktokStatus.ts.
//
// CRIT-B note: AUCTION_CAMPAIGN-level rows are intentionally NOT
// fetched. The campaigns_daily.ad_set_id column is NOT NULL — the
// TikTok report at AUCTION_CAMPAIGN provides no adgroup breakdown, so
// there's no source value to satisfy the constraint. The
// campaign-aggregate value used by Today / Today-Live is computed at
// read time by the existing aggregators reading the per-adgroup rows.
// `hotCampaignIds` remains in the input shape so callers don't have
// to change; it is now ignored by the fetcher.

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
    dimensionName: 'adgroup_id' | 'ad_id',
    filterField: 'adgroup_ids' | 'ad_ids',
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> => {
    if (ids.length === 0) return [];
    const url = `${TT_BASE}/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&data_level=${dataLevel}&dimensions=["${dimensionName}"]&metrics=["spend","impressions","clicks","conversion","purchase","total_purchase_value"]&start_date=${dateStr}&end_date=${dateStr}&page=1&page_size=1000&filtering=${encodeURIComponent(JSON.stringify([{ field_name: filterField, filter_type: 'IN', filter_value: ids }]))}`;
    const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
    if (!res.ok) throw new Error(`TikTok report ${dataLevel}: ${res.status}`);
    const body = await res.json() as { data?: { list?: unknown[] } };
    return (body.data?.list as Array<Record<string, unknown>>) ?? [];
  };

  const [adgroupRaw, adRaw] = await Promise.all([
    fetchLevel('AUCTION_ADGROUP', 'adgroup_id', 'adgroup_ids', input.hotAdgroupIds),
    fetchLevel('AUCTION_AD', 'ad_id', 'ad_ids', input.hotAdIds),
  ]);

  const adsets = await Promise.all(adgroupRaw.map(r => toAdsetRow(resolveStore, dateStr, r, accountCurrency, getFxCadFor)));
  const ads = await Promise.all(adRaw.map(r => toAdRow(resolveStore, dateStr, r, accountCurrency, getFxCadFor)));

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
