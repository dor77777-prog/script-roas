/**
 * KEEP-IN-SYNC with Shopify.gs:getShopifyRefundsForDay_ + getShopifyRevenue +
 * getShopifyProductSalesForDay (Phase 05.2.3.0 + gap-closure 08).
 *
 * This is the pure-TS mirror of the refund attribution algorithm. Any change
 * must be applied to BOTH files in the same commit.
 *
 * === LOAD-BEARING INVARIANTS (gap-closure 08, 2026-05-21) ===
 *
 * Three invariants MUST remain identical between Apps Script and this file
 * — drift between them ships a double-deduction bug to production:
 *
 *   1. Store-level gross uses total_price (immutable per Shopify Admin REST
 *      2024-10), NOT current_total_price (which is live and reflects all
 *      refunds applied so far). Under current_total_price + cross-day
 *      filter, every refund within 48h of order creation was deducted
 *      twice once any backfill re-fetched the prior-day row. See CR-01
 *      in 05.2.3.0-REVIEW.md.
 *
 *   2. Refunds attribute to their `processed_at` day exactly ONCE — no
 *      cross-day filter. Same-day and cross-day refunds both deduct on
 *      the refund day. Re-fetching prior-day rows no longer changes their
 *      value because total_price is immutable.
 *
 *   3. Per-product intra-order refund map (refundByLineId in Apps Script;
 *      the same-day path here in TS) is built ONLY from refunds whose
 *      processed_at falls on the same day as the order. A future-day
 *      refund on an order created on day D must NOT be deducted from
 *      day D's per-product net — it deducts on its processed_at day.
 *      See CR-02 in 05.2.3.0-REVIEW.md.
 *
 * Additionally:
 *   - No Math.max(0, …) clamping ANYWHERE — per-line, per-product, and
 *     store-level nets can all go negative (D-D3). See CR-03 in
 *     05.2.3.0-REVIEW.md.
 *   - transactions[].amount is IGNORED (PROBE-EVIDENCE.md §Finding 1 —
 *     ran 2–4× the order total on 3/3 stores, unsafe to deduct).
 *
 * Decision-ID citations applied in this file (post-gap-closure 08):
 * - D-A1: total_price is the immutable gross at order creation.
 * - D-A2 (REVISED gap-closure 08): every refund attributes to its
 *   processed_at day — no cross-day filter anymore.
 * - D-A4: all day comparisons use Asia/Jerusalem TZ via Intl.DateTimeFormat.
 * - D-C1 / D-C2: store-level and per-product both use
 *   refund_line_items[].subtotal.
 * - D-C3 (REVISED): customItemRefundCad surfaces null/missing-pid refunds.
 * - D-D3: no clamping.
 */

type ShopifyLineItem = {
  product_id: string | number | null;
  price: string | number;
  quantity: number;
  /** Optional — first non-empty title encountered seeds bucket.productTitle. */
  title?: string;
  name?: string;
};

type ShopifyRefundLineItem = {
  product_id: string | number | null;
  subtotal: string | number;
  total?: string | number;
};

type ShopifyRefundTx = {
  amount: string | number;
  /**
   * Shopify transaction status — `success`, `failure`, `pending`, `error`.
   * Used by `hasSuccessfulRefundTransaction()` to skip refunds whose
   * underlying payment processor (PayPal, Stripe, …) rejected the
   * refund attempt. See bug report 2026-05-21: usmile360 order
   * 4697724059855 had two `status: failure` PayPal refund attempts
   * (`error_code: processing_error`) for $302.10 each, but the algorithm
   * still subtracted $136.43 from May 20 revenue because the
   * `refund_line_items` were populated regardless of whether money
   * actually moved. The Apps Script original (Phase 05.2.3.0) had the
   * same defect; the TS port inherited it via the 1:1 mirror.
   */
  status?: string;
};

type ShopifyRefund = {
  processed_at: string;
  transactions?: ShopifyRefundTx[];
  refund_line_items?: ShopifyRefundLineItem[];
};

