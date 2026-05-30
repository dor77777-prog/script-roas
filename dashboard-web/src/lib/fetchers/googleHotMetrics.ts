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

  // Phase E1.7 hotfix (2026-05-30 night) — Google Ads `segments.date`
  // is bucketed in the account's timezone, NOT UTC. Worker calls us
  // with `dateStr` derived from `new Date().toISOString().slice(0,10)`
  // (UTC date) which mismatches accounts in non-UTC timezones and
  // returns 0 rows. Fix: query the account's `customer.time_zone`
  // (one extra GAQL call per fetcher call, ~50ms) and compute the
  // local date for the segments.date filter. We also expand the
  // filter to `BETWEEN today-1 AND today` so Google's reporting delay
  // (cost.cost_micros can be buffered up to ~3h after the activity)
  // still lets us catch yesterday's full-day spend in case today is
  // stale.
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
  console.log(`[gh-diag] tz=${accountTz} todayInTz=${todayInTz} yesterdayInTz=${yesterdayInTz} workerDateStr=${dateStr}`);

  const adsets: AdsetDailyRow[] = [];
  if (input.hotAdgroupIds.length > 0) {
    const ids = input.hotAdgroupIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group WHERE ad_group.id IN (${ids}) AND segments.date BETWEEN '${yesterdayInTz}' AND '${todayInTz}'`;
    const rows = await customer.searchStream({ query });
    console.log(`[gh-diag] adgroup_query store=${storeId} tz=${accountTz} range=${yesterdayInTz}..${todayInTz} ids=${input.hotAdgroupIds.length} rows=${rows.length} sample=${JSON.stringify(rows[0] ?? null).slice(0, 300)}`);
    // Phase E1.7 diag #2: if filtered query returns 0, fall back to a
    // broader query (NO id filter, just date) to verify Google has any
    // data today + to capture the actual ad_group IDs that have spend.
    // This is diagnostic only — the rows still go through the filtered
    // path. Helps determine if our hot-set IDs match Google's reality.
    if (rows.length === 0) {
      const broadQuery = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros, segments.date FROM ad_group WHERE segments.date BETWEEN '${yesterdayInTz}' AND '${todayInTz}' AND metrics.cost_micros > 0 LIMIT 20`;
      const broadRows = await customer.searchStream({ query: broadQuery });
      console.log(`[gh-diag] BROAD store=${storeId} rows_with_cost=${broadRows.length} actual_ids=${broadRows.slice(0, 10).map(r => {
        const c = (r as { campaign?: Record<string, unknown> }).campaign ?? {};
        const g = (r as { adGroup?: Record<string, unknown> }).adGroup ?? {};
        return `c=${c.id}/ag=${g.id}/cost=${((r as { metrics?: Record<string, unknown> }).metrics ?? {}).costMicros}`;
      }).join(' | ').slice(0, 600)}`);
    }
    for (const r of rows) {
      adsets.push(toAdsetRow(storeId, r));
    }
  }

  const ads: AdDailyRow[] = [];
  if (input.hotAdIds.length > 0) {
    const ids = input.hotAdIds.map(id => `'${id}'`).join(',');
    const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date FROM ad_group_ad WHERE ad_group_ad.ad.id IN (${ids}) AND segments.date BETWEEN '${yesterdayInTz}' AND '${todayInTz}'`;
    const rows = await customer.searchStream({ query });
    console.log(`[gh-diag] ad_query store=${storeId} tz=${accountTz} ids=${input.hotAdIds.length} rows=${rows.length}`);
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
