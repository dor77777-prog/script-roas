// dashboard-web/src/lib/fetchers/fx.ts
//
// Phase 05.6-06 — TS port of FX.gs (Frankfurter currency conversion).
//
// Why Frankfurter (RESEARCH §Don't Hand-Roll):
//   - Free, no API key, no rate limits.
//   - ECB-backed daily rates published Mon–Fri at ~16:00 CET.
//   - The Apps Script source FX.gs already uses Frankfurter (the dashboard
//     never used Open Exchange Rates despite older CONTEXT.md prose calling
//     it out — see FX.gs:14 `https://api.frankfurter.dev/v1/...`).
//
// Why we drop the Apps Script CacheService wrapper:
//   - Frankfurter has no quota or per-key throttle (frankfurter.dev/).
//   - Caching is premature optimization for our load profile
//     (~3 stores × 1 conversion/day × backfill bursts).
//   - Inngest steps already deduplicate same-tick re-runs via the
//     step-level idempotency key.
//
// Why we do NOT validate body.date === dateStr (RESEARCH §Pitfall 13):
//   - Frankfurter auto-shifts weekend/holiday requests to the previous
//     business day's published rate. A Saturday lookup for 2026-05-23
//     returns the Friday 2026-05-22 rate; body.date will read '2026-05-22'.
//   - The Apps Script source accepts this implicitly (FX.gs docstring:
//     "אם נשאל על תאריך סוף שבוע/חג, ה-API מחזיר אוטומטית את שער יום
//     העסקים הקודם"). The TS port matches by reading body.rates[to]
//     directly, ignoring body.date.
//
// Callers (after plans 03/05/07 land):
//   - shopify.ts (CAD/USD conversion of order line items)
//   - meta.ts (ILS → CAD for Meta spend, the load-bearing case)
//   - manualOverrides.ts (currency normalization of operator-entered rows)

/**
 * Fetches the historical FX rate for `from → to` on `dateStr`.
 *
 * @param from - ISO 4217 source currency (e.g., 'ILS')
 * @param to - ISO 4217 target currency (e.g., 'CAD')
 * @param dateStr - YYYY-MM-DD lookup date; Frankfurter shifts weekends/holidays
 *                  to the prior business day automatically.
 * @returns The numeric conversion rate (1 unit of `from` = N units of `to`).
 *          Returns 1 immediately when `from === to` without an HTTP call.
 * @throws Error with from/to/dateStr/status when the response is non-OK.
 * @throws Error with from/to/dateStr when `rates[to]` is missing/non-finite.
 */
export async function getFxRate(
  from: string,
  to: string,
  dateStr: string,
): Promise<number> {
  if (from === to) return 1;

  const url = `https://api.frankfurter.dev/v1/${dateStr}?base=${from}&symbols=${to}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `FX fetch failed (${from}->${to} on ${dateStr}, status ${res.status}): ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    rates?: Record<string, number>;
    date?: string;
  };
  const rate = data.rates?.[to];

  if (!rate || !Number.isFinite(rate)) {
    throw new Error(`No FX rate ${from}->${to} for ${dateStr}`);
  }

  return rate;
}
