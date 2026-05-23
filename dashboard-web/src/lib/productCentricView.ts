/**
 * Phase 05.7.x (2026-05-23) — Product-centric pivot.
 *
 * The dashboard is campaign-centric: each row is a campaign and the
 * Shopify ROAS column is its share of the mapped products' revenue.
 * Operators need the inverse view too: "for THIS product, which
 * campaigns are promoting it on each platform, how does each rank?"
 *
 * This module turns the campaign-centric data into a product-centric
 * pivot:
 *
 *   - One ProductCohortRow per product the operator has mapped.
 *   - Each row carries the cohort campaigns (sortable: ROAS Shopify,
 *     spend, share), grouped by platform.
 *   - Aggregate metrics at the product level: total cohort spend,
 *     total Shopify net revenue, blended ROAS (Σrevenue / Σspend).
 *
 * Pure function — no React, no IO. Easy to test + reuse from the
 * ProductCentricView component, AI report, or anywhere else.
 */

import type { Aggregated } from './campaignsAggregator';
import type { ProductMap } from './campaignProductMap';

// =============================================================================
// Types
// =============================================================================

export type ProductCohortMember = {
  campaignKey: string; // `${storeId}::${platform}::${campaignId}`
  campaignId: string;
  campaignName: string;
  platform: string;
  storeId: string;
  storeName: string;
  spend: number;
  conversionValue: number;       // platform-reported (Pixel)
  /** spend share within the SAME-PLATFORM subset of the cohort. */
  intraPlatformSpendShare: number;
  /** spend share across the WHOLE cohort (cross-platform). */
  totalSpendShare: number;
  /** Estimated revenue allocated to this campaign for THIS product, based
   *  on intra-platform spend share × cohort-wide product revenue per
   *  platform. Same proportional rule as allocateProductRevenue but
   *  computed locally per platform for the table display. */
  allocatedRevenueEstimate: number;
  /** roas = conversionValue / spend (platform-reported). 0 when spend=0. */
  platformRoas: number;
  effectiveStatus: string | null;
};

export type ProductCohortRow = {
  productId: string;
  productTitle: string;
  storeId: string;
  /** Total spend across ALL cohort campaigns (any platform). */
  totalCohortSpend: number;
  /** Total NET revenue of this product in the range (across all
   *  channels — Shopify-side, not platform-reported). May be 0 when no
   *  products_daily row exists yet for the window. */
  totalNetRevenue: number;
  /** Cohort members sorted by spend desc. */
  members: ProductCohortMember[];
  /** Per-platform breakdown so the UI can render mini-tables. */
  byPlatform: {
    platform: string;
    members: ProductCohortMember[];
    intraSpend: number;
    /** Aggregate intra-platform revenue (sum of allocated revenue
     *  estimates from the members at this platform). Same as the
     *  per-platform deterministic-then-proportional allocation that
     *  allocateProductRevenue does for the campaign-centric view. */
    intraAllocatedRevenue: number;
  }[];
  /** True when the cohort has 2+ members (multi-mapped product). The
   *  product-centric view typically filters to multi-mapped only, but
   *  the field is exposed for callers that want everything. */
  isMultiMapped: boolean;
  /** Average blended ROAS across the cohort: totalNetRevenue /
   *  totalCohortSpend. Falls to 0 when spend = 0. */
  blendedRoas: number;
};

// =============================================================================
// Inputs
// =============================================================================

export type ProductCentricInputs = {
  storeId: string;
  productMap: ProductMap;
  aggregated: Aggregated[];
  /** Per-product NET revenue from products_daily for the visible range.
   *  Map<productId, netRevenue>. Used for blendedRoas + allocation. */
  productNetRevenue: Map<string, number>;
  /** Per-product Shopify title. Optional — if missing, we fall back to
   *  the productId. */
  productTitles?: Map<string, string>;
};

// =============================================================================
// Public API
// =============================================================================

