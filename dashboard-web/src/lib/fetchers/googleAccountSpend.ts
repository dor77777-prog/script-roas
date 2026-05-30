/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level Google Ads spend
 * fetcher. One GAQL query returns per-day cost_micros + impressions for
 * a date range. Used by googleWorker's hot_metrics branch.
 *
 * Google Ads account for uzoshop is CAD-native (per project memory
 * ad-account-currencies). cost_micros / 1_000_000 = CAD spend. The
 * currency field is surfaced regardless so the caller's cadConvert
 * helper can pass through (CAD) or convert (if the account currency
 * ever changes).
 */

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

type Input = {
  customer: Customer;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max. */
  dates: string[];
};

export type GoogleAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

export async function fetchGoogleAccountSpendForDates(
  input: Input,
): Promise<GoogleAccountSpendRow[]> {
  const { customer, dates } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const query = `
    SELECT customer.currency_code, metrics.cost_micros, metrics.impressions, segments.date
      FROM customer
     WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;
  const rows = await customer.searchStream({ query });
  return rows.map((r) => {
    // CRIT-C (Phase C precedent): Google's JSON response uses camelCase
    // keys even though GAQL uses snake_case. customer.currencyCode
    // (NOT currency_code), metrics.costMicros. segments.date stays as
    // segments.date (not transformed).
    const cust = (r as { customer?: Record<string, unknown> }).customer ?? {};
    const metrics = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
    const segments = (r as { segments?: Record<string, unknown> }).segments ?? {};
    const costMicros = parseInt(String(metrics.costMicros ?? '0'), 10) || 0;
    const impressions = parseInt(String(metrics.impressions ?? '0'), 10) || 0;
    const currency = String(cust.currencyCode ?? 'CAD');
    return {
      date: String(segments.date ?? ''),
      spend: costMicros / 1_000_000,
      currency,
      impressions,
    };
  });
}
