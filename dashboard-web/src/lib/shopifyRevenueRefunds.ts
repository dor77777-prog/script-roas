/**
 * KEEP-IN-SYNC with Shopify.gs:getShopifyRefundsForDay_ + getShopifyRevenue +
 * getShopifyProductSalesForDay (Phase 05.2.3.0).
 *
 * This is the pure-TS mirror of the cross-day refund attribution algorithm.
 * Any change to the algorithm must be applied to BOTH files in the same commit.
 * Tests live at dashboard-web/src/lib/__tests__/shopifyRevenueRefunds.test.ts —
 * fixtures derive from
 * .planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/05.2.3.0-PROBE-EVIDENCE.md
 * per D-C4. NO fictional fixtures.
 *
 * === REVISED CONTRACT (2026-05-21) ===
 *
 * The 2026-05-21 empirical probe falsified the original hypothesis that
 * `transactions[].amount` is the store-level deduction (PROBE-EVIDENCE.md
 * §Finding 1: `transactions[].amount` ran 2–4× the order total on 3/3
 * stores because it is denominated in payout/transaction currency and
 * includes duplicate-refund/void artifacts). CONTEXT.md D-B2, D-C1, D-C3
 * were revised before this mirror was written. The corrected invariant
 *   `current_total_price == total_price − Σ refund_line_items[].subtotal`
 * matched 3/3 stores exactly.
 *
 * Decision-ID citations applied in this file:
 * - D-A1: current_total_price is net of intra-order refunds (AUDIT-P0-03).
 * - D-A2: cross-day filter is `refund.processed_at on D AND order.created_at NOT on D`.
 *         Same-day refunds are already in current_total_price and must NOT
 *         be subtracted again (the rolled-back double-deduction trap).
 * - D-A4: all day comparisons use Asia/Jerusalem TZ via Intl.DateTimeFormat.
 * - D-C1 (REVISED): store-level subtracts Σ refund_line_items[].subtotal
 *        across ALL refund_line_items (including null product_id),
 *        NOT transactions[].amount.
 * - D-C2: per-product subtracts refund_line_items[].subtotal grouped by
 *         product_id (skipping null/missing).
 * - D-C3 (REVISED): cross-path reconciliation collapses onto the same field
 *        (no tax/shipping gap). Null-product refunds surface in
 *        customItemRefundCad.
 * - D-D3: result can be negative; no clamping.
 */

type ShopifyLineItem = {
  product_id: string | number | null;
  price: string | number;
  quantity: number;
};

type ShopifyRefundLineItem = {
  product_id: string | number | null;
  subtotal: string | number;
  total?: string | number;
};

type ShopifyRefundTx = { amount: string | number };

