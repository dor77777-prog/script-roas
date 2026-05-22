/**
 * Shopify Admin REST fetcher — pure-TS HTTP layer that delegates to the
 * Phase 05.2.3.0 refund-correction algorithm at
 * `src/lib/shopifyRevenueRefunds.ts:computeRevenueWithCrossDayRefunds`.
 *
 * KEEP-IN-SYNC with Apps Script `Shopify.gs:90` (`getShopifyRevenue`) +
 * `Shopify.gs:220-246` (`getShopifyProductSalesForDay` line-item handling)
 * + `Shopify.gs:633` (`getShopifyRefundsForDay_`). The algorithm is the
 * canonical implementation; this module is its I/O wrapper. Any change to
 * the algorithm must be applied to BOTH files in the same commit per the
 * load-bearing-invariants header in `shopifyRevenueRefunds.ts:8-48`.
 *
 * === Why we MUST import, not re-derive ===
 *
 * The three load-bearing invariants (gap-closure 08, 2026-05-21) are:
 *
 *   1. Store-level gross uses `total_price` (immutable per Shopify Admin
 *      REST 2024-10), NOT `current_total_price`. Under `current_total_price`
 *      + cross-day filter, every refund within 48h of order creation was
 *      deducted TWICE once any backfill re-fetched the prior-day row
 *      (CR-01 in 05.2.3.0-REVIEW.md).
 *
 *   2. Refunds attribute to their `processed_at` day exactly ONCE — no
 *      cross-day filter. Same-day and cross-day refunds both deduct on
 *      the refund day. Re-fetching prior-day rows no longer changes their
 *      value because total_price is immutable.
 *
 *   3. Per-product intra-order refund map is built ONLY from refunds whose
 *      `processed_at` falls on the same day as the order. A future-day
 *      refund on an order created on day D must NOT be deducted from
 *      day D's per-product net — it deducts on its processed_at day
 *      (CR-02 in 05.2.3.0-REVIEW.md).
 *
 * Plus: NO zero-clamping (i.e. `Math.max( 0, ...)`) ANYWHERE. Negative
 * store/per-product net is legitimate (D-D3 in CR-03). `transactions[].amount`
 * is IGNORED (PROBE-EVIDENCE.md §Finding 1).
 *
 * The fetcher's responsibility is HTTP (paginate orders+refunds for the day,
 * including the cross-day-refund updated_at window) → call algorithm →
 * return per-store + per-product totals. The "pure" boundary is at the
 * algorithm function; this fetcher is the I/O wrapper (per D-C3 +
 * 05.6-PATTERNS.md S-9 §shopify.ts).
 *
 * Apps Script's `fetchWithRetry_` is replaced by **letting Inngest handle
 * retries** — the fetcher throws on non-200 and Inngest's default 4-retry
 * exponential backoff handles the rest (per 05.6-RESEARCH.md Pattern 2 +
 * 05.6-PATTERNS.md S-9 deviations).
 *
 * Decision-ID citations:
 *   - D-C1 / D-C4: algorithm parity with Apps Script via REUSE of the
 *     existing pure-TS implementation.
 *   - D-C4: `SHOPIFY_API_VERSION` was '2024-10' (Config.gs:12) — bumped to
 *     '2026-04' on 2026-05-22; see the SHOPIFY_API_VERSION docstring below
 *     for why the divergence from Config.gs is safe.
 *   - D-A4: TZ = 'Asia/Jerusalem' (passed to algorithm).
 *   - D-D3: no clamping anywhere.
 */

import {
  computeRevenueWithCrossDayRefunds,
  type ShopifyOrderInput,
} from '@/lib/shopifyRevenueRefunds';
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';

// =============================================================================
// Constants
// =============================================================================

/**
 * Shopify Admin REST API version. Bumped 2026-05-22 from 2024-10 → 2026-04.
 * Shopify supports the last 4 stable versions; as of May 2026 those are
 * 2026-04 (latest), 2026-01, 2025-10, 2025-04. 2024-10 was already out of
 * the supported window (sunset Jan 2026); Shopify "falls forward" so requests
 * still worked but were silently served the latest-stable semantics.
 *
 * The orders payload fields we read (id, created_at, total_price,
 * current_total_price, test, financial_status, line_items[], refunds[],
 * note_attributes[], landing_site, referring_site, source_name) and the
 * products payload fields (id, title, status, handle, image, variants[].price,
 * product_type, vendor, updated_at) are stable across 2024-10..2026-04 —
 * no breaking changes on the read paths we use.
 *
 * Apps Script side (`Config.gs:12`) is still on 2024-10; the load-bearing
 * algorithm (`shopifyRevenueRefunds.ts`) is version-agnostic — its three
 * invariants depend on `total_price` being immutable, which has been true
 * since Shopify Admin REST 2024-10. Bumping the TS-side path is safe.
 */
const SHOPIFY_API_VERSION = '2026-04';

/**
 * Project TZ (matches `Config.gs:6`). The algorithm uses this for all
 * day-string comparisons (D-A4).
 */
const SHOPIFY_TZ = 'Asia/Jerusalem';

