/**
 * classify-v2 T4 — re-runnable operator attribution diagnostic.
 *
 * GET /api/operator/attribution-diag?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Reproduces, LIVE and on demand, the ad-hoc source-distribution analysis the
 * operator wants to keep re-running over time to see whether the classifier
 * (classify-v2) has more to expand. It aggregates four things SERVER-SIDE:
 *
 *   1. Orders source distribution — count + pct per `orders_attribution.source`.
 *   2. ATC source distribution    — count + pct per `store_events.source`
 *                                   (type = 'add_to_cart').
 *   3. Murky-bucket breakdowns (where the expansion opportunities hide):
 *        • other-paid     → top "utm_source | utm_medium" combos (the
 *                           unrecognised paid sources — partners / influencers).
 *        • other-referral → top referrer DOMAINS (host only, no path/query).
 *        • direct         → first_touch_source breakdown (how many carry a
 *                           first-touch signal vs none).
 *   4. First-touch coverage — % of orders (and ATC) carrying a
 *      first_touch_source. This is the metric that justifies the beacon work.
 *
 * Aggregation strategy: JS over the fetched range. Order volume is modest
 * (~1-2k/month) so a paginated range read + an in-memory group-by is cheaper to
 * maintain than a bespoke RPC, and only the *aggregates* (never raw rows) leave
 * the server. We select ONLY the marketing columns we need — never order ids,
 * customer ids, or the raw event blob — so the response carries NO PII/secrets.
 * utm_source / utm_medium / referrer domains are marketing labels (safe), and we
 * cap every emitted string length so a malicious label cannot bloat the payload.
 *
 * Operator-gated: lives under /api/operator/* so the middleware enforces the
 * operator secret. Soft-fails to a typed empty body (HTTP 200) on any query
 * error, matching the other operator panels.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface SourceCount {
  /** Raw classifier `source` value ('' = unknown/missing bucket). */
  source: string;
  count: number;
  /** Percentage of the table total (0-100). */
  pct: number;
}

export interface KeyCount {
  /** "utm_source | utm_medium" combo. */
  key: string;
  count: number;
}

export interface DomainCount {
  /** Referrer host only (no path/query/scheme). */
  domain: string;
  count: number;
}

export interface FirstTouchCount {
  /** first_touch_source value, or '(ללא)' for the no-signal bucket. */
  firstTouch: string;
  count: number;
}

export interface Coverage {
  withFt: number;
  total: number;
  /** withFt / total × 100 (0 when total === 0; never NaN). */
  pct: number;
}

