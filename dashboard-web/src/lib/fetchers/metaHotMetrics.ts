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
// CRIT-D note: conversions are extracted using the canonical priority
// chain `omni_purchase → purchase → offsite_conversion.fb_pixel_purchase`
// (first match wins, NOT summed). Source of truth: meta.ts:280
// (extractMetaPurchases). Duplicated here rather than exported to
// preserve meta.ts's "exported for parity tests only" boundary.
//
// CRIT-E note: spend/value FX conversion uses the per-row
// `account_currency` (Meta returns ILS for all 3 stores per the seed).
// Hardcoded 'USD' inflated CAD by ~3.7x (USD→CAD 1.36 vs ILS→CAD 0.37).
//
// IMP-A note: `campaign_name`, `adset_name`, `ad_name` are preserved on
// every hot-metrics upsert. Supabase upsert SETs every column; omitting
// names would null them until nightly cron repopulates.
//
// Returns rows compatible with the existing campaigns_daily +
// ads_daily shapes used by persistCampaignsLive.

import type { Platform, StoreId } from '@/lib/registries/types';

const GRAPH_VERSION = 'v22.0';
// IMP-A + CRIT-E: include campaign_name, adset_name (and ad_name on AD level)
// + account_currency for per-row FX resolution.
const ADSET_INSIGHTS_FIELDS = 'campaign_id,campaign_name,adset_id,adset_name,impressions,clicks,spend,actions,action_values,account_currency';
const AD_INSIGHTS_FIELDS = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,clicks,spend,actions,action_values,account_currency';

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
  campaign_name: string | null;
  date: string;
  spend_cad: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_cad: number;
};

export type AdsetDailyRow = CampaignDailyRow & {
  ad_set_id: string;
  ad_set_name: string | null;
};
export type AdDailyRow = AdsetDailyRow & {
  ad_id: string;
  ad_name: string | null;
};

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
  // CRIT-E: resolve FX per row from account_currency (Meta returns ILS
  // for all 3 stores per the seed; hardcoded 'USD' inflated CAD ~3.7x).
  const currency = normalizeCurrency(r.account_currency);
  const spendCad = await getFx(spend, currency);
  // CRIT-D: priority chain pick — first match wins, do NOT sum.
  // Source of truth: meta.ts:280 (extractMetaPurchases).
  const conv = extractMetaPurchasesHot(r.actions, r.action_values);
  const convValueCad = await getFx(conv.value, currency);
  return {
    store_id: storeId, platform: 'meta',
    campaign_id: String(r.campaign_id),
    // IMP-A: preserve campaign_name so upsert does not null the existing
    // column (Supabase upsert SETs every column in the row).
    campaign_name: (r.campaign_name as string | undefined) ?? null,
    date: dateStr,
    spend_cad: spendCad,
    impressions: Math.round(Number(r.impressions ?? 0)),
    clicks: Math.round(Number(r.clicks ?? 0)),
    conversions: Math.round(conv.count),
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
    // IMP-A: preserve adset_name (column is `ad_set_name` per schema).
    ad_set_name: (r.adset_name as string | undefined) ?? null,
  };
}

async function toAdRow(
  storeId: StoreId, dateStr: string, r: Record<string, unknown>,
  getFx: MetaHotMetricsInput['getFxCadFor'],
): Promise<AdDailyRow> {
  return {
    ...(await toAdsetRow(storeId, dateStr, r, getFx)),
    ad_id: String(r.ad_id),
    // IMP-A: preserve ad_name (column is `ad_name` per schema).
    ad_name: (r.ad_name as string | undefined) ?? null,
  };
}

/**
 * CRIT-D — Pick a purchase metric value from the action arrays using the
 * canonical priority chain. SOURCE OF TRUTH: `meta.ts:280`
 * (extractMetaPurchases). Duplicated here rather than exported because
 * meta.ts boundary comment says "exported for parity tests only — do
 * not call from production code".
 *
 * Priority chain — DO NOT reorder. omni_purchase first because it
 * captures offline conversions in addition to web/CAPI; purchase second
 * because it matches both the pixel and the server-side CAPI deduped
 * events; the legacy fb_pixel_purchase event last for accounts that
 * have not migrated.
 */
// prettier-ignore
const META_PURCHASE_PRIORITY = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'] as const;

function extractMetaPurchasesHot(
  actions: unknown,
  values: unknown,
): { count: number; value: number } {
  const pick = (arr: unknown): number => {
    if (!Array.isArray(arr)) return 0;
    for (const t of META_PURCHASE_PRIORITY) {
      const found = arr.find(
        (a): a is { action_type?: string; value?: string | number } =>
          typeof a === 'object' && a !== null && (a as { action_type?: string }).action_type === t,
      );
      if (found) return Number(found.value ?? 0) || 0;
    }
    return 0;
  };
  return { count: pick(actions), value: pick(values) };
}

/**
 * CRIT-E — Narrow Meta's `account_currency` (untyped string) to the
 * union accepted by `getFxCadFor`. The 3 production stores are all ILS,
 * but the type union also accepts USD/CAD for robustness against future
 * accounts. Unknown codes fall back to ILS (the seed default) rather
 * than throwing — better to use an approximate rate than to skip the
 * row entirely.
 */
function normalizeCurrency(raw: unknown): 'USD' | 'CAD' | 'ILS' {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'USD' || s === 'CAD' || s === 'ILS') return s;
  return 'ILS';
}