/**
 * Pagination safety cap. Mirrors `Shopify.gs:129` exactly. With Shopify's
 * 250-orders-per-page limit, 50 pages = 12,500 orders/day. Per Pitfall 6
 * (05.6-RESEARCH.md:1433-1439), current store volume is ~10-50 orders/day,
 * so this cap is invisible in practice; it exists to prevent runaway loops.
 * If the cap is ever hit, we emit `console.warn` (matching Apps Script's
 * `Logger.log` warning at `Shopify.gs:168-174`) but do NOT throw.
 */
const PAGINATION_CAP = 50;

/**
 * Hard-coded store-name map. Avoids a Supabase round-trip per fetch for a
 * near-immutable display string. Matches the Phase 05.5-01 stores seed.
 * If a store name ever changes, the operator console's stores-CRUD UI
 * (plan 13) is the right place to update it — out of scope for 05.6-03.
 *
 * Source: `Config.gs:STORES` (uzoshop / zolplus / usmile360).
 */
const STORE_NAMES: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

// =============================================================================
// Types
// =============================================================================

/**
 * Per-product row in the fetcher result. Same shape that plans 08-10 (Inngest
 * functions) UPSERT into the Supabase `products_daily` table.
 */
export type ShopifyProductRow = {
  product_id: string;
  net_revenue_cad: number;
  /**
   * 2026-05-21 additions for products_daily completeness — the UI's
   * "הנחות/החזרים" refund-% formula is `(1 − net_revenue / gross_revenue) × 100`,
   * which was always rendering 0% pre-fix because gross was null.
   */
  gross_revenue_cad: number;
  units: number;
  orders: number;
  product_title: string;
};

/**
 * Fetcher result. `revenueCad` is `storeNetCad` from the algorithm rename'd
 * for clarity at the cron-function boundary (matches RESEARCH §Pattern 9 line
 * 1146). Shopify accounts on all 3 stores are CAD-denominated per existing
 * Apps Script config, so no FX conversion happens here.
 */
export type ShopifyDayRows = {
  storeId: string;
  date: string;
  storeName: string;
  revenueCad: number;
  productRows: ShopifyProductRow[];
  customItemRefundCad: number;
  /**
   * Σ total_price for orders created on D (BEFORE refund subtraction).
   * `revenueCad + refundDeductionCad` should equal this. Surfaced for the
   * dashboard's refund indicator badge + tooltip (2026-05-21).
   */
  grossRevenueCad: number;
  /**
   * Σ refund_line_items[].subtotal for refunds processed on D. POSITIVE
   * value; equals `grossRevenueCad − revenueCad`. Used by the UI to render
   * the per-day refund chip and the "before refunds" tooltip.
   */
  refundDeductionCad: number;
};

/**
 * Phase 05.6.1 — one product-catalog snapshot row per active Shopify product.
 *
 * Port of `Shopify.gs:537` (`getShopifyProductsCatalog`). Shape matches the
 * `product_catalog` table in migration 20260521063112_initial_schema.sql:141.
 *
 * `storeId` is included so the writer in cronDaily.ts can UPSERT with the
 * full (store_id, product_id) PK without a second pass.
 *
 * `priceCad` is the FIRST variant's price (representative, not authoritative).
 * Apps Script line 569-570 documents this — "most stores have a single variant
 * or all variants priced similarly". The dashboard shows it as context, not
 * gospel. `null` when the product has no variants (rare but possible during
 * draft → active transitions).
 *
 * `updatedAt` carries Shopify's last-modified timestamp so future deltas can
 * detect changes without re-fetching the full catalog.
 */
export type ShopifyCatalogRow = {
  storeId: string;
  productId: string;
  title: string;
  handle: string;
  status: string;
  priceCad: number | null;
  imageUrl: string | null;
  productType: string | null;
  vendor: string | null;
  updatedAt: string | null;
};

/**
 * Phase 05.6.1 — one attribution row per non-test, non-voided Shopify order
 * on day `dateStr`.
 *
 * Port of `Shopify.gs:757` (`getShopifyOrdersAttribution`). Shape matches the
 * `orders_attribution` table in migration 20260521063112_initial_schema.sql:119
 * (using camelCase here; writer in cronDaily.ts snake_cases on the way to DB).
 *
 * `source` follows the Apps Script priority chain (line 940-984) but the
 * unified-schema label format (kept here: 'meta-paid' / 'google-paid' /
 * 'meta-organic' / 'google-organic' / 'email' / 'other-paid' / 'other-referral'
 * / 'direct') — matching what postgresReaders.ts:589 reads back into
 * OrderAttributionRow.source.
 */
export type ShopifyOrderRow = {
  storeId: string;
  orderId: string;
  date: string;
  totalCad: number;
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string | null;
  utmId: string | null;
  utmTerm: string | null;
  lineItems: Array<{ p: string; u: number; r: number }> | null;
};

// =============================================================================
// Helpers — day boundaries & Link header parsing
// =============================================================================

