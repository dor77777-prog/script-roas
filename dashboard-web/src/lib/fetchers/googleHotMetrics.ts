// dashboard-web/src/lib/fetchers/googleHotMetrics.ts
//
// Phase C — Google Ads metrics fetch for hot ids. Cost is reported
// in micros (1/1,000,000 of the account currency unit); we divide by
// 1e6 to get major-unit. uzoshop's Google account is CAD-native, so
// no FX conversion needed at this level.

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
  campaigns: CampaignDailyRow[];
  adsets: AdsetDailyRow[];
  ads: AdDailyRow[];
};

export async function fetchGoogleHotMetricsForStore(input: GoogleHotMetricsInput): Promise<GoogleHotMetricsResult> {
  const { storeId, customer, dateStr } = input;
  if (input.hotCampaignIds.length === 0 && input.hotAdgroupIds.length === 0 && input.hotAdIds.length === 0) {
    return { campaigns: [], adsets: [], ads: [] };
  }
  const dateLiteral = `'${dateStr}'`;

  const campaigns: CampaignDailyRow[] = [];
  if (input.hotCampaignIds.length > 0) {
    const ids = input.hotCampaignIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE campaign.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      campaigns.push(toCampaignRow(storeId, r));
    }
  }

  const adsets: AdsetDailyRow[] = [];
  if (input.hotAdgroupIds.length > 0) {
    const ids = input.hotAdgroupIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, ad_group.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group WHERE ad_group.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      adsets.push(toAdsetRow(storeId, r));
    }
  }

  const ads: AdDailyRow[] = [];
  if (input.hotAdIds.length > 0) {
    const ids = input.hotAdIds.map(id => `'${id}'`).join(',');
    const rows = await customer.searchStream({
      query: `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids}) AND segments.date = ${dateLiteral}`,
    });
    for (const r of rows) {
      ads.push(toAdRow(storeId, r));
    }
  }

  return { campaigns, adsets, ads };
}

function toCampaignRow(storeId: StoreId, r: Record<string, unknown>): CampaignDailyRow {
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const s = (r.segments ?? {}) as Record<string, unknown>;
  const c = (r.campaign ?? {}) as Record<string, unknown>;
  return {
    store_id: storeId,
    platform: 'google',
    campaign_id: String(c.id),
    date: String(s.date ?? ''),
    spend_cad: Number(m.cost_micros ?? 0) / 1e6,
    impressions: Math.round(Number(m.impressions ?? 0)),
    clicks: Math.round(Number(m.clicks ?? 0)),
    conversions: Math.round(Number(m.conversions ?? 0)),
    conversion_value_cad: Number(m.conversions_value ?? 0),
  };
}

function toAdsetRow(storeId: StoreId, r: Record<string, unknown>): AdsetDailyRow {
  const ag = (r.ad_group ?? {}) as Record<string, unknown>;
  return {
    ...toCampaignRow(storeId, r),
    ad_set_id: String(ag.id),
  };
}

function toAdRow(storeId: StoreId, r: Record<string, unknown>): AdDailyRow {
  const ag = (r.ad_group ?? {}) as Record<string, unknown>;
  const aga = (r.ad_group_ad ?? {}) as Record<string, unknown>;
  const adInner = (aga.ad ?? {}) as Record<string, unknown>;
  return {
    ...toCampaignRow(storeId, r),
    ad_set_id: String(ag.id),
    ad_id: String(adInner.id),
  };
}
