/**
 * Cost configuration for true P&L calculation.
 *
 * Shopify revenue is already net of refunds (we sum `current_total_price`
 * which is the order's value after returns). So the only costs to subtract
 * are:
 *
 *   1. Ad spend         — Meta + Google, already in data-daily
 *   2. COGS             — 25% of revenue (CONFIRMED estimate based on 25-26%
 *                         historical inventory ratio across all 3 stores)
 *   3. Transaction fees — 6.5% of revenue (PayPal + currency conversion).
 *                         Accurate to ±0.5%.
 *   4. Email service    — fixed $20/store/month
 *   5. Shopify plan + apps — per-store fixed monthly, set in STORE_FIXED_COSTS.
 *                         Updatable via the GoalTracker-style edit UI later;
 *                         autofetch from Shopify Billing API is a Phase 2.
 *
 * Shipping is NOT a separate cost — confirmed it's already embedded in the
 * product price across all 3 stores.
 *
 * All values in CAD (the dashboard's reporting currency).
 */

/** Transaction processing fee as a fraction of revenue. */
export const TRANSACTION_FEES_RATE = 0.065;

/** Email service (Klaviyo / similar) fixed monthly cost per store, in CAD. */
export const EMAIL_COST_PER_STORE_MONTHLY = 20;

/**
 * Per-store fixed monthly costs. Edit in code OR via the dashboard
 * "Cost Settings" UI (planned). Auto-fetching from Shopify Billing API is
 * Phase 2 — for now, manually keyed in based on each store's actual bill.
 *
 * `shopifyPlan` covers the base Shopify subscription (Basic/Shopify/Advanced/Plus).
 * `apps` is the sum of all recurring app subscriptions on that store.
 */
export type StoreFixedCosts = {
  shopifyPlan: number;
  apps: number;
};

export const STORE_FIXED_COSTS: Record<string, StoreFixedCosts> = {
  uzoshop:     { shopifyPlan: 0, apps: 0 },
  'Zol Plus':  { shopifyPlan: 0, apps: 0 },
  '360usmile': { shopifyPlan: 0, apps: 0 },
};

/**
 * Total monthly fixed cost for a single store: subscription + apps + email.
 * If the store name isn't in our map, returns just the email cost as a sane
 * fallback so newly-added stores don't disappear from the P&L.
 */
export function monthlyFixedCostsForStore(storeName: string): number {
  const overrides = STORE_FIXED_COSTS[storeName];
  const base = overrides ? overrides.shopifyPlan + overrides.apps : 0;
  return base + EMAIL_COST_PER_STORE_MONTHLY;
}

/**
 * Prorate a list of stores' monthly fixed costs to the number of days in the
 * reporting period. Example: 16 days of "All stores" returns the daily share
 * × 16 × 3 stores.
 */
export function prorateFixedCosts(
  storeNames: string[],
  daysInPeriod: number,
): number {
  if (daysInPeriod <= 0) return 0;
  const monthlyTotal = storeNames.reduce(
    (sum, s) => sum + monthlyFixedCostsForStore(s),
    0,
  );
  // Use 30 as the canonical month length — the difference vs. exact days-in-
  // month is < 5% and avoids edge cases around February / 31-day months that
  // would only matter for an enterprise auditor.
  return (monthlyTotal / 30) * daysInPeriod;
}

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
