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
import { allocateProductRevenue, type ProductMap } from './campaignProductMap';

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
  /** Per-product units sold (Phase b/HI-03 — needed by allocateProductRevenue
   *  when orders are threaded through for the deterministic-first path).
   *  Optional for back-compat; without it the allocator can't run and we
   *  fall back to the simplified per-platform split. */
  productUnits?: Map<string, number>;
  /**
   * Audit fix 2026-05-23 (b/HI-03) — order rows for the same (store, range).
   * When provided, buildProductCentricView calls `allocateProductRevenue`
   * per product so the per-campaign + per-platform revenue numbers match
   * EXACTLY the campaign-centric drawer (deterministic per-platform first,
   * then spend-proportional fallback). Without this the simplified spend-
   * share split differed from the drawer's number for the same product +
   * campaign.
   *
   * Optional — when omitted (e.g., older callers, tests), the function
   * falls back to the simplified split (correct in expectation, exact
   * only when no orders carry platform signals).
   */
  orders?: Array<{
    storeId: string;
    source: string;
    fbclidPresent: boolean;
    gclidPresent: boolean;
    lineItems: Array<{ productId: string; units: number; revenueCad: number }>;
  }>;
};

// =============================================================================
// Public API
// =============================================================================

export function buildProductCentricView(
  inputs: ProductCentricInputs,
): ProductCohortRow[] {
  const {
    storeId, productMap, aggregated, productNetRevenue, productTitles,
    productUnits, orders,
  } = inputs;

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

  // Audit fix 2026-05-23 (b/HI-03): when orders are threaded through,
  // delegate the per-campaign revenue allocation to the canonical
  // `allocateProductRevenue` per product, so the product-centric view's
  // numbers match the campaign-centric drawer EXACTLY. Build the
  // campaignSpend map once (cheap O(N)) and call the allocator once per
  // product below — the allocator was designed for batch but works
  // correctly with a single-product `productRevenue` array.
  let allocatorReady = false;
  const campaignSpendForAllocator = new Map<string, number>();
  if (orders && orders.length > 0) {
    for (const a of aggregated) {
      campaignSpendForAllocator.set(
        a.key,
        (campaignSpendForAllocator.get(a.key) ?? 0) + a.spend,
      );
    }
    allocatorReady = true;
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

    // ── b/HI-03 preferred path: per-product allocateProductRevenue ──
    // When orders are provided we call the canonical allocator (same one
    // the campaign-centric drawer uses) on a single-product input, then
    // read the per-campaign output. This guarantees the product-centric
    // view and the campaign-centric view agree on every revenue number
    // for the same (product, campaign, range) tuple — eliminating the
    // pre-fix divergence where deterministic per-platform attribution
    // was ignored here.
    let allocByCampaign: Map<string, number> | null = null;
    if (allocatorReady) {
      const productUnitsCount = productUnits?.get(productId) ?? 0;
      const allocOutput = allocateProductRevenue({
        storeId,
        map: productMap,
        productRevenue: [
          {
            productId,
            netRevenueCad: totalNetRevenue,
            units: productUnitsCount,
          },
        ],
        campaignSpend: campaignSpendForAllocator,
        orders,
      });
      allocByCampaign = new Map();
      for (const [k, alloc] of allocOutput.entries()) {
        allocByCampaign.set(k, alloc.revenue);
      }
    }

    // For each platform, estimate the platform's intra-allocated revenue.
    //
    // Default path (no `orders` threaded through): simplified split —
    // each platform's allocated revenue ≈ totalNetRevenue × platformSpend
    // / totalCohortSpend. Matches the per-campaign allocator IN EXPECTATION
    // and is exactly correct when all orders are non-attributed.
    //
    // Audit fix 2026-05-23 (b/HI-05): when totalCohortSpend === 0 (all
    // cohort campaigns are dormant in the range, but the product has
    // revenue) the previous `: 0` fallback silently dropped 100% of the
    // product's revenue from the per-platform breakdown. Now we fall back
    // to equal-share across the platforms that have at least one mapped
    // campaign — operator sees "$X allocated to Meta + $X to TikTok" instead
    // of the misleading "$0 everywhere with $1000 revenue floating".
    const platformAllocatedRevenue = new Map<string, number>();
    const platformCount = platformGroups.size;
    if (allocByCampaign) {
      // Sum the allocator's per-campaign output up to platform totals so
      // the byPlatform.intraAllocatedRevenue field stays consistent with
      // the per-member allocatedRevenueEstimate.
      for (const platform of platformGroups.keys()) {
        platformAllocatedRevenue.set(platform, 0);
      }
      for (const [campaignKey, rev] of allocByCampaign.entries()) {
        const member = raw.find(r => r.campaignKey === campaignKey);
        if (!member?.agg) continue;
        const platform = member.agg.platform;
        platformAllocatedRevenue.set(
          platform,
          (platformAllocatedRevenue.get(platform) ?? 0) + rev,
        );
      }
    } else {
      for (const [platform, spend] of platformSpend.entries()) {
        const share = totalCohortSpend > 0
          ? spend / totalCohortSpend
          : (platformCount > 0 ? 1 / platformCount : 0);
        platformAllocatedRevenue.set(platform, totalNetRevenue * share);
      }
    }

    // Build the final member rows with the share + allocation fields.
    const members: ProductCohortMember[] = raw
      .filter(r => r.agg !== undefined)
      .map(r => {
        const a = r.agg!;
        const intraTotal = platformSpend.get(a.platform) ?? 0;
        const intraShare = intraTotal > 0 ? a.spend / intraTotal : 0;
        const totalShare = totalCohortSpend > 0 ? a.spend / totalCohortSpend : 0;
        // Audit fix 2026-05-23 (b/HI-03): when the allocator ran, read the
        // exact per-campaign revenue from its output. Falls back to the
        // simplified split (platform revenue × intra share) when orders
        // weren't provided.
        const platformRev = platformAllocatedRevenue.get(a.platform) ?? 0;
        const allocatedRev = allocByCampaign?.get(a.key) ?? (platformRev * intraShare);
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