/**
 * Returns an ISO-8601 timestamp for local midnight on `dateStr` (YYYY-MM-DD)
 * in the project timezone. The timezone offset is resolved from the actual
 * date instead of using a hardcoded offset — mirrors `Shopify.gs:isoLocalMidnight_`
 * (line 56-83) so DST transitions in Asia/Jerusalem produce correct windows.
 *
 * Algorithm: start from the target wall-clock time interpreted as UTC, format
 * it in the target TZ, compare the delta, and iterate (max 3 times — enough
 * for DST transitions which shift by exactly 1 hour). Final output is
 * formatted with the resolved offset, e.g. '2026-05-19T00:00:00+03:00'.
 */
function isoLocalMidnight(dateStr: string, tz: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`isoLocalMidnight: invalid dateStr "${dateStr}"`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetLocalAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instantMs = targetLocalAsUtc;

  for (let i = 0; i < 3; i++) {
    const local = formatLocalIso(instantMs, tz);
    const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) throw new Error(`isoLocalMidnight: could not parse "${local}"`);
    const localAsUtc = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    const deltaMs = localAsUtc - targetLocalAsUtc;
    if (deltaMs === 0) break;
    instantMs -= deltaMs;
  }

  // Compute the offset hh:mm at the resolved instant.
  //
  // CRITICAL FIX (2026-05-22 incident): Date.UTC expects month 0-indexed
  // (Jan=0 .. Dec=11). The previous version spread the regex groups
  // directly via .slice(1).map(Number), passing month=5 for "05" → which
  // Date.UTC treats as JUNE → produced an offset of +747:00 (= 31 days +
  // 3 hours in minutes) instead of +03:00 for Asia/Jerusalem in May.
  //
  // Shopify silently accepts invalid timezone offsets > +14:00 and returns
  // an empty orders[] array, so the fetcher silently lost EVERY order on
  // every day. The dashboard had been showing zero revenue for "today" on
  // every store since this codepath went live; backfill on prior days hid
  // it because re-fetches just overwrote already-correct values until the
  // 2026-05-22 day rollover when nothing was queued to backfill the new
  // day. See debug endpoint /api/debug/shopify-fetch for the diagnostic
  // that surfaced this.
  const offsetMatch = formatLocalIso(instantMs, tz).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!offsetMatch) {
    throw new Error(
      `isoLocalMidnight: offset calc could not parse "${formatLocalIso(instantMs, tz)}"`,
    );
  }
  const offsetMin =
    (Date.UTC(
      Number(offsetMatch[1]),
      Number(offsetMatch[2]) - 1, // ← month MUST be 0-indexed for Date.UTC
      Number(offsetMatch[3]),
      Number(offsetMatch[4]),
      Number(offsetMatch[5]),
      Number(offsetMatch[6]),
    ) -
      instantMs) /
    60000;
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const oh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const om = String(absMin % 60).padStart(2, '0');

  // Build the canonical 'YYYY-MM-DDTHH:mm:ss±HH:MM' shape.
  const local = formatLocalIso(instantMs, tz);
  return `${local}${sign}${oh}:${om}`;
}

function formatLocalIso(instantMs: number, tz: string): string {
  const d = new Date(instantMs);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // en-CA produces 'YYYY-MM-DD, HH:MM:SS' (24h). Normalize to ISO 'T' shape.
  // Some runtimes emit 'YYYY-MM-DD HH:MM:SS' without the comma; handle both.
  const out = fmt.format(d).replace(', ', 'T').replace(' ', 'T');
  // hour can be reported as '24' at midnight in some Node versions — normalize.
  return out.replace(/T24:/, 'T00:');
}

/**
 * Returns the day AFTER `dateStr` as 'YYYY-MM-DD'. Mirror of `Config.gs:78-82`
 * (`nextDayStr_`). Uses Date.UTC arithmetic so it works across month + DST
 * boundaries without local-time landmines.
 */
function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse the `Link` response header and extract the URL where
 * `rel="next"`. Returns undefined when no next page. Matches the
 * Apps Script regex at `Shopify.gs:164` verbatim.
 */
function parseNextLink(headers: Headers): string | undefined {
  const link = headers.get('Link') ?? headers.get('link') ?? '';
  if (!link) return undefined;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1] : undefined;
}

// =============================================================================
// HTTP layer — paginated fetch with merge of two windows
// =============================================================================

/**
 * Build the initial URL for a window query.
 *
 *   /admin/api/{VER}/orders.json?status=any&limit=250
 *     &{windowField}_min={iso_start}[&{windowField}_max={iso_end}]
 *     &fields={fields_csv}
 *
 * windowField is either:
 *   - `created_at` (Window A — same-day gross): bounded [D, D+1)
 *   - `updated_at` (Window B — cross-day refunds): bounded [D, today+1)
 *
 * Why Window B is open-ended (extends to today, not D+1):
 *
 * Shopify advances `Order.updated_at` whenever ANY refund is attached, but
 * subsequent updates (tag changes, batch jobs, fulfillment status, customer
 * notes) push it further out. Bug 2026-05-21: 8 of 10 refunds processed on
 * 2026-05-20 for uzoshop were on orders whose `updated_at` had advanced to
 * 2026-05-21T15:31 (some kind of batch update). The narrow [D, D+1) window
 * missed all 8 ($832.43 in `refund_line_items.subtotal`), leaving the
 * dashboard $832 above the truth.
 *
 * Fix: drop the upper bound and use `today+1` so any order updated AT OR
 * AFTER D is candidates for the refund.processed_at==D filter applied by
 * `computeRevenueWithCrossDayRefunds`. Cost grows linearly with backfill
 * depth (~250 orders/day for these stores), bounded by PAGINATION_CAP (50
 * pages = 12,500 orders), which covers ~50 days of typical store volume.
 *
 * NOTE: this is a TS-only fix. Apps Script (`Shopify.gs:644-648`) has the
 * same bug but is no longer the source of truth (READ_FROM=postgres
 * permanent as of Phase 05.7.0). The two implementations have legitimately
 * diverged on this point; the load-bearing-invariants header in
 * `shopifyRevenueRefunds.ts` (the ALGORITHM) is still in sync — only the
 * I/O wrapper changed.
 *
 * Fields list mirrors `Shopify.gs:222` (the more-inclusive product-sales
 * variant) — it's a superset of what `getShopifyRevenue` requests, so a
 * single fetch satisfies both store-level + per-product algorithm needs.
 */
