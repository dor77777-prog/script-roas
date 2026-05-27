/**
 * Shared date-range parsing for paginated API routes (Phase 5).
 *
 * All four telemetry routes (/api/data, /api/campaigns, /api/products,
 * /api/orders-attribution) accept ?from=YYYY-MM-DD&to=YYYY-MM-DD. When
 * absent, we default to the LAST 90 DAYS (DEFAULT_RANGE_DAYS) — covers
 * the 95% case where the dashboard renders its default range without
 * forcing the full multi-year history through the payload.
 *
 * Server-side filtering is performed in-memory by each lib's `fetch*`
 * function. We do NOT attempt to push the range filter down to a
 * Sheets API range-read because the underlying tabs are NOT strictly
 * sorted by date (idempotent writes leave rows in arbitrary positions).
 * The benefit of pagination is still realized at the HTTP layer —
 * the server pays the Sheets read once and returns only the slice the
 * client asked for.
 */
export type DateRange = { from: string; to: string };

export const DEFAULT_RANGE_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-trip date check. The ISO_DATE regex above only validates SHAPE
 * (four-digit year, two-digit month, two-digit day separated by dashes)
 * — strings like "2026-99-99", "2026-02-30", or "9999-13-31" pass the
 * regex but are NOT real dates. Without this check, a malformed query
 * combined with the lexicographic comparator in isInRange could let
 * every row through (e.g. from="0001-01-01"&to="9999-12-31"), which
 * with archive-fallback at sheets.ts:127 could trigger a 100k-row
 * archive read. WR-01.
 */
function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

/**
 * Parses ?from=&to= out of a Next.js Request URL. Validation:
 *   - Both keys absent  → returns the default last-90-days range
 *   - Exactly one key absent  → 400-able error (caller throws)
 *   - Either key malformed (not YYYY-MM-DD) → 400-able error
 *   - Either key NOT a real calendar date (e.g. 2026-02-30) → 400-able error
 *   - from > to → 400-able error
 */
export function parseRangeParams(searchParams: URLSearchParams): DateRange {
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  // P1-2 (data-consistency audit 2026-05-27): treat "both absent" as an
  // error instead of silently returning the 90-day default. A caller with
  // a misnamed param (e.g. ?range.from= instead of ?from=) would have
  // previously received HTTP 200 with the wrong window — indistinguishable
  // from a correct response. Fail loud so callers know the request is wrong.
  //
  // SPA safety: buildDateRangeKey always emits both params (or returns null
  // so SWR doesn't fire at all). TodayLive always constructs ?from=…&to=…
  // explicitly. No legitimate caller intentionally omits both params.
  if (!from && !to) {
    throw new RangeParamError('Both ?from and ?to are required.');
  }

  if (!from || !to) {
    throw new RangeParamError('Both ?from and ?to are required when either is provided.');
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new RangeParamError('from/to must be in YYYY-MM-DD format.');
  }
  if (!isRealDate(from) || !isRealDate(to)) {
    throw new RangeParamError('from/to must be a real calendar date (YYYY-MM-DD).');
  }
  if (from > to) {
    throw new RangeParamError('Invalid range: from must be <= to.');
  }
  return { from, to };
}

/**
 * Custom error so route handlers can map to HTTP 400 without catching
 * all errors (which include Sheets API errors that should be 500).
 */
export class RangeParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeParamError';
  }
}

/**
 * Returns the default last-90-days range, anchored on "today" in
 * Asia/Jerusalem (the spreadsheet's TZ — see TZ constant in Config.gs).
 *
 * Previously anchored on UTC midnight. At 02:00 IL on a day boundary
 * (UTC = previous-day 23:00), to=toISOString().slice(0,10) returned
 * yesterday-UTC = day-before-yesterday-IL, so the default 90-day window
 * excluded today entirely until UTC ticked over (WR-09). Tying both
 * boundaries to Asia/Jerusalem matches the user's mental model of
 * "today" and the spreadsheet's row stamps.
 */
export function defaultRange(): DateRange {
  // 'en-CA' formats as YYYY-MM-DD which is exactly what the spreadsheet
  // and isInRange() expect — no string surgery needed.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const to = fmt.format(new Date());
  // Anchor `from` arithmetic in UTC milliseconds based on the IL "today"
  // string. Constructing a Date at "${to}T00:00:00Z" gives a stable
  // epoch ms that ignores the runtime's local TZ; subtracting
  // DEFAULT_RANGE_DAYS * 86400 * 1000 and re-formatting via the same IL
  // formatter avoids DST edge-cases (Israel observes IDT/IST; subtracting
  // 24h ms across a DST shift would otherwise return the same day twice
  // or skip one).
  const toEpochMs = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  const fromEpochMs = toEpochMs - DEFAULT_RANGE_DAYS * 86400 * 1000;
  const from = fmt.format(new Date(fromEpochMs));
  return { from, to };
}

