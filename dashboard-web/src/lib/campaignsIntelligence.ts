/**
 * Phase 2026-05-28 Plan 4a Task 1 — campaigns intelligence orchestrator.
 *
 * `buildHealthByKey` is the pure extraction of `CampaignsTable`'s existing
 * `healthByKey` memo body. Given per-campaign aggregates, true-revenue
 * lookups, daily CPM/ROAS trajectories, product mappings, and the raw
 * per-day campaigns/products rows for the visible range, it orchestrates:
 *
 *   1. `computeCampaignHealth`             — base 0..100 health score
 *      (profitability + volume + trajectory + attribution clarity).
 *   2. `computeMultiMappingCohort`         — peer-set with which this
 *      campaign shares Shopify product mappings (intra-platform =
 *      competing for the same audience; cross-platform = independent
 *      channels). Null when the campaign is solo on its products.
 *   3. `detectProductCannibalization`      — verdicts per multi-mapped
 *      product (early-half vs late-half spend↑/value↓ test). We filter
 *      to this campaign's mapped products and take the WORST risk.
 *   4. `applyCohortAdjustmentOnce`         — combines the cohort context
 *      with the base score (weakest in cohort → −5; high cannibalization
 *      → −10; leader → +3; etc).
 *
 * The audit fix HIGH-01 (2026-05-23) is preserved: the secondary tie-break
 * lookup `roasShopifyPlatformByKey` uses `deterministicRevenue / spend`,
 * not `trueRevenue / spend`, so the cohort ranker's secondary actually
 * differs from the primary.
 *
 * The original `healthByKey` memo lives at `CampaignsTable.tsx` lines
 * 738-842 (commit 48d0d69). This extraction is byte-for-byte equivalent;
 * the memo is expected to be replaced with `buildHealthByKey(...)` in a
 * follow-up task.
 */

import {
  computeCampaignHealth,
  applyCohortAdjustmentOnce,
  type CampaignHealth,
} from './campaignHealthScore';
import { computeMultiMappingCohort } from './multiMappingCohort';
import { detectProductCannibalization } from './cannibalizationDetection';
import { analyzeCpmVsRoas, type DailyCpmRoasPoint } from './cpmRoasAnalysis';
import { campaignKey, type ProductMap } from './campaignProductMap';
import { getTodayInIsraelTz } from './dateRange';
import type { Aggregated } from './campaignsAggregator';
import type { TrueRevenueInfo } from './hooks/useCampaignTrueRevenue';
import type { DateRange } from './types';
import { isAdsEnabled, type AdStateMap, type AdPlatform } from './adState';

export interface CampaignsDailyRow {
  date: string;
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;
}

export interface ProductsDailyRow {
  date: string;
  storeId: string;
  productId: string;
  productTitle: string;
  netRevenue: number;
}

export interface BuildHealthByKeyInputs {
  /** Per-campaign aggregates over the visible range. */
  aggregated: Aggregated[];
  /** Per-campaign true-revenue lookups (Shopify-attributed). */
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  /** Per-campaign daily CPM/ROAS trajectory (for trajectory health signal). */
  dailyByCampaign: Map<string, DailyCpmRoasPoint[]>;
  /** Per-campaign product mapping: `{[campaignKey]: productId[]}`. */
  productMap: ProductMap;
  /** Raw per-day campaign rows (for cannibalization detection). */
  campaignsDaily: CampaignsDailyRow[];
  /** Raw per-day product rows (for cannibalization detection). */
  productsDaily: ProductsDailyRow[];
  /** Visible date range. */
  localRange: DateRange;
  /**
   * ads-off Phase 4 — per (store,platform) toggle map (missing key = ON).
   * When a campaign's (storeId, platform) is OFF and spend === 0, the health
   * score is forced to the existing insufficient/unknown state so the operator
   * sees ⏳ instead of a misleading F/red grade for a campaign with no data.
   * Optional — absence treated as empty map (all ON, existing behaviour).
   */
  adStateMap?: AdStateMap;
}

/**
 * Pure function: orchestrates `computeCampaignHealth` + cohort + cannibalization
 * lib calls per aggregated campaign row and returns a Map keyed by campaign key.
 *
 * Extracted byte-for-byte from CampaignsTable's `healthByKey` memo. Behavior
 * is identical. Algorithm:
 *   1. Build per-key ROAS lookups: `roasShopifyByKey` (true/spend) and
 *      `roasShopifyPlatformByKey` (deterministic/spend, audit fix HIGH-01).
 *   2. For each aggregated row, compute base health + cohort + cannibalization
 *      verdict and combine via `applyCohortAdjustmentOnce`.
 *   3. Return the Map.
 */
