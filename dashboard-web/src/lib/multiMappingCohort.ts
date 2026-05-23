/**
 * Phase 05.7.x (2026-05-23) — Multi-mapping cohort analysis.
 *
 * The "cohort" of a campaign C is the set of OTHER campaigns that share
 * at least one Shopify-product mapping with C. Two cohort flavours:
 *
 *   intraPlatform — campaigns of the same platform as C (Meta, Google,
 *                   TikTok). These compete for the SAME audience pool
 *                   on the SAME ad network. Scaling one may cannibalize
 *                   the others if the audience is saturated.
 *
 *   crossPlatform — campaigns on a DIFFERENT platform than C. These are
 *                   parallel channels (e.g. Meta audience vs TikTok
 *                   audience for the same product). Scaling is usually
 *                   independent — different users.
 *
 * The distinction matters for operator decisions: scaling within an
 * intra-platform cohort is risky (may steal share); scaling across
 * platforms is usually independent.
 *
 * Public API:
 *   computeMultiMappingCohort(currentCampaignKey, productMap, aggregated)
 *     → MultiMappingCohort | null
 *
 * Returns null if the current campaign has no mapped products OR no
 * other campaigns share any of its products. Callers (e.g. drawer
 * panel) gate rendering on the null check.
 */

import type { ProductMap } from './campaignProductMap';
import type { Aggregated } from './campaignsAggregator';

// =============================================================================
// Types
// =============================================================================

export type CohortMember = {
  /** `${storeId}::${platform}::${campaignId}` */
  campaignKey: string;
  campaignId: string;
  campaignName: string;
  platform: string;
  /** Product IDs this member shares with the current campaign. */
  sharedProductIds: string[];
  /** All products this member has mapped (superset of sharedProductIds
   *  when the member has additional non-shared products). Useful for
   *  the operator to see how "specialised" each member is. */
  allProductIds: string[];
  /** Aggregated metrics from the current view's date range. Undefined
   *  when the member doesn't appear in the aggregated list (no spend in
   *  range — campaign was paused for the whole window). */
  metrics: {
    spend: number;
    /** ROAS Shopify combined (deterministic + proportional fallback).
     *  Used as the primary ranking metric. Computed by the caller (the
     *  drawer already has trueRevenueByKey). */
    roasShopify: number;
    /** Platform-deterministic ROAS — only orders with the matching
     *  click-id for this platform. More conservative; used as the
     *  tie-breaker when roasShopify is equal. */
    roasShopifyPlatform: number;
    conversions: number;
    effectiveStatus: string | null;
  } | undefined;
};

export type MultiMappingCohort = {
  /** The current campaign — always rank #1 in the listing but with its
   *  own `isCurrent: true` flag so the UI can distinguish it. */
  current: CohortMember & { isCurrent: true };
  /** Other campaigns sharing AT LEAST ONE product with the current
   *  campaign. Sorted by ranking score descending. */
  others: CohortMember[];
  /** All members (current + others) sorted by score descending — used
   *  by the table rendering. The current campaign carries `isCurrent`. */
  rankedAll: Array<CohortMember & { isCurrent: boolean }>;
  /** Where the current campaign sits in the ranking. 1 = best, N = worst.
   *  Computed across the full rankedAll list (current + others). */
  currentRank: number;
  /** Total members including current. >= 2 (cohort only meaningful when
   *  at least one other campaign shares a product). */
  totalMembers: number;
  /** True when current is rank 1 (highest roasShopify). */
  isLeader: boolean;
  /** True when current is the rank-N (lowest) member of a cohort of >= 3.
   *
   *  Audit fix 2026-05-23 (HIGH-02 multi-mapping): the floor
   *  `totalMembers >= 3` prevents auto-flagging the loser of a 2-member
   *  cohort just because someone had to be lower. The companion
   *  health-score adjustment in `applyCohortAdjustmentOnce` already
   *  enforces the same `cohortSize >= 3` floor (campaignHealthScore.ts:424)
   *  — pulling the gate up to the source so the UI chip and the score
   *  adjustment agree on the definition of "weakest". */
  isWeakest: boolean;
  /** All distinct product IDs shared between the current campaign and
   *  at least one other member of the cohort. Used by the AI report
   *  and the drawer's product-product table. */
  sharedProductIds: string[];
  /** Cohort members split by platform vs the current campaign's
   *  platform. Lets the UI render two separate mini-tables
   *  ("competing on the same platform" vs "parallel channels"). */
  intraPlatformOthers: CohortMember[];
  crossPlatformOthers: CohortMember[];
};

