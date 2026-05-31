/**
 * Task 3.1 — Home-tab data adapters.
 *
 * Pure transforms that shape the existing `aggregate`, `aggregateByStore`,
 * `dailySeries` outputs into the prop shapes <CommandCenterHero>,
 * <PerStoreRow>, and <RoasTargetChart> expect.
 *
 * Keeping these out of Dashboard.tsx so they can be unit-tested without a
 * React tree — the Dashboard file is the orchestration layer only.
 */

import type {
  Aggregate,
  StoreAgg,
  DailySeries,
} from '@/lib/analytics';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type {
  CommandCenterDelta,
  CommandCenterPeriod,
} from '@/components/home/CommandCenterHero';
import type {
  PerStoreData,
  PerStorePlatformCpm,
} from '@/components/home/PerStoreRow';
import type {
  RoasChartData,
  RoasChartKpis,
} from '@/components/home/RoasTargetChart';
import type {
  RoasChartPoint,
} from '@/lib/synthesis/roasChart';
import { storeHasTikTok } from '@/lib/platformsByStore';

/* --------------------------------------------------------------------------
 * CommandCenterHero
 * -------------------------------------------------------------------------- */

export interface BlendedCpm {
  cpm: number;
  impressions: number;
  spend: number;
}

/**
 * Compute period blended CPM from a CampaignsResponse + scope. Returns
 * 0 / 0 / 0 when impressions are missing — caller renders "—" in that case.
 */
export function aggregateCpm(
  rows: CampaignsResponse['rows'] | undefined,
  from: string,
  to: string,
  store: string,
): BlendedCpm {
  if (!rows || rows.length === 0) {
    return { cpm: 0, impressions: 0, spend: 0 };
  }
  let spend = 0;
  let impressions = 0;
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (store !== 'All' && r.storeName !== store) continue;
    spend += r.spend;
    impressions += r.impressions;
  }
  return {
    spend,
    impressions,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
  };
}

/**
 * Reshape an `aggregate()` Aggregate + CPM into the
 * <CommandCenterHero current=…> prop. trueNetProfit is preferred over
 * the legacy net (matches KpiCards behaviour).
 */
export function toHeroPeriod(
  agg: Aggregate,
  cpm: BlendedCpm,
  ordersTotal: number,
): CommandCenterPeriod {
  return {
    roas: agg.roas > 0 ? agg.roas : null,
    netProfit: agg.trueNetProfit,
    revenue: agg.revenue,
    spend: agg.spend,
    cpm: cpm.cpm > 0 ? cpm.cpm : null,
    orders: ordersTotal,
  };
}

/**
 * Delta vs. previous period. Each delta is null when the previous baseline
 * is empty so <CommandCenterHero> can suppress the line cleanly (rather
 * than render a misleading "+∞%" against a 0 baseline).
 */
export function toHeroDelta(
  cur: Aggregate,
  prev: Aggregate,
  curCpm: BlendedCpm,
  prevCpm: BlendedCpm,
  curOrders: number,
  prevOrders: number,
): CommandCenterDelta {
  const baselineEmpty = prev.spend === 0 && prev.revenue === 0;
  return {
    roas: baselineEmpty || prev.roas === 0 ? null : cur.roas - prev.roas,
    netProfit: baselineEmpty ? null : cur.trueNetProfit - prev.trueNetProfit,
    revenuePct:
      baselineEmpty || prev.revenue === 0
        ? null
        : (cur.revenue - prev.revenue) / prev.revenue,
    spendPct:
      baselineEmpty || prev.spend === 0
        ? null
        : (cur.spend - prev.spend) / prev.spend,
    cpmPct:
      curCpm.cpm > 0 && prevCpm.cpm > 0
        ? (curCpm.cpm - prevCpm.cpm) / prevCpm.cpm
        : null,
    orders: baselineEmpty ? null : curOrders - prevOrders,
  };
}

/**
 * Build the featured Net-Profit sparkline series — one value per calendar
 * day in the period, accumulated across visible stores. Pulls from the
 * already-computed DailySeries so the sparkline mirrors the chart shape
 * other Home components consume.
 *
 * Each per-store ROAS is `number | null`; for the spark we only need a
 * proxy of profit shape — we use `totalRevenue - totalSpend` (operating
 * profit) since DailySeries already carries those two and they're a
 * tight proxy for the featured-card big number (the actual trueNetProfit
 * subtracts COGS + fees + fixed costs but those are flat-ish per day, so
 * the SHAPE of the spark matches even without them).
 */
export function toNetSparkValues(series: DailySeries[]): number[] {
  if (!series || series.length === 0) return [];
  return series.map((d) => d.totalRevenue - d.totalSpend);
}

