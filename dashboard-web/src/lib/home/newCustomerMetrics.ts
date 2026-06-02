/**
 * Phase 3 — pure NC-ROAS / nCAC adapter.
 *
 * NC-ROAS = new-customer revenue ÷ MER spend; nCAC = MER spend ÷ new-customer
 * orders. The MER spend (`merSpend`) is the MAPPING-AWARE aggregate spend
 * (agg.spend) passed in by the caller — this adapter NEVER recomputes spend
 * from raw account totals (preserves the campaign↔store↔product mapping).
 *
 * "new customer" = isFirstOrder === true (first-order-EVER). Guest checkouts
 * (isFirstOrder === null) are surfaced as `unclassifiableShare`, NEVER folded
 * into new or returning. ncRoas is null when merSpend <= 0 (no meaningful
 * ratio) OR ncRevenue === 0 with no orders; nCac is null when ncOrders === 0.
 */

export interface FirstOrderInput {
  /** Store display name — used by the optional `storeName` scope filter. */
  storeName: string;
  /** Immutable CAD order total (orders_attribution.total_cad). */
  totalCad: number;
  /** true = first-order-EVER; false = returning; null = unclassifiable. */
  isFirstOrder: boolean | null;
}

export interface NewCustomerMetrics {
  /** Σ totalCad where isFirstOrder === true. */
  ncRevenue: number;
  /** Count where isFirstOrder === true. */
  ncOrders: number;
  /** ncRevenue / merSpend; null when merSpend <= 0 or ncRevenue === 0. */
  ncRoas: number | null;
  /** merSpend / ncOrders; null when ncOrders === 0. */
  nCac: number | null;
  /** (#isFirstOrder===null) / total; 0 when there are no rows. */
  unclassifiableShare: number;
}

export function computeNewCustomerMetrics(
  rows: FirstOrderInput[],
  merSpend: number | null,
  storeName?: string,
): NewCustomerMetrics {
  const scoped = storeName ? rows.filter((r) => r.storeName === storeName) : rows;

  let ncRevenue = 0;
  let ncOrders = 0;
  let unclassifiable = 0;
  for (const r of scoped) {
    if (r.isFirstOrder === true) {
      ncRevenue += Number.isFinite(r.totalCad) ? r.totalCad : 0;
      ncOrders += 1;
    } else if (r.isFirstOrder === null) {
      unclassifiable += 1;
    }
  }

  const spend = merSpend != null && Number.isFinite(merSpend) ? merSpend : 0;
  const ncRoas = spend > 0 && ncRevenue > 0 ? ncRevenue / spend : null;
  const nCac = ncOrders > 0 ? spend / ncOrders : null;
  const unclassifiableShare = scoped.length > 0 ? unclassifiable / scoped.length : 0;

  return { ncRevenue, ncOrders, ncRoas, nCac, unclassifiableShare };
}