function buildWindowUrl(
  domain: string,
  windowField: 'created_at' | 'updated_at',
  dateStr: string,
): string {
  const dayStart = isoLocalMidnight(dateStr, SHOPIFY_TZ);
  const fields =
    'id,created_at,total_price,current_total_price,test,financial_status,line_items,refunds';
  let url =
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
    `?status=any&limit=250` +
    `&${windowField}_min=${encodeURIComponent(dayStart)}`;

  if (windowField === 'created_at') {
    // Same-day gross: tight [D, D+1) window.
    const dayEnd = isoLocalMidnight(nextDayStr(dateStr), SHOPIFY_TZ);
    url += `&${windowField}_max=${encodeURIComponent(dayEnd)}`;
  } else {
    // Cross-day refunds: open the upper bound to today+1 (covers orders
    // whose updated_at advanced after the refund-day). See JSDoc above.
    const todayStr = dayInTz(new Date().toISOString(), SHOPIFY_TZ);
    const tomorrowEnd = isoLocalMidnight(nextDayStr(todayStr), SHOPIFY_TZ);
    url += `&${windowField}_max=${encodeURIComponent(tomorrowEnd)}`;
  }

  url += `&fields=${fields}`;
  return url;
}

/**
 * Local copy of the algorithm's TZ day-string helper. Used by
 * `buildWindowUrl` to compute "today" in Asia/Jerusalem for the open-ended
 * Window B upper bound. Mirrors the helper in `shopifyRevenueRefunds.ts:185`
 * verbatim — duplicated here to avoid importing from a pure-algorithm file
 * that's tested in isolation.
 */
function dayInTz(ts: string, tz: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

/**
 * Paginate a single window (created_at OR updated_at) for day D. Returns the
 * raw orders array — no algorithm logic. Pagination cap mirrors
 * `Shopify.gs:129` exactly: emit `console.warn` if hit, do NOT throw.
 *
 * Non-200 responses throw — Inngest's retry layer handles transient
 * 5xx/429 (per 05.6-PATTERNS.md S-9 deviation: `fetchWithRetry_` → throw +
 * Inngest retries).
 */
async function fetchWindow(
  domain: string,
  token: string,
  windowField: 'created_at' | 'updated_at',
  dateStr: string,
  storeId: string,
): Promise<ShopifyOrderInput[]> {
  let url: string | undefined = buildWindowUrl(domain, windowField, dateStr);
  const orders: ShopifyOrderInput[] = [];
  let pages = 0;

  while (url && pages < PAGINATION_CAP) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => '');
      throw new Error(
        `Shopify ${storeId} ${dateStr} ${windowField} window failed ` +
          `(${res.status}): ${bodyTxt.slice(0, 200)}`,
      );
    }

    const body = (await res.json()) as { orders?: ShopifyOrderInput[] };
    const pageOrders = body?.orders ?? [];
    for (const o of pageOrders) orders.push(o);

    url = parseNextLink(res.headers);
    pages++;
  }

  if (pages >= PAGINATION_CAP && url) {
    console.warn(
      `Shopify ${storeId} ${dateStr} ${windowField} window hit pagination ` +
        `cap of ${PAGINATION_CAP} pages — additional orders beyond may be ` +
        `missing. Increase cap or investigate volume spike. ` +
        `(05.6-RESEARCH.md Pitfall 6)`,
    );
  }

  return orders;
}

/**
 * Fetch BOTH windows for day D and merge the orders array deduped by `id`.
 *
 * Window A (`created_at=D`) catches every order CREATED on day D — these
 * are the same-day-gross input to the algorithm.
 *
 * Window B (`updated_at=D`) catches every order whose `updated_at` advanced
 * into day D — typically because a refund processed on D bumped the order's
 * updated_at, regardless of when the order was created. These are the
 * cross-day-refund input.
 *
 * The two windows ALMOST ALWAYS overlap (an order created on D that's also
 * refunded on D appears in both). The algorithm gets a deduped superset and
 * uses `created_at` per-order to decide whether to apply the same-day-gross
 * branch — so dedup is required to avoid double-counting.
 *
 * Per RESEARCH §Pattern 9 (lines 1131-1138).
 */
