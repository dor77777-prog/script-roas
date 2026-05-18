import { useMemo } from 'react';
import {
  allocateProductRevenue,
  campaignKey,
  type ProductMap,
} from '@/lib/campaignProductMap';
import {
  analyzeAttribution,
  type AttributionAnalysis,
} from '@/lib/attributionAnalysis';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { DateRange } from '@/lib/types';
import type { Aggregated } from '@/components/CampaignsTable';

/**
 * Per-campaign output of the true-ROAS allocation. `trueRevenue` is the
 * Shopify-actual revenue allocated to this campaign (proportional to spend
 * when products are shared). `confidence` is a heuristic trust signal so
 * the user knows whether a gap vs Meta is likely real or just an artifact
 * of incomplete mapping / shared attribution / low sample size.
 */
export type TrueRevenueInfo = {
  trueRevenue: number;
  /** Allocated Shopify units sold of mapped products in the date range —
   *  uses the same spend-proportional share as trueRevenue. Surfaced as a
   *  separate column so the operator can sanity-check the revenue figure
   *  against unit volume. */
  trueUnits: number;
  metaClaim: number;
  spend: number;
  mappedCount: number;
  sharedCampaigns: number;
  confidence: ConfidenceLevel;
  /** Deterministic per-order attribution analysis (from
   *  /api/orders-attribution). When present, this is the authoritative
   *  signal — replaces the heuristic confidence chip with click-ID-proven
   *  numbers ('X orders tagged, Y modeled, Z% coverage'). null when:
   *    - Google campaign (no per-product attribution),
   *    - orders-attribution tab missing (first deploy), or
   *    - the new pipeline hasn't run yet. */
  attribution: AttributionAnalysis | null;
};

export type ConfidenceLevel = {
  /** Color-coded bucket — drives the chip background in the row. */
  level: 'high' | 'medium' | 'low';
  /** Hebrew label shown in the chip itself. */
  label: string;
  /** Multi-line explanation shown in the tooltip. Lists the actual reasons
   *  this campaign landed in this bucket so the user can act on them
   *  (extend mapping, narrow shared products, wait for more spend). */
  reasons: string[];
};

/**
 * Decide how much to trust a campaign's true-ROAS number. Heuristic — not a
 * statistical test — but tuned so the warning bands match the common
 * failure modes operators run into:
 *   - low spend → noise dominates
 *   - mapping shared with many campaigns → allocation arbitrary
 *   - very few mapped products → likely missing the actual hero
 *   - massive Meta vs Shopify gap (>70%) → could be over-attribution OR
 *     incomplete mapping OR halo, but in any case the user shouldn't
 *     treat the gap as gospel without investigating
 */
