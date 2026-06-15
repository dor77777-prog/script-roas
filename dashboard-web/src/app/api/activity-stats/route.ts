/**
 * AS-T1 — GET /api/activity-stats
 *
 * Data endpoint for the "פעילות › סטטיסטיקות והתפלגויות" sub-tab. It aggregates,
 * SERVER-SIDE, the attribution distribution that drives the two donuts + the
 * per-product table in the mockup:
 *
 *   1. paid-vs-organic split of orders (count + revenueCad).
 *   2. EXHAUSTIVE platform/channel buckets (meta/google/tiktok/email/referral/
 *      other-paid/direct) — by orders AND revenueCad; buckets sum to the total.
 *   3. ATC platform distribution from store_events (type = 'add_to_cart').
 *   4. per-product purchases (orders_attribution.line_items, keyed by productId,
 *      titled via products_daily) merged with per-product ATC (store_events).
 *      The ATC↔purchase join prefers the EXACT productId carried in
 *      store_events.raw.product_id (PPJ-T1 beacon, normalized to match
 *      line_items productId), and falls back to normalized-title matching only
 *      for HISTORICAL events that predate the product_id capture — each split by
 *      source bucket, plus conversionPct.
 *   5. first-touch coverage — % of orders carrying a first_touch_source.
 *
 * Auth: a NORMAL dashboard data route (like /api/data). The dashboard-password
 * cookie gate is applied automatically by middleware — this route is NOT in the
 * allowlist and NOT operator-gated.
 *
 * Aggregation strategy: JS over the fetched range (order volume ~1-2k/month) —
 * a paginated range read + an in-memory group-by, identical to the operator
 * attribution-diag sibling. Only AGGREGATES leave the server. We select ONLY the
 * marketing/product columns we need — never order ids, customer ids, or the raw
 * event blob — so the response carries NO PII/secrets. Product ids / titles are
 * safe (catalog labels); every emitted title is length-capped.
 *
 * Soft-fails to a typed empty body (HTTP 200 + `error`) on any query error.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';
import { parseLineItems } from '@/lib/ordersAttribution';
import {
  sourceToBucket,
  sourceIsPaid,
  SOURCE_BUCKETS,
  SOURCE_BUCKET_LABEL,
  type SourceBucket,
} from '@/lib/sourceLabels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response shape (drives the UI)
// ---------------------------------------------------------------------------

export interface BucketCount {
  bucket: SourceBucket;
  label: string;
  orders: number;
  revenueCad: number;
  /** Percentage of orders total (0-100). */
  pct: number;
}

export interface AtcBucketCount {
  bucket: SourceBucket;
  label: string;
  count: number;
  /** Percentage of ATC total (0-100). */
  pct: number;
}

export interface SourceSplit {
  bucket: SourceBucket;
  count: number;
}

export interface PerProduct {
  /** Shopify product id when known (from line_items / products_daily), else null. */
  productId: string | null;
  productTitle: string;
  atcCount: number;
  purchaseCount: number;
  /** purchases / atc × 100 when atc > 0, else null. */
  conversionPct: number | null;
  purchaseBySource: SourceSplit[];
  atcBySource: SourceSplit[];
}

export interface Coverage {
  withFt: number;
  total: number;
  /** withFt / total × 100 (0 when total === 0; never NaN). */
  pct: number;
}