async function fetchOrdersWithRefundsForDay(
  domain: string,
  token: string,
  dateStr: string,
  storeId: string,
): Promise<ShopifyOrderInput[]> {
  const [windowA, windowB] = await Promise.all([
    fetchWindow(domain, token, 'created_at', dateStr, storeId),
    fetchWindow(domain, token, 'updated_at', dateStr, storeId),
  ]);

  // Dedup by stringified id. Map preserves insertion order; window A comes
  // first so same-id orders from window A's response shape "win" (in practice
  // both windows return identical payloads for an overlapping order — Shopify
  // returns the same record, not a windowed view).
  const merged = new Map<string, ShopifyOrderInput>();
  for (const o of windowA) merged.set(String(o.id), o);
  for (const o of windowB) {
    const key = String(o.id);
    if (!merged.has(key)) merged.set(key, o);
  }
  return Array.from(merged.values());
}

// =============================================================================
// Public entry point
// =============================================================================

/**
 * Fetch one day's Shopify revenue + per-product net for a single store.
 *
 * Pipeline:
 *   1. Resolve per-store creds from env (`${STORE}_SHOPIFY_DOMAIN/_TOKEN`)
 *   2. Paginate BOTH `created_at=D` and `updated_at=D` windows, merge deduped
 *   3. Delegate to `computeRevenueWithCrossDayRefunds` for the algorithm
 *   4. Shape the result for the Inngest writers (plans 08-10)
 *
 * Throws on missing env vars, non-200 responses. Inngest's retry layer
 * handles transient errors; permanent errors (auth, missing creds) surface
 * to the operator console's jobs table.
 *
 * Env var convention: matches `docs/PROPS-MAP.md` (Phase 05.5-02) which is
 * the operator-facing canonical list — `${STORE}_SHOPIFY_*`, NOT
 * `SHOPIFY_${STORE}_*`. The earlier ordering was a fetcher-side bug that
 * caused live cron-live runs to fail with "Missing Shopify creds" against
 * properly-seeded Vercel env vars.
 *
 * Algorithm parity guarantee: the EXISTING pure-TS function at
 * `shopifyRevenueRefunds.ts:150` is called exactly once per invocation
 * (verified by Test 7 in `__tests__/shopify.test.ts`). This is the
 * load-bearing "don't hand-roll the algorithm" gate.
 */
export async function fetchShopifyDayRows(
  storeId: string,
  dateStr: string,
): Promise<ShopifyDayRows> {
  // Phase 05.7.7: Dev Dashboard apps use OAuth client_credentials grant —
  // exchange Client ID + Secret for a 24h access token (cached in-process).
  // See shopifyAuth.ts for the helper that owns the cache + refresh logic.
  const upper = storeId.toUpperCase();
  const domain = process.env[`${upper}_SHOPIFY_DOMAIN`];
  if (!domain) {
    throw new Error(
      `Missing Shopify domain for store "${storeId}" — expected ` +
        `${upper}_SHOPIFY_DOMAIN env var.`,
    );
  }
  const token = await getShopifyAccessToken(storeId);

  const orders = await fetchOrdersWithRefundsForDay(
    domain,
    token,
    dateStr,
    storeId,
  );

  const {
    storeNetCad,
    byProduct,
    customItemRefundCad,
    storeGrossCad,
    storeRefundDeductionCad,
  } = computeRevenueWithCrossDayRefunds(orders, dateStr, SHOPIFY_TZ);

  const storeName = STORE_NAMES[storeId] ?? storeId;

  return {
    storeId,
    date: dateStr,
    storeName,
    revenueCad: storeNetCad,
    productRows: Object.entries(byProduct).map(([pid, p]) => ({
      product_id: pid,
      net_revenue_cad: p.netRevenueCad,
      gross_revenue_cad: p.grossRevenueCad,
      units: p.units,
      orders: p.orders,
      product_title: p.productTitle,
    })),
    customItemRefundCad,
    grossRevenueCad: storeGrossCad,
    refundDeductionCad: storeRefundDeductionCad,
  };
}

// =============================================================================
// Phase 05.6.1 — product catalog snapshot
// =============================================================================

/**
 * Resolve domain + a fresh Admin API access_token. Phase 05.7.7 changed
 * the auth model from a static `${STORE}_SHOPIFY_TOKEN` env var to
 * OAuth client_credentials grant (Client ID + Secret exchanged for a
 * 24h token, cached in-process via `getShopifyAccessToken`).
 *
 * Centralized so all 3 Shopify fetchers (day rows, products catalog,
 * orders attribution) share ONE canonical auth path. A drift between
 * fetchers on auth scheme would silently break some writers.
 */
async function getShopifyCreds(
  storeId: string,
): Promise<{ domain: string; token: string }> {
  const upper = storeId.toUpperCase();
  const domain = process.env[`${upper}_SHOPIFY_DOMAIN`];

  if (!domain) {
    throw new Error(
      `Missing Shopify domain for store "${storeId}" — expected ` +
        `${upper}_SHOPIFY_DOMAIN env var.`,
    );
  }
  const token = await getShopifyAccessToken(storeId);
  return { domain, token };
}