export interface AttributionDiagResponse {
  range: { from: string; to: string };
  orders: { total: number; bySource: SourceCount[] };
  atc: { total: number; bySource: SourceCount[] };
  buckets: {
    otherPaid: KeyCount[];
    otherReferral: DomainCount[];
    directFirstTouch: FirstTouchCount[];
  };
  firstTouchCoverage: { orders: Coverage; atc: Coverage };
  /** Present only on the degraded-error path; UI renders an inline notice. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;
const PAGE_SIZE = 1000; // PostgREST default cap; we paginate above it.
const MAX_PAGES = 50; // hard ceiling (50k rows) so a pathological table can't loop forever.
const TOP_N = 25; // cap each murky-bucket list.
const MAX_LABEL_LEN = 200; // cap emitted strings (utm combos, domains, ft labels).
const NO_FT_LABEL = '(ללא)';
const IL_OFFSET = '+03:00'; // store_events.received_at window anchored to IL time.
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDaysBefore(dateIso: string, nDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - nDays);
  return d.toISOString().slice(0, 10);
}

/** Trim + cap a label so the payload can't be bloated by a hostile value. */
function clampLabel(v: unknown): string {
  const s = String(v ?? '').trim();
  return s.length > MAX_LABEL_LEN ? s.slice(0, MAX_LABEL_LEN) : s;
}

/** Referrer → bare host (no scheme/path/query). Falls back to a capped raw
 *  token when the value isn't a parseable URL. Empty → ''. */
function referrerDomain(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const host = new URL(s).hostname;
    if (host) return clampLabel(host);
  } catch {
    // Not a full URL — strip an explicit scheme then take the first path
    // segment as a best-effort host.
    const noScheme = s.replace(/^[a-z]+:\/\//i, '');
    const host = noScheme.split(/[/?#]/)[0];
    if (host) return clampLabel(host);
  }
  return clampLabel(s);
}

/** Map a Map<string,count> → sorted [{key,count}] DESC, capped at TOP_N. */
function topEntries(m: Map<string, number>): { key: string; count: number }[] {
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP_N);
}

/** Distribution helper — Map<source,count> → SourceCount[] sorted DESC w/ pct. */
function toDistribution(m: Map<string, number>, total: number): SourceCount[] {
  return Array.from(m.entries())
    .map(([source, count]) => ({
      source,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}

type OrderRow = {
  source?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  referrer?: unknown;
  first_touch_source?: unknown;
};
type EventRow = { source?: unknown; first_touch_source?: unknown };

/** Terminal PostgREST result shape after `.range()`. */
type RangeResult = { data: unknown; error: { message: string } | null };

/** A query builder exposing `.range()` returning a thenable result. The
 *  PostgREST builder is itself a PromiseLike of this shape, so we type it
 *  structurally rather than importing the heavy supabase-js generics. */
interface RangeableBuilder {
  range: (lo: number, hi: number) => PromiseLike<RangeResult>;
}

/** Generic paginated range read on the admin client. The `build` callback
 *  receives a fresh query builder and applies the table-specific filters; we
 *  only add `.range()`. Stops when a page is short or empty. */
async function fetchAllRows<T>(build: () => RangeableBuilder): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const lo = page * PAGE_SIZE;
    const hi = lo + PAGE_SIZE - 1;
    const { data, error } = await build().range(lo, hi);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function emptyBody(range: { from: string; to: string }, error?: string): AttributionDiagResponse {
  return {
    range,
    orders: { total: 0, bySource: [] },
    atc: { total: 0, bySource: [] },
    buckets: { otherPaid: [], otherReferral: [], directFirstTouch: [] },
    firstTouchCoverage: {
      orders: { withFt: 0, total: 0, pct: 0 },
      atc: { withFt: 0, total: 0, pct: 0 },
    },
    ...(error ? { error } : {}),
  };
}

export async function GET(req: Request): Promise<NextResponse<AttributionDiagResponse>> {
  const params = new URL(req.url).searchParams;
  const today = getTodayInIsraelTz();
  const toParam = params.get('to');
  const fromParam = params.get('from');
  const to = toParam && ISO_DATE_RX.test(toParam) ? toParam : today;
  const from =
    fromParam && ISO_DATE_RX.test(fromParam)
      ? fromParam
      : isoDaysBefore(to, DEFAULT_WINDOW_DAYS);
  const range = { from, to };

  try {
    const sb = getSupabaseAdmin();

    // ── Orders — marketing columns only, never order/customer ids or raw. ──
    const orderRows = await fetchAllRows<OrderRow>(() =>
      sb
        .from('orders_attribution')
        .select('source, utm_source, utm_medium, referrer, first_touch_source')
        .gte('date', from)
        .lte('date', to),
    );

    // ── ATC — store_events of type add_to_cart, IL-anchored received_at. ───
    const fromTs = `${from}T00:00:00.000${IL_OFFSET}`;
    const toTs = `${to}T23:59:59.999${IL_OFFSET}`;
    const eventRows = await fetchAllRows<EventRow>(() =>
      sb
        .from('store_events')
        // raw->>first_touch_source aliased so we read the single JSON path WITHOUT
        // shipping the whole `raw` blob (no PII).
        .select('source, first_touch_source:raw->>first_touch_source')
        .eq('type', 'add_to_cart')
        .gte('received_at', fromTs)
        .lte('received_at', toTs),
    );

    // ── Aggregate orders ─────────────────────────────────────────────────
    const orderDist = new Map<string, number>();
    const otherPaid = new Map<string, number>();
    const otherReferral = new Map<string, number>();
    const directFt = new Map<string, number>();
    let orderFt = 0;

    for (const r of orderRows) {
      const source = String(r.source ?? '').trim();
      bump(orderDist, source);

      const ft = String(r.first_touch_source ?? '').trim();
      if (ft) orderFt++;

      if (source === 'other-paid') {
        const us = clampLabel(r.utm_source) || '(ריק)';
        const um = clampLabel(r.utm_medium) || '(ריק)';
        bump(otherPaid, clampLabel(`${us} | ${um}`));
      } else if (source === 'other-referral') {
        const dom = referrerDomain(r.referrer) || '(ריק)';
        bump(otherReferral, dom);
      } else if (source === 'direct') {
        bump(directFt, ft || NO_FT_LABEL);
      }
    }

    // ── Aggregate ATC ────────────────────────────────────────────────────
    const atcDist = new Map<string, number>();
    let atcFt = 0;
    for (const r of eventRows) {
      const source = String(r.source ?? '').trim();
      bump(atcDist, source);
      if (String(r.first_touch_source ?? '').trim()) atcFt++;
    }

    const orderTotal = orderRows.length;
    const atcTotal = eventRows.length;

    const body: AttributionDiagResponse = {
      range,
      orders: { total: orderTotal, bySource: toDistribution(orderDist, orderTotal) },
      atc: { total: atcTotal, bySource: toDistribution(atcDist, atcTotal) },
      buckets: {
        otherPaid: topEntries(otherPaid),
        otherReferral: topEntries(otherReferral).map((e) => ({ domain: e.key, count: e.count })),
        directFirstTouch: topEntries(directFt).map((e) => ({ firstTouch: e.key, count: e.count })),
      },
      firstTouchCoverage: {
        orders: {
          withFt: orderFt,
          total: orderTotal,
          pct: orderTotal > 0 ? (orderFt / orderTotal) * 100 : 0,
        },
        atc: {
          withFt: atcFt,
          total: atcTotal,
          pct: atcTotal > 0 ? (atcFt / atcTotal) * 100 : 0,
        },
      },
    };

    return NextResponse.json<AttributionDiagResponse>(body, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    captureRouteError('/api/operator/attribution-diag', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/attribution-diag GET threw:', rawMessage);
    return NextResponse.json<AttributionDiagResponse>(
      emptyBody(range, userFacingError(rawMessage)),
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
