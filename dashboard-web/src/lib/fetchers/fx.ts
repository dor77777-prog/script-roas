// dashboard-web/src/lib/fetchers/fx.ts
//
// Phase 05.6-06 — TS port of FX.gs (Frankfurter currency conversion).
// 2026-07-16 — provider CHAIN (fx_rate_failure alert #55, seen 230×).
//
// Why a chain and not just Frankfurter (the original design):
//   - Frankfurter is free/keyless/ECB-backed, but its origin has a recurring
//     nightly outage window (~03:00 UTC ≈ 06:00 Asia/Jerusalem) where
//     Cloudflare returns 522. The */10 crons collided with it EVERY DAY:
//     230 recorded failures / 55 operator alerts between 2026-06-04 and
//     2026-07-16, each pausing CAD conversion for that run (P1-11 contract).
//   - Fallback: fawazahmed0/exchange-api ("currency-api") — also free and
//     keyless, ~200 currencies, daily snapshots addressable by date, served
//     from TWO independent infrastructures (jsDelivr CDN + Cloudflare Pages).
//     Rates agree with Frankfurter to ~0.1% (checked 2026-07-15: ILS→CAD
//     0.46903 vs 0.46855).
//   - Order: Frankfurter first (primary source of record, keeps historical
//     continuity), then currency-api via jsDelivr, then the pages.dev mirror.
//     getFxRate throws ONLY when all three fail, so the fx_rate_failure
//     alert now means "the whole chain is down", not "Frankfurter blinked".
//
// Why we drop the Apps Script CacheService wrapper:
//   - Neither provider has a quota or per-key throttle.
//   - Caching is premature optimization for our load profile
//     (~3 stores × 1 conversion/day × backfill bursts); the CAD adapters
//     additionally memoize one rate per (currency, day) per run.
//
// Why we do NOT validate body.date === dateStr (RESEARCH §Pitfall 13):
//   - Frankfurter auto-shifts weekend/holiday requests to the previous
//     business day's published rate. The TS port matches by reading
//     body.rates[to] directly, ignoring body.date. The currency-api fallback
//     publishes daily snapshots (weekends included), so dated lookups hit
//     directly; a not-yet-published RECENT date (Asia/Jerusalem runs ahead
//     of the UTC publish cycle) is clamped to `latest`, mirroring
//     Frankfurter's unpublished-date behavior.
//
// Callers (after plans 03/05/07 land):
//   - shopify.ts (CAD/USD conversion of order line items)
//   - meta.ts (ILS → CAD for Meta spend, the load-bearing case)
//   - manualOverrides.ts (currency normalization of operator-entered rows)

/** Per-attempt fetch timeout. Frankfurter normally answers in <500ms; a
 *  Cloudflare 522 takes 15-30s to materialize, which would eat the cron step
 *  budget × 3 providers. Cut each attempt short and move down the chain. */
const FX_FETCH_TIMEOUT_MS = 8_000;

/** A dated currency-api file that 404s is only clamped to `latest` when the
 *  requested date is within this window of now (BOTH sides — past AND
 *  future) — "today" before the daily snapshot lands. 404s outside the
 *  window (old backfill dates, typo'd future years) must fail loudly
 *  instead of silently taking the CURRENT rate. */
const CLAMP_TO_LATEST_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Cap each provider's error contribution so the aggregate message survives
 *  the WhatsApp alert's 500-char param limit (Cloudflare 522 bodies are
 *  full HTML pages). */
const MAX_PROVIDER_ERROR_LEN = 140;

function trimBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_PROVIDER_ERROR_LEN);
}

function errMsg(e: unknown): string {
  return trimBody(e instanceof Error ? e.message : String(e));
}

function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
}