/**
 * Phase 05.6.1 — snapshot of every active product in a Shopify store.
 *
 * Port of `Shopify.gs:537` (`getShopifyProductsCatalog`). This is a snapshot
 * (no date arg) — each call returns ALL active products for the store. The
 * writer in cronDaily.ts UPSERTs with PK `(store_id, product_id)` so daily
 * re-fetches harmlessly overwrite the prior snapshot.
 *
 * Pagination: Shopify cursor pagination via `Link: <...>; rel="next"` header
 * (same mechanism as the orders fetcher above). Cap at `PAGINATION_CAP` (50)
 * pages of 250 = 12,500 active products — well beyond any single store.
 *
 * Non-200 throws. Inngest's default 4-retry exponential backoff handles
 * transient 5xx/429 (same convention as `fetchShopifyDayRows`).
 */
export async function fetchShopifyProductsCatalog(
  storeId: string,
): Promise<ShopifyCatalogRow[]> {
  const { domain, token } = await getShopifyCreds(storeId);

  const fields = 'id,title,status,handle,image,variants,product_type,vendor,updated_at';
  let url: string | undefined =
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json` +
    `?status=active&limit=250&fields=${fields}`;

  const out: ShopifyCatalogRow[] = [];
  let pages = 0;

  // Narrowed payload shape — only the fields we read are typed; everything else
  // (variants[].compare_at_price, images[], etc.) is ignored.
  type CatalogProductPayload = {
    id?: number | string;
    title?: string;
    handle?: string;
    status?: string;
    image?: { src?: string } | null;
    variants?: Array<{ price?: string | number }>;
    product_type?: string;
    vendor?: string;
    updated_at?: string;
  };

  while (url && pages < PAGINATION_CAP) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => '');
      throw new Error(
        `Shopify catalog ${storeId} failed ` +
          `(${res.status}): ${bodyTxt.slice(0, 200)}`,
      );
    }

    const body = (await res.json()) as { products?: CatalogProductPayload[] };
    const products = body?.products ?? [];

    for (const p of products) {
      // First-variant price as a representative (Apps Script Shopify.gs:569-570).
      // `null` when the product has no variants — distinguishes "free product"
      // (priceCad=0) from "no variants" (priceCad=null) for the dashboard.
      const firstVariant = (p.variants ?? [])[0];
      const priceParsed =
        firstVariant && firstVariant.price !== undefined
          ? parseFloat(String(firstVariant.price))
          : NaN;
      const priceCad = Number.isFinite(priceParsed) ? priceParsed : null;

      const imageUrl = p.image?.src ?? null;

      out.push({
        storeId,
        productId: String(p.id ?? ''),
        // Apps Script line 574 falls back to '(ללא שם)' here. We pass the
        // empty title through and let postgresReaders.ts (line 636) apply
        // the localized fallback — keeps the storage layer free of UI
        // strings.
        title: p.title ?? '',
        handle: p.handle ?? '',
        status: p.status ?? '',
        priceCad,
        imageUrl,
        productType: p.product_type ?? null,
        vendor: p.vendor ?? null,
        updatedAt: p.updated_at ?? null,
      });
    }

    url = parseNextLink(res.headers);
    pages++;
  }

  if (pages >= PAGINATION_CAP && url) {
    console.warn(
      `Shopify catalog ${storeId}: hit pagination cap of ${PAGINATION_CAP} ` +
        `pages (${out.length} products collected); data beyond may be missing. ` +
        `(05.6-RESEARCH.md Pitfall 6)`,
    );
  }

  return out;
}

// =============================================================================
// Phase 05.6.1 — orders attribution
// =============================================================================

/**
 * Classifier helper — pulls UTM/fbclid/gclid from `landing_site` + falls back
 * to `note_attributes`. Mirrors `Shopify.gs:classifyOrderAttribution_` at
 * line 910-1001.
 *
 * Defensive guards (matching Apps Script verbatim):
 *   - `safeDecode`: decodeURIComponent that swallows URIError on malformed
 *     percent-escapes (bot traffic regularly produces these). Drops the bad
 *     param, never aborts the whole order.
 *   - `Object.create(null)` for the params bag so a query param named
 *     `__proto__` / `hasOwnProperty` / `toString` does not collide with
 *     inherited Object prototype keys (Apps Script IN5-05 / Shopify.gs:929).
 *   - source_name override: when Shopify sets `source_name` to 'fb' / 'google',
 *     treat that as a deterministic platform signal BEFORE we fall back to
 *     the landing-URL UTM parsing. Apps Script does not branch on source_name
 *     because Shopify's source_name is "web" for nearly every storefront
 *     order. We surface it here per the plan scope so cleanly-tagged
 *     server-side orders are not misclassified as 'direct' just because they
 *     happen to lack a landing_site UTM tail.
 */
type ShopifyOrderPayload = {
  id?: number | string;
  current_total_price?: string | number;
  financial_status?: string;
  test?: boolean;
  landing_site?: string;
  referring_site?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  source_name?: string;
  line_items?: Array<{
    product_id?: number | string | null;
    quantity?: number | string;
    price?: number | string;
  }>;
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function classifyOrderAttribution(order: ShopifyOrderPayload): {
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmId: string;
  utmTerm: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string;
} {
  const landing = String(order.landing_site ?? '');
  const ref = String(order.referring_site ?? '').toLowerCase();
  const sourceName = String(order.source_name ?? '').toLowerCase();
  const noteAttrs = order.note_attributes ?? [];

  // Parse UTM-like params from landing URL.
  const params: Record<string, string> = Object.create(null);
  const qIdx = landing.indexOf('?');
  if (qIdx >= 0) {
    const qs = landing.slice(qIdx + 1);
    for (const pair of qs.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = safeDecode(pair.slice(0, eq)).toLowerCase();
      const v = safeDecode(pair.slice(eq + 1));
      params[k] = v;
    }
  }
  // Some Shopify integrations stash click IDs in note_attributes (Apps Script
  // line 942-946) — check there too.
  for (const na of noteAttrs) {
    const name = String(na.name ?? '').toLowerCase();
    if (!name) continue;
    if (!params[name]) params[name] = String(na.value ?? '');
  }

  const utmSource = params['utm_source'] ?? '';
  const utmMedium = params['utm_medium'] ?? '';
  const utmCampaign = params['utm_campaign'] ?? '';
  const utmContent = params['utm_content'] ?? '';
  const utmId = params['utm_id'] ?? '';
  const utmTerm = params['utm_term'] ?? '';
  const fbclid = !!(params['fbclid'] || params['_fbc']);
  const gclid = !!params['gclid'];
  // Phase 05.7.5: TikTok click ID. Same pattern as fbclid/gclid — TikTok's
  // ad SDK appends `ttclid` to landing URLs when the click came from a
  // TikTok ad. Promoted to its own variable for symmetry with the other
  // two paid platforms.
  const ttclid = !!params['ttclid'];

  // Source priority chain. Apps Script Shopify.gs:963-984 + two prepended
  // branches:
  //   1. source_name overrides (fb/google/tiktok) — Shopify's checkout SDK
  //      writes source_name when the order arrives via the platform's
  //      channel app. More reliable than landing_site UTMs (which can be
  //      stripped by a redirect chain).
  //   2. Click-ID overrides (fbclid / gclid / ttclid) — the platform's
  //      JavaScript SDK tags the landing URL. Trumps UTM tags because the
  //      click-ID is canonical (platform-signed) whereas UTMs can be hand-
  //      typed / spoofed.
  let source: string;
  if (sourceName === 'fb' || sourceName === 'facebook') {
    source = 'meta-paid';
  } else if (sourceName === 'google') {
    source = 'google-paid';
  } else if (sourceName === 'tiktok') {
    source = 'tiktok-paid';
  } else if (fbclid) {
    source = 'meta-paid';
  } else if (gclid) {
    source = 'google-paid';
  } else if (ttclid) {
    source = 'tiktok-paid';
  } else if (/cpc|paid|paidsocial|social/i.test(utmMedium)) {
    if (/^(facebook|fb|meta|instagram|ig)$/i.test(utmSource)) source = 'meta-paid';
    else if (/^(google|youtube)$/i.test(utmSource)) source = 'google-paid';
    else if (/^tiktok$/i.test(utmSource)) source = 'tiktok-paid';
    else source = 'other-paid';
  } else if (/^(email|newsletter|klaviyo|mailchimp)$/i.test(utmSource)) {
    source = 'email';
  } else if (/^tiktok$/i.test(utmSource)) {
    // Tagged as TikTok but utm_medium isn't cpc/paid (e.g. organic share
    // from a TikTok creator). Still a TikTok-paid attribution under our
    // model because the click came from a paid placement — TikTok organic
    // doesn't generate utm_source=tiktok tagging in practice; only paid
    // creative does.
    source = 'tiktok-paid';
  } else if (utmSource) {
    // Tagged but unrecognised (influencer / partner / etc.)
    source = 'other-paid';
  } else if (/(facebook|fb|instagram|ig)\.com/.test(ref)) {
    source = 'meta-organic';
  } else if (/(google|youtube)\.com/.test(ref)) {
    source = 'google-organic';
  } else if (/tiktok\.com/.test(ref)) {
    // Organic TikTok referrer (someone shared the product link on TikTok
    // and a viewer clicked through). Treated as other-referral rather
    // than tiktok-paid — we keep tiktok-paid for ad-attributed traffic
    // only (ttclid / utm_source=tiktok). Future Phase D may split this
    // into 'tiktok-organic' if useful; for now 'other-referral' keeps
    // the source taxonomy clean.
    source = 'other-referral';
  } else if (ref) {
    source = 'other-referral';
  } else {
    source = 'direct';
  }

  // Keep referring site short for storage. Matches Apps Script line 987.
  const refTrimmed = ref.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 120);

  return {
    source,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmId,
    utmTerm,
    fbclidPresent: fbclid,
    gclidPresent: gclid,
    referrer: refTrimmed,
  };
}

/**
 * Compute the per-line-item CAD breakdown for a single order. Returns an
 * array of `{p, u, r}` (compact keys per Apps Script Shopify.gs:887 + the
 * postgresReaders.ts:101-120 parser shape).
 *
 * All 3 stores are CAD-native, so `li.price` is already in CAD. The
 * proportional split allocates order-level adjustments (tax, shipping,
 * discounts) back to line items so the lineItems[].r sums to ~totalCad.
 *
 * Three guards (Apps Script Pitfalls 1, 2, A4):
 *   1. Skip items with null/empty `product_id` (custom items, deleted
 *      products) — they can never match a mapped campaign anyway.
 *   2. If `sum(price × qty) === 0` (rare: 100%-discount / free-gift), spread
 *      `totalCad` equally across items instead of dividing by zero.
 *   3. Round each lineCad to 2 decimals so the JSONB stays compact.
 */
function computeLineItemsCad(
  order: ShopifyOrderPayload,
  totalCad: number,
): Array<{ p: string; u: number; r: number }> {
  const items = order.line_items ?? [];
  if (items.length === 0) return [];

  const subtotal = items.reduce((s, li) => {
    const price = parseFloat(String(li.price ?? '0')) || 0;
    const qty = parseInt(String(li.quantity ?? '0'), 10) || 0;
    return s + price * qty;
  }, 0);

  const useFlatSpread = !(subtotal > 0);

  const out: Array<{ p: string; u: number; r: number }> = [];
  for (const li of items) {
    const pid = li.product_id != null ? String(li.product_id) : '';
    if (!pid) continue; // Guard 1
    const qty = parseInt(String(li.quantity ?? '0'), 10) || 0;
    const price = parseFloat(String(li.price ?? '0')) || 0;
    const lineGross = price * qty;
    const lineCad = useFlatSpread
      ? items.length > 0
        ? totalCad / items.length
        : 0
      : (lineGross / subtotal) * totalCad;
    out.push({ p: pid, u: qty, r: Math.round(lineCad * 100) / 100 });
  }
  return out;
}

/**
 * Phase 05.6.1 — order attribution rows for a single day.
 *
 * Port of `Shopify.gs:757` (`getShopifyOrdersAttribution`). Returns one row
 * per non-test, non-voided order created on `dateStr`. Each row carries:
 *   - the order's CAD total (`current_total_price` — D-A1 already deducts
 *     same-day refunds; cross-day refunds are NOT subtracted here because the
 *     `orders_attribution` table is order-level, not net-revenue)
 *   - the classified attribution source (see `classifyOrderAttribution`)
 *   - UTM params + fbclid/gclid presence flags
 *   - per-line-item CAD breakdown (compact `{p,u,r}` JSON for storage; the
 *     reader at postgresReaders.ts:101 maps it back to the dashboard shape)
 *
 * Day boundaries use `isoLocalMidnight(dateStr, SHOPIFY_TZ)` — same
 * Asia/Jerusalem convention as the orders+refunds fetcher above.
 *
 * Pagination via `Link: <...>; rel="next"` header, cap at PAGINATION_CAP.
 */
export async function fetchShopifyOrdersAttribution(
  storeId: string,
  dateStr: string,
): Promise<ShopifyOrderRow[]> {
  const { domain, token } = await getShopifyCreds(storeId);

  const dayStart = isoLocalMidnight(dateStr, SHOPIFY_TZ);
  const dayEnd = isoLocalMidnight(nextDayStr(dateStr), SHOPIFY_TZ);
  const fields =
    'id,current_total_price,financial_status,test,landing_site,referring_site,' +
    'note_attributes,source_name,line_items';

  let url: string | undefined =
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
    `?status=any&financial_status=any&limit=250` +
    `&created_at_min=${encodeURIComponent(dayStart)}` +
    `&created_at_max=${encodeURIComponent(dayEnd)}` +
    `&fields=${fields}`;

  const out: ShopifyOrderRow[] = [];
  let pages = 0;

  while (url && pages < PAGINATION_CAP) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => '');
      throw new Error(
        `Shopify orders-attribution ${storeId} ${dateStr} failed ` +
          `(${res.status}): ${bodyTxt.slice(0, 200)}`,
      );
    }

    const body = (await res.json()) as { orders?: ShopifyOrderPayload[] };
    const orders = body?.orders ?? [];

    for (const o of orders) {
      if (o.test) continue;
      if (o.financial_status === 'voided') continue;

      const totalCad = parseFloat(String(o.current_total_price ?? '0')) || 0;
      const classified = classifyOrderAttribution(o);

      out.push({
        storeId,
        orderId: String(o.id ?? ''),
        date: dateStr,
        totalCad,
        source: classified.source,
        utmSource: classified.utmSource || null,
        utmMedium: classified.utmMedium || null,
        utmCampaign: classified.utmCampaign || null,
        utmContent: classified.utmContent || null,
        fbclidPresent: classified.fbclidPresent,
        gclidPresent: classified.gclidPresent,
        referrer: classified.referrer || null,
        utmId: classified.utmId || null,
        utmTerm: classified.utmTerm || null,
        lineItems: computeLineItemsCad(o, totalCad),
      });
    }

    url = parseNextLink(res.headers);
    pages++;
  }

  if (pages >= PAGINATION_CAP && url) {
    console.warn(
      `Shopify orders-attribution ${storeId} ${dateStr}: hit pagination cap ` +
        `of ${PAGINATION_CAP} pages (${out.length} orders collected); data ` +
        `beyond may be missing.`,
    );
  }

  return out;
}
