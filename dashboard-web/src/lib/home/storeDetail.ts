/**
 * Per-store drill-down MODAL adapter (Home tab).
 *
 * Pure transform from the data the HomeTab already holds → the
 * `StoreDetailData` shape <StoreDetailModal> renders. NO network: every input
 * (current + previous StoreAgg, the per-day DailySeries, the campaigns rows,
 * the per-store order count) is already in HomeTab state when the operator
 * clicks a store card.
 *
 * Kept out of Dashboard.tsx (orchestration only) so it can be unit-tested
 * without a React tree — mirrors `lib/home/adapters.ts`.
 *
 * Money/profit semantics mirror the existing Home adapters:
 *   • operatingProfit = revenue − ad spend − COGS  (same as toHeroPeriod —
 *     the Home surface contextualises ads + inventory, not fixed overhead).
 *   • deltas are fractional (cur − prev) / prev, signed, computed ONLY where
 *     the previous value exists and is non-zero — otherwise null. No fake 0s.
 *   • roas null when the agg ROAS is 0 (a 0-spend / 0-revenue store isn't a
 *     meaningful ratio) — mirrors PerStoreRow / toPerStoreData.
 *   • zeroSalesWithSpend = spend > 0 && revenue === 0 — mirrors PerStoreRow's
 *     "alarm-red" derivation so the modal header band matches the card.
 */

import type { StoreAgg, DailySeries } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';
import { normalizePlatform } from '@/components/ui/PlatformBadge';
import {
  computeNewCustomerMetrics,
  type FirstOrderInput,
  type NewCustomerMetrics,
} from '@/lib/home/newCustomerMetrics';

type PaidPlatform = 'meta' | 'google' | 'tiktok';

export interface StoreDetailPlatform {
  platform: PaidPlatform;
  spend: number;
  /** CPM in CAD (spend / impressions × 1000). null when impressions are 0. */
  cpm: number | null;
  /** value / spend. null when spend is 0 (can't divide). */
  roas: number | null;
}

export interface StoreDetailCampaign {
  name: string;
  platform: PaidPlatform;
  /** value / spend. null when spend is 0. */
  roas: number | null;
  spend: number;
  /** Platform-attributed revenue (Σ conversionValue), CAD. The IMPACT metric the
   *  list is ranked by (so tiny-spend high-ROAS campaigns don't dominate). */
  revenue: number;
  /** Platform-attributed orders/conversions (Σ conversions). */
  orders: number;
  /** Supabase store id (from the campaign row) — feeds the Campaigns-tab drill. */
  storeId: string;
  /** Platform-native campaign id — feeds the Campaigns-tab drill (c_drill). */
  campaignId: string;
}

export interface StoreDetailData {
  storeId: string;
  storeName: string;
  /** Range ROAS. null when the store has no meaningful ratio (0 spend/rev). */
  roas: number | null;
  /** spend > 0 && revenue === 0 — drives the header's alarm-red band. */
  zeroSalesWithSpend: boolean;
  /** ISO timestamp of the dataset's freshest write (page-global). */
  updatedAt: string | null;
  kpis: {
    spend: number | null;
    revenue: number | null;
    operatingProfit: number | null;
    orders: number | null;
    aov: number | null;
  };
  deltas: {
    spendPct: number | null;
    revenuePct: number | null;
    operatingProfitPct: number | null;
    ordersPct: number | null;
    aovPct: number | null;
  };
  /** Per-day ROAS for the store in ISO-date order. null = gap day (kept). */
  roasSeries: Array<{ date: string; roas: number | null }>;
  /** Per-platform breakdown. Only platforms with rows present are included. */
  platforms: StoreDetailPlatform[];
  /** Top-5 campaigns by ROAS desc. */
  topCampaigns: StoreDetailCampaign[];
  /** Per-store NC-ROAS / nCAC (new-customer lens). Scoped to this store; MER
   *  spend = cur.spend (mapping-aware). */
  newCustomer: NewCustomerMetrics;
}

export interface ToStoreDetailArgs {
  storeId: string;
  storeName: string;
  /** Current-range StoreAgg for the store. */
  cur: StoreAgg;
  /** Previous-range StoreAgg for the store, or null when unavailable. */
  prev: StoreAgg | null;
  /** Per-day DailySeries (same input the Home chart/hero consume). */
  series: DailySeries[];
  /** Campaign rows for the active range (from /api/campaigns). */
  campaignRows: CampaignRow[] | undefined;
  range: { from: string; to: string };
  /** Current-range order count for the store. */
  orders: number;
  /** Previous-range order count, or null when not supplied (no orders/aov delta). */
  prevOrders: number | null;
  /** Page-global freshest-write ISO timestamp. */
  updatedAt: string | null;
  /** Order rows carrying first-order classification (from /api/orders-attribution
   *  → OrderAttributionRow). Scoped per-store inside toStoreDetail. Optional for
   *  back-compat; defaults to [] (zeroed newCustomer block) when omitted. */
  firstOrderRows?: FirstOrderInput[];
}

/** operatingProfit = revenue − ad spend − COGS (mirrors toHeroPeriod). */
function operatingProfitOf(agg: { revenue: number; spend: number; cogs: number }): number {
  return agg.revenue - agg.spend - agg.cogs;
}

/**
 * Signed fractional delta (cur − prev) / prev. null when prev is missing,
 * zero, or non-finite (can't divide / would be a fake value).
 */
function fracDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0 || !Number.isFinite(prev)) return null;
  return (cur - prev) / prev;
}

interface PlatformAccum {
  spend: number;
  impressions: number;
  value: number;
}

