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
  CommandCenterSecondarySparklines,
} from '@/components/home/CommandCenterHero';
import type {
  PerStoreData,
  PerStorePlatformCpm,
} from '@/components/home/PerStoreRow';
import type {
  AnnotationPin,
  RoasChartData,
  RoasChartKpis,
} from '@/components/home/RoasTargetChart';
import type {
  RoasChartPoint,
} from '@/lib/synthesis/roasChart';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import { storeHasTikTok } from '@/lib/platformsByStore';
import {
  ANNOTATION_KIND_EMOJI,
  type Annotation,
} from '@/lib/annotations';

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
 * <CommandCenterHero current=…> prop.
 *
 * Two profit fields:
 *   • `operatingProfit` = revenue − ad spend − COGS. The hero's featured
 *     "רווח תפעולי" card uses this — it matches what the Home tab actually
 *     contextualises (ads + inventory). Fixed/recurring overhead is NOT
 *     subtracted here because the Home tab doesn't surface that context;
 *     surfacing trueNetProfit here would silently bake in costs the
 *     operator can't see on this screen.
 *   • `netProfit` keeps the legacy semantics (trueNetProfit — full net
 *     after fixed + recurring + fees) so P&L callers that read
 *     `period.netProfit` from this adapter (e.g. tests, the chart KPI
 *     strip) keep working unchanged.
 *
 * `cogs` is the period's cost-of-goods-sold total in CAD. Exposed so the
 * row-2 inventory hero card can render its dollar amount and the
 * "% of revenue" subtitle without recomputing it from a sibling field.
 * Replaces the prior `adSpendPctOfRevenue` field (the Ad-Spend ÷ Revenue
 * card it powered was retired 2026-05-31 in favour of an inventory card
 * the operator finds more actionable).
 */