function computeConfidence(
  trueRevenue: number,
  metaClaim: number,
  spend: number,
  sharedCampaigns: number,
  mappedCount: number,
): ConfidenceLevel {
  const reasons: string[] = [];
  let level: ConfidenceLevel['level'] = 'high';

  // The gap is the primary signal — if Meta and Shopify agree, every
  // other warning becomes much weaker (the agreement is the validation).
  // Computed first so downstream rules can reference it.
  const gap = metaClaim > 0 || trueRevenue > 0
    ? Math.abs(trueRevenue - metaClaim) / Math.max(metaClaim, trueRevenue, 1)
    : 0;

  // Pure return-value version so TS's flow-sensitive type tracking sees the
  // mutations at the call sites (closure mutation hides them and made the
  // final ternary fail with 'low and medium have no overlap'). Same logic:
  // 'high' can drop to anything; 'medium' can drop to 'low'; 'low' stays.
  function applyDowngrade(current: ConfidenceLevel['level'], target: 'medium' | 'low'): ConfidenceLevel['level'] {
    if (current === 'high') return target;
    if (current === 'medium' && target === 'low') return 'low';
    return current;
  }

  // Hard gap thresholds — Meta and Shopify telling different stories.
  if (gap > 0.7) {
    level = 'low';
    reasons.push(`פער של ${(gap * 100).toFixed(0)}% מול Meta — בדוק לעומק לפני שמסיק מסקנות`);
  } else if (gap > 0.3) {
    level = applyDowngrade(level, 'medium');
    reasons.push(`פער של ${(gap * 100).toFixed(0)}% מול Meta — סביר, יתכן שילוב של over-attribution + halo`);
  }

  // Shared products. 3+ is always concerning; 1-2 only matters when there's
  // also a non-trivial gap (with perfect agreement, sharing is fine).
  if (sharedCampaigns >= 3) {
    level = applyDowngrade(level, 'low');
    reasons.push(`מוצרים משותפים עם ${sharedCampaigns} קמפיינים אחרים — החלוקה קירוב`);
  } else if (sharedCampaigns >= 1 && gap > 0.15) {
    level = applyDowngrade(level, 'medium');
    reasons.push(`מוצרים משותפים עם עוד ${sharedCampaigns} קמפיין${sharedCampaigns > 1 ? 'ים' : ''} — חלוקה פרופורציונלית להוצאה`);
  }

  // Mapping completeness — single product + big gap suggests missing mapping.
  // We don't penalise a single-product mapping when the numbers agree
  // (that's actually evidence the mapping is correct).
  if (mappedCount < 2 && metaClaim > 0 && trueRevenue < metaClaim * 0.5) {
    level = applyDowngrade(level, 'medium');
    reasons.push('מוצר יחיד משויך + פער גדול מול Meta — ייתכן שמיפוי לא מלא');
  }

  // Low spend = small sample. Used to be an automatic LOW downgrade, which
  // produced false negatives whenever spend was modest but the two sources
  // agreed strongly (e.g. CAD 78 spend, Meta 1335 vs Shopify 1375 — gap 3%).
  // Now: only downgrade when the gap is also non-trivial; otherwise just
  // an FYI line.
  if (spend < 200) {
    if (gap > 0.15) {
      level = applyDowngrade(level, 'medium');
      reasons.push(`הוצאה נמוכה בתקופה (CAD ${spend.toFixed(0)}) — המדגם קטן, פער ${(gap * 100).toFixed(0)}% עשוי להיות רעש`);
    } else {
      reasons.push(`הוצאה נמוכה (CAD ${spend.toFixed(0)}) — שני המקורות מסכימים, אבל המדגם קטן`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('מיפוי מלא, פער קטן, הוצאה מספיקה — מספרים אמינים');
  }
  const label = level === 'high' ? 'אמין' : level === 'medium' ? 'חלקי' : 'לא אמין';
  return { level, label, reasons };
}

/**
 * "True ROAS" allocation per campaign. For each campaign that has mapped
 * products, sum the actual Shopify net revenue across those products
 * (filtered to the same store and date range), then allocate
 * proportionally to spend when a product is shared with other campaigns.
 *
 * Returns a Map<campaignKey, { trueRevenue, confidence, mappedCount,
 * sharedProducts, metaClaim }> so the renderer can show both the number
 * and the trust signal in one lookup.
 *
 * Only meaningful in campaign mode (mapping is at the campaign level).
 * In ad-set mode the map is empty so all rows fall back to Meta numbers.
 *
 * IMPORTANT — `localRange` reference-equality contract (WR-05):
 * The inner useMemo lists `localRange` as a dep (alongside its
 * destructured siblings). The dep array compares by reference, so the
 * caller MUST replace `localRange` on every change — never mutate it
 * in place. Concretely, callers should do
 *   setLocalRange({ from, to })
 * (creating a fresh object) and NOT
 *   setLocalRange(prev => { prev.from = ...; return prev; })
 * (mutating the existing object). In-place mutation would yield the
 * same reference, the memo would not invalidate, and the allocation
 * would keep returning numbers from the stale range — silently.
 */
export function useCampaignTrueRevenue(opts: {
  mode: 'campaign' | 'adset';
  data: CampaignsResponse | undefined;
  productsResp: ProductsResponse | undefined;
  ordersAttrResp: OrdersAttributionResponse | undefined;
  productMap: ProductMap;
  aggregated: Aggregated[];
  localRange: DateRange;
}): Map<string, TrueRevenueInfo> {
  const { mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange } = opts;
  return useMemo(() => {
    if (mode !== 'campaign') return new Map<string, TrueRevenueInfo>();
    if (!data?.rows || !productsResp?.rows) return new Map<string, TrueRevenueInfo>();

    // Step 1: compute total spend per campaign-key from the aggregated list
    // (already scoped to localRange/localStore/platform).
    const campaignSpend = new Map<string, number>();
    for (const a of aggregated) {
      campaignSpend.set(campaignKey(a.storeId, a.campaignId), a.spend);
    }

    // Step 2: group product net-revenue by (storeId, productId) over the
    // same date range. We iterate products by store because allocation is
    // scoped to one store at a time (campaigns can't sell products from
    // another store).
    const productsByStore = new Map<string, Array<{ productId: string; netRevenueCad: number; units: number }>>();
    for (const p of productsResp.rows) {
      if (p.date < localRange.from || p.date > localRange.to) continue;
      if (!p.productId) continue;
      const net = p.netRevenue ?? p.revenue; // net wins when available
      if (net <= 0 && p.units <= 0) continue;
      if (!productsByStore.has(p.storeId)) productsByStore.set(p.storeId, []);
      const arr = productsByStore.get(p.storeId)!;
      // Dedupe: sum the multi-day rows into a single per-product total.
      const existing = arr.find(x => x.productId === p.productId);
      if (existing) {
        existing.netRevenueCad += net;
        existing.units += p.units;
      } else {
        arr.push({ productId: p.productId, netRevenueCad: net, units: p.units });
      }
    }

    // Step 3: run the allocator per store (keeps the storeId scoping that
    // campaignsForProduct enforces). The allocator now returns both
    // revenue and units per campaign, sharing the same spend-proportional
    // share so the numbers stay internally consistent.
    const allocations = new Map<string, { revenue: number; units: number }>();
    for (const [storeId, productRev] of productsByStore) {
      const allocated = allocateProductRevenue({
        storeId,
        map: productMap,
        productRevenue: productRev,
        campaignSpend,
      });
      for (const [k, v] of allocated) {
        const cur = allocations.get(k) ?? { revenue: 0, units: 0 };
        cur.revenue += v.revenue;
        cur.units += v.units;
        allocations.set(k, cur);
      }
    }

    // Step 4: build the per-key info object with the trust signal.
    const out = new Map<string, TrueRevenueInfo>();
    for (const a of aggregated) {
      const k = campaignKey(a.storeId, a.campaignId);
      const mappedIds = productMap[k] ?? [];
      if (mappedIds.length === 0) continue; // no mapping → no true-ROAS row
      const alloc = allocations.get(k) ?? { revenue: 0, units: 0 };
      const trueRevenue = alloc.revenue;
      const trueUnits = alloc.units;
      // How many OTHER campaigns share at least one of this campaign's
      // mapped products? Higher overlap → noisier allocation → lower trust.
      //
      // #WR-02: Previously a `shared++` counter with `break` only on the
      // inner loop double-counted whenever one other campaign overlapped
      // on multiple products: A=[P1,P2] and B=[P1,P2] reported shared=2
      // instead of 1, pushing computeConfidence toward 'low' too aggressively.
      // Tracking the unique other-campaign keys in a Set and reading .size
      // implements the documented "count each campaign once" semantics.
      const sharedKeys = new Set<string>();
      for (const pid of mappedIds) {
        for (const otherKey of Object.keys(productMap)) {
          if (otherKey === k) continue;
          if (!otherKey.startsWith(`${a.storeId}::`)) continue;
          if ((productMap[otherKey] ?? []).includes(pid)) {
            sharedKeys.add(otherKey);
          }
        }
      }
      const shared = sharedKeys.size;
      // Daily Meta conv-value series for this specific campaign — used by
      // attribution analysis for outlier detection + window stability.
      // We pull from the raw rows (already filtered to range by aggregate)
      // and bucket by date.
      const dailyMeta = (() => {
        const byDate = new Map<string, number>();
        if (!data) return [];
        for (const r of data.rows) {
          if (r.storeId !== a.storeId) continue;
          if (r.platform !== a.platform) continue;
          if (r.campaignId !== a.campaignId) continue;
          if (r.date < localRange.from || r.date > localRange.to) continue;
          byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.conversionValue);
        }
        return Array.from(byDate.entries()).map(([date, value]) => ({ date, value }));
      })();

      // Deterministic per-order attribution. Uses utm_id (campaignId) for
      // primary matching when present, falls back to utm_campaign by name.
      // Returns null for non-Meta campaigns or when the attribution tab is
      // empty (first deploy). Daily series enables Bayesian / window /
      // outlier analysis.
      const attribution = analyzeAttribution(
        {
          campaignName: a.campaignName,
          campaignId: a.campaignId,
          storeId: a.storeId,
          platform: a.platform,
          metaClaim: a.conversionValue,
          spend: a.spend,
        },
        ordersAttrResp?.rows ?? [],
        localRange.from,
        localRange.to,
        dailyMeta,
      );
      out.set(k, {
        trueRevenue,
        trueUnits,
        metaClaim: a.conversionValue,
        mappedCount: mappedIds.length,
        sharedCampaigns: shared,
        spend: a.spend,
        confidence: computeConfidence(trueRevenue, a.conversionValue, a.spend, shared, mappedIds.length),
        attribution,
      });
    }
    return out;
  }, [mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]);
}
