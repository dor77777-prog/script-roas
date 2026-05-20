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
    // FIX-21 (5.2.2.1): early exit for null summary or non-Meta platform — analyzer is never called in those cases.
    if (!summary || summary.platform !== 'Meta') return new Map<string, Array<{ date: string; value: number }>>();
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
    if (!summary || summary.platform !== 'Meta') return out;
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