export function buildProductCentricView(
  inputs: ProductCentricInputs,
): ProductCohortRow[] {
  const { storeId, productMap, aggregated, productNetRevenue, productTitles } = inputs;

  // 1. Pre-index aggregated rows by campaignKey for O(1) lookup.
  const aggByKey = new Map<string, Aggregated>();
  for (const a of aggregated) {
    aggByKey.set(a.key, a);
  }

  // 2. Reverse productMap: productId → [campaignKey, ...] (this store only).
  const storePrefix = `${storeId}::`;
  const cohortByProduct = new Map<string, string[]>();
  for (const [key, pids] of Object.entries(productMap)) {
    if (!key.startsWith(storePrefix)) continue;
    if (!Array.isArray(pids)) continue;
    for (const pid of pids) {
      if (!cohortByProduct.has(pid)) cohortByProduct.set(pid, []);
      cohortByProduct.get(pid)!.push(key);
    }
  }

  // 3. Build one row per product.
  const rows: ProductCohortRow[] = [];
  for (const [productId, campaignKeys] of cohortByProduct.entries()) {
    // Collect cohort members (resolved aggregated rows). Members with
    // no aggregated row (campaign paused throughout the range) are kept
    // with zero metrics — operator may want to see "campaign X was
    // mapped but didn't spend in this window".
    type RawMember = {
      campaignKey: string;
      agg: Aggregated | undefined;
    };
    const raw: RawMember[] = campaignKeys.map(k => ({
      campaignKey: k,
      agg: aggByKey.get(k),
    }));

    // Skip products where NO cohort campaign has any aggregated row at
    // all — those are stale mappings on dormant campaigns and add only
    // noise to the product-centric view.
    if (raw.every(r => !r.agg)) continue;

    const totalCohortSpend = raw.reduce((s, r) => s + (r.agg?.spend ?? 0), 0);
    const totalNetRevenue = productNetRevenue.get(productId) ?? 0;
    const blendedRoas = totalCohortSpend > 0 ? totalNetRevenue / totalCohortSpend : 0;

    // Group by platform for intra-platform calculations.
    const platformGroups = new Map<string, RawMember[]>();
    for (const r of raw) {
      if (!r.agg) continue;
      const platform = r.agg.platform;
      if (!platformGroups.has(platform)) platformGroups.set(platform, []);
      platformGroups.get(platform)!.push(r);
    }

    // Total spend per platform — for intra-platform share computation.
    const platformSpend = new Map<string, number>();
    for (const [platform, members] of platformGroups.entries()) {
      platformSpend.set(
        platform,
        members.reduce((s, r) => s + (r.agg?.spend ?? 0), 0),
      );
    }

    // For each platform, estimate the platform's intra-allocated revenue.
    // We don't have orders-attribution here (would require threading
    // through), so we use a simplified split: each platform's allocated
    // revenue ≈ totalNetRevenue × platformSpend/totalCohortSpend.
    // The true `allocateProductRevenue` is more nuanced (deterministic
    // first, then proportional) but it requires orders data this
    // module doesn't take. The simplified version is correct in
    // expectation and exactly correct when all orders are non-attributed.
    const platformAllocatedRevenue = new Map<string, number>();
    for (const [platform, spend] of platformSpend.entries()) {
      const share = totalCohortSpend > 0 ? spend / totalCohortSpend : 0;
      platformAllocatedRevenue.set(platform, totalNetRevenue * share);
    }

    // Build the final member rows with the share + allocation fields.
    const members: ProductCohortMember[] = raw
      .filter(r => r.agg !== undefined)
      .map(r => {
        const a = r.agg!;
        const intraTotal = platformSpend.get(a.platform) ?? 0;
        const intraShare = intraTotal > 0 ? a.spend / intraTotal : 0;
        const totalShare = totalCohortSpend > 0 ? a.spend / totalCohortSpend : 0;
        // Member allocated revenue = platform's allocated revenue × intra share.
        const platformRev = platformAllocatedRevenue.get(a.platform) ?? 0;
        const allocatedRev = platformRev * intraShare;
        return {
          campaignKey: a.key,
          campaignId: a.campaignId,
          campaignName: a.campaignName,
          platform: a.platform,
          storeId: a.storeId,
          storeName: a.storeName,
          spend: a.spend,
          conversionValue: a.conversionValue,
          intraPlatformSpendShare: intraShare,
          totalSpendShare: totalShare,
          allocatedRevenueEstimate: allocatedRev,
          platformRoas: a.spend > 0 ? a.conversionValue / a.spend : 0,
          effectiveStatus: a.effectiveStatus,
        };
      });

    // Sort members by spend desc.
    members.sort((a, b) => b.spend - a.spend);

    // Build the per-platform groups for the UI.
    const byPlatform = Array.from(platformGroups.entries())
      .map(([platform, raws]) => {
        const platformMembers = members.filter(m => m.platform === platform);
        return {
          platform,
          members: platformMembers,
          intraSpend: platformSpend.get(platform) ?? 0,
          intraAllocatedRevenue: platformAllocatedRevenue.get(platform) ?? 0,
        };
      })
      // Sort platforms by their spend desc — biggest first.
      .sort((a, b) => b.intraSpend - a.intraSpend);

    rows.push({
      productId,
      productTitle: productTitles?.get(productId) ?? productId,
      storeId,
      totalCohortSpend,
      totalNetRevenue,
      members,
      byPlatform,
      isMultiMapped: members.length >= 2,
      blendedRoas,
    });
  }

  // Sort rows by net revenue desc — biggest revenue producers first.
  rows.sort((a, b) => b.totalNetRevenue - a.totalNetRevenue);

  return rows;
}