/**
 * Returns true if the refund actually moved money. The bug we're fixing
 * (2026-05-21) is the modern case where `transactions[]` is populated
 * with EXPLICIT `status: 'failure'` entries (e.g., PayPal refund attempt
 * rejected) but the algorithm still subtracted the refund_line_items.
 *
 * Conservative legacy behaviour: treat a missing `transactions` array
 * (length 0), or transactions that lack a `status` field, as legitimate.
 * Sparse/older Shopify orders sometimes ship without the status field,
 * and we'd rather over-count those than silently drop them. Only skip
 * when the array is populated AND every entry has a non-empty status
 * that is explicitly not 'success'.
 */
function hasSuccessfulRefundTransaction(r: ShopifyRefund): boolean {
  const txs = r.transactions ?? [];
  if (txs.length === 0) return true; // legacy / missing — assume real
  return txs.some((t) => {
    const s = (t.status ?? '').toLowerCase();
    // Missing/blank status → legacy data, treat as success.
    // Explicit 'success' → real.
    // Anything else ('failure', 'pending', 'error') → not yet money.
    return s === '' || s === 'success';
  });
}

export type ShopifyOrderInput = {
  id: string | number;
  created_at: string;
  total_price?: string | number;
  current_total_price: string | number;
  test?: boolean;
  financial_status?: string;
  line_items?: ShopifyLineItem[];
  refunds?: ShopifyRefund[];
};

export type CrossDayRefundResult = {
  /**
   * Store-level net revenue for day D:
   *   Σ total_price(orders.created_at=D, excl test/voided)
   *   − Σ refund_line_items[].subtotal(refunds.processed_at=D,
   *                                    across ALL refund_line_items including null product_id,
   *                                    regardless of when the order was created)
   * D-D3: can be negative; no clamping.
   *
   * Gap-closure 08 model change: total_price is immutable, so re-fetching
   * prior-day rows is mathematically safe (no double-deduction risk).
   */
  storeNetCad: number;
  /**
   * Per-product net revenue for day D, keyed by product_id (string form):
   *   (per-pid line gross for orders.created_at=D after intra-order
   *    refund_line_items.subtotal deduction)
   *   − Σ refund_line_items[].subtotal(refunds.processed_at=D on
   *                                    NON-same-day orders, grouped by
   *                                    product_id, skipping null/missing pid).
   * Bug #6 fix (2026-06-20): same-day orders' refunds are subtracted ONCE
   * (in the intra-order loop only) — the refund-day attribution loop skips
   * per-product for same-day orders to avoid the gross−2×refund double-count.
   * Null/missing product_id refunds are diverted to customItemRefundCad
   * (D-C2 / REVISED D-C3 invariant 3).
   */
  byProduct: Record<
    string,
    {
      /** Net revenue after refund-line-items subtraction (refund-day attribution). */
      netRevenueCad: number;
      /**
       * Gross revenue for D — sum of (line.price × line.quantity) across
       * same-day orders for this product, BEFORE any refund subtraction.
       * Used by the UI to render refund % as `(1 − net/gross)` (see
       * `ProductsTable.tsx` "הנחות/החזרים" tooltip). 2026-05-21: added
       * to fix the all-products-show-0%-refund regression after the
       * Postgres cut-over.
       */
      grossRevenueCad: number;
      /** Sum of line.quantity for this product across same-day orders. */
      units: number;
      /** Distinct same-day orders that contain this product. */
      orders: number;
      /** First non-empty title encountered for this product_id (best-effort label). */
      productTitle: string;
    }
  >;
  /**
   * Sum of refund_line_items[].subtotal where product_id is null or empty,
   * for refunds.processed_at == D AND order.created_at != D. POSITIVE value
   * (absolute deduction). Diagnostic surface — typically zero in practice
   * (custom items / manual adjustments are rare). REVISED D-C3 invariant 3
   * collapses the cross-path gap onto this single bucket; there is no
   * tax/shipping reconciliation gap (both store and per-product paths use
   * the same refund_line_items[].subtotal field).
   */
  customItemRefundCad: number;
  /**
   * Σ total_price for orders created on D (BEFORE refund subtraction).
   * Used by the UI to render the gross revenue alongside net, and to compute
   * `refund_deduction_cad = gross - net` for the refund indicator badge
   * (bug fix 2026-05-21: dashboard tables now show both numbers so days with
   * material refunds can be flagged with a chip + tooltip).
   *
   * Equals `storeNetCad + storeRefundDeductionCad` exactly.
   */
  storeGrossCad: number;
  /**
   * Σ refund_line_items[].subtotal for refunds.processed_at = D (POSITIVE
   * value; equals `storeGrossCad − storeNetCad`). Surfaced separately so the
   * dashboard can render the refund-day indicator with the actual subtracted
   * amount, not just a boolean "had refunds" flag.
   */
  storeRefundDeductionCad: number;
};