async function fetchFrankfurter(from: string, to: string, dateStr: string): Promise<number> {
  const url = `https://api.frankfurter.dev/v1/${dateStr}?base=${from}&symbols=${to}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`status ${res.status}: ${trimBody(await res.text())}`);
  }
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[to];
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`no usable ${from}->${to} rate in response`);
  }
  return rate;
}

/** The two currency-api hosts serve the SAME daily dataset from independent
 *  infrastructures. `dateOrLatest` is 'YYYY-MM-DD' or 'latest'. */
const CURRENCY_API_HOSTS: ReadonlyArray<{
  name: string;
  url: (dateOrLatest: string, baseLower: string) => string;
}> = [
  {
    name: 'currency-api(jsdelivr)',
    url: (d, base) =>
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/${base}.json`,
  },
  {
    name: 'currency-api(pages)',
    url: (d, base) => `https://${d}.currency-api.pages.dev/v1/currencies/${base}.json`,
  },
];

function isRecentDate(dateStr: string): boolean {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  // Math.abs — a one-sided check would let a FAR-future dateStr (negative
  // diff) clamp to `latest` and silently return today's rate for a bogus
  // date; the legitimate case is only "today"/"tomorrow" in Asia/Jerusalem
  // running ~1 day ahead of the UTC publish cycle.
  return Math.abs(Date.now() - t) <= CLAMP_TO_LATEST_WINDOW_MS;
}

async function fetchCurrencyApi(
  host: (typeof CURRENCY_API_HOSTS)[number],
  from: string,
  to: string,
  dateStr: string,
): Promise<number> {
  const baseLower = from.toLowerCase();
  let res = await fetchWithTimeout(host.url(dateStr, baseLower));
  if (res.status === 404 && isRecentDate(dateStr)) {
    // Date not yet published (Asia/Jerusalem "today" runs ahead of the UTC
    // publish cycle) — clamp to the latest available snapshot.
    res = await fetchWithTimeout(host.url('latest', baseLower));
  }
  if (!res.ok) {
    throw new Error(`status ${res.status}: ${trimBody(await res.text())}`);
  }
  const data = (await res.json()) as Record<string, Record<string, number> | string>;
  const table = data[baseLower];
  const rate = typeof table === 'object' && table !== null ? table[to.toLowerCase()] : undefined;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`no usable ${from}->${to} rate in response`);
  }
  return rate;
}

/**
 * Fetches the historical FX rate for `from → to` on `dateStr`, walking the
 * provider chain (Frankfurter → currency-api jsDelivr → currency-api pages)
 * until one answers.
 *
 * @param from - ISO 4217 source currency (e.g., 'ILS')
 * @param to - ISO 4217 target currency (e.g., 'CAD')
 * @param dateStr - YYYY-MM-DD lookup date; Frankfurter shifts weekends/holidays
 *                  to the prior business day automatically, and the fallback
 *                  clamps a not-yet-published recent date to `latest`.
 * @returns The numeric conversion rate (1 unit of `from` = N units of `to`).
 *          Returns 1 immediately when `from === to` without an HTTP call.
 * @throws Error only when ALL providers fail. Message keeps the historic
 *         `FX fetch failed (FROM->TO on DATE)` prefix (the fx_rate_failure
 *         alert + operator console rely on it) followed by one
 *         `provider: reason` entry per failed attempt.
 */
export async function getFxRate(
  from: string,
  to: string,
  dateStr: string,
): Promise<number> {
  if (from === to) return 1;

  const failures: string[] = [];

  try {
    return await fetchFrankfurter(from, to, dateStr);
  } catch (e) {
    failures.push(`frankfurter: ${errMsg(e)}`);
  }

  for (const host of CURRENCY_API_HOSTS) {
    try {
      return await fetchCurrencyApi(host, from, to, dateStr);
    } catch (e) {
      failures.push(`${host.name}: ${errMsg(e)}`);
    }
  }

  throw new Error(
    `FX fetch failed (${from}->${to} on ${dateStr}): ${failures.join('; ')}`,
  );
}
