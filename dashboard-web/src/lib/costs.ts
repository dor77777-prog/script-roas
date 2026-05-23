/**
 * Cost configuration for true P&L calculation.
 *
 * Shopify revenue is already net of refunds (we sum `current_total_price`
 * which is the order's value after returns). So the only costs to subtract
 * are:
 *
 *   1. Ad spend         — Meta + Google, already in data-daily
 *   2. COGS             — per-store calibration via `${STORE}_COGS_RATE`
 *                         env var, default 0.25. Set both at the write side
 *                         (cron-daily / cron-live) and the read side
 *                         (analytics.ts:getCogsRateForStore) so the dashboard
 *                         and the underlying rows agree on every store.
 *   3. Transaction fees — per-store calibration via `${STORE}_TX_FEES_RATE`
 *                         env var, default 0.065 (PayPal + currency conv).
 *                         Computed at the read side (analytics.ts) since the
 *                         cron-daily write doesn't persist a fees column.
 *   4. Recurring billing entries — managed by the operator via the
 *                         BillingSettings UI (billing.ts:billingForRange).
 *                         Replaces the legacy hardcoded STORE_FIXED_COSTS.
 *
 * Shipping is NOT a separate cost — confirmed it's already embedded in the
 * product price across all 3 stores.
 *
 * All values in CAD (the dashboard's reporting currency).
 *
 * Audit fix 2026-05-23 (d/HI-01): deleted the unused STORE_FIXED_COSTS map +
 * `monthlyFixedCostsForStore` + `prorateFixedCosts`. These were superseded by
 * the BillingSettings UI (Phase 4 — billing.ts) but the dead module-scope
 * declarations remained, fooling new readers into thinking the dashboard had
 * a fallback hardcoded per-store fixed-cost table (it doesn't — the seed
 * billing data covers the gap when the operator hasn't entered anything).
 * Verified via grep before deletion: no callers anywhere in src/.
 */

/** Transaction processing fee as a fraction of revenue. */
export const TRANSACTION_FEES_RATE = 0.065;

/** Email service (Klaviyo / similar) fixed monthly cost per store, in CAD. */
export const EMAIL_COST_PER_STORE_MONTHLY = 20;

/**
 * Compute the full P&L line items for a single aggregate of rows.
 * Pure function — no React, no fetching.
 */
export function buildPnLBreakdown(input: {
  revenue: number;
  adSpend: number;
  cogs: number;
  fixedCostsForPeriod: number;
}): {
  revenue: number;
  adSpend: number;
  cogs: number;
  transactionFees: number;
  fixedCosts: number;
  trueNetProfit: number;
  margin: number;
} {
  const { revenue, adSpend, cogs, fixedCostsForPeriod } = input;
  const transactionFees = revenue * TRANSACTION_FEES_RATE;
  const trueNetProfit =
    revenue - adSpend - cogs - transactionFees - fixedCostsForPeriod;
  const margin = revenue > 0 ? trueNetProfit / revenue : 0;
  return {
    revenue,
    adSpend,
    cogs,
    transactionFees,
    fixedCosts: fixedCostsForPeriod,
    trueNetProfit,
    margin,
  };
}
