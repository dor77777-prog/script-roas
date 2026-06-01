import type { DateRange } from './dateRange';

/**
 * Data-correctness gate (2026-06-01) for the Campaigns-tab
 * "התאמת שיוך · Meta & Google & TikTok ↔ Shopify" attribution-reconciliation
 * panel (`attributionGap` in CampaignsTable.tsx).
 *
 * The panel reconciles a PLATFORM claim (Σ conversionValue from /api/campaigns,
 * SWR-keyed on the in-table `localRange`) against SHOPIFY revenue. As of the
 * 2026-06-01 data-visibility fix the Shopify side is ALSO fetched from /api/data
 * keyed on the SAME `localRange` (the `localDailyResp` SWR call in
 * CampaignsTable), with a first-paint fallback to the page-global `dailyRows`
 * prop (covered by the global `range`) until that local fetch settles. Those two
 * sources still settle on a new window at slightly DIFFERENT times after a date
 * change, so for one-or-more render cycles they can describe DIFFERENT windows —
 * producing the operator-reported "unrelated numbers" (bogus over/under-count
 * gap %, reliability ratio) that self-correct only after a refetch.
 *
 * Returns `true` only when both halves are provably coherent:
 *   (1) the campaigns `data` currently in hand was fetched for the SAME
 *       `localRange` we're about to compare (`campaignsDataRange` snapshot) —
 *       a stale cached SWR response for the previous key fails this; AND
 *   (2) `globalRange` fully contains `localRange`. Once the localRange-keyed
 *       Shopify fetch has settled, the call site passes `globalRange: localRange`
 *       so this is trivially satisfied — gate 2 then only matters during the
 *       FIRST-PAINT FALLBACK window, where it still guards the global-`range`-
 *       bounded `dailyRows` prop against a localRange that reaches outside it.
 *
 * Pure + side-effect-free so it can be unit-tested without mounting the table
 * (which pulls in recharts/lucide and won't load under the node test env).
 */
export function isReconciliationCoherent(args: {
  /** The in-table date picker window the panel is being computed for. */
  localRange: DateRange;
  /** Window the page-global /api/data (dailyRows) was fetched for. */
  globalRange: DateRange;
  /**
   * Window the campaigns /api/data currently in hand was fetched for. `null`
   * until the first campaigns response settles. A stale cached SWR response
   * for the previous key leaves this on the OLD window → not coherent.
   */
  campaignsDataRange: DateRange | null;
}): boolean {
  const { localRange, globalRange, campaignsDataRange } = args;
  // (1) platform side must match the window we're comparing.
  if (
    !campaignsDataRange ||
    campaignsDataRange.from !== localRange.from ||
    campaignsDataRange.to !== localRange.to
  ) {
    return false;
  }
  // (2) Shopify side (dailyRows ⊆ globalRange) must fully cover localRange.
  if (localRange.from < globalRange.from || localRange.to > globalRange.to) {
    return false;
  }
  return true;
}
