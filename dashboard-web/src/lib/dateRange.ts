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

  if (!from && !to) return defaultRange();

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
 * Returns the default last-90-days range, anchored on "today" in UTC
 * so server and client agree on the boundary (no timezone surprises).
 */
export function defaultRange(): DateRange {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - DEFAULT_RANGE_DAYS * 86400 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
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

/** Helper for lib-side filtering. Returns true if `date` ∈ [from, to]. */
export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