export interface ActivityStatsResponse {
  range: { from: string; to: string };
  orders: {
    total: number;
    paidVsOrganic: {
      paid: { orders: number; revenueCad: number };
      organic: { orders: number; revenueCad: number };
    };
    byPlatform: BucketCount[];
  };
  atc: { total: number; byPlatform: AtcBucketCount[] };
  perProduct: PerProduct[];
  /** Total distinct products in range (perProduct is capped to TOP_PRODUCTS);
   *  lets the UI show "showing 20 of N" instead of implying the list is whole. */
  totalProducts: number;
  firstTouchCoverage: { orders: Coverage };
  /** True when a 50k-row page cap was hit on orders/ATC → totals are INCOMPLETE.
   *  UI must render a "data incomplete" banner (audit 2026-06-15, P0). */
  dataTruncated?: boolean;
  /** Present only on the degraded-error path; UI renders an inline notice. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 30;
const PAGE_SIZE = 1000; // PostgREST default cap; we paginate above it.
const MAX_PAGES = 50; // hard ceiling (50k rows) so a pathological table can't loop forever.
const TOP_PRODUCTS = 20; // cap the per-product table.
const MAX_TITLE_LEN = 200; // cap emitted product titles.
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
function clampTitle(v: unknown): string {
  const s = String(v ?? '').trim();
  return s.length > MAX_TITLE_LEN ? s.slice(0, MAX_TITLE_LEN) : s;
}

/** Normalize a title for matching purchases (titled via catalog) with ATC
 *  (titled via store_events). Case/space-insensitive AND punctuation-insensitive
 *  so trivial drift joins — e.g. "מגנטו-זן" (maqaf) and "מגנטו זן" (space) must
 *  collapse to the SAME key, otherwise a historical title-only ATC splits off
 *  into its own row and the purchase row reads an inflated >100% conversion
 *  (audit 2026-06-15, P1b). Strips combining diacritics + common punctuation
 *  (Hebrew maqaf U+05BE, hyphen/dash, slash, comma, etc.) → space, then collapses. */
function titleKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining diacritics
    .replace(/[־‐-―\-_/.,:;'"`(){}[\]]+/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

type OrderRow = {
  source?: unknown;
  total_cad?: unknown;
  first_touch_source?: unknown;
  line_items?: unknown;
};
type EventRow = { source?: unknown; product_title?: unknown; product_id?: unknown };
type ProductRow = { product_id?: unknown; product_title?: unknown };

/** Terminal PostgREST result shape after `.range()`. */
type RangeResult = { data: unknown; error: { message: string } | null };

/** A query builder exposing `.range()` returning a thenable result — typed
 *  structurally so we don't import the heavy supabase-js generics. */
interface RangeableBuilder {
  range: (lo: number, hi: number) => PromiseLike<RangeResult>;
}

/** Generic paginated range read on the admin client. The `build` callback
 *  applies the table-specific filters; we only add `.range()`. Stops when a
 *  page is short or empty. Returns `truncated: true` when the MAX_PAGES ceiling
 *  is hit with a still-full final page — i.e. there were MORE rows we did NOT
 *  fetch, so every downstream total/pct is silently incomplete. Callers MUST
 *  surface this (audit 2026-06-15, P0). */
async function fetchAllRows<T>(
  build: () => RangeableBuilder,
): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const lo = page * PAGE_SIZE;
    const hi = lo + PAGE_SIZE - 1;
    const { data, error } = await build().range(lo, hi);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return { rows: out, truncated: false };
  }
  // Exhausted MAX_PAGES and every page was full → there is very likely more.
  return { rows: out, truncated: true };
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Empty per-bucket accumulator { meta: 0, google: 0, ... }. */
function zeroBuckets(): Record<SourceBucket, number> {
  const m = {} as Record<SourceBucket, number>;
  for (const b of SOURCE_BUCKETS) m[b] = 0;
  return m;
}

/** Map a per-bucket count Map → SourceSplit[] (only non-zero buckets, DESC). */
function splitOf(m: Record<SourceBucket, number>): SourceSplit[] {
  return SOURCE_BUCKETS.filter((b) => m[b] > 0)
    .map((bucket) => ({ bucket, count: m[bucket] }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function emptyBody(range: { from: string; to: string }, error?: string): ActivityStatsResponse {
  return {
    range,
    orders: {
      total: 0,
      paidVsOrganic: { paid: { orders: 0, revenueCad: 0 }, organic: { orders: 0, revenueCad: 0 } },
      byPlatform: [],
    },
    atc: { total: 0, byPlatform: [] },
    perProduct: [],
    totalProducts: 0,
    firstTouchCoverage: { orders: { withFt: 0, total: 0, pct: 0 } },
    ...(error ? { error } : {}),
  };
}

export async function GET(req: Request): Promise<NextResponse<ActivityStatsResponse>> {
  const params = new URL(req.url).searchParams;
  const today = getTodayInIsraelTz();
  const toParam = params.get('to');
  const fromParam = params.get('from');
  const to = toParam && ISO_DATE_RX.test(toParam) ? toParam : today;
  const from =
    fromParam && ISO_DATE_RX.test(fromParam) ? fromParam : isoDaysBefore(to, DEFAULT_WINDOW_DAYS);
  const range = { from, to };

  // 'All' / empty → no store filter; else filter by store_id.
  const storeParam = params.get('store');
  const storeId = storeParam && storeParam !== 'All' ? storeParam : undefined;

  try {
    const sb = getSupabaseAdmin();

    // ── Orders — marketing/product columns only, never order/customer ids. ──
    const { rows: orderRows, truncated: ordersTruncated } = await fetchAllRows<OrderRow>(() => {
      let q = sb
        .from('orders_attribution')
        .select('source, total_cad, first_touch_source, line_items')
        .gte('date', from)
        .lte('date', to);
      if (storeId) q = q.eq('store_id', storeId);
      return q as unknown as RangeableBuilder;
    });

    // ── ATC — store_events of type add_to_cart, IL-anchored received_at. ───
    const fromTs = `${from}T00:00:00.000${IL_OFFSET}`;
    const toTs = `${to}T23:59:59.999${IL_OFFSET}`;
    const { rows: eventRows, truncated: atcTruncated } = await fetchAllRows<EventRow>(() => {
      let q = sb
        .from('store_events')
        // PPJ-T2: read the beacon-captured numeric productId for an EXACT
        // ATC↔purchase join. Only the `raw->>product_id` JSON path is read —
        // never the raw blob wholesale (PII-free).
        .select('source, product_title, product_id:raw->>product_id')
        .eq('type', 'add_to_cart')
        .gte('received_at', fromTs)
        .lte('received_at', toTs);
      if (storeId) q = q.eq('store_id', storeId);
      return q as unknown as RangeableBuilder;
    });

    // ── Products — productId → title bridge for per-product purchases. The
    //    line_items column carries only the productId (compact {p,u,r}); the
    //    human title lives in products_daily / store_events. ────────────────
    const { rows: productRows } = await fetchAllRows<ProductRow>(() => {
      let q = sb.from('products_daily').select('product_id, product_title').gte('date', from).lte('date', to);
      if (storeId) q = q.eq('store_id', storeId);
      return q as unknown as RangeableBuilder;
    });

    const titleByProductId = new Map<string, string>();
    // Reverse bridge (normalized catalog title → productId): lets a HISTORICAL
    // ATC event that lacks raw.product_id resolve to the same productId a
    // purchase used, so the legacy title fallback still merges into one row.
    const productIdByTitleKey = new Map<string, string>();
    for (const p of productRows) {
      const pid = String(p.product_id ?? '').trim();
      if (!pid) continue;
      const title = clampTitle(p.product_title);
      if (title && !titleByProductId.has(pid)) titleByProductId.set(pid, title);
      if (title) {
        const tk = titleKey(title);
        if (!productIdByTitleKey.has(tk)) productIdByTitleKey.set(tk, pid);
      }
    }

    // ── Aggregate orders: paid/organic, byPlatform, per-product purchases,
    //    first-touch coverage. ──────────────────────────────────────────────
    const paidVsOrganic = {
      paid: { orders: 0, revenueCad: 0 },
      organic: { orders: 0, revenueCad: 0 },
    };
    const platformOrders = zeroBuckets();
    const platformRevenue = zeroBuckets();
    let orderFt = 0;

    // Per-product accumulator. The merge key prefers the exact productId
    // (`pid:<id>`) so an id-bearing ATC and a line_items purchase of the same
    // product collapse into ONE row regardless of title drift; entries with no
    // productId (a historical, title-only ATC that matches no catalog product)
    // fall back to a normalized-title key (`title:<key>`). Each entry tracks its
    // display title, its productId (if any), the purchase + ATC counts, and the
    // per-bucket source splits.
    type ProductAcc = {
      productId: string | null;
      title: string;
      purchaseCount: number;
      purchaseBySource: Record<SourceBucket, number>;
      atcCount: number;
      atcBySource: Record<SourceBucket, number>;
    };
    const byKey = new Map<string, ProductAcc>();
    const pidKey = (pid: string) => `pid:${pid}`;
    const titleKeyed = (tk: string) => `title:${tk}`;
    function ensure(key: string, title: string, productId: string | null): ProductAcc {
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          productId,
          title,
          purchaseCount: 0,
          purchaseBySource: zeroBuckets(),
          atcCount: 0,
          atcBySource: zeroBuckets(),
        };
        byKey.set(key, acc);
      } else if (!acc.productId && productId) {
        acc.productId = productId;
      }
      return acc;
    }

    for (const r of orderRows) {
      const source = String(r.source ?? '').trim();
      const revenue = toNumber(r.total_cad);
      const bucket = sourceToBucket(source);

      // paid vs organic
      const side = sourceIsPaid(source) ? paidVsOrganic.paid : paidVsOrganic.organic;
      side.orders += 1;
      side.revenueCad += revenue;

      // platform distribution (orders + revenue)
      platformOrders[bucket] += 1;
      platformRevenue[bucket] += revenue;

      // first-touch coverage
      if (String(r.first_touch_source ?? '').trim()) orderFt += 1;

      // per-product purchases — one count per line item × the order's source.
      // Keyed by the exact productId so id-bearing ATC merges into the same row.
      const lineItems = parseLineItems(r.line_items);
      for (const li of lineItems) {
        const pid = li.productId; // guaranteed non-empty by parseLineItems
        const title = titleByProductId.get(pid) ?? pid; // catalog title, id fallback
        const acc = ensure(pidKey(pid), clampTitle(title), pid);
        acc.purchaseCount += 1;
        acc.purchaseBySource[bucket] += 1;
      }
    }

    // ── Aggregate ATC: platform distribution + per-product. Prefer the exact
    //    productId (raw.product_id, PPJ-T1) so id-bearing carts merge with
    //    purchases under one productId-keyed row; fall back to normalized-title
    //    matching only for historical events that lack a product_id. ──────────
    const atcPlatform = zeroBuckets();
    for (const r of eventRows) {
      const source = String(r.source ?? '').trim();
      const bucket = sourceToBucket(source);
      atcPlatform[bucket] += 1;

      const eventPid = String(r.product_id ?? '').trim();
      const rawTitle = clampTitle(r.product_title);

      let key: string;
      let title: string;
      let productId: string | null;
      if (eventPid) {
        // New event: exact id-join. Title from the catalog, id fallback.
        productId = eventPid;
        key = pidKey(eventPid);
        title = clampTitle(titleByProductId.get(eventPid) ?? (rawTitle || eventPid));
      } else {
        // Historical event (no product_id): best-effort title match.
        if (!rawTitle) continue; // can't attribute an ATC with no product to a row
        const tk = titleKey(rawTitle);
        const matchedPid = productIdByTitleKey.get(tk);
        if (matchedPid) {
          // Title matches a catalog product → merge into its id-keyed row.
          productId = matchedPid;
          key = pidKey(matchedPid);
          title = clampTitle(titleByProductId.get(matchedPid) ?? rawTitle);
        } else {
          // No catalog match → its own best-effort, title-only row.
          productId = null;
          key = titleKeyed(tk);
          title = rawTitle;
        }
      }
      const acc = ensure(key, title, productId);
      acc.atcCount += 1;
      acc.atcBySource[bucket] += 1;
    }

    const orderTotal = orderRows.length;
    const atcTotal = eventRows.length;

    const byPlatform: BucketCount[] = SOURCE_BUCKETS.filter(
      (b) => platformOrders[b] > 0 || platformRevenue[b] > 0,
    ).map((bucket) => ({
      bucket,
      label: SOURCE_BUCKET_LABEL[bucket],
      orders: platformOrders[bucket],
      revenueCad: platformRevenue[bucket],
      pct: orderTotal > 0 ? (platformOrders[bucket] / orderTotal) * 100 : 0,
    }));

    const atcByPlatform: AtcBucketCount[] = SOURCE_BUCKETS.filter((b) => atcPlatform[b] > 0).map(
      (bucket) => ({
        bucket,
        label: SOURCE_BUCKET_LABEL[bucket],
        count: atcPlatform[bucket],
        pct: atcTotal > 0 ? (atcPlatform[bucket] / atcTotal) * 100 : 0,
      }),
    );

    // Top products by purchase count (ties broken by ATC, then title for stability).
    const perProduct: PerProduct[] = Array.from(byKey.values())
      .sort(
        (a, b) =>
          b.purchaseCount - a.purchaseCount ||
          b.atcCount - a.atcCount ||
          a.title.localeCompare(b.title),
      )
      .slice(0, TOP_PRODUCTS)
      .map((acc) => ({
        productId: acc.productId,
        productTitle: acc.title,
        atcCount: acc.atcCount,
        purchaseCount: acc.purchaseCount,
        conversionPct: acc.atcCount > 0 ? (acc.purchaseCount / acc.atcCount) * 100 : null,
        purchaseBySource: splitOf(acc.purchaseBySource),
        atcBySource: splitOf(acc.atcBySource),
      }));

    // P0 (audit 2026-06-15): if orders OR ATC hit the 50k page cap, the totals
    // below are INCOMPLETE — flag it so the UI can warn instead of silently
    // showing skewed numbers.
    const dataTruncated = ordersTruncated || atcTruncated;
    if (dataTruncated) {
      console.warn(
        `/api/activity-stats: row cap (${MAX_PAGES * PAGE_SIZE}) hit — totals incomplete`,
        { range, storeId, ordersTruncated, atcTruncated },
      );
    }

    const body: ActivityStatsResponse = {
      range,
      orders: { total: orderTotal, paidVsOrganic, byPlatform },
      atc: { total: atcTotal, byPlatform: atcByPlatform },
      perProduct,
      // Distinct products in range (perProduct is sliced to TOP_PRODUCTS); the UI
      // shows "20 מתוך N" so the table never implies it's the whole catalog.
      totalProducts: byKey.size,
      firstTouchCoverage: {
        orders: {
          withFt: orderFt,
          total: orderTotal,
          pct: orderTotal > 0 ? (orderFt / orderTotal) * 100 : 0,
        },
      },
      ...(dataTruncated ? { dataTruncated: true } : {}),
    };

    return NextResponse.json<ActivityStatsResponse>(body, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    captureRouteError('/api/activity-stats', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/activity-stats GET threw:', rawMessage);
    return NextResponse.json<ActivityStatsResponse>(emptyBody(range, userFacingError(rawMessage)), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
