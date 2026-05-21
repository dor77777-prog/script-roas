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
 *   - D-C4: `SHOPIFY_API_VERSION = '2024-10'` matches `Config.gs:12`.
 *   - D-A4: TZ = 'Asia/Jerusalem' (passed to algorithm).
 *   - D-D3: no clamping anywhere.
 */

import {
  computeRevenueWithCrossDayRefunds,
  type ShopifyOrderInput,
} from '@/lib/shopifyRevenueRefunds';

// =============================================================================
// Constants
// =============================================================================

/**
 * Shopify Admin REST API version. MUST match `Config.gs:12` exactly per D-C4
 * (algorithm parity demands identical API version → identical response shape).
 * Bumping requires re-validating the algorithm's payload assumptions.
 */
const SHOPIFY_API_VERSION = '2024-10';

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
  const offsetMin = (Date.UTC(
    ...(formatLocalIso(instantMs, tz)
      .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)!
      .slice(1)
      .map(Number) as [number, number, number, number, number, number]),
  ) -
    instantMs) / 60000;
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
 * Build the initial URL for a window query. The Apps Script convention is:
 *   /admin/api/{VER}/orders.json?status=any&limit=250
 *     &{windowField}_min={iso_start}&{windowField}_max={iso_end}
 *     &fields={fields_csv}
 * where windowField is either `created_at` (Window A — same-day gross) or
 * `updated_at` (Window B — cross-day refunds, mirrors Shopify.gs:644-648).
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
  const dayEnd = isoLocalMidnight(nextDayStr(dateStr), SHOPIFY_TZ);
  const fields =
    'id,created_at,total_price,current_total_price,test,financial_status,line_items,refunds';
  return (
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
    `?status=any&limit=250` +
    `&${windowField}_min=${encodeURIComponent(dayStart)}` +
    `&${windowField}_max=${encodeURIComponent(dayEnd)}` +
    `&fields=${fields}`
  );
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
  const upper = storeId.toUpperCase();
  // PROPS-MAP rows 22/25/29/32/35/38 — `${STORE}_SHOPIFY_DOMAIN/_TOKEN`
  const domain = process.env[`${upper}_SHOPIFY_DOMAIN`];
  const token = process.env[`${upper}_SHOPIFY_TOKEN`];

  if (!domain || !token) {
    throw new Error(
      `Missing Shopify creds for store "${storeId}" — expected ` +
        `${upper}_SHOPIFY_DOMAIN and ${upper}_SHOPIFY_TOKEN env vars ` +
        `(per docs/PROPS-MAP.md Phase 05.5).`,
    );
  }

  const orders = await fetchOrdersWithRefundsForDay(
    domain,
    token,
    dateStr,
    storeId,
  );

  const { storeNetCad, byProduct, customItemRefundCad } =
    computeRevenueWithCrossDayRefunds(orders, dateStr, SHOPIFY_TZ);

  const storeName = STORE_NAMES[storeId] ?? storeId;

  return {
    storeId,
    date: dateStr,
    storeName,
    revenueCad: storeNetCad,
    productRows: Object.entries(byProduct).map(([pid, p]) => ({
      product_id: pid,
      net_revenue_cad: p.netRevenueCad,
    })),
    customItemRefundCad,
  };
}