type ShopifyRefund = {
  processed_at: string;
  transactions?: ShopifyRefundTx[];
  refund_line_items?: ShopifyRefundLineItem[];
};

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
   *   Σ current_total_price(orders.created_at=D, excl test/voided)
   *   − Σ refund_line_items[].subtotal(refunds.processed_at=D AND order.created_at != D,
   *                                    across ALL refund_line_items including null product_id)
   * D-D3: can be negative; no clamping.
   */
  storeNetCad: number;
  /**
   * Per-product net revenue for day D, keyed by product_id (string form):
   *   (per-pid line gross for orders.created_at=D after intra-order
   *    refund_line_items.subtotal deduction)
   *   − Σ refund_line_items[].subtotal(cross-day, grouped by product_id,
   *                                    skipping null/missing product_id).
   * Null/missing product_id refunds are diverted to customItemRefundCad
   * (D-C2 / REVISED D-C3 invariant 3).
   */
  byProduct: Record<string, { netRevenueCad: number }>;
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
  // Object.create(null) avoids prototype-key collisions (IN5-05 convention)
  // — defensive when product_ids could be 'constructor' / '__proto__'.
  const byProduct: Record<string, { netRevenueCad: number }> = Object.create(null);

  function bumpByProduct(pid: string, delta: number): void {
    if (!pid) return; // null/empty pid → caller handles via customItemRefundCad
    if (!byProduct[pid]) byProduct[pid] = { netRevenueCad: 0 };
    byProduct[pid].netRevenueCad += delta;
  }

  for (const o of orders) {
    // D-A1 / D-D4: exclude test and voided orders uniformly across both paths.
    if (o.test === true) continue;
    if (o.financial_status === 'voided') continue;

    const orderCreatedDay = dayInTz(o.created_at, tz);

    // Same-day path: gross + per-product line items, minus intra-order refunds.
    if (orderCreatedDay === dateStr) {
      // D-A1: current_total_price is net of intra-order refunds.
      sameDayGross += parseNum(o.current_total_price);

      // Per-product positive gross = Σ line_items[].price × quantity.
      const lineItems = o.line_items ?? [];
      for (const li of lineItems) {
        const pid = normalizeProductId(li.product_id);
        if (!pid) continue; // custom items have no product_id surface; the
                            // store-level current_total_price already
                            // accounts for them.
        const lineGross = parseNum(li.price) * (parseNum(li.quantity) || 0);
        bumpByProduct(pid, lineGross);
      }

      // Per-product intra-order refund deduction = Σ refund_line_items[].subtotal
      // for refunds whose processed_at falls on the same day as the order
      // (i.e. same-day intra-order refund — already reflected in
      // current_total_price). This keeps per-product net == current_total_price
      // for the same-day order.
      const sameDayRefunds = o.refunds ?? [];
      for (const r of sameDayRefunds) {
        if (!r.processed_at) continue;
        const processedDay = dayInTz(r.processed_at, tz);
        if (processedDay !== dateStr) continue; // we only deduct same-day intra-order here
        const rlis = r.refund_line_items ?? [];
        for (const rli of rlis) {
          const pid = normalizeProductId(rli.product_id);
          if (!pid) continue;
          const amt = parseNum(rli.subtotal);
          bumpByProduct(pid, -amt);
        }
      }
    }

    // Cross-day refund path: refunds processed on D for orders created
    // on any OTHER day (D-A2). These deductions are NOT already in
    // current_total_price (because current_total_price freezes at the
    // moment the refund is applied — and a cross-day refund modifies
    // the prior-day order's row, not today's gross).
    const refunds = o.refunds ?? [];
    for (const r of refunds) {
      if (!r.processed_at) continue;
      const processedDay = dayInTz(r.processed_at, tz);
      if (processedDay !== dateStr) continue;          // refund must be on D
      if (orderCreatedDay === dateStr) continue;       // and order must NOT be on D

      // D-C1 (REVISED) / D-C2: BOTH paths use refund_line_items[].subtotal.
      // transactions[].amount is intentionally IGNORED — see CONTEXT.md
      // D-C1 REVISED and PROBE-EVIDENCE.md §Finding 1.
      const rlis = r.refund_line_items ?? [];
      for (const rli of rlis) {
        // Use subtotal as primary, fall back to total for safety (per
        // existing Shopify.gs pattern, though Finding 2 shows total is
        // always undefined in the live response).
        const amt = parseNum(
          rli.subtotal !== undefined && rli.subtotal !== null
            ? rli.subtotal
            : (rli.total ?? 0),
        );
        const pid = normalizeProductId(rli.product_id);
        storeRefundDeduction += amt;
        if (pid) {
          // D-C2: bucketed by product_id (negative — refund reduces revenue).
          bumpByProduct(pid, -amt);
        } else {
          // REVISED D-C3 invariant 3: null/missing pid goes to the
          // diagnostic custom-item bucket (positive absolute deduction).
          customItemRefundCad += amt;
        }
      }
    }
  }

  // D-D3: no clamping — negative storeNet is a legitimate accounting result
  // when refunds against prior-day orders exceed today's gross.
  const storeNetCad = sameDayGross - storeRefundDeduction;

  return { storeNetCad, byProduct, customItemRefundCad };
}
