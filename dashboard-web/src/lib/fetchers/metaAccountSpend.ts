/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level spend fetcher.
 *
 * Returns one row per date in `dates[]` from a single Meta Graph API
 * call using `time_range={since:min,until:max}` + `time_increment=1`
 * (one row per day in the window). Used by metaWorker's hot_metrics
 * branch to populate data_daily.fb_spend_cad / fb_impressions for
 * [today, yesterday, day-before] without 3 separate calls.
 *
 * Meta ad accounts are ILS-billed (per project memory
 * ad-account-currencies). The caller's cadConvert helper handles the
 * ILS → CAD conversion at write time.
 *
 * Decoupled from store/credentials: takes adAccountId + accessToken
 * directly so the worker's existing credential resolver handles the
 * lookup. This mirrors fetchMetaStatusForStore.
 */

import { META_API_VERSION } from '@/lib/fetchers/meta';

type Input = {
  adAccountId: string;
  accessToken: string;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max for the range. */
  dates: string[];
  /** Injected for tests. Defaults to global fetch. */
  fetcher?: typeof fetch;
};

export type MetaAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

type MetaInsightsRow = {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  account_currency?: string;
};

export async function fetchMetaAccountSpendForDates(
  input: Input,
): Promise<MetaAccountSpendRow[]> {
  const { adAccountId, accessToken, dates, fetcher = fetch } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const since = sorted[0];
  const until = sorted[sorted.length - 1];
  const timeRange = JSON.stringify({ since, until });
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?fields=${encodeURIComponent('spend,impressions,account_currency')}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&time_increment=1` +
    `&level=account` +
    `&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetcher(url, {});
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Meta account spend bulk-fetch failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as { data?: MetaInsightsRow[] };
  return (body.data ?? []).map((row) => ({
    date: row.date_start ?? '',
    spend: parseFloat(row.spend ?? '0') || 0,
    currency: row.account_currency ?? 'ILS',
    impressions: parseInt(row.impressions ?? '0', 10) || 0,
  }));
}
