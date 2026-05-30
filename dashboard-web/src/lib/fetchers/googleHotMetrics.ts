// dashboard-web/src/lib/fetchers/googleHotMetrics.ts
//
// Google Ads hot-set metrics fetcher for campaigns_daily + ads_daily.
//
// Resource selection (per Google Ads API):
//   campaigns_daily — query `FROM campaign WHERE campaign.id IN (...)` for
//     hot CAMPAIGN ids. This works for ALL campaign types (Performance Max,
//     Standard Shopping, Search, Display), because per Google's docs every
//     campaign aggregates `metrics.cost_micros` etc at the campaign resource.
//     Performance Max campaigns intentionally expose NO `ad_group` resource
//     (their delivery is asset-group based), so the previous
//     `FROM ad_group WHERE ad_group.id IN (campaignId)` query returned 0
//     rows. Synthesizing `ad_set_id = campaign_id` matches the existing
//     convention used by the nightly cron + the Phase D backfill (see
//     `campaigns_daily.google` historical rows).
//   ads_daily — query `FROM ad_group_ad WHERE ad_group_ad.ad.id IN (...)`
//     for hot AD ids. Returns 0 rows for PMax campaigns (no `ad_group_ad`
//     resource); returns 1+ rows per ad_id for non-PMax campaigns.
//
// Cost is reported in micros (1/1,000,000 of the account currency unit);
// we divide by 1e6 to get major-unit. uzoshop's Google account is CAD-
// native, so no FX conversion needed at this level.
//
// `hotAdgroupIds` remains in the input shape so callers don't have to
// change; it is now ignored by the fetcher.

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
  const { storeId, customer } = input;
  // hotAdgroupIds is intentionally ignored — we query at campaign level
  // (see file-header). dateStr is also unused because Google's `segments.date`
  // is bucketed in the account timezone — we resolve the date range below
  // from the account's `customer.time_zone`. Empty hot-set early-exit.
  if (input.hotCampaignIds.length === 0 && input.hotAdIds.length === 0) {
    return { adsets: [], ads: [] };
  }

  // Google Ads `segments.date` is bucketed in the account's timezone, NOT
  // UTC. Worker calls us with `dateStr` derived from `new Date().toISOString()
  // .slice(0,10)` (UTC date) which mismatches accounts in non-UTC timezones
  // and returns 0 rows. Fix: query the account's `customer.time_zone` (one
  // extra GAQL call per fetcher call, ~50ms) and compute the local date for
  // the segments.date filter. The filter is `BETWEEN today-1 AND today` so
  // Google's reporting delay (cost.cost_micros can be buffered up to ~3h
  // after the activity) still lets us catch yesterday's full-day spend if
  // today is stale.
  const tzRows = await customer.searchStream({ query: 'SELECT customer.time_zone FROM customer LIMIT 1' });
  const accountTz = String((tzRows[0]?.customer as { timeZone?: string } | undefined)?.timeZone ?? 'UTC');
  const todayInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: accountTz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterdayInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: accountTz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - oneDayMs));

  const adsets: AdsetDailyRow[] = [];
  if (input.hotCampaignIds.length > 0) {
    const ids = input.hotCampaignIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE campaign.id IN (${ids}) AND segments.date BETWEEN '${yesterdayInTz}' AND '${todayInTz}'`;
    const rows = await customer.searchStream({ query });
    for (const r of rows) {
      adsets.push(toAdsetRowFromCampaign(storeId, r));
    }
  }

  const ads: AdDailyRow[] = [];
  if (input.hotAdIds.length > 0) {
    const ids = input.hotAdIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids}) AND segments.date BETWEEN '${yesterdayInTz}' AND '${todayInTz}'`;
    const rows = await customer.searchStream({ query });
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

/**
 * Synthesize an adset row from a campaign-level result by setting
 * `ad_set_id = campaign_id`. Matches the convention used by the nightly
 * cron + Phase D backfill for Performance Max campaigns (which have no
 * real ad_group resource). For non-PMax campaigns this is still correct
 * because we sum across all rows per (date, store_id, platform) when
 * deriving `data_daily.ga_spend_cad` via `agg_data_daily_for_date`.
 */
function toAdsetRowFromCampaign(storeId: StoreId, r: Record<string, unknown>): AdsetDailyRow {
  const c = (r.campaign ?? {}) as Record<string, unknown>;
  const base = toCampaignRow(storeId, r);
  return {
    ...base,
    ad_set_id: String(c.id),
    ad_set_name: (c.name as string | undefined) ?? null,
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