/* --------------------------------------------------------------------------
 * PerStoreRow
 * -------------------------------------------------------------------------- */

interface CampaignsByStorePlatformAgg {
  spend: number;
  impressions: number;
}

/**
 * Reshape `aggregateByStore` output into the <PerStoreRow stores=…> prop.
 *
 * Per-platform CPM is computed by re-walking the campaigns response so the
 * cards always see the platform breakdown the dashboard already shows
 * elsewhere (TodayLive). We only include a platform key when it has spend
 * for the period — which matches the mockup's "Google · לא פעיל היום"
 * caption (rendered as omitted platforms downstream).
 */
export function toPerStoreData(
  storeAggs: StoreAgg[],
  campaignsRows: CampaignsResponse['rows'] | undefined,
  range: { from: string; to: string },
  ordersByStore: Record<string, number>,
  storeIdByName: Record<string, string> = {},
): PerStoreData[] {
  // Aggregate per (store, platform) once so the inner loop below is O(1) per
  // store. Spend + impressions are summed across the requested range only.
  const byStorePlatform = new Map<string, CampaignsByStorePlatformAgg>();
  if (campaignsRows) {
    for (const r of campaignsRows) {
      if (r.date < range.from || r.date > range.to) continue;
      const k = `${r.storeName}__${r.platform.toLowerCase()}`;
      const e = byStorePlatform.get(k) ?? { spend: 0, impressions: 0 };
      e.spend += r.spend;
      e.impressions += r.impressions;
      byStorePlatform.set(k, e);
    }
  }

  function perPlatformCpm(
    storeName: string,
  ): Partial<Record<'meta' | 'google' | 'tiktok', PerStorePlatformCpm>> {
    const out: Partial<Record<'meta' | 'google' | 'tiktok', PerStorePlatformCpm>> = {};
    for (const plat of ['meta', 'google', 'tiktok'] as const) {
      const v = byStorePlatform.get(`${storeName}__${plat}`);
      if (!v || v.spend <= 0) continue;
      // Skip TikTok for stores that genuinely don't have it wired AND have
      // 0 spend — guards a stuck-impression edge from polluting the row.
      if (plat === 'tiktok' && !storeHasTikTok(storeName) && v.spend === 0) {
        continue;
      }
      out[plat] = {
        cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
        spend: v.spend,
      };
    }
    return out;
  }

  return storeAggs.map((s) => ({
    storeId: storeIdByName[s.store] ?? s.store,
    storeName: s.store,
    spend: s.spend,
    revenue: s.revenue,
    orders: ordersByStore[s.store] ?? 0,
    aov:
      (ordersByStore[s.store] ?? 0) > 0
        ? s.revenue / (ordersByStore[s.store] ?? 1)
        : null,
    roas: s.roas > 0 ? s.roas : null,
    updatedAt: null,
    perPlatformCpm: perPlatformCpm(s.store),
  }));
}

/* --------------------------------------------------------------------------
 * RoasTargetChart
 * -------------------------------------------------------------------------- */

/**
 * Build the chart point series from a DailySeries collection. Each point
 * is `{ date, roas }` where roas==null on days with no spend (gap).
 */
export function toChartPoints(series: DailySeries[]): RoasChartPoint[] {
  if (!series) return [];
  return series.map((d) => ({
    date: d.date,
    roas: d.totalSpend > 0 ? d.totalRoas : null,
  }));
}

/**
 * KPI strip values for the RoasTargetChart — driven by the period
 * aggregate + the period CPM.
 */
export function toChartKpis(agg: Aggregate, cpm: BlendedCpm): RoasChartKpis {
  return {
    revenue: agg.revenue,
    roas: agg.roas,
    spend: agg.spend,
    // Per spec the chart KPI strip surfaces "רווח תפעולי" (Gross Profit ≈
    // revenue − ad spend − COGS) — netProfit is the legacy field name and
    // is exactly that calculation.
    netProfit: agg.netProfit,
    cpm: cpm.cpm,
  };
}

/**
 * Wrap everything into the <RoasTargetChart data=…> prop.
 */
export function toChartData(
  series: DailySeries[],
  agg: Aggregate,
  cpm: BlendedCpm,
  prevAgg: Aggregate | null,
): RoasChartData {
  const points = toChartPoints(series);
  const daysActive = points.filter((p) => p.roas != null).length;
  return {
    points,
    pins: [],
    kpis: toChartKpis(agg, cpm),
    prevPeriod:
      prevAgg && prevAgg.spend > 0
        ? { roas: prevAgg.roas, revenue: prevAgg.revenue }
        : undefined,
    daysActive,
  };
}