// =============================================================================
// Helpers
// =============================================================================

function parseKey(
  campaignKey: string,
): { storeId: string; platform: string; campaignId: string } | null {
  const parts = campaignKey.split('::');
  if (parts.length !== 3) return null;
  const [storeId, platform, campaignId] = parts;
  if (!storeId || !platform || !campaignId) return null;
  return { storeId, platform, campaignId };
}

/**
 * Bayesian shrinkage anchor for ranking. Spend below this floor gets its
 * ROAS pulled toward 1.0 (break-even) proportionally to how far it sits
 * below the floor — the smaller the sample, the more aggressive the pull.
 *
 * Audit fix 2026-05-23 (CRITICAL-02 multi-mapping): the previous raw-ROAS
 * formula let a $40-spend / ROAS-12 anomaly score 3× higher than a
 * $20K-spend / ROAS-4 mature campaign — operator would be told to scale
 * the anomaly and pause the mature. With this anchor at CAD 500:
 *   - $40 + ROAS 12 → shrunk ROAS ≈ 1.86 (~3 orders of noise discounted)
 *   - $500 + ROAS 8 → shrunk ROAS ≈ 4.5 (~10 orders of signal preserved)
 *   - $20K + ROAS 4 → shrunk ROAS ≈ 3.93 (large-sample, barely shifted)
 *
 * Tuning: $500 is the operator's typical "minimum statistically meaningful
 * sample" in the 3-store / 3-platform setup. Lower numbers (e.g., the
 * audit's first-pass k=100) didn't fully neutralize the $40 vs $20K case.
 * Higher numbers would over-penalize legitimate launches.
 */
const ROAS_SHRINKAGE_ANCHOR_CAD = 500;

/**
 * Orders-axis shrinkage anchor.
 *
 * Audit fix 2026-05-23 (b/HI-02): the CAD-only shrinkage above had a
 * blind spot — a 1-order / $500-AOV cohort scored IDENTICALLY to a
 * 50-orders / $10-AOV cohort because both had the same total CAD spend.
 * Statistically the 50-orders cohort is far more trustworthy (sample size
 * is the dominant source of ROAS noise). Adding an orders-axis anchor at
 * 10 conversions and taking the BETTER-OF weight means:
 *   - 1-order $500 spend  → w_spend ≈ 0.50, w_orders ≈ 0.09 → max 0.50
 *   - 50-orders $500 spend → w_spend ≈ 0.50, w_orders ≈ 0.83 → max 0.83
 *   - 50-orders $50 spend  → w_spend ≈ 0.09, w_orders ≈ 0.83 → max 0.83
 *
 * The "better-of" choice — vs averaging or a product — means a cohort
 * that's strong on EITHER axis (lots of conversions OR lots of CAD)
 * gets preserved signal, and only cohorts weak on BOTH get shrunk
 * aggressively. Matches the operator's intuition: "I trust the campaign
 * with 50 orders even if cheap, and I trust the campaign with $20K
 * spend even if only one big-ticket purchase."
 *
 * Tuning: 10 conversions is the operator's typical threshold for "I
 * believe this ROAS." Below that one refund flips the verdict.
 */
const ROAS_SHRINKAGE_ANCHOR_ORDERS = 10;

/** Shrink raw ROAS toward 1.0 (break-even) based on sample size.
 *  Uses the BETTER-OF spend-axis and orders-axis weights so a cohort
 *  strong on EITHER axis keeps its signal. Returns the ROAS estimate
 *  to use for ranking — NOT for display.
 *
 *  Audit fix 2026-05-23 (b/HI-02): orders axis added. See the
 *  ROAS_SHRINKAGE_ANCHOR_ORDERS docstring above for the before/after
 *  numerical examples. */
