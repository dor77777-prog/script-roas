/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level TikTok spend
 * fetcher. One TikTok report API call returns per-day spend +
 * impressions for the advertiser. Used by tiktokWorker's hot_metrics
 * branch.
 *
 * data_level=AUCTION_ADVERTISER + dimensions=["stat_time_day"]
 * produces one row per day. start_date / end_date are an inclusive
 * range. TikTok ad accounts are USD-billed (per project memory
 * ad-account-currencies); accountCurrency is passed in by the worker
 * because the report endpoint doesn't surface it. The caller's
 * cadConvert helper handles USD → CAD.
 *
 * TikTok envelope: every response has {code, message, data}. code !== 0
 * is an error; throw with both code + message for operator debuggability.
 */

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

type Input = {
  advertiserId: string;
  accessToken: string;
  accountCurrency: string;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max. */
  dates: string[];
  /** Injected for tests. Defaults to global fetch. */
  fetcher?: typeof fetch;
};

export type TikTokAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

type TikTokReportRow = {
  dimensions?: { stat_time_day?: string };
  metrics?: { spend?: string | number; impressions?: string | number };
};

export async function fetchTikTokAccountSpendForDates(
  input: Input,
): Promise<TikTokAccountSpendRow[]> {
  const { advertiserId, accessToken, accountCurrency, dates, fetcher = fetch } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];
  const dimensions = encodeURIComponent(JSON.stringify(['stat_time_day']));
  const metrics = encodeURIComponent(JSON.stringify(['spend', 'impressions']));
  const url =
    `${TT_BASE}/report/integrated/get/` +
    `?advertiser_id=${advertiserId}` +
    `&report_type=BASIC` +
    `&data_level=AUCTION_ADVERTISER` +
    `&dimensions=${dimensions}` +
    `&metrics=${metrics}` +
    `&start_date=${startDate}` +
    `&end_date=${endDate}` +
    `&page=1` +
    `&page_size=1000`;
  const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `TikTok account spend bulk-fetch HTTP ${res.status}: ${body.slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { list?: TikTokReportRow[] };
  };
  if (body.code !== 0) {
    throw new Error(
      `TikTok account spend bulk-fetch failed: code=${body.code} ${body.message ?? ''}`,
    );
  }
  const list = body.data?.list ?? [];
  return list.map((r) => ({
    date: (r.dimensions?.stat_time_day ?? '').slice(0, 10),
    spend: typeof r.metrics?.spend === 'number'
      ? r.metrics.spend
      : parseFloat(r.metrics?.spend ?? '0') || 0,
    currency: accountCurrency,
    impressions: typeof r.metrics?.impressions === 'number'
      ? r.metrics.impressions
      : parseInt(r.metrics?.impressions ?? '0', 10) || 0,
  }));
}