/**
 * Compute the local YYYY-MM-DD date string for an ISO timestamp in the given
 * TZ. Mirrors Apps Script's `Utilities.formatDate(new Date(ts), TZ, 'yyyy-MM-dd')`
 * (D-A4 — all day comparisons use Asia/Jerusalem).
 */
function dayInTz(ts: string, tz: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  // Intl.DateTimeFormat with 'en-CA' produces 'YYYY-MM-DD' shape.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

function parseNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeProductId(raw: unknown): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  return s;
}

export function computeRevenueWithCrossDayRefunds(
  orders: ShopifyOrderInput[],
  dateStr: string,
  tz: string = 'Asia/Jerusalem',
): CrossDayRefundResult {
  let sameDayGross = 0;
  let storeRefundDeduction = 0;
  let customItemRefundCad = 0;
  // Object.create(null) avoids prototype-key collisions (IN5-05 convention).
  type ProductBucket = {
    netRevenueCad: number;
    grossRevenueCad: number;
    units: number;
    orders: number;
    productTitle: string;
  };
  const byProduct: Record<string, ProductBucket> = Object.create(null);

  function ensureBucket(pid: string): ProductBucket {
    if (!byProduct[pid]) {
      byProduct[pid] = {
        netRevenueCad: 0,
        grossRevenueCad: 0,
        units: 0,
        orders: 0,
        productTitle: '',
      };
    }
    return byProduct[pid];
  }

  function bumpByProduct(pid: string, delta: number): void {
    if (!pid) return; // null/empty pid → caller handles via customItemRefundCad
    ensureBucket(pid).netRevenueCad += delta;
  }

  /**
   * Record the same-day line item: bump both gross and net by line.price ×
   * line.quantity, increment units, and capture title if not yet set.
   */
  function recordSameDayLine(
    pid: string,
    lineGross: number,
    quantity: number,
    title: string,
  ): void {
    if (!pid) return;
    const b = ensureBucket(pid);
    b.grossRevenueCad += lineGross;
    b.netRevenueCad += lineGross;
    b.units += quantity;
    if (!b.productTitle && title) b.productTitle = title;
  }

  for (const o of orders) {
    // D-A1 / D-D4: exclude test and voided orders uniformly.
    if (o.test === true) continue;
    if (o.financial_status === 'voided') continue;

    // gap-closure 08: day-string of order creation in TZ (used only to
    // gate the same-day-order branch below; NO cross-day filter on refunds).
    const isSameDayOrder = dayInTz(o.created_at, tz) === dateStr;

    // === Same-day order path ===
    // gap-closure 08: gross uses total_price (immutable), NOT current_total_price.
    if (isSameDayOrder) {
      // Invariant 1: total_price is immutable gross.
      sameDayGross += parseNum(o.total_price);

      // Per-product line gross = Σ price × quantity. (Line-level discounts
      // are not present in the narrow type — they're folded into the
      // intra-order refund_line_items.subtotal in practice for the
      // probe fixtures. Match this to Apps Script:
      //   line_gross = qty * price  (no total_discount visible in TS shape)
      //   line_net   = line_gross - intra_order_refund_subtotal
      // Apps Script subtracts line_discount AND refund_subtotal — when
      // line_discount is not modeled in TS, the test fixtures provide
      // current_total_price that already nets discounts, and per-product
      // net = line_gross - intra_order_refund.)
      const lineItems = o.line_items ?? [];
      // 2026-05-21: track gross + units + orders + title on the bucket so the
      // dashboard can render refund % (1 − net/gross) and per-product
      // unit/order counts. Previously only netRevenueCad was tracked, so
      // gross_revenue_cad stayed null in Supabase and the UI's refund %
      // formula degenerated to 0%.
      const productsThisOrder = new Set<string>();
      for (const li of lineItems) {
        const pid = normalizeProductId(li.product_id);
        if (!pid) continue;
        const qty = parseNum(li.quantity) || 0;
        const lineGross = parseNum(li.price) * qty;
        const title = (li.title ?? li.name ?? '').toString().trim();
        recordSameDayLine(pid, lineGross, qty, title);
        productsThisOrder.add(pid);
      }
      for (const pid of productsThisOrder) {
        ensureBucket(pid).orders += 1;
      }

      // Invariant 3: intra-order refundByLineId filtered to processed_at == dateStr.
      // A future-day refund on a same-day order must NOT deduct from same-day
      // per-product net — it deducts on its processed_at day via the
      // refund-day attribution loop below.
      //
      // Bug fix 2026-05-21: also skip refunds whose transactions all failed
      // (e.g., PayPal refund attempt rejected with `processing_error`).
      // The refund_line_items still exist in failed attempts but no money
      // actually moved, so subtracting them inflates the deduction.
      const sameDayRefunds = o.refunds ?? [];
      for (const r of sameDayRefunds) {
        if (!r.processed_at) continue;
        const processedDay = dayInTz(r.processed_at, tz);
        if (processedDay !== dateStr) continue;
        if (!hasSuccessfulRefundTransaction(r)) continue; // bug fix 2026-05-21
        const rlis = r.refund_line_items ?? [];
        for (const rli of rlis) {
          const pid = normalizeProductId(rli.product_id);
          if (!pid) continue;
          const amt = parseNum(rli.subtotal);
          bumpByProduct(pid, -amt);
        }
      }
    }

    // === Refund-day attribution path (gap-closure 08 model change) ===
    // Invariant 2: EVERY refund processed on day D deducts here. No cross-day
    // filter. Same-day refunds previously absorbed by current_total_price now
    // deduct here because the gross above uses total_price (immutable).
    const refunds = o.refunds ?? [];
    for (const r of refunds) {
      if (!r.processed_at) continue;
      const processedDay = dayInTz(r.processed_at, tz);
      if (processedDay !== dateStr) continue;  // refund must be on D
      // gap-closure 08: cross-day short-circuit DROPPED. Same-day refunds
      // count here too, because the gross above uses total_price
      // (immutable), so the same-day refund is NOT absorbed by gross.
      // Bug fix 2026-05-21: skip refunds where the underlying transactions
      // all failed (e.g., PayPal `status:failure` with `error_code:
      // processing_error`). No money actually moved, so the
      // refund_line_items[].subtotal must not deduct from revenue.
      // See `hasSuccessfulRefundTransaction()` for the legacy-data fallback
      // (refunds with empty/missing transactions[] still count, to avoid
      // breaking older orders that never populated the field).
      if (!hasSuccessfulRefundTransaction(r)) continue;

      // D-C1 / D-C2: BOTH paths use refund_line_items[].subtotal.
      // transactions[].amount is intentionally IGNORED for the AMOUNT;
      // the new transaction-status filter above gates WHETHER to count
      // this refund at all.
      const rlis = r.refund_line_items ?? [];
      for (const rli of rlis) {
        const amt = parseNum(
          rli.subtotal !== undefined && rli.subtotal !== null
            ? rli.subtotal
            : (rli.total ?? 0),
        );
        const pid = normalizeProductId(rli.product_id);
        // Store-level and null-pid customItem deductions are ALWAYS counted
        // here (the same-day intra-order loop above skips null-pid and never
        // touches store/customItem) — keep them unconditional.
        storeRefundDeduction += amt;
        if (pid) {
          // Bug #6 fix (2026-06-20): for a SAME-DAY order, the intra-order
          // refund loop above already called bumpByProduct(pid, -amt) for this
          // exact refund (same processed_at == dateStr filter). Subtracting
          // again here double-deducts the per-product net (byProduct[pid] =
          // gross − 2×refund), which flows straight into
          // products_daily.net_revenue_cad via fetchShopifyDayRows. Only
          // subtract here when the order is NOT same-day.
          if (!isSameDayOrder) {
            bumpByProduct(pid, -amt);
          }
        } else {
          customItemRefundCad += amt;
        }
      }
    }
  }

  // D-D3: no clamping. Negative storeNet is legitimate.
  const storeNetCad = sameDayGross - storeRefundDeduction;

  return {
    storeNetCad,
    byProduct,
    customItemRefundCad,
    storeGrossCad: sameDayGross,
    storeRefundDeductionCad: storeRefundDeduction,
  };
}
