// dashboard-web/src/lib/fetchers/googleHotMetrics.ts
//
// Phase C — Google Ads metrics fetch for hot ids. Cost is reported
// in micros (1/1,000,000 of the account currency unit); we divide by
// 1e6 to get major-unit. uzoshop's Google account is CAD-native, so
// no FX conversion needed at this level.
//
// CRIT-B note: campaign-level rows are intentionally NOT fetched. The
// campaigns_daily.ad_set_id column is NOT NULL — Google's `campaign`
// resource returns no ad_group breakdown so there's no source value
// to satisfy the constraint. The campaign-aggregate value used by
// Today / Today-Live is computed at read time by the existing
// aggregators reading the per-ad-group rows. `hotCampaignIds` remains
// in the input shape so callers don't have to change; it is now
// ignored by the fetcher.

import type { StoreId } from '@/lib/registries/types';
import type { AdDailyRow, AdsetDailyRow, CampaignDailyRow } from './metaHotMetrics';

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

export type GoogleHotMetricsInput = {
  storeId: StoreId;
  customer: Customer;
  hotCampaignIds: string[];
  hotAdgroupIds: string[];
  hotAdIds: string[];
  dateStr: string;
};

export type GoogleHotMetricsResult = {
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchGoogleHotMetricsForStore(input: GoogleHotMetricsInput): Promise<GoogleHotMetricsResult> {
  const { storeId, customer, dateStr } = input;
  // hotCampaignIds is intentionally ignored — see file-header CRIT-B note.
  if (input.hotAdgroupIds.length === 0 && input.hotAdIds.length === 0) {
    return { adsets: [], ads: [] };
  }
  const dateLiteral = `'${dateStr}'`;

  const adsets: AdsetDailyRow[] = [];
  if (input.hotAdgroupIds.length > 0) {
    const ids = input.hotAdgroupIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group WHERE ad_group.id IN (${ids}) AND segments.date = ${dateLiteral}`;
    const rows = await customer.searchStream({ query });
    // Phase E1.7 diagnostic logging — investigate why campaigns_daily.google
    // was frozen since 17:30 IL on 2026-05-30. Captures API response shape.
    console.log(`[gh-diag] adgroup_query store=${storeId} date=${dateStr} ids=${input.hotAdgroupIds.length} rows=${rows.length} sample=${JSON.stringify(rows[0] ?? null).slice(0, 300)}`);
    for (const r of rows) {
      adsets.push(toAdsetRow(storeId, r));
    }
  }

  const ads: AdDailyRow[] = [];
  if (input.hotAdIds.length > 0) {
    const ids = input.hotAdIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids}) AND segments.date = ${dateLiteral}`;
    const rows = await customer.searchStream({ query });
    console.log(`[gh-diag] ad_query store=${storeId} date=${dateStr} ids=${input.hotAdIds.length} rows=${rows.length}`);
    for (const r of rows) {
      ads.push(toAdRow(storeId, r));
    }
  }

  return { adsets, ads };
}

function toCampaignRow(storeId: StoreId, r: Record<string, unknown>): CampaignDailyRow {
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const s = (r.segments ?? {}) as Record<string, unknown>;
  const c = (r.campaign ?? {}) as Record<string, unknown>;
  // CRIT-C: JSON response uses camelCase keys — costMicros, conversionsValue.
  return {
    store_id: storeId,
    platform: 'google',
    campaign_id: String(c.id),
    // IMP-A: preserve campaign_name on every hot-metrics upsert.
    campaign_name: (c.name as string | undefined) ?? null,
    date: String(s.date ?? ''),
    spend_cad: Number(m.costMicros ?? 0) / 1e6,
    impressions: Math.round(Number(m.impressions ?? 0)),
    clicks: Math.round(Number(m.clicks ?? 0)),
    conversions: Math.round(Number(m.conversions ?? 0)),
    conversion_value_cad: Number(m.conversionsValue ?? 0),
  };
}

function toAdsetRow(storeId: StoreId, r: Record<string, unknown>): AdsetDailyRow {
  // CRIT-C: JSON uses camelCase key `adGroup`.
  const ag = (r.adGroup ?? {}) as Record<string, unknown>;
  return {
    ...toCampaignRow(storeId, r),
    ad_set_id: String(ag.id),
    // IMP-A: preserve ad_set_name (sourced from ad_group.name).
    ad_set_name: (ag.name as string | undefined) ?? null,
  };
}

function toAdRow(storeId: StoreId, r: Record<string, unknown>): AdDailyRow {
  // CRIT-C: JSON uses camelCase keys `adGroup` and `adGroupAd`.
  const ag = (r.adGroup ?? {}) as Record<string, unknown>;
  const aga = (r.adGroupAd ?? {}) as Record<string, unknown>;
  const adInner = (aga.ad ?? {}) as Record<string, unknown>;
  return {
    ...toCampaignRow(storeId, r),
    ad_set_id: String(ag.id),
    ad_set_name: (ag.name as string | undefined) ?? null,
    ad_id: String(adInner.id),
    // IMP-A: preserve ad_name (sourced from ad_group_ad.ad.name).
    ad_name: (adInner.name as string | undefined) ?? null,
  };
}
