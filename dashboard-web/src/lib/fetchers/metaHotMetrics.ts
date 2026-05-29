// dashboard-web/src/lib/fetchers/metaHotMetrics.ts
//
// Phase C — Meta Graph API batch fetch for insights at two levels
// (adset / ad), filtered to the hot set ids passed in. Time range =
// single day (the same day; intraday refresh is the orchestrator's job
// to call back every 10 min).
//
// CRIT-B note: campaign-level rows are intentionally NOT fetched. The
// campaigns_daily.ad_set_id column is NOT NULL — Meta `/insights?
// level=campaign` returns no adset breakdown, so there's no source
// value to satisfy the constraint. The campaign-aggregate value used
// by Today / Today-Live is computed at read time by the existing
// aggregators reading the per-adset rows. `hotCampaignIds` remains in
// the input shape so callers don't have to change; it is now ignored
// by the fetcher.
//
// Returns rows compatible with the existing campaigns_daily +
// ads_daily shapes used by persistCampaignsLive.

import type { Platform, StoreId } from '@/lib/registries/types';

const GRAPH_VERSION = 'v22.0';
const ADSET_INSIGHTS_FIELDS = 'campaign_id,adset_id,impressions,clicks,spend,actions,action_values';
const AD_INSIGHTS_FIELDS = 'campaign_id,adset_id,ad_id,impressions,clicks,spend,actions,action_values';

export type MetaHotMetricsInput = {
  storeId: StoreId;
  adAccountId: string;
  accessToken: string;
  hotCampaignIds: string[];
  hotAdsetIds: string[];
  hotAdIds: string[];
  dateStr: string;
  fetcher?: typeof fetch;
  getFxCadFor: (amount: number, currency: 'USD' | 'CAD' | 'ILS') => Promise<number>;
};

export type CampaignDailyRow = {
  store_id: StoreId;
  platform: Platform;
  campaign_id: string;
  date: string;
  spend_cad: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_cad: number;
};

export type AdsetDailyRow = CampaignDailyRow & { ad_set_id: string };
export type AdDailyRow = AdsetDailyRow & { ad_id: string };

export type MetaHotMetricsResult = {
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchMetaHotMetricsForStore(input: MetaHotMetricsInput): Promise<MetaHotMetricsResult> {
  const { storeId, accessToken, dateStr, fetcher = fetch, getFxCadFor } = input;
  // hotCampaignIds is intentionally ignored — see file-header CRIT-B note.
  if (input.hotAdsetIds.length === 0 && input.hotAdIds.length === 0) {
    return { adsets: [], ads: [] };
  }
  const adAccountId = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`;

  const filtering = (field: string, ids: string[]): string =>
    encodeURIComponent(JSON.stringify([{ field, operator: 'IN', value: ids }]));
  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }));

  const batch: Array<{ method: string; relative_url: string }> = [];
  if (input.hotAdsetIds.length > 0) {
    batch.push({
      method: 'GET',
      relative_url: `${adAccountId}/insights?level=adset&fields=${ADSET_INSIGHTS_FIELDS}&time_range=${timeRange}&filtering=${filtering('adset.id', input.hotAdsetIds)}&limit=1000`,
    });
  }
  if (input.hotAdIds.length > 0) {
    batch.push({
      method: 'GET',
      relative_url: `${adAccountId}/insights?level=ad&fields=${AD_INSIGHTS_FIELDS}&time_range=${timeRange}&filtering=${filtering('ad.id', input.hotAdIds)}&limit=2000`,
    });
  }

  const body = new URLSearchParams();
  body.set('access_token', accessToken);
  body.set('batch', JSON.stringify(batch));

  const res = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Meta hot-metrics batch ${res.status}: ${await res.text()}`);

  const parts = (await res.json()) as Array<{ code: number; body: string }>;

  let cursor = 0;
  const adsetRaw = input.hotAdsetIds.length > 0 ? asArray(parts[cursor++]) : [];
  const adRaw = input.hotAdIds.length > 0 ? asArray(parts[cursor++]) : [];

  const adsets = await Promise.all(adsetRaw.map((r) => toAdsetRow(storeId, dateStr, r, getFxCadFor)));
  const ads = await Promise.all(adRaw.map((r) => toAdRow(storeId, dateStr, r, getFxCadFor)));

  return { adsets, ads };
}

function asArray(part: { code: number; body: string } | undefined): Array<Record<string, unknown>> {
  if (!part || part.code !== 200) return [];
  try {
    const parsed = JSON.parse(part.body) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

async function toCampaignRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<CampaignDailyRow> {
  const spend = Number(r.spend ?? 0);
  const spendCad = await getFx(spend, 'USD');
  const conv = sumActions(r.actions, 'purchase');
  const convValue = sumActionValues(r.action_values, 'purchase');
  const convValueCad = await getFx(convValue, 'USD');
  return {
    store_id: storeId, platform: 'meta', campaign_id: String(r.campaign_id), date: dateStr,
    spend_cad: spendCad,
    impressions: Math.round(Number(r.impressions ?? 0)),
    clicks: Math.round(Number(r.clicks ?? 0)),
    conversions: Math.round(conv),
    conversion_value_cad: convValueCad,
  };
}

async function toAdsetRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<AdsetDailyRow> {
  return {
    ...(await toCampaignRow(storeId, dateStr, r, getFx)),
    ad_set_id: String(r.adset_id),
  };
}

async function toAdRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<AdDailyRow> {
  return {
    ...(await toAdsetRow(storeId, dateStr, r, getFx)),
    ad_id: String(r.ad_id),
  };
}

function sumActions(actions: unknown, type: string): number {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .filter((a) => a.action_type === type)
    .reduce((acc, a) => acc + Number(a.value ?? 0), 0);
}

function sumActionValues(values: unknown, type: string): number {
  return sumActions(values, type);
}
