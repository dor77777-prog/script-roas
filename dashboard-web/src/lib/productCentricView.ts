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
  /**
   * Phase D (2026-05-30) — registry-backed delivery status, threaded
   * through from Aggregated so the per-platform mini-table can prefer
   * always-fresh registry truth over the legacy effective_status.
   * Null for dormant members (no aggregated row in range).
   */
  regDeliveryStatus: string | null;
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
    // AUDIT ALG-02 + ALG-03 (2026-05-24, Phase 12.2.3): preserve stale-
    // mapped cohort members + emit dormant members with zero metrics
    // per the JSDoc contract below. Pre-fix:
    //   - ALG-02 (line ~272 `if (!member?.agg) continue;`) dropped
    //     allocator-assigned revenue for stale-mapped campaigns →
    //     operator saw $1200 visible vs $1500 totalNetRevenue (300 leak).
    //   - ALG-03 (line ~311 dormant-member filter) dropped dormant
    //     members entirely, contradicting the docstring at line 178-181.
    // Fix (Option A per evidence pack): carry platform/storeId/campaignId
    // metadata derived from the campaignKey on each raw member, then
    // emit dormant members with zero metrics in the final array. The
    // allocator-assigned revenue (if any) is read from allocByCampaign
    // by campaignKey lookup — works for dormant + active alike.
    // Evidence: raw-returns/lib_algorithm_productCentricView.json
    //   (ALG-02 + ALG-03).
    //
    // Collect cohort members (resolved aggregated rows). Members with
    // no aggregated row (campaign paused throughout the range) are kept
    // with zero metrics — operator may want to see "campaign X was
    // mapped but didn't spend in this window".
    type RawMember = {
      campaignKey: string;
      agg: Aggregated | undefined;
      /** Platform parsed from campaignKey (`${storeId}::${platform}::${campaignId}`).
       *  Used for ALG-02 fix: when `agg` is missing (dormant campaign),
       *  the platform attribution still needs a value to credit allocator
       *  revenue to. */
      platformFromKey: string;
      /** storeId parsed from campaignKey. Same rationale as platformFromKey. */
      storeIdFromKey: string;
      /** campaignId parsed from campaignKey. Same rationale. */
      campaignIdFromKey: string;
    };
    const raw: RawMember[] = campaignKeys.map(key => {
      // campaignKey format: `${storeId}::${platform}::${campaignId}`.
      // Split on '::' to recover metadata for dormant campaigns. The
      // productMap key is the canonical source of identity — same shape
      // as `campaignKey()` in lib/campaignProductMap.ts.
      const parts = key.split('::');
      return {
        campaignKey: key,
        agg: aggByKey.get(key),
        storeIdFromKey: parts[0] ?? '',
        platformFromKey: parts[1] ?? '',
        campaignIdFromKey: parts.slice(2).join('::'), // tolerate campaignIds with '::'
      };
    });

    // Skip products where NO cohort campaign has any aggregated row at
    // all — those are stale mappings on dormant campaigns and add only
    // noise to the product-centric view.
    if (raw.every(r => !r.agg)) continue;

    const totalCohortSpend = raw.reduce((s, r) => s + (r.agg?.spend ?? 0), 0);
    const totalNetRevenue = productNetRevenue.get(productId) ?? 0;
    const blendedRoas = totalCohortSpend > 0 ? totalNetRevenue / totalCohortSpend : 0;

    // Group by platform for intra-platform calculations.
    //
    // ALG-02 + ALG-03 (Phase 12.2.3): include DORMANT members too so the
    // stale-mapped platform shows up in byPlatform (otherwise allocator-
    // assigned revenue for a stale TikTok campaign would be silently
    // dropped from `platformAllocatedRevenue`). Platform is read from
    // `agg.platform` when present (canonical) else from `platformFromKey`
    // (parsed from the campaignKey) for dormant members.
    const platformGroups = new Map<string, RawMember[]>();
    for (const r of raw) {
      const platform = r.agg?.platform ?? r.platformFromKey;
      if (!platform) continue; // malformed campaignKey — skip defensively
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
        // ALG-02 (Phase 12.2.3): use platformFromKey fallback when the
        // member has no agg (stale-mapped paused campaign). Pre-fix the
        // `if (!member?.agg) continue;` here silently dropped the
        // allocator-assigned revenue → 300 leak vs totalNetRevenue.
        const platform = member?.agg?.platform ?? member?.platformFromKey;
        if (!platform) continue;
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

    // AUDIT ALG-01 (2026-05-24, Phase 12.1.3): per-platform member count
    // so the simplified-split branch can fall back to equal-share when
    // intraTotal === 0 (the zero-spend cohort scenario that the b/HI-05
    // platform-level fix already handles one level up).
    //
    // Pre-fix: intraShare = a.spend / intraTotal = 0/0 = 0 → per-member
    // allocatedRev = platformRev * 0 = 0, even though byPlatform.intra
    // AllocatedRevenue = 500. Operator saw CAD 0 rows under a CAD 500
    // platform header.
    //
    // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
    //   lib_algorithm_productCentricView.json (ALG-01).
    //
    // ALG-03 + Phase 12.1.3 ALG-01: platformMemberCount counts ONLY active
    // members (those with `r.agg` present). This preserves the 12.1.3
    // intraRevShare = 1/N fallback semantic where active members on a
    // zero-spend platform split the platform revenue equally. Dormant
    // members get their allocation from the allocator path (via
    // allocByCampaign.get) — they don't dilute the active members' share.
    const platformMemberCount = new Map<string, number>();
    for (const r of raw) {
      if (!r.agg) continue;
      platformMemberCount.set(
        r.agg.platform,
        (platformMemberCount.get(r.agg.platform) ?? 0) + 1,
      );
    }

    // Build the final member rows with the share + allocation fields.
    //
    // ALG-03 (Phase 12.2.3): removed the pre-fix `.filter(r => r.agg !==
    // undefined)` — dormant members are now emitted with zero metrics per
    // the JSDoc contract above. Allocator-assigned revenue (if any) is
    // read from allocByCampaign by campaignKey lookup — works for
    // dormant + active alike (ALG-02 fix side-effect).
    const members: ProductCohortMember[] = raw.map(r => {
      if (!r.agg) {
        // ALG-03 dormant member branch — emit with zero metrics. Display
        // fields come from the campaignKey-parsed metadata.
        //
        // Revenue allocation policy for dormant members:
        //   - Allocator branch (orders provided): read from allocByCampaign
        //     by campaignKey. The allocator credits stale-mapped platforms
        //     their deterministic order revenue → ALG-02 fix path.
        //   - Simplified-split branch (no orders): zero. The active members
        //     on the same platform already absorb the full platform share
        //     via their intraRevShare; dormant members would double-count.
        //     If the platform is dormant-only, the active platforms split
        //     totalNetRevenue (via b/HI-05) and the dormant-only platform
        //     gets nothing — operator's mental model is "dormant campaigns
        //     on dormant platforms contribute zero in the visible range".
        const platform = r.platformFromKey;
        const allocatedRev = allocByCampaign?.get(r.campaignKey) ?? 0;
        return {
          campaignKey: r.campaignKey,
          campaignId: r.campaignIdFromKey,
          campaignName: r.campaignIdFromKey, // no aggregated name available
          platform,
          storeId: r.storeIdFromKey,
          storeName: r.storeIdFromKey, // no aggregated storeName available
          spend: 0,
          conversionValue: 0,
          intraPlatformSpendShare: 0,
          totalSpendShare: 0,
          allocatedRevenueEstimate: allocatedRev,
          platformRoas: 0,
          effectiveStatus: null,
          regDeliveryStatus: null,
        };
      }
      const a = r.agg;
      const intraTotal = platformSpend.get(a.platform) ?? 0;
      // UI-spend-share for rendering — when intraTotal=0, spend share IS
      // zero (operator-correct: a zero-spend campaign occupies 0% of a
      // zero-spend cohort's spend). Same value as pre-fix.
      const intraSpendShare = intraTotal > 0 ? a.spend / intraTotal : 0;
      // AUDIT ALG-01 (2026-05-24, Phase 12.1.3): SEPARATE revenue-
      // allocation-share. When intraTotal === 0 fall back to 1/N across
      // the platform's members so per-member allocatedRev sums to
      // platformRev. Aligns with the b/HI-05 equal-platform semantic
      // applied one level up (the platform total uses 1/platformCount;
      // we extend that to the member level).
      const platformMembers = platformMemberCount.get(a.platform) ?? 1;
      const intraRevShare = intraTotal > 0
        ? a.spend / intraTotal
        : (platformMembers > 0 ? 1 / platformMembers : 0);
      const totalShare = totalCohortSpend > 0 ? a.spend / totalCohortSpend : 0;
      // Audit fix 2026-05-23 (b/HI-03): when the allocator ran, read the
      // exact per-campaign revenue from its output. Falls back to the
      // simplified split (platform revenue × intra REVENUE share) when
      // orders weren't provided — uses intraRevShare so the zero-spend
      // cohort scenario produces platformRev/N instead of 0.
      const platformRev = platformAllocatedRevenue.get(a.platform) ?? 0;
      const allocatedRev = allocByCampaign?.get(a.key) ?? (platformRev * intraRevShare);
      return {
        campaignKey: a.key,
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        platform: a.platform,
        storeId: a.storeId,
        storeName: a.storeName,
        spend: a.spend,
        conversionValue: a.conversionValue,
        intraPlatformSpendShare: intraSpendShare,
        totalSpendShare: totalShare,
        allocatedRevenueEstimate: allocatedRev,
        platformRoas: a.spend > 0 ? a.conversionValue / a.spend : 0,
        effectiveStatus: a.effectiveStatus,
        regDeliveryStatus: a.regDeliveryStatus,
      };
    });

    // Sort members by spend desc.
    members.sort((a, b) => b.spend - a.spend);

    // Build the per-platform groups for the UI.
    const byPlatform = Array.from(platformGroups.keys())
      .map(platform => {
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
