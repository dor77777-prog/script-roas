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
import type { CampaignRow } from '@/lib/campaigns';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { DateRange } from '@/lib/types';

/**
 * Per-campaign output of the true-ROAS allocation. `trueRevenue` is the
 * Shopify-actual revenue allocated to this campaign (proportional to spend
 * when products are shared). `confidence` is a heuristic trust signal so
 * the user knows whether a gap vs Meta is likely real or just an artifact
 * of incomplete mapping / shared attribution / low sample size.
 */
export type TrueRevenueInfo = {
  /** Full allocation: deterministic + spend-proportional fallback combined.
   *  Used for ROAS Shopify column + sort. */
  trueRevenue: number;
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
  /** Phase 05.7.9b — product TOTALS across ALL platforms for this
   *  campaign's mapped products in the date range. Used for the "ערך/יח'
   *  Shopify · סה"כ" columns.
   *  Phase 05.7.x (2026-05-23) — added `orders` so the new "הזמנות
   *  Shopify" column can show the order count for the campaign's mapped
   *  products. Sum across mapped products = total orders that contained
   *  ANY of them; conservative — an order with 2 mapped products counts
   *  once per product (so the sum may be > distinct orders). Operators
   *  read this as "total product-orders" not "distinct orders". */
  productTotals: {
    revenue: number;
    units: number;
    orders: number;
  };
  /** Phase 05.7.9b — deterministic-only share. Orders with an explicit
   *  platform signal (source='X-paid' OR fbclid/gclid) classified to this
   *  campaign's platform, then split among the platform's mapped campaigns
   *  by intra-platform spend share. NO heuristic fallback. Used for the
   *  "ערך/יח' Shopify · פלטפורמה" columns. */
  deterministicRevenue: number;
  deterministicUnits: number;
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
  allCampaignRows: CampaignRow[];
  localRange: DateRange;
}): Map<string, TrueRevenueInfo> {
  const { mode, data, productsResp, ordersAttrResp, productMap, aggregated, allCampaignRows, localRange } = opts;

  // FIX-08 (5.2.2.1): hoist dailyMetaByCampaign so per-campaign lookup is O(1)
  // instead of rebuilding from all rows per campaign. Uses allCampaignRows for
  // consistency with the cross-platform allocation basis.
  //
  // IN-06 (5.2.2.1): only includes platforms analyzeAttribution can process.
  // Phase 05.7.9c — TikTok added (analyzer extended). Google still excluded
  // (PMax/Shopping utm flow unreliable). The name is a misnomer at this point
  // — kept to avoid a large rename — but semantically it's "daily conv-value
  // series per campaign for any platform we analyze".
  const dailyMetaByCampaign = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const r of allCampaignRows) {
      if (r.platform !== 'Meta' && r.platform !== 'TikTok') continue;
      const k = campaignKey(r.storeId, r.platform, r.campaignId);
      let inner = out.get(k);
      if (!inner) {
        inner = new Map<string, number>();
        out.set(k, inner);
      }
      inner.set(r.date, (inner.get(r.date) ?? 0) + r.conversionValue);
    }
    return out;
  }, [allCampaignRows]);

  // FIX-15 (5.2.2.1): pre-build productToCampaigns index so per-campaign
  // shared-product lookup is O(M) instead of walking every productMap key.
  const productToCampaigns = useMemo(() => {
    const out = new Map<string, Map<string, Set<string>>>();
    for (const k of Object.keys(productMap)) {
      // campaignKey format is `${storeId}::${platform}::${campaignId}`.
      const parts = k.split('::');
      if (parts.length !== 3) continue;
      const storeId = parts[0];
      const products = productMap[k] ?? [];
      let inner = out.get(storeId);
      if (!inner) {
        inner = new Map<string, Set<string>>();
        out.set(storeId, inner);
      }
      for (const pid of products) {
        let set = inner.get(pid);
        if (!set) {
          set = new Set<string>();
          inner.set(pid, set);
        }
        set.add(k);
      }
    }
    return out;
  }, [productMap]);

  return useMemo(() => {
    if (mode !== 'campaign') return new Map<string, TrueRevenueInfo>();
    if (!data?.rows || !productsResp?.rows) return new Map<string, TrueRevenueInfo>();

    // Step 1: compute total spend per campaign-key from ALL campaign rows in
    // the store/date range, before the UI platform filter is applied.
    // Otherwise hidden-platform campaigns get spend=0 and inflate the visible
    // platform's allocated revenue. Fix for CODEX-NEW-P1-02.
    const campaignSpend = new Map<string, number>();
    for (const r of allCampaignRows) {
      if (r.date < localRange.from || r.date > localRange.to) continue;
      const key = campaignKey(r.storeId, r.platform, r.campaignId);
      campaignSpend.set(key, (campaignSpend.get(key) ?? 0) + r.spend);
    }

    // Step 2: group product net-revenue by (storeId, productId) over the
    // same date range. We iterate products by store because allocation is
    // scoped to one store at a time (campaigns can't sell products from
    // another store).
    const productsByStore = new Map<string, Array<{ productId: string; netRevenueCad: number; units: number; orders: number }>>();
    for (const p of productsResp.rows) {
      if (p.date < localRange.from || p.date > localRange.to) continue;
      if (!p.productId) continue;
      const net = p.netRevenue ?? p.revenue; // net wins when available
      if (net <= 0 && p.units <= 0) continue;
      if (!productsByStore.has(p.storeId)) productsByStore.set(p.storeId, []);
      const arr = productsByStore.get(p.storeId)!;
      // Dedupe: sum the multi-day rows into a single per-product total.
      // Phase 05.7.x (2026-05-23) — `orders` accumulated too so the new
      // "הזמנות Shopify" column has a value per product.
      const existing = arr.find(x => x.productId === p.productId);
      if (existing) {
        existing.netRevenueCad += net;
        existing.units += p.units;
        existing.orders += p.orders ?? 0;
      } else {
        arr.push({
          productId: p.productId,
          netRevenueCad: net,
          units: p.units,
          orders: p.orders ?? 0,
        });
      }
    }

    // Step 3: run the allocator per store (keeps the storeId scoping that
    // campaignsForProduct enforces). The allocator now returns both
    // revenue and units per campaign, sharing the same spend-proportional
    // share so the numbers stay internally consistent.
    // Phase 05.7.9 — flatten orders down to the allocator's minimal shape
    // (no need to ship the full OrderAttributionRow). Filtering by date
    // happens here once instead of per-product inside the allocator.
    const ordersForAllocator = (ordersAttrResp?.rows ?? [])
      .filter(o => o.date >= localRange.from && o.date <= localRange.to)
      .map(o => ({
        storeId: o.storeId,
        source: o.source,
        fbclidPresent: o.fbclidPresent,
        gclidPresent: o.gclidPresent,
        lineItems: o.lineItems.map(li => ({
          productId: li.productId,
          units: li.units,
          revenueCad: li.revenueCad,
        })),
      }));

    const allocations = new Map<
      string,
      {
        revenue: number;
        units: number;
        deterministicRevenue: number;
        deterministicUnits: number;
      }
    >();
    for (const [storeId, productRev] of productsByStore) {
      const allocated = allocateProductRevenue({
        storeId,
        map: productMap,
        productRevenue: productRev,
        campaignSpend,
        orders: ordersForAllocator,
      });
      for (const [k, v] of allocated) {
        const cur = allocations.get(k) ?? {
          revenue: 0,
          units: 0,
          deterministicRevenue: 0,
          deterministicUnits: 0,
        };
        cur.revenue += v.revenue;
        cur.units += v.units;
        cur.deterministicRevenue += v.deterministicRevenue;
        cur.deterministicUnits += v.deterministicUnits;
        allocations.set(k, cur);
      }
    }

    // Phase 05.7.9 — per-product totals for the units-cell tooltip.
    // We need to surface, alongside the per-campaign allocated share, the
    // TOTAL Shopify units/revenue for this campaign's mapped products
    // across ALL platforms. That gives the operator the denominator
    // ("got X of N total") so a rounded "2" is grounded in reality.
    //
    // Built once here as a (storeId, productId) -> totals map; per-campaign
    // tooltip summation happens in the loop below.
    const productTotalsByStoreProduct = new Map<
      string,
      { revenue: number; units: number; orders: number }
    >();
    for (const [storeId, productRev] of productsByStore) {
      for (const p of productRev) {
        productTotalsByStoreProduct.set(`${storeId}::${p.productId}`, {
          revenue: p.netRevenueCad,
          units: p.units,
          orders: p.orders,
        });
      }
    }

    // Step 4: build the per-key info object with the trust signal.
    const out = new Map<string, TrueRevenueInfo>();
    for (const a of aggregated) {
      const k = campaignKey(a.storeId, a.platform, a.campaignId);
      const mappedIds = productMap[k] ?? [];
      if (mappedIds.length === 0) continue; // no mapping → no true-ROAS row
      const alloc = allocations.get(k) ?? {
        revenue: 0,
        units: 0,
        deterministicRevenue: 0,
        deterministicUnits: 0,
      };
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
      const perStoreIndex = productToCampaigns.get(a.storeId);
      if (perStoreIndex) {
        for (const pid of mappedIds) {
          const keys = perStoreIndex.get(pid);
          if (!keys) continue;
          for (const otherKey of keys) {
            if (otherKey !== k) sharedKeys.add(otherKey);
          }
        }
      }
      const shared = sharedKeys.size;
      // Daily Meta conv-value series for this specific campaign — used by
      // attribution analysis for outlier detection + window stability.
      // We pull from the raw rows (already filtered to range by aggregate)
      // and bucket by date.
      const dailyMeta = (() => {
        const byDate = dailyMetaByCampaign.get(campaignKey(a.storeId, a.platform, a.campaignId));
        return Array.from(byDate ?? [], ([date, value]) => ({ date, value }));
      })();

      // Deterministic per-order attribution. Uses utm_id (campaignId) for
      // primary matching when present, falls back to utm_campaign by name.
      // Returns null for non-Meta campaigns or when the attribution tab is
      // empty (first deploy). Daily series enables Bayesian / window /
      // outlier analysis.
      let attribution = analyzeAttribution(
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

      // Phase 05.7.9c — Two-method-agreement trust upgrade.
      //
      // The attribution analyzer's trust is computed from click-id
      // coverage alone (% of Meta's claim that we could match to a
      // tagged order). When coverage is low it labels the chip "לא אמין"
      // even if the Shopify product-mapping ALSO confirms Meta's claim.
      //
      // Two independent methods (click-id + product mapping) agreeing is
      // STRONGER evidence than either alone, so a small gap between
      // metaClaim and trueRevenue (via mapping) deserves a trust bump:
      //
      //   - gap < 10% → high (override low/medium)
      //   - gap < 20% → at least medium (override low)
      //
      // Operator feedback 2026-05-22: "if both methods agree to within
      // a few percent and the chip still says 'not trusted', that's
      // wrong — the agreement IS the trust signal."
      if (attribution && a.conversionValue > 0 && trueRevenue > 0) {
        const gap =
          Math.abs(trueRevenue - a.conversionValue) /
          Math.max(a.conversionValue, trueRevenue);
        if (gap < 0.1 && attribution.trust.level !== 'high') {
          attribution = {
            ...attribution,
            trust: {
              level: 'high',
              label: 'אמין',
              // Score = 100 - gap%. With gap=5% the score is 95, etc.
              // Always >= 90 in this branch by construction.
              score: Math.round(100 - gap * 100),
            },
            reasons: [
              `הסכמה בין Meta ל-Shopify mapping בתוך ${(gap * 100).toFixed(1)}% — שתי שיטות עצמאיות חופפות, סיגנל חזק`,
              ...attribution.reasons,
            ],
          };
        } else if (gap < 0.2 && attribution.trust.level === 'low') {
          attribution = {
            ...attribution,
            trust: {
              level: 'medium',
              label: 'חלקי',
              score: Math.max(attribution.trust.score, Math.round(70 - gap * 100)),
            },
            reasons: [
              `Meta ↔ Shopify mapping מסכימים בתוך ${(gap * 100).toFixed(0)}% — חיזוק חלקי לאמינות, גם ש-click-id coverage נמוך`,
              ...attribution.reasons,
            ],
          };
        }
      }
      // Phase 05.7.9 — sum the totals across this campaign's mapped
      // products. A campaign mapped to [P1, P2] gets `productTotals =
      // P1.totals + P2.totals`. Provides the tooltip denominator.
      const productTotals = { revenue: 0, units: 0, orders: 0 };
      for (const pid of mappedIds) {
        const t = productTotalsByStoreProduct.get(`${a.storeId}::${pid}`);
        if (!t) continue;
        productTotals.revenue += t.revenue;
        productTotals.units += t.units;
        productTotals.orders += t.orders;
      }
      out.set(k, {
        trueRevenue,
        trueUnits,
        metaClaim: a.conversionValue,
        mappedCount: mappedIds.length,
        sharedCampaigns: shared,
        spend: a.spend,
        confidence: computeConfidence(trueRevenue, a.conversionValue, a.spend, shared, mappedIds.length),
        attribution,
        productTotals,
        deterministicRevenue: alloc.deterministicRevenue,
        deterministicUnits: alloc.deterministicUnits,
      });
    }
    return out;
  }, [mode, data, productsResp, ordersAttrResp, productMap, aggregated, allCampaignRows, localRange, dailyMetaByCampaign, productToCampaigns]);
}