export function buildHealthByKey(inputs: BuildHealthByKeyInputs): Map<string, CampaignHealth> {
  const {
    aggregated,
    trueRevenueByKey,
    dailyByCampaign,
    productMap,
    campaignsDaily,
    productsDaily,
    localRange,
    adStateMap = {},
  } = inputs;

  const out = new Map<string, CampaignHealth>();

  // P1-7 (audit 2026-06-10): the trajectory signal is computed from
  // COMPLETED days only. dailyByCampaign (built component-side from the
  // visible range) includes the in-progress Israel day, whose
  // lagged-attribution ROAS understates the day every morning —
  // analyzeCpmVsRoas then read a fake "ROAS collapsing" recent half and the
  // health grade swung B↔C by time of day. The chart display keeps today;
  // only the health-trajectory input drops it (mirrors the insights.ts
  // z-score / streak today-1 anchor and detectCampaignDied).
  const todayIl = getTodayInIsraelTz();

  // Build per-key ROAS lookups from trueRevenueByKey so the cohort module can
  // rank without re-computing.
  //
  // Audit fix 2026-05-23 (HIGH-01 multi-mapping): the secondary
  // `roasShopifyPlatformByKey` MUST differ from the primary so the
  // tie-breaker actually tie-breaks. Pre-fix, both maps were fed the same
  // `roasShopifyByKey` — secondary contributed zero discrimination. Use
  // `deterministicRevenue / spend` for the platform-only signal (the same
  // number rendered by the "ROAS Shopify · פלטפורמה" column).
  const roasShopifyByKey = new Map<string, number>();
  const roasShopifyPlatformByKey = new Map<string, number>();
  for (const [k, info] of trueRevenueByKey.entries()) {
    roasShopifyByKey.set(k, info.spend > 0 ? info.trueRevenue / info.spend : 0);
    roasShopifyPlatformByKey.set(
      k,
      info.spend > 0 ? info.deterministicRevenue / info.spend : 0,
    );
  }

  for (const a of aggregated) {
    // ads-off Phase 4 guard: a campaign whose (storeId, platform) is toggled OFF
    // and has no spend in this range has no meaningful health signal. Return the
    // existing insufficient/unknown shape so the operator sees ⏳ instead of a
    // misleading F/red grade.
    //
    // Note: platform in Aggregated is title-case ('Meta', 'Google', 'TikTok');
    // adStateKey expects lowercase — mirror the same toLowerCase used in
    // isInsightSuppressedByAdState (adState.ts line 88).
    //
    // off-but-spend>0 campaigns (historical data before the toggle) are left
    // alone — they carry real performance data that should still be graded.
    if (a.spend === 0 && !isAdsEnabled(adStateMap, a.storeId, a.platform.toLowerCase() as AdPlatform)) {
      out.set(a.key, {
        score: 0,
        grade: 'unknown',
        components: { profitability: 0, volume: 0, trajectory: 0, attributionClarity: 0, cohortAdjustment: 0 },
        reasons: ['מודעות כבויות עבור פלטפורמה זו — אין נתוני הוצאה לניקוד. הפעל את הפלטפורמה כדי לקבל ציון.'],
        insufficient: true,
      });
      continue;
    }

    const info = trueRevenueByKey.get(campaignKey(a.storeId, a.platform, a.campaignId));
    const series = dailyByCampaign.get(a.key);
    // P1-7: exclude the in-progress IL day from the trajectory evaluation
    // (see comment above). The 5-day gate applies to COMPLETED days.
    const completedSeries = series?.filter((p) => p.date !== todayIl);
    const trajectory =
      completedSeries && completedSeries.length >= 5
        ? analyzeCpmVsRoas(completedSeries)
        : undefined;
    const base = computeCampaignHealth({
      aggregated: a,
      trueRevenueInfo: info,
      cpmRoasAnalysis: trajectory,
    });

    // Cohort adjustment — only fires when this campaign actually has a cohort
    // (>= 2 members sharing a product). For solo campaigns (no shared
    // products), cohort is null and we keep the base.
    const cohort = computeMultiMappingCohort({
      currentCampaignKey: a.key,
      productMap,
      aggregated,
      roasShopifyByKey,
      // Audit fix 2026-05-23 (HIGH-01): real platform-deterministic ROAS as
      // the secondary tie-breaker. Pre-fix this also passed
      // `roasShopifyByKey`, making the tertiary `spend` the de-facto
      // secondary (and the documented secondary a no-op).
      roasShopifyPlatformByKey,
    });
    // Take the WORST cannibalization risk across this campaign's mapped
    // products in the visible range. It's cheap (O(products × campaigns)),
    // bounded, runs once per aggregated change.
    //
    // Audit fix 2026-05-23 (a/WARN-6): `composition_changed` added to the
    // union so the assignment from `detectProductCannibalization`'s
    // `CannibalizationRisk` is type-correct without an implicit cast.
    // composition_changed is informational only — it doesn't get bumped up
    // the severity ladder below (the `if (v.risk === ...)` chain only
    // matches low/medium/high), and applyCohortAdjustmentOnce's switch lets
    // it fall through to zero delta. Net effect: composition_changed never
    // silently overwrites a worse risk that's already been seen.
    let worstRisk:
      | 'none'
      | 'low'
      | 'medium'
      | 'high'
      | 'insufficient'
      | 'composition_changed' = 'none';
    if (cohort) {
      const verdicts = detectProductCannibalization({
        range: localRange,
        storeId: a.storeId,
        productMap,
        campaignsDaily,
        productsDaily,
      });
      // Filter verdicts to products this specific campaign maps —
      // adjustment is per-campaign, not store-wide.
      const myProducts = new Set(productMap[a.key] ?? []);
      const myVerdicts = verdicts.filter(v => myProducts.has(v.productId));
      for (const v of myVerdicts) {
        // Severity order: high > medium > low > insufficient > none.
        if (v.risk === 'high') worstRisk = 'high';
        else if (v.risk === 'medium' && worstRisk !== 'high') worstRisk = 'medium';
        else if (v.risk === 'low' && worstRisk !== 'high' && worstRisk !== 'medium')
          worstRisk = 'low';
      }
    }

    const adjusted = cohort
      ? applyCohortAdjustmentOnce(base, {
          isLeader: cohort.isLeader,
          isWeakest: cohort.isWeakest,
          cohortSize: cohort.totalMembers,
          cannibalizationRisk: worstRisk,
        })
      : base;
    out.set(a.key, adjusted);
  }

  return out;
}
