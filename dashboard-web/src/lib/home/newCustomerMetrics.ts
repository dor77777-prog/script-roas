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
 *
 * Wave 1: `ncRevenue` is re-based onto the NET basis via the optional blended
 * `netAdjust` factor (gross→net, default 1 = no adjustment), so NC-ROAS sits on
 * the same basis as the headline net MER. nCAC/ncOrders are count-based and
 * therefore untouched by the factor. A two-stage `confidence` gate is derived
 * from `unclassifiableShare` (see NC_CONFIDENCE_LOW / NC_CONFIDENCE_SUPPRESS).
 */

export interface FirstOrderInput {
  /** Store display name — used by the optional `storeName` scope filter. */
  storeName: string;
  /** Immutable CAD order total (orders_attribution.total_cad). */
  totalCad: number;
  /** true = first-order-EVER; false = returning; null = unclassifiable. */
  isFirstOrder: boolean | null;
}

/** Unclassifiable share > this → "low confidence" badge on NC-ROAS. */
export const NC_CONFIDENCE_LOW = 0.20;
/** Unclassifiable share > this → suppress the ratio ("not enough data"). */
export const NC_CONFIDENCE_SUPPRESS = 0.40;
export type NcConfidence = 'ok' | 'low' | 'suppressed';

export interface NewCustomerMetrics {
  /**
   * Σ totalCad where isFirstOrder === true, re-based to NET by the blended
   * net-adj factor (Wave 1) so it sits on the same basis as the headline net
   * MER. With factor 1 (degraded / no adjustment) this is the gross sum.
   */
  ncRevenue: number;
  /** Count where isFirstOrder === true. */
  ncOrders: number;
  /** Count where isFirstOrder === false (returning customers). new + returning + unclassifiable = total. */
  returningOrders: number;
  /** ncRevenue / merSpend; null when merSpend <= 0 or ncRevenue === 0. */
  ncRoas: number | null;
  /** merSpend / ncOrders; null when ncOrders === 0. */
  nCac: number | null;
  /** (#isFirstOrder===null) / total; 0 when there are no rows. */
  unclassifiableShare: number;
  /**
   * Two-stage gate derived from unclassifiableShare:
   * `> NC_CONFIDENCE_SUPPRESS` → 'suppressed' (hide ratio),
   * `> NC_CONFIDENCE_LOW` → 'low' (badge), else 'ok'.
   */
  confidence: NcConfidence;
}

export function computeNewCustomerMetrics(
  rows: FirstOrderInput[],
  merSpend: number | null,
  storeName?: string,
  netAdjust: number = 1,
): NewCustomerMetrics {
  const scoped = storeName ? rows.filter((r) => r.storeName === storeName) : rows;

  let ncRevenue = 0;
  let ncOrders = 0;
  let returning = 0;
  let unclassifiable = 0;
  for (const r of scoped) {
    if (r.isFirstOrder === true) {
      ncRevenue += Number.isFinite(r.totalCad) ? r.totalCad : 0;
      ncOrders += 1;
    } else if (r.isFirstOrder === false) {
      returning += 1;
    } else if (r.isFirstOrder === null) {
      unclassifiable += 1;
    }
  }

  const spend = merSpend != null && Number.isFinite(merSpend) ? merSpend : 0;
  const adjFactor = Number.isFinite(netAdjust) ? netAdjust : 1;
  const ncRevenueNet = ncRevenue * adjFactor;
  const ncRoas = spend > 0 && ncRevenueNet > 0 ? ncRevenueNet / spend : null;
  const nCac = ncOrders > 0 ? spend / ncOrders : null;
  const unclassifiableShare = scoped.length > 0 ? unclassifiable / scoped.length : 0;
  const confidence: NcConfidence =
    unclassifiableShare > NC_CONFIDENCE_SUPPRESS ? 'suppressed'
    : unclassifiableShare > NC_CONFIDENCE_LOW ? 'low'
    : 'ok';

  return { ncRevenue: ncRevenueNet, ncOrders, returningOrders: returning, ncRoas, nCac, unclassifiableShare, confidence };
}