interface CampaignAccum {
  name: string;
  platform: PaidPlatform;
  storeId: string;
  campaignId: string;
  spend: number;
  value: number;
  orders: number;
}

export function toStoreDetail(args: ToStoreDetailArgs): StoreDetailData {
  const { storeId, storeName, cur, prev, series, campaignRows, range, orders, prevOrders, updatedAt, firstOrderRows = [] } = args;

  const zeroSalesWithSpend = (cur.spend ?? 0) > 0 && cur.revenue === 0;
  const roas = cur.roas > 0 ? cur.roas : null;

  // ---- KPIs ----------------------------------------------------------------
  const curOperatingProfit = operatingProfitOf(cur);
  // AOV = gross order value at checkout ÷ order count (standard; stable on refund
  // days). Both from the same StoreAgg basis — never net÷gross (Wave 1 fix).
  const aov = orders > 0 ? cur.grossRevenue / orders : null;
  const kpis = {
    spend: cur.spend,
    revenue: cur.revenue,
    operatingProfit: curOperatingProfit,
    orders,
    aov,
  };

  // ---- Deltas vs previous range -------------------------------------------
  // Money deltas only when a prev StoreAgg is supplied; orders/aov deltas only
  // when prevOrders is ALSO supplied (else we can't compute them honestly).
  // prevAov shares the same gross÷orders basis as `aov` so the delta compares
  // like with like (Wave 1: AOV is gross-based, never net÷orders).
  const prevAov =
    prev != null && prevOrders != null && prevOrders > 0 ? prev.grossRevenue / prevOrders : null;
  const deltas = {
    spendPct: prev ? fracDelta(cur.spend, prev.spend) : null,
    revenuePct: prev ? fracDelta(cur.revenue, prev.revenue) : null,
    operatingProfitPct: prev ? fracDelta(curOperatingProfit, operatingProfitOf(prev)) : null,
    ordersPct: prev != null && prevOrders != null ? fracDelta(orders, prevOrders) : null,
    aovPct: aov != null && prevAov != null ? fracDelta(aov, prevAov) : null,
  };

  // ---- ROAS series (gap-preserving) ---------------------------------------
  // Walk in the order the series already carries (chronological from
  // dailySeries). Keep null per-store cells as null gap days for the chart.
  const roasSeries = series.map((d) => {
    const v = d.byStore[storeName];
    return { date: d.date, roas: typeof v === 'number' && Number.isFinite(v) ? v : null };
  });

  // ---- Per-platform + top campaigns ---------------------------------------
  const platformAccum = new Map<PaidPlatform, PlatformAccum>();
  const campaignAccum = new Map<string, CampaignAccum>();

  if (campaignRows) {
    for (const r of campaignRows) {
      if (r.date < range.from || r.date > range.to) continue;
      if (r.storeName !== storeName) continue;
      const plat = normalizePlatform(r.platform);
      if (plat !== 'meta' && plat !== 'google' && plat !== 'tiktok') continue;

      const p = platformAccum.get(plat) ?? { spend: 0, impressions: 0, value: 0 };
      p.spend += r.spend;
      p.impressions += r.impressions;
      p.value += r.conversionValue;
      platformAccum.set(plat, p);

      const key = `${plat}::${r.campaignId}`;
      const c =
        campaignAccum.get(key) ??
        { name: r.campaignName, platform: plat, storeId: r.storeId, campaignId: r.campaignId, spend: 0, value: 0, orders: 0 };
      c.spend += r.spend;
      c.value += r.conversionValue;
      c.orders += r.conversions;
      campaignAccum.set(key, c);
    }
  }

  // Stable platform order: Meta → Google → TikTok (matches PerStoreRow + chart).
  const platforms: StoreDetailPlatform[] = (['meta', 'google', 'tiktok'] as const)
    .map((plat) => {
      const a = platformAccum.get(plat);
      if (!a) return null;
      return {
        platform: plat,
        spend: a.spend,
        cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
        roas: a.spend > 0 ? a.value / a.spend : null,
      } satisfies StoreDetailPlatform;
    })
    .filter((p): p is StoreDetailPlatform => p !== null);

  // Top campaigns: ranked by REVENUE desc (the impact metric — so a tiny-spend
  // high-ROAS campaign doesn't outrank a high-revenue one), tiebreak spend desc,
  // top 5. ROAS + orders are surfaced per row for context (operator request
  // 2026-06-01: "top by ROAS AND by revenue/orders").
  const topCampaigns: StoreDetailCampaign[] = Array.from(campaignAccum.values())
    .map((c) => ({
      name: c.name,
      platform: c.platform,
      roas: c.spend > 0 ? c.value / c.spend : null,
      spend: c.spend,
      revenue: c.value,
      orders: c.orders,
      storeId: c.storeId,
      campaignId: c.campaignId,
    }))
    .sort((a, b) => (b.revenue !== a.revenue ? b.revenue - a.revenue : b.spend - a.spend))
    .slice(0, 5);

  // ---- Per-store NC-ROAS / nCAC -------------------------------------------
  // Scoped to this store; MER spend = cur.spend (the mapping-aware aggregate
  // already in the StoreAgg, never raw account totals). Guest checkouts stay
  // in unclassifiableShare, never folded into new/returning.
  const newCustomer = computeNewCustomerMetrics(firstOrderRows, cur.spend, storeName);

  return {
    storeId,
    storeName,
    roas,
    zeroSalesWithSpend,
    updatedAt,
    kpis,
    deltas,
    roasSeries,
    platforms,
    topCampaigns,
    newCustomer,
  };
}