export function toHeroPeriod(
  agg: Aggregate,
  cpm: BlendedCpm,
  ordersTotal: number,
): CommandCenterPeriod {
  const operatingProfit = agg.revenue - agg.spend - agg.cogs;
  return {
    roas: agg.roas > 0 ? agg.roas : null,
    netProfit: agg.trueNetProfit,
    operatingProfit,
    revenue: agg.revenue,
    spend: agg.spend,
    cpm: cpm.cpm > 0 ? cpm.cpm : null,
    orders: ordersTotal,
    cogs: agg.cogs,
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
  prevOrders: number | null,
): CommandCenterDelta {
  const baselineEmpty = prev.spend === 0 && prev.revenue === 0;
  const curOperatingProfit = cur.revenue - cur.spend - cur.cogs;
  const prevOperatingProfit = prev.revenue - prev.spend - prev.cogs;
  return {
    roas: baselineEmpty || prev.roas === 0 ? null : cur.roas - prev.roas,
    netProfit: baselineEmpty ? null : cur.trueNetProfit - prev.trueNetProfit,
    operatingProfit: baselineEmpty
      ? null
      : curOperatingProfit - prevOperatingProfit,
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
    orders: baselineEmpty || prevOrders == null ? null : curOrders - prevOrders,
    cogs: baselineEmpty ? null : cur.cogs - prev.cogs,
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

/**
 * Per-day series for the 5 secondary hero cards. Each array is the same
 * length as `series` (one entry per calendar day in the active range, in
 * ISO order) so the sparklines on every card stay temporally aligned —
 * the operator can compare shapes across cards without mentally
 * re-stretching them.
 *
 * Sources:
 *   - Spend / Revenue / ROAS are sliced straight off DailySeries (the
 *     same input the Net spark already uses, so no second pass over the
 *     row set).
 *   - Orders requires bucketing the raw orders-attribution rows by date
 *     because DailySeries doesn't carry order counts — the caller passes
 *     the `ordersRows` SWR payload directly so this adapter stays pure.
 *   - CPM needs (spend, impressions) per day; the campaigns SWR payload
 *     carries them, but the per-day buckets are produced here so the
 *     hero never inherits an unfiltered (multi-store) series when the
 *     operator narrows the global store filter.
 *
 * Each metric returns `undefined` (not `[]`) when its source rows are
 * missing — the hero treats `undefined` as "spark suppressed, leave the
 * card bare" while an empty array is still treated as "data loaded, no
 * days in range" and rendered as nothing.
 */
export function toSecondarySparklines(opts: {
  series: DailySeries[];
  range: { from: string; to: string };
  store: string;
  ordersRows?: Array<{ storeName: string; date: string }>;
  campaignsRows?: CampaignsResponse['rows'];
}): CommandCenterSecondarySparklines {
  const { series, range, store, ordersRows, campaignsRows } = opts;

  // Build the canonical ISO-date list once from `series` so every metric
  // bucket lines up with the existing chart x-axis. This guarantees every
  // returned array is length-equal (zero-filled days included).
  const dateOrder = series.map((d) => d.date);
  const dateIndex = new Map(dateOrder.map((d, i) => [d, i]));

  const spend   = series.map((d) => d.totalSpend);
  const revenue = series.map((d) => d.totalRevenue);
  // ROAS at the same per-day grain — `totalRoas` is already computed in
  // dailySeries (sum-revenue / sum-spend within the day, so it's a true
  // blended ROAS for that calendar day).
  const roas    = series.map((d) => d.totalRoas);

  // Orders: 1 increment per attribution row, scoped by the same store
  // filter the per-store row uses so a single-store view doesn't get a
  // blended-all sparkline. Days with zero orders sit at 0 (not undefined)
  // — matches the SVG geometry that treats a flat baseline as "no
  // activity yet" rather than "data missing".
  const orders = dateOrder.map(() => 0);
  if (ordersRows && ordersRows.length > 0) {
    for (const r of ordersRows) {
      if (r.date < range.from || r.date > range.to) continue;
      if (store !== 'All' && r.storeName !== store) continue;
      const idx = dateIndex.get(r.date);
      if (idx == null) continue;
      orders[idx]! += 1;
    }
  }

  // CPM: blended (spend / impressions × 1000) per day. Days with zero
  // impressions emit 0 — same baseline-flat semantics as orders.
  // `campaignsRows` may be undefined while the secondary SWR is still
  // loading; we propagate undefined so the spark hides rather than
  // showing a misleading flat line.
  let cpm: number[] | undefined;
  if (campaignsRows && campaignsRows.length > 0) {
    const cpmSpend = dateOrder.map(() => 0);
    const cpmImpr  = dateOrder.map(() => 0);
    for (const r of campaignsRows) {
      if (r.date < range.from || r.date > range.to) continue;
      if (store !== 'All' && r.storeName !== store) continue;
      const idx = dateIndex.get(r.date);
      if (idx == null) continue;
      cpmSpend[idx]! += r.spend;
      cpmImpr[idx]!  += r.impressions;
    }
    cpm = cpmSpend.map((s, i) => {
      const imp = cpmImpr[i]!;
      return imp > 0 ? (s / imp) * 1000 : 0;
    });
  }

  return {
    spend,
    revenue,
    roas,
    orders: ordersRows ? orders : undefined,
    cpm,
  };
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
 *
 * Mobile B1 — two OPTIONAL trailing args feed the per-store card's tiny
 * ROAS trend line + "▲/▼ X%" delta chip. Both default to omitted so every
 * existing caller / test keeps compiling and DESKTOP is unaffected:
 *
 *   • `series` (DailySeries[]) — the same per-day series the Home tab
 *     already computes. We read `entry.byStore[storeName]` for each day to
 *     build `roasSpark` (mirrors how `toSecondarySparklines` walks `series`).
 *     Non-finite cells (null gaps) are dropped; <2 finite points → the
 *     field is omitted so the card hides the spark (hero MiniSparkline
 *     contract).
 *   • `prevRoasByStore` (Record<string, number | null>) — each store's ROAS
 *     in the PREVIOUS equal-length range, for the delta. Supply the map
 *     (even partially) to opt a row into delta computation; omit it
 *     entirely to keep `roasDeltaPct` undefined (back-compat). A store
 *     present with prev 0 / null → `roasDeltaPct = null` (can't divide).
 */
export function toPerStoreData(
  storeAggs: StoreAgg[],
  campaignsRows: CampaignsResponse['rows'] | undefined,
  range: { from: string; to: string },
  ordersByStore: Record<string, number>,
  storeIdByName: Record<string, string> = {},
  dataLastWriteAt: string | null = null,
  series?: DailySeries[],
  prevRoasByStore?: Record<string, number | null>,
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

  /**
   * Mobile B1 — daily ROAS spark for one store. Walks the per-day `series`
   * (same input the hero/chart consume) and reads each day's per-store ROAS
   * from `entry.byStore[storeName]`, dropping non-finite (null gap) cells.
   * Returns `undefined` when <2 finite points remain (or no series) so the
   * card hides the spark, matching the hero MiniSparkline "<2 points" rule.
   */
  function roasSparkFor(storeName: string): number[] | undefined {
    if (!series || series.length === 0) return undefined;
    const pts: number[] = [];
    for (const d of series) {
      const v = d.byStore[storeName];
      if (typeof v === 'number' && Number.isFinite(v)) pts.push(v);
    }
    return pts.length >= 2 ? pts : undefined;
  }

  /**
   * Mobile B1 — fractional ROAS change vs the previous equal-length range.
   * `undefined` when no prev map was supplied at all (back-compat); `null`
   * when this store's prev ROAS is 0 / null / missing (can't divide); else
   * the signed fraction (cur − prev) / prev.
   */
  function roasDeltaPctFor(storeName: string, curRoas: number): number | null | undefined {
    if (prevRoasByStore === undefined) return undefined;
    const prev = prevRoasByStore[storeName];
    if (prev == null || prev === 0 || !Number.isFinite(prev)) return null;
    return (curRoas - prev) / prev;
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
    updatedAt: dataLastWriteAt,
    perPlatformCpm: perPlatformCpm(s.store),
    roasSpark: roasSparkFor(s.store),
    roasDeltaPct: roasDeltaPctFor(s.store, s.roas),
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
 * Map operator-logged annotations → `AnnotationPin[]` consumed by the
 * <RoasTargetChart> pins overlay.
 *
 * Filter contract (mirrors HeroOverview's legacy chart wiring):
 *   • `annotations` is already scope-filtered by the caller via
 *     `annotationsInScope(readAnnotations(), range, store)` — we trust that
 *     slice and do not re-filter here.
 *   • Pins outside the chart's `points` date range are silently dropped by
 *     the chart's `renderablePins` memo (date→index lookup misses), so we
 *     emit every in-scope annotation and let the chart decide what to
 *     render. Keeps the pin-count chip ("3 ציוני דרך") honest relative to
 *     the operator's full activity log, not the visible chart slice.
 *
 * Emoji defaulting: each AnnotationKind has a canonical emoji in
 * ANNOTATION_KIND_EMOJI; we pass it through so the chart pin's glyph matches
 * the AnnotationsPanel + StatusEventsFeed icons. The chart still falls back
 * to 💰 if `icon` is undefined (mockup default).
 */
export function annotationsToPins(annotations: Annotation[]): AnnotationPin[] {
  return annotations.map((a) => ({
    id: a.id,
    date: a.date,
    icon: ANNOTATION_KIND_EMOJI[a.kind],
    label: a.title,
  }));
}

/**
 * Wrap everything into the <RoasTargetChart data=…> prop.
 *
 * `annotations` is optional so legacy callers (tests, ad-hoc fixtures)
 * keep working without surfacing pins; the Home Dashboard threads in the
 * scope-filtered annotation list via `readAnnotations()` + a localStorage
 * subscription so the chart re-renders when the operator logs a new event.
 */
export function toChartData(
  series: DailySeries[],
  agg: Aggregate,
  cpm: BlendedCpm,
  prevAgg: Aggregate | null,
  annotations: Annotation[] = [],
): RoasChartData {
  const points = toChartPoints(series);
  const daysActive = points.filter((p) => p.roas != null).length;
  return {
    points,
    pins: annotationsToPins(annotations),
    kpis: toChartKpis(agg, cpm),
    prevPeriod:
      prevAgg && prevAgg.spend > 0
        ? { roas: prevAgg.roas, revenue: prevAgg.revenue }
        : undefined,
    daysActive,
  };
}

/* --------------------------------------------------------------------------
 * Attribution coverage (hero-only, honest)
 * -------------------------------------------------------------------------- */

export interface CoverageResult {
  total: number;
  covered: number;
  /** covered / total (0 when total === 0). */
  coverageShare: number;
  /** 1 − coverageShare (the unknown remainder). */
  unknownShare: number;
}

/** An order is "covered" when it carries ANY attribution signal. */
function hasAttributionSignal(o: OrderAttributionRow): boolean {
  // 'direct' and '' are the UNKNOWN bucket, NOT a signal. The writer's
  // catch-all for an unattributed order is 'direct' (never ''), so a bare
  // `source.trim() !== ''` check would count EVERY order as covered. Only an
  // ATTRIBUTED channel label (meta-paid/google-paid/.../-organic/email/
  // other-referral) counts here; click-ids and utm_* are handled below.
  const s = o.source.trim();
  return (
    o.fbclidPresent ||
    o.gclidPresent ||
    (s !== '' && s !== 'direct') ||
    o.utmSource.trim() !== '' ||
    o.utmMedium.trim() !== '' ||
    o.utmCampaign.trim() !== '' ||
    o.utmContent.trim() !== '' ||
    o.utmId.trim() !== '' ||
    o.utmTerm.trim() !== ''
  );
}

/**
 * Honest coverage from existing orders_attribution fields. Coverage =
 * orders with any click-id/UTM ÷ total; unknown = remainder. The two shares
 * sum to 1 and are NEVER redistributed across channels.
 */
export function computeCoverage(rows: readonly OrderAttributionRow[]): CoverageResult {
  const total = rows.length;
  if (total === 0) return { total: 0, covered: 0, coverageShare: 0, unknownShare: 0 };
  let covered = 0;
  for (const o of rows) if (hasAttributionSignal(o)) covered += 1;
  const coverageShare = covered / total;
  return { total, covered, coverageShare, unknownShare: 1 - coverageShare };
}

export interface CoverageChip {
  coverageShare: number;
  unknownShare: number;
  /** Visually prominent ONLY when the unknown share exceeds 30%. */
  prominent: boolean;
}

/** null when there are no orders (caller renders nothing). */
export function toCoverageChip(r: CoverageResult): CoverageChip | null {
  if (r.total === 0) return null;
  return {
    coverageShare: r.coverageShare,
    unknownShare: r.unknownShare,
    prominent: r.unknownShare > 0.3,
  };
}