/**
 * Builds the SWR cache key for a paginated route. SWR keys are strings,
 * so changing `range` (e.g., user picks a wider range in Filters) yields
 * a NEW key → SWR fires a fresh fetch (no stale-cache shadow).
 *
 * Used by Dashboard.tsx, CampaignsTable.tsx, CampaignDrawer.tsx,
 * ProductsTable.tsx. The shape must match how the route parses params.
 */
export function buildDateRangeKey(basePath: string, range: DateRange | null | undefined): string | null {
  if (!range || !range.from || !range.to) return null;
  return `${basePath}?from=${range.from}&to=${range.to}`;
}

/**
 * Strict UTC-anchored date parser. Returns 'YYYY-MM-DD' or null.
 * Handles: numeric Apps Script serial dates, ISO 8601 strings, 'YYYY-MM-DD',
 * and 'DD/MM/YYYY' legacy strings. Anything else returns null and warns.
 *
 * FIX-20 (5.2.2.1): centralized to eliminate local-TZ `new Date(string)`
 * fallbacks in campaigns.ts / ads.ts / ordersAttribution.ts.
 */
export function parseDate(s: string | number | null | undefined): string | null {
  if (s == null) return null;
  if (typeof s === 'number' && Number.isFinite(s)) {
    const d = new Date(Math.round((s - 25569) * 86400 * 1000));
    if (Number.isNaN(d.getTime())) {
      console.warn(`parseDate: NaN from numeric ${s}`);
      return null;
    }
    return d.toISOString().slice(0, 10);
  }

  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) {
      console.warn(`parseDate: NaN from ISO ${str}`);
      return null;
    }
    return d.toISOString().slice(0, 10);
  }
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const candidate = `${yyyy}-${mm}-${dd}`;
    // WR-04 (5.2.2.1): validate that the day/month numbers form a real
    // calendar date. The previous code just reformatted the string
    // ("31/02/2026" -> "2026-02-31") without checking that the month
    // has 31 days. Downstream lexicographic comparisons accept it and
    // the row gets included with a fake date. Round-trip via Date and
    // compare the ISO slice to the candidate — mismatch means the JS
    // Date constructor rolled the day over (e.g., Feb 31 -> Mar 03)
    // and the original input was not a real date. parseRangeParams
    // already validates query params via isRealDate; this aligns the
    // legacy DMY fallback to the same gate.
    const d = new Date(`${candidate}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== candidate) {
      console.warn(`parseDate: invalid DD/MM/YYYY "${str}"`);
      return null;
    }
    return candidate;
  }

  console.warn(`parseDate: unrecognized format "${str}"`);
  return null;
}

/** Enumerates every YYYY-MM-DD date in the inclusive [from, to] range. */
export function enumerateDateRange(from: string, to: string): string[] {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return [];
  const dates: string[] = [];
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** Helper for lib-side filtering. Returns true if `date` ∈ [from, to]. */
export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/**
 * Returns the previous-period DateRange of equal length immediately preceding
 * `range`. Validates inputs via regex; returns the input range as a no-op
 * fallback if malformed.
 *
 * FIX-23 (5.2.2.1): centralized to avoid duplicated UTC math and
 * NaN-throwing edges in component code.
 */
export function getPreviousPeriod(range: DateRange): DateRange {
  if (!ISO_DATE.test(range.from) || !ISO_DATE.test(range.to)) {
    console.warn('getPreviousPeriod: malformed range, returning as-is', range);
    return range;
  }
  // WR-05 (5.2.2.1): also guard against inverted ranges. If a caller passes
  // { from: '2026-05-31', to: '2026-05-01' } (corrupted localStorage,
  // future caller that doesn't enforce ordering, etc.), `lengthMs` is
  // negative and `prevFromMs = prevToMs - lengthMs = prevToMs + |lengthMs|`
  // — the returned prev range satisfies `prevFromMs > prevToMs`, an
  // inverted output. Downstream `r.date >= prev.from && r.date <= prev.to`
  // becomes impossible and silently returns empty.
  // CampaignsTable enforces ordering on its date inputs (swap on blur),
  // so today's call sites are safe, but the helper's contract is
  // independent — fail loudly here.
  if (range.from > range.to) {
    console.warn('getPreviousPeriod: from > to, returning as-is', range);
    return range;
  }
  const fromMs = Date.UTC(
    Number(range.from.slice(0, 4)),
    Number(range.from.slice(5, 7)) - 1,
    Number(range.from.slice(8, 10)),
  );
  const toMs = Date.UTC(
    Number(range.to.slice(0, 4)),
    Number(range.to.slice(5, 7)) - 1,
    Number(range.to.slice(8, 10)),
  );
  const lengthMs = toMs - fromMs;
  const prevToMs = fromMs - 86400_000;
  const prevFromMs = prevToMs - lengthMs;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: toIso(prevFromMs), to: toIso(prevToMs) };
}