function shrinkRoas(roas: number, spend: number, orders: number): number {
  if (spend <= 0 && orders <= 0) return 1.0; // truly unspendable → break-even neutral
  const wSpend = spend > 0 ? spend / (spend + ROAS_SHRINKAGE_ANCHOR_CAD) : 0;
  const wOrders = orders > 0 ? orders / (orders + ROAS_SHRINKAGE_ANCHOR_ORDERS) : 0;
  const w = Math.max(wSpend, wOrders);
  return roas * w + 1.0 * (1 - w);
}

/** Rank-by score for cohort members. Higher = better.
 *
 *  Primary: shrunk roasShopify (combined Shopify ROAS, sample-size weighted).
 *  Secondary: shrunk roasShopifyPlatform (deterministic-only — when wired,
 *  this discriminates among same-combined-ROAS members based on platform-
 *  attributed orders).
 *  Tertiary: spend (more invested = more "weight" in true ties).
 *
 *  Members without metrics (campaign had no spend in the range) sink to
 *  the bottom but don't get NaN-treated.
 *
 *  Audit fix 2026-05-23 (CRITICAL-02): the raw-ROAS version let small-
 *  sample anomalies dominate. See `ROAS_SHRINKAGE_ANCHOR_CAD` above. */
function rankingScore(m: CohortMember): number {
  if (!m.metrics) return -Infinity;
  // Audit fix 2026-05-23 (b/HI-02): pass `conversions` so shrinkRoas can
  // use the orders-axis when spend is small but conversion volume is
  // meaningful (or vice-versa).
  const shrunk = shrinkRoas(m.metrics.roasShopify, m.metrics.spend, m.metrics.conversions);
  const shrunkPlat = shrinkRoas(m.metrics.roasShopifyPlatform, m.metrics.spend, m.metrics.conversions);
  return (
    shrunk * 1_000_000 +
    shrunkPlat * 1_000 +
    m.metrics.spend
  );
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build the cohort summary for the current campaign. Returns null when:
 *   - The current campaign has no mapped products, OR
 *   - No other campaign maps any of the current campaign's products.
 *
 * Inputs:
 *   currentCampaignKey — the `${storeId}::${platform}::${campaignId}` key
 *   productMap         — the operator's full Shopify-product↔campaign map
 *                        (from readProductMap() / cloud-synced state).
 *                        Keys are storeId-prefixed; we filter to the
 *                        current campaign's store inside.
 *   aggregated         — campaign-level rows from the current view's
 *                        date range. We look up each cohort member here
 *                        for its metrics. Members without an entry get
 *                        metrics:undefined (don't drop — operator may
 *                        want to see that "this cohort member exists
 *                        but is paused in the current range").
 *   trueRevenueByKey   — Map<campaignKey, {trueRevenue, ...}> from the
 *                        useCampaignTrueRevenue hook. Used to compute
 *                        roasShopify (combined) per member. The hook
 *                        already does the deterministic-then-proportional
 *                        allocation; we just read its output.
 *   deterministicRoasByKey — Map<campaignKey, number>. Pre-computed
 *                        from postgresReaders' shopifyValuePlatform
 *                        column divided by spend. Used as the secondary
 *                        ranking key + the panel's tie-break display.
 */
export function computeMultiMappingCohort(args: {
  currentCampaignKey: string;
  productMap: ProductMap;
  aggregated: Aggregated[];
  /** campaignKey → roasShopify (combined). Source: the drawer's
   *  trueRevenueByKey memo (trueRevenue / spend). 0 when undefined. */
  roasShopifyByKey: Map<string, number>;
  /** campaignKey → roasShopifyPlatform (deterministic-only). Source:
   *  postgresReaders' shopifyValuePlatform / spend, computed in the
   *  parent. 0 when undefined. */
  roasShopifyPlatformByKey: Map<string, number>;
}): MultiMappingCohort | null {
  const {
    currentCampaignKey,
    productMap,
    aggregated,
    roasShopifyByKey,
    roasShopifyPlatformByKey,
  } = args;

  const currentParts = parseKey(currentCampaignKey);
  if (!currentParts) return null;
  const currentProducts = productMap[currentCampaignKey] ?? [];
  if (currentProducts.length === 0) return null;

  const currentProductSet = new Set(currentProducts);
  const storePrefix = `${currentParts.storeId}::`;

  // Walk productMap, find every other campaign (in the same store) that
  // has at least one product in common with the current campaign.
  // O(N×M) where N=campaigns in store, M=products per campaign. Both
  // small in practice (<200 × <20).
  const others: CohortMember[] = [];
  const sharedProductIdsSet = new Set<string>();

  for (const [k, productIds] of Object.entries(productMap)) {
    if (!k.startsWith(storePrefix)) continue;
    if (k === currentCampaignKey) continue;
    if (!Array.isArray(productIds) || productIds.length === 0) continue;

    const sharedIds = productIds.filter(pid => currentProductSet.has(pid));
    if (sharedIds.length === 0) continue;

    // Add the shared IDs to the cohort-wide shared set.
    for (const pid of sharedIds) sharedProductIdsSet.add(pid);

    const parts = parseKey(k);
    if (!parts) continue;

    others.push(buildMember(k, parts, sharedIds, productIds, aggregated, roasShopifyByKey, roasShopifyPlatformByKey));
  }

  // No co-mapped campaigns — no cohort.
  if (others.length === 0) return null;

  // Build the current member entry.
  const currentMemberBase = buildMember(
    currentCampaignKey,
    currentParts,
    currentProducts, // current's "shared" with itself = all its products
    currentProducts,
    aggregated,
    roasShopifyByKey,
    roasShopifyPlatformByKey,
  );

  // Rank all members (current + others) by score desc, stable for ties.
  // Stable sort keeps the natural-order tie-breaker deterministic across
  // renders (operator-visible chip won't bounce 🥇 ↔ 🥈 on each refresh).
  const rankedAll = [
    { ...currentMemberBase, isCurrent: true },
    ...others.map(o => ({ ...o, isCurrent: false })),
  ];
  rankedAll.sort((a, b) => rankingScore(b) - rankingScore(a));

  const currentRank = rankedAll.findIndex(m => m.isCurrent) + 1; // 1-based
  const totalMembers = rankedAll.length;
  const isLeader = currentRank === 1;
  // Audit fix 2026-05-23 (HIGH-02): require cohortSize >= 3 before flagging
  // "weakest". For a 2-cohort, the loser by 1% is mathematically rank-N
  // but is not actionable signal ("someone had to be second"). Matches the
  // floor already present in applyCohortAdjustmentOnce.
  const isWeakest = totalMembers >= 3 && currentRank === totalMembers;

  // Split others by platform.
  const intraPlatformOthers = others.filter(o => o.platform === currentParts.platform);
  const crossPlatformOthers = others.filter(o => o.platform !== currentParts.platform);

  return {
    current: { ...currentMemberBase, isCurrent: true },
    others,
    rankedAll,
    currentRank,
    totalMembers,
    isLeader,
    isWeakest,
    sharedProductIds: Array.from(sharedProductIdsSet),
    intraPlatformOthers,
    crossPlatformOthers,
  };
}

function buildMember(
  campaignKey: string,
  parts: { storeId: string; platform: string; campaignId: string },
  sharedIds: string[],
  allIds: string[],
  aggregated: Aggregated[],
  roasShopifyByKey: Map<string, number>,
  roasShopifyPlatformByKey: Map<string, number>,
): CohortMember {
  // First try to find the matching aggregated row for this campaign.
  // The aggregated array uses `key` from `campaignsAggregator.ts` which
  // matches our 3-segment key shape.
  const agg = aggregated.find(a => a.key === campaignKey);

  const metrics = agg
    ? {
        spend: agg.spend,
        roasShopify: roasShopifyByKey.get(campaignKey) ?? 0,
        roasShopifyPlatform: roasShopifyPlatformByKey.get(campaignKey) ?? 0,
        conversions: agg.conversions,
        effectiveStatus: agg.effectiveStatus,
      }
    : undefined;

  // Fallback name: when there's no aggregated row (campaign paused for
  // the whole range), we still want a human-readable label. The campaign
  // ID is the best we have.
  const campaignName = agg?.campaignName ?? `(לא פעיל) ${parts.campaignId}`;

  return {
    campaignKey,
    campaignId: parts.campaignId,
    campaignName,
    platform: parts.platform,
    sharedProductIds: sharedIds,
    allProductIds: allIds,
    metrics,
  };
}
