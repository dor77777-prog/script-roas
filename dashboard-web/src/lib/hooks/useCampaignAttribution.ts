import { useMemo } from 'react';
import {
  analyzeAttributionForAdSet,
  type AttributionAnalysis,
} from '@/lib/attributionAnalysis';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';

/**
 * Shape of the per-campaign summary the drawer aggregates from `rows`.
 * Only the fields the per-ad-set attribution memo reads are typed here —
 * any additional fields on the actual drawer summary object are ignored.
 *
 * Promoted from the anonymous `useMemo` return type at
 * CampaignDrawer.tsx:190-269 so this hook can declare a concrete input
 * type instead of an inferred-narrow duck shape.
 */
export type CampaignDrawerSummary = {
  campaignName: string;
  storeName: string;
  platform: string;
  spend: number;
  value: number;
  clicks: number;
  impressions: number;
  conversions: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpa: number;
  dailyArr: Array<{ date: string; spend: number; value: number }>;
  adSets: Array<{
    id: string;
    name: string;
    storeId: string;
    platform: string;
    campaignId: string;
    spend: number;
    value: number;
    clicks: number;
    impressions: number;
    conversions: number;
    adSetBudgetCad: number | null;
    roas: number;
  }>;
  activeDays: number;
};

/**
 * Per-ad-set attribution analysis. Pre-computes once per orders/rows/range
 * change instead of inside the row IIFE on every render — was walking the
 * full orders array per cell × per render before. (IN5-01)
 *
 * Internally also memoizes `dailyMetaByAdSet` — the per-ad-set daily
 * Meta conv-value series required by
 * analyzeAttributionForAdSet → computeWindowStability / detectOutlierDays.
 * Without it those features are silently inert at the ad-set level.
 *
 * Returns `Map<adSetKey, AttributionAnalysis | null>` keyed by
 * `adSetId || adSetName || '(אחר)'` — same formula the drawer's summary
 * aggregation uses, so `a.id` (which may be '') reliably maps back.
 */
export function useCampaignAttribution(opts: {
  summary: CampaignDrawerSummary | null;
  rows: CampaignRow[];
  ordersAttrData: OrdersAttributionResponse | undefined;
  rangeFrom: string;
  rangeTo: string;
}): Map<string, AttributionAnalysis | null> {
  const { summary, rows, ordersAttrData, rangeFrom, rangeTo } = opts;

  // Per-ad-set daily Meta conv-value series. Required by
  // analyzeAttributionForAdSet → computeWindowStability / detectOutlierDays;
  // without it those features are silently inert at the ad-set level. Built
  // once in a useMemo (instead of per-render inside the row IIFE) so the
  // walk over `rows` happens only when rows change, not on every sort/state
  // tick. Keyed by the same `adSetId || adSetName || '(אחר)'` formula the
  // summary aggregation uses, so a.id (which may be '') reliably maps back.
  const dailyMetaByAdSet = useMemo(() => {
    // d/CR-06 (audit 2026-05-23): the Meta-only gate here used to short-
    // circuit the entire pipeline for TikTok ad-sets, so the "ROAS Shopify"
    // column rendered "—" for every TikTok row even though AdSetTable now
    // permits TikTok drill-down (Phase 05.7.9c extended attribution to
    // TikTok at the CAMPAIGN level via analyzeAttribution → see line ~310
    // in lib/attributionAnalysis.ts). The hook now only short-circuits on
    // null summary; per-platform fan-out happens inside the analyzer.
    //
    // NOTE — DEFERRED WORK: `analyzeAttributionForAdSet` and
    // `analyzeAttributionForAd` (lib/attributionAnalysis.ts:717, :767) STILL
    // hard-return null for non-Meta platforms. That file is owned by Wave 2
    // (Agent owning lib/attributionAnalysis.ts), so the platform widening
    // there is a follow-up. With this hook-level fix the architecture
    // already supports TikTok end-to-end; only the analyzer line needs to
    // be widened to `platform !== 'Meta' && platform !== 'TikTok'` for the
    // chip to start showing real numbers on TikTok ad-sets.
    if (!summary) return new Map<string, Array<{ date: string; value: number }>>();
    const buckets = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const key = r.adSetId || r.adSetName || '(אחר)';
      let b = buckets.get(key);
      if (!b) {
        b = new Map<string, number>();
        buckets.set(key, b);
      }
      b.set(r.date, (b.get(r.date) ?? 0) + r.conversionValue);
    }
    const out = new Map<string, Array<{ date: string; value: number }>>();
    for (const [key, byDate] of buckets) {
      out.set(key, Array.from(byDate, ([date, value]) => ({ date, value })));
    }
    return out;
  }, [rows, summary]);

  // Per-ad-set attribution analysis. Pre-computes once per orders/rows/range
  // change instead of inside the row IIFE on every render — was walking the
  // full orders array per cell × per render before. (IN5-01)
  return useMemo(() => {
    const out = new Map<string, AttributionAnalysis | null>();
    // d/CR-06 (audit 2026-05-23): platform gate removed. See the comment in
    // dailyMetaByAdSet above for context — short version: this hook now
    // lets the analyzer decide what to do per platform. For TikTok, today
    // the analyzer still returns null (deferred to a Wave 2 / analyzer
    // owner edit), so the user-visible behaviour is unchanged for TikTok;
    // but the architectural gate is in the right place now, and a one-line
    // change in analyzeAttributionForAdSet/ForAd will light up the chip
    // without touching this hook again.
    if (!summary) return out;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return out;
    if (!rangeFrom || !rangeTo) return out;
    for (const a of summary.adSets) {
      const key = a.id || a.name || '(אחר)';
      out.set(key, analyzeAttributionForAdSet(
        {
          adSetId: a.id,
          adSetName: a.name,
          storeId: a.storeId,
          platform: a.platform,
          metaClaim: a.value,
          spend: a.spend,
        },
        ordersRows,
        rangeFrom,
        rangeTo,
        dailyMetaByAdSet.get(key) ?? [],
      ));
    }
    return out;
  }, [summary, ordersAttrData, rows, rangeFrom, rangeTo, dailyMetaByAdSet]);
}
