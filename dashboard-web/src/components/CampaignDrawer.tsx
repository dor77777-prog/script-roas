'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X,
  ExternalLink,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  TrendingUp,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Package,
  Edit3,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import {
  analyzeAttribution,
  analyzeAttributionForAdSet,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import {
  readOptimized,
  toggleOptimized,
} from '@/lib/campaignOptimized';
import { useDrawerEsc } from '@/lib/drawerStack';
import { AdsDrawer } from './AdsDrawer';
import { ProductPickerModal } from './ProductPickerModal';
import {
  readProductMap,
  campaignKey,
  setMappedProducts,
  type ProductMap,
} from '@/lib/campaignProductMap';

/**
 * Slide-in drawer that opens when the user clicks a campaign row in the
 * campaigns table. Linear / Vercel-style: full context, but the rest of the
 * dashboard remains in view so the user knows where they came from.
 *
 * Contents:
 *  - hero: campaign name, store badge, platform badge, ROAS chip, key
 *    aggregate KPIs (spend, value, conversions, CTR, CPC, CPA)
 *  - daily area chart of spend vs conversion value (the cleanest visual
 *    answer to "is this campaign worth it?")
 *  - all ad-sets within the campaign, ranked by spend, with their own
 *    ROAS / spend / conversions
 *  - "פתח ב-Ads Manager" button as the primary action
 */

type Props = {
  /** All rows matching this campaign in the selected period (any store,
   *  any ad-set, any day). The drawer aggregates internally. */
  rows: CampaignRow[];
  campaignId: string;
  open: boolean;
  onClose: () => void;
  /** Map of storeId → ad-account IDs, used to build deep links into the
   *  right account in Ads Manager. */
  adAccounts: AdAccountMap;
  /** The user's selected date range from the parent CampaignsTable.
   *  Distinct from min/max(rows.date), which narrows to *campaign-active*
   *  days only — for the channel breakdown we want all mapped-product
   *  orders in the user's window regardless of whether the campaign was
   *  spending on a given day. */
  rangeFrom: string;
  rangeTo: string;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

// Columns the drawer's ad-set table can be sorted by. Kept narrow because
// the drawer is a focused drilldown — full sortable surface is in
// CampaignsTable.
type AdSetSortKey = 'name' | 'spend' | 'budget' | 'value' | 'roas' | 'conversions';
type AdSetSortDir = 'asc' | 'desc';

export function CampaignDrawer({ rows, campaignId, open, onClose, adAccounts, rangeFrom, rangeTo }: Props) {
  // Drawer-local sort state. Default to spend-desc which matches the
  // pre-sortable hardcoded ordering, so users already comfortable with the
  // drawer don't see anything jump on first paint.
  const [sortKey, setSortKey] = useState<AdSetSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSetSortDir>('desc');

  function handleSort(key: AdSetSortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc'); // first click on a new column → "largest first"
    }
  }

  // Ad-set → ads drilldown (Meta only). Click on an ad-set row inside the
  // drawer opens the AdsDrawer scoped to that ad-set.
  const [adDrillSet, setAdDrillSet] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);

  // Product-mapping picker state. The map is cloud-synced; we hydrate on
  // mount and re-read when partners push changes from other devices.
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    setProductMap(readProductMap());
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, []);

  // Sales data — needed for the Meta-vs-Shopify reconciliation panel. Fetched
  // lazily only while the drawer is open. Bigger payload than campaigns but
  // SWR dedupes globally so the cost is paid once per session.
  const { data: productsData } = useSWR<ProductsResponse>(
    open ? '/api/products' : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Per-order attribution for the deterministic confidence panel.
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
    open ? '/api/orders-attribution' : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  // Optimization marks — shared with the main CampaignsTable via the same
  // localStorage key (lib/campaignOptimized), so a mark made in either place
  // shows in the other. Hydrate on mount, listen for cross-tab/device sync.
  const [optimized, setOptimized] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setOptimized(readOptimized());
    const onChange = () => setOptimized(readOptimized());
    window.addEventListener('roas-campaign-optimized-changed', onChange);
    return () => window.removeEventListener('roas-campaign-optimized-changed', onChange);
  }, []);
  function onToggle(key: string) {
    setOptimized(prev => toggleOptimized(key, prev));
  }
  // Close on Esc — coordinated via the shared drawer stack so that when
  // a nested drawer (AdsDrawer) is open over this one, Esc only closes
  // the topmost. Otherwise both `window` listeners fire in the same tick
  // and the whole drilldown collapses in one keystroke (#WR-01).
  useDrawerEsc(open, onClose);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    // Drawer always receives rows already filtered to this campaign.
    const first = rows[0];
    let spend = 0, value = 0, clicks = 0, impressions = 0, conversions = 0;
    const byDay = new Map<string, { spend: number; value: number }>();
    const byAdSet = new Map<string, {
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
      /** Latest non-null daily budget seen for this ad-set across the
       *  selected range. Budget is a current-state property — most-recent wins
       *  instead of summing across days. */
      adSetBudgetCad: number | null;
    }>();
    for (const r of rows) {
      spend += r.spend;
      value += r.conversionValue;
      clicks += r.clicks;
      impressions += r.impressions;
      conversions += r.conversions;

      if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, value: 0 });
      const d = byDay.get(r.date)!;
      d.spend += r.spend;
      d.value += r.conversionValue;

      const aKey = r.adSetId || r.adSetName || '(אחר)';
      if (!byAdSet.has(aKey)) {
        byAdSet.set(aKey, {
          id: r.adSetId,
          name: r.adSetName || '—',
          storeId: r.storeId,
          platform: r.platform,
          campaignId: r.campaignId,
          spend: 0,
          value: 0,
          clicks: 0,
          impressions: 0,
          conversions: 0,
          adSetBudgetCad: r.adSetBudgetCad,
        });
      }
      const a = byAdSet.get(aKey)!;
      a.spend += r.spend;
      a.value += r.conversionValue;
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.conversions += r.conversions;
      // Latest non-null budget wins (rows iterate in date order).
      if (r.adSetBudgetCad != null) a.adSetBudgetCad = r.adSetBudgetCad;
    }
    const roas = spend > 0 ? value / spend : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const dailyArr = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, spend: v.spend, value: v.value }));
    const adSets = Array.from(byAdSet.values())
      .map(a => ({ ...a, roas: a.spend > 0 ? a.value / a.spend : 0 }))
      .sort((a, b) => b.spend - a.spend);
    return {
      campaignName: first.campaignName,
      storeName: first.storeName,
      platform: first.platform,
      spend, value, clicks, impressions, conversions,
      roas, ctr, cpc, cpa,
      dailyArr,
      adSets,
      activeDays: byDay.size,
    };
  }, [rows]);

  // Per-ad-set daily Meta conv-value series. Required by
  // analyzeAttributionForAdSet → computeWindowStability / detectOutlierDays;
  // without it those features are silently inert at the ad-set level. Built
  // once in a useMemo (instead of per-render inside the row IIFE) so the
  // walk over `rows` happens only when rows change, not on every sort/state
  // tick. Keyed by the same `adSetId || adSetName || '(אחר)'` formula the
  // summary aggregation uses, so a.id (which may be '') reliably maps back.
  const dailyMetaByAdSet = useMemo(() => {
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
  }, [rows]);

  // Per-ad-set attribution analysis. Pre-computes once per orders/rows/range
  // change instead of inside the row IIFE on every render — was walking the
  // full orders array per cell × per render before. (IN5-01)
  const attributionByAdSet = useMemo(() => {
    const out = new Map<string, ReturnType<typeof analyzeAttributionForAdSet>>();
    if (!summary || summary.platform !== 'Meta') return out;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return out;
    const first = rows[0];
    const dateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), first.date);
    const dateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), first.date);
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
        dateFrom,
        dateTo,
        dailyMetaByAdSet.get(key) ?? [],
      ));
    }
    return out;
  }, [summary, ordersAttrData, rows, dailyMetaByAdSet]);

  // Stabilize mappedIds reference (RESEARCH.md §7 caveat). Without this, the
  // inline `productMap[...] ?? []` returns a fresh [] array every render when
  // the key is missing, which would defeat the productChannelBreakdown memo
  // below (and any other downstream useMemo that uses mappedIds as a dep).
  // storeId is derived inline (rows[0]?.storeId) because the post-guard
  // `storeId` declaration on line ~325 isn't visible to a top-level hook.
  const mappedIds = useMemo(
    () => {
      const sid = rows[0]?.storeId ?? '';
      return productMap[campaignKey(sid, campaignId)] ?? [];
    },
    [productMap, rows, campaignId],
  );

  // Per-product channel breakdown (Phase 1). Triple-gate is concentrated
  // here so the JSX render below can do a single `{productChannelBreakdown
  // && (...)}` truthy check:
  //   - return null when platform isn't Meta (Google has no mapping)
  //   - return null when the campaign has no mapped products
  //   - return null when fewer than 3 mapped-product orders exist in the
  //     period (CONTEXT — "signal too noisy below 3")
  // analyzeProductChannel itself returns an explicit-zero breakdown (not
  // null), so the ≥3 threshold check lives here as the final gate.
  const productChannelBreakdown = useMemo(() => {
    if (!summary || summary.platform !== 'Meta') return null;
    if (mappedIds.length === 0) return null;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return null;
    const storeIdForCampaign = rows[0]?.storeId ?? '';
    if (!storeIdForCampaign) return null;
    // Use the user's selected window (passed from CampaignsTable), NOT
    // min/max(rows.date). The latter narrows to campaign-active days
    // only — but the channel-breakdown question is "where did the mapped
    // products' sales come from in this period?", which should include
    // orders on days the campaign happened to be paused. Without this
    // fix, sales on non-active days are silently missing.
    const breakdown = analyzeProductChannel({
      productIds: mappedIds,
      orders: ordersRows,
      storeId: storeIdForCampaign,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    // ≥3 orders gate (per CONTEXT) — collapse to null so the renderer's
    // single truthy check hides the whole section.
    if (breakdown.totalOrders < 3) return null;
    return breakdown;
  }, [summary, ordersAttrData, rows, mappedIds, rangeFrom, rangeTo]);

  // Re-sort ad-sets per user choice. Computed outside the `if (!open || !summary)`
  // guard would be wrong because hooks must run unconditionally — but useMemo
  // is already called above inside the summary computation. Sorting here is a
  // plain expression, no hook needed.

  if (!open || !summary) return null;

  // All rows in the drawer belong to the same campaign and the same store,
  // so we can pick storeId off any of them to look up the ad-account ID.
  const storeId = rows.length > 0 ? rows[0].storeId : '';

  // -----------------------------------------------------------------------
  // Meta vs Shopify reconciliation. Build a day-by-day series from:
  //   - summary.dailyArr[i].value  → what Meta claimed per day
  //   - productsData filtered to this campaign's mapped products,
  //     same store, same day  → what Shopify actually sold per day
  //
  // Then compute Pearson correlation r. Interpretation:
  //   r > 0.7  — Meta tracks the trend correctly even if the level is off.
  //              Gap is probably a constant bias (view-through credit, halo
  //              attribution). Directional decisions from Meta are reliable.
  //   r 0.3-0.7 — Partial correlation. Either attribution lag is shifting
  //                them, or Meta over-fires on some days. Don't trust
  //                day-by-day Meta numbers; aggregate over 7-14 days.
  //   r < 0.3  — Meta and Shopify don't move together. Either the mapping
  //              is missing big products, or Meta is firing on conversions
  //              that aren't happening (over-attribution). Numbers
  //              unreliable per-period.
  //
  // We also compute a coarse lag: the offset (in days, -3..3) that
  // maximises correlation. If non-zero, that's the attribution window
  // showing up — Meta credits sooner than Shopify records.
  // -----------------------------------------------------------------------
  // `mappedIds` is the memoized hook value from above (line ~316). The
  // inline `productMap[...] ?? []` that used to live here was a fresh
  // array reference every render — see RESEARCH.md §7 for why that
  // matters for the new productChannelBreakdown memo.
  const reconciliation = (() => {
    if (mappedIds.length === 0) return null;
    if (summary.platform !== 'Meta') return null; // Google has no mapping
    const productRows = productsData?.rows ?? [];
    const wantedIds = new Set(mappedIds);
    // Build {date → shopify net revenue} for the campaign's mapped products
    // in this store, scoped to the same date window as the drawer's data.
    const shopifyByDate = new Map<string, number>();
    const datesInDrawer = new Set(summary.dailyArr.map(d => d.date));
    for (const p of productRows) {
      if (p.storeId !== storeId) continue;
      if (!wantedIds.has(p.productId)) continue;
      if (!datesInDrawer.has(p.date)) continue;
      const net = p.netRevenue ?? p.revenue;
      if (net <= 0) continue;
      shopifyByDate.set(p.date, (shopifyByDate.get(p.date) ?? 0) + net);
    }
    // Build the paired series, one point per day in the drawer's window.
    const series = summary.dailyArr.map(d => ({
      date: d.date,
      meta: d.value,
      shopify: shopifyByDate.get(d.date) ?? 0,
    }));
    if (series.length < 5) return null; // not enough points for r

    const r = pearson(series.map(s => s.meta), series.map(s => s.shopify));
    // Lag detection: try offsets -3..3, pick the one with the highest r.
    //
    // #WR-03: pearson on n=2 returns ±1.0 trivially (two points fit a
    // line perfectly), so a 5-day series with lag=3 leaves only 2 paired
    // points and spuriously beats the true r — firing a false "lag
    // detected" banner. Require at least 5 paired points AFTER shifting,
    // matching the outer series.length<5 gate. With lag=3 this means the
    // series itself must be >=8 days to even consider lag=±3.
    let bestLag = 0;
    let bestR = r;
    for (let lag = -3; lag <= 3; lag++) {
      if (lag === 0) continue;
      const effectiveN = series.length - Math.abs(lag);
      if (effectiveN < 5) continue; // n<5 makes |r| trivially close to 1
      const r2 = pearsonWithLag(series.map(s => s.meta), series.map(s => s.shopify), lag);
      if (Math.abs(r2) > Math.abs(bestR)) {
        bestR = r2;
        bestLag = lag;
      }
    }
    return { series, r, bestLag, bestR };
  })();
  const link = buildAdsManagerLink({
    platform: summary.platform,
    storeId,
    campaignId,
    accounts: adAccounts,
  });

  const sortedAdSets = (() => {
    const list = [...summary.adSets];
    const sign = sortDir === 'asc' ? 1 : -1;
    list.sort((x, y) => {
      switch (sortKey) {
        case 'name':
          return sign * (x.name || '').localeCompare(y.name || '', 'he');
        case 'spend':
          return sign * (x.spend - y.spend);
        case 'budget':
          return sign * ((x.adSetBudgetCad ?? 0) - (y.adSetBudgetCad ?? 0));
        case 'value':
          return sign * (x.value - y.value);
        case 'roas':
          return sign * (x.roas - y.roas);
        case 'conversions':
          return sign * (x.conversions - y.conversions);
      }
    });
    return list;
  })();
  const roasInfo = roasLabel(summary.roas);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-text-primary/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer — slides in from the start side (RTL: from the left). */}
      <aside
        dir="rtl"
        className={cn(
          'relative bg-surface w-full sm:w-[min(640px,100vw)] max-w-full',
          'ml-0 sm:ms-auto h-full overflow-y-auto',
          'shadow-elevated animate-fade-in-up',
        )}
      >
        {/* Header */}
        <header className="sticky top-0 bg-surface/95 backdrop-blur-md z-10 px-4 sm:px-6 py-4 border-b border-borderSubtle">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/8 text-primary shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <h2
                  id="campaign-drawer-title"
                  className="text-base sm:text-lg font-semibold text-text-primary tracking-tight truncate"
                >
                  {summary.campaignName || '(ללא שם)'}
                </h2>
                <div className="text-[11px] sm:text-xs text-text-muted flex items-center gap-1.5 mt-0.5">
                  <StoreIcon size={11} />
                  <span>{summary.storeName}</span>
                  <span className="text-text-subtle">·</span>
                  <span>{summary.platform}</span>
                  <span className="text-text-subtle">·</span>
                  <Calendar size={11} />
                  <span className="tabular-nums">{summary.activeDays} ימים פעילים</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors shrink-0"
              aria-label="סגור"
            >
              <X size={18} />
            </button>
          </div>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-primary hover:text-primary-dark font-medium"
            >
              <ExternalLink size={13} />
              פתח ב-{summary.platform} Ads Manager
            </a>
          )}
        </header>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <DrawerStat label="ROAS" value={summary.roas > 0 ? formatNumber(summary.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} primary />
            <DrawerStat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
            <DrawerStat label="ערך המרות" value={formatCurrency(summary.value)} prefix="CAD" accent={summary.value > summary.spend ? 'green' : undefined} />
            <DrawerStat label="המרות" value={formatNumber(summary.conversions, 0)} />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <DrawerStat label="CTR" value={summary.impressions > 0 ? `${(summary.ctr * 100).toFixed(2)}%` : '—'} compact />
            <DrawerStat label="CPC" value={summary.clicks > 0 ? `CAD ${formatCurrency(summary.cpc, 2)}` : '—'} compact />
            <DrawerStat label="CPA" value={summary.conversions > 0 ? `CAD ${formatCurrency(summary.cpa, 2)}` : '—'} compact />
          </div>

          {/* Daily trend chart */}
          {summary.dailyArr.length >= 2 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-text-secondary" />
                  הוצאה ↔ ערך המרות לאורך הזמן
                </h3>
              </div>
              <div className="h-40 sm:h-44 rounded-xl bg-surfaceMuted/40 border border-borderSubtle p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.dailyArr} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="drawer-spend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#dc2626" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="drawer-value" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#15803d" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#15803d" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#7a8a9a' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={d => {
                        const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                        return m ? `${m[2]}/${m[1]}` : String(d);
                      }}
                    />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const d = payload[0].payload as { date: string; spend: number; value: number };
                        return (
                          <div
                            dir="rtl"
                            className="rounded-lg bg-text-primary text-white px-3 py-2 text-xs shadow-elevated tabular-nums"
                          >
                            <div className="text-white/70 mb-1 text-[10px]">{formatDate(d.date)}</div>
                            <div>הוצאה: <span className="font-semibold">CAD {formatCurrency(d.spend)}</span></div>
                            <div>ערך המרות: <span className="font-semibold text-emerald-300">CAD {formatCurrency(d.value)}</span></div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#15803d"
                      strokeWidth={1.5}
                      fill="url(#drawer-value)"
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="#dc2626"
                      strokeWidth={1.5}
                      fill="url(#drawer-spend)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1.5">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                  ערך המרות
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-roas-red" />
                  הוצאה
                </span>
              </div>
            </section>
          )}

          {/* Mapped products — Meta only. Google PMax doesn't expose a
              per-product attribution: the feed is what governs delivery,
              so manually tagging products to a PMax campaign would be
              misleading. We hide the section entirely for Google so users
              don't try to do something that won't reflect reality. */}
          {summary.platform === 'Meta' && (() => {
            const storeIdForCampaign = rows[0]?.storeId ?? '';
            const mappedIds = productMap[campaignKey(storeIdForCampaign, campaignId)] ?? [];
            return (
              <section>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                    <Package size={14} className="text-text-secondary" />
                    מוצרי Shopify משויכים
                    {mappedIds.length > 0 && (
                      <span className="text-[10px] font-medium text-text-muted">
                        ({mappedIds.length})
                      </span>
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-surface border border-border hover:border-primary/40 px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-primary transition-colors"
                  >
                    <Edit3 size={12} />
                    {mappedIds.length > 0 ? 'ערוך מיפוי' : 'שייך מוצרים'}
                  </button>
                </div>
                {mappedIds.length === 0 ? (
                  <p className="text-[11px] text-text-muted leading-relaxed bg-surfaceMuted/40 rounded-lg px-3 py-2">
                    לא משויכים מוצרים. לאחר שיוך, ה-ROAS יחושב מחדש לפי מכירות{' '}
                    Shopify אמיתיות במקום ערך ההמרה ש-Meta דיווח (לרוב מנופח).
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {mappedIds.map(id => (
                      <li
                        key={id}
                        className="inline-flex items-center gap-1 text-[11px] bg-primary/8 text-primary px-2 py-0.5 rounded-md font-mono"
                        title={id}
                      >
                        <Package size={10} />
                        <span className="truncate max-w-[120px]">{id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })()}

          {/* Deterministic attribution panel (Meta only). When orders carry
              fbclid + utm_campaign matching the campaign name, we can prove
              which conversions came from clicks vs which are modeled by
              Meta. Renders trust verdict + ROAS interval + recommendation
              as a callout — replaces the heuristic chip in the table with
              real numbers in the drawer. */}
          {(() => {
            const storeIdForCampaign = rows[0]?.storeId ?? '';
            const dailyMeta = summary.dailyArr.map(d => ({ date: d.date, value: d.value }));
            // Derive the same dateFrom/dateTo as the reconciliation block.
            const dateFrom = rows.reduce(
              (min, r) => (r.date < min ? r.date : min),
              rows[0]?.date ?? '',
            );
            const dateTo = rows.reduce(
              (max, r) => (r.date > max ? r.date : max),
              rows[0]?.date ?? '',
            );
            const analysis = analyzeAttribution(
              {
                campaignName: summary.campaignName,
                campaignId,
                storeId: storeIdForCampaign,
                platform: summary.platform,
                metaClaim: summary.value,
                spend: summary.spend,
              },
              ordersAttrData?.rows ?? [],
              dateFrom,
              dateTo,
              dailyMeta,
            );
            if (!analysis) return null;

            const trustBg =
              analysis.trust.level === 'high'    ? 'bg-roas-greenBg/50 border-roas-green/30 text-roas-green'
            : analysis.trust.level === 'medium'  ? 'bg-amber-50 border-amber-300 text-amber-800'
            : analysis.trust.level === 'unknown' ? 'bg-surfaceMuted border-borderSubtle text-text-secondary'
            :                                      'bg-roas-redBg/50 border-roas-red/30 text-roas-red';

            const detRoas = summary.spend > 0
              ? analysis.deterministicRevenue / summary.spend
              : 0;
            const metaRoas = summary.spend > 0
              ? summary.value / summary.spend
              : 0;

            return (
              <section>
                <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
                  <TrendingUp size={14} className="text-text-secondary" />
                  ניתוח attribution
                </h3>
                <div className={cn('rounded-xl border p-3 space-y-3', trustBg)}>
                  {/* Header: trust verdict + score */}
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="shrink-0">
                      <div className="text-[10px] uppercase tracking-wide opacity-70">
                        ציון אמינות
                      </div>
                      <div className="text-2xl font-bold tabular-nums leading-tight">
                        {analysis.trust.score.toFixed(0)}<span className="text-sm opacity-60">/100</span>
                      </div>
                      <div className="text-[11px] font-semibold">{analysis.trust.label}</div>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] uppercase opacity-60">ROAS אמיתי (click-id)</div>
                          <div className="text-base font-semibold tabular-nums">
                            {detRoas > 0 ? `${detRoas.toFixed(2)}x` : '—'}
                          </div>
                          {analysis.roasInterval && (
                            <div className="text-[10px] opacity-60 tabular-nums">
                              טווח 95%: {analysis.roasInterval.low.toFixed(2)} – {analysis.roasInterval.high.toFixed(2)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-[10px] uppercase opacity-60">ROAS לפי Meta</div>
                          <div className="text-base font-semibold tabular-nums">
                            {metaRoas > 0 ? `${metaRoas.toFixed(2)}x` : '—'}
                          </div>
                          <div className="text-[10px] opacity-60 tabular-nums">
                            CAD {summary.value.toFixed(0)} מדווח
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Breakdown bar: deterministic vs modeled */}
                  {summary.value > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="opacity-80">click-id מתויג: {analysis.deterministicOrders} הזמנות (CAD {analysis.deterministicRevenue.toFixed(0)})</span>
                        <span className="opacity-80">modeled: CAD {analysis.modeledRevenue.toFixed(0)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-white/40 overflow-hidden flex">
                        <div
                          className="h-full bg-current opacity-70"
                          style={{ width: `${Math.min(100, (analysis.deterministicRevenue / summary.value) * 100)}%` }}
                        />
                        <div
                          className="h-full bg-current opacity-25"
                          style={{ width: `${Math.min(100, (analysis.modeledRevenue / summary.value) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Reasons list */}
                  {analysis.reasons.length > 0 && (
                    <ul className="text-[11px] space-y-1 leading-relaxed">
                      {analysis.reasons.map((r, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="opacity-60">•</span>
                          <span className="opacity-90">{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Recommendation callout */}
                  {analysis.recommendation && (
                    <div className="rounded-md bg-white/40 border border-current/20 px-2.5 py-2 text-[11px] leading-relaxed">
                      <strong>💡 המלצה:</strong> {analysis.recommendation}
                    </div>
                  )}

                  {/* Window stability + outliers footer */}
                  {(analysis.windowStability || analysis.outlierDays.length > 0) && (
                    <div className="text-[10px] flex flex-wrap gap-2 pt-1 border-t border-current/15">
                      {analysis.windowStability && (
                        <span className="opacity-70">
                          יציבות ({analysis.windowStability.windowCountWithData} שבועות):{' '}
                          <strong>{analysis.windowStability.verdict === 'stable' ? 'יציב' : analysis.windowStability.verdict === 'mixed' ? 'מעורב' : 'תנודתי'}</strong>{' '}
                          (σ={(analysis.windowStability.stdDev * 100).toFixed(0)}%)
                        </span>
                      )}
                      {analysis.outlierDays.length > 0 && (
                        <span className="opacity-70">
                          • <strong>{analysis.outlierDays.length}</strong> ימי spike מ-Meta (modeled)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* Phase 1 — Channel-level product attribution. The triple-gate
              (platform Meta / mapped products / ≥3 orders) was concentrated
              in the productChannelBreakdown useMemo above (line ~343), so
              the JSX guard is a single truthy check. */}
          {productChannelBreakdown && (() => {
            const total = productChannelBreakdown.totalOrders;
            const fb = productChannelBreakdown.facebookOrders;
            const google = (productChannelBreakdown.bySource['google-paid']?.orders ?? 0)
                        + (productChannelBreakdown.bySource['google-organic']?.orders ?? 0);
            const direct = productChannelBreakdown.bySource['direct']?.orders ?? 0;
            const other = Math.max(0, total - fb - google - direct);
            const fbPct = Math.round(productChannelBreakdown.facebookShare * 100);
            return (
              <section>
                <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
                  <Package size={14} className="text-text-secondary" />
                  <span title="סיגנל זה משלים את ה-trust chip. הוא מודד 'מאיפה הגיעו הקונים של המוצרים המשויכים' גם כש-utm_id חסר.">
                    מכירות לפי ערוץ של המוצרים המשויכים
                  </span>
                </h3>
                <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
                  {/* Summary line — total orders + CAD */}
                  <div className="text-[12px] text-text-secondary tabular-nums">
                    {total} הזמנות של מוצרים משויכים · CAD {productChannelBreakdown.totalRevenue.toFixed(0)} סה&quot;כ
                  </div>

                  {/* 4-segment source breakdown bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-text-secondary tabular-nums">
                      <span>פייסבוק: {fb} · גוגל: {google} · ישיר: {direct} · אחר: {other}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-surfaceMuted overflow-hidden flex">
                      <div className="h-full bg-roas-blue"   style={{ width: `${(fb / total) * 100}%` }} />
                      <div className="h-full bg-amber-500"   style={{ width: `${(google / total) * 100}%` }} />
                      <div className="h-full bg-text-muted"  style={{ width: `${(direct / total) * 100}%` }} />
                      <div className="h-full bg-text-subtle" style={{ width: `${(other / total) * 100}%` }} />
                    </div>
                  </div>

                  {/* Recommendation chips — two variants per PATTERNS.md §5c.
                      Green: ≥60% Facebook → confidence to scale.
                      Amber: <30% Facebook AND ≥5 orders → caution (the
                      ≥5-orders floor is plan-level; a brand-new campaign
                      with 0% on only 3 orders is noise, not signal —
                      RESEARCH.md Open Question 2).
                      Between 30% and 60%: no chip per CONTEXT. */}
                  {productChannelBreakdown.facebookShare >= 0.6 && (
                    <div className="rounded-md bg-roas-greenBg/50 border border-roas-green/30 text-roas-green px-2.5 py-2 text-[11px] leading-relaxed">
                      <strong>💡 </strong>
                      {fbPct}% מהמכירות הגיעו מפייסבוק
                      {' → '}
                      ביטחון להעלאת תקציב הקמפיין
                    </div>
                  )}
                  {productChannelBreakdown.facebookShare < 0.3 && total >= 5 && (
                    <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-2.5 py-2 text-[11px] leading-relaxed">
                      <strong>⚠️ </strong>
                      רק {fbPct}% מהמכירות הגיעו מפייסבוק
                      {' → '}
                      ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* Meta vs Shopify reconciliation. Only when products are mapped
              AND we have at least 5 days of data to correlate. The chart +
              Pearson r + interpretation help the user decide whether a
              Meta-vs-Shopify gap is real (Meta over-claiming) or fake
              (mapping incomplete / halo effect / lag from attribution
              window). */}
          {reconciliation && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
                <TrendingUp size={14} className="text-text-secondary" />
                Meta מול Shopify — מתאם יומי
              </h3>
              <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="shrink-0">
                    <div className="text-[10px] text-text-muted uppercase tracking-wide">
                      מתאם (Pearson r)
                    </div>
                    <div className={cn(
                      'text-2xl font-bold tabular-nums leading-tight',
                      Math.abs(reconciliation.r) >= 0.7 ? 'text-roas-green'
                        : Math.abs(reconciliation.r) >= 0.3 ? 'text-amber-600'
                        : 'text-roas-red',
                    )}>
                      {reconciliation.r >= 0 ? '+' : ''}{reconciliation.r.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-[200px] text-[11px] sm:text-xs text-text-secondary leading-relaxed">
                    {(() => {
                      const absR = Math.abs(reconciliation.r);
                      if (absR >= 0.7) {
                        return (
                          <>
                            <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                            Meta תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה{' '}
                            <strong>bias קבוע</strong> (view-through credit, halo).{' '}
                            החלטות גידול תקציב על בסיס מגמות Meta אמינות.
                          </>
                        );
                      }
                      if (absR >= 0.3) {
                        return (
                          <>
                            <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                            Meta תופס חלק מהתנועות אבל יש ימים שהוא חורג.{' '}
                            התעלם מ-Meta ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.
                          </>
                        );
                      }
                      return (
                        <>
                          <strong className="text-roas-red">אין מתאם.</strong>{' '}
                          Meta מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא{' '}
                          (חסרים מוצרים), או שיש over-attribution אגרסיבי. אל תקבל החלטות{' '}
                          על בסיס המרות Meta של הקמפיין הזה.
                        </>
                      );
                    })()}
                  </div>
                </div>

                {reconciliation.bestLag !== 0 && Math.abs(reconciliation.bestR) > Math.abs(reconciliation.r) + 0.1 && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
                    <strong>זוהה lag של {Math.abs(reconciliation.bestLag)} ימים:</strong>{' '}
                    {reconciliation.bestLag > 0
                      ? `Meta מדווח על המרה ${Math.abs(reconciliation.bestLag)} ימים לפני שהמכירה מופיעה ב-Shopify (חלון attribution).`
                      : `Shopify מקדים את Meta ב-${Math.abs(reconciliation.bestLag)} ימים — לא טיפוסי, בדוק.`}
                  </div>
                )}

                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={reconciliation.series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={d => {
                          const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                          return m ? `${m[2]}/${m[1]}` : String(d);
                        }}
                      />
                      <YAxis hide domain={[0, 'auto']} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const d = payload[0].payload as { date: string; meta: number; shopify: number };
                          return (
                            <div dir="rtl" className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                              <div className="text-white/65 mb-1 text-[10px]">{formatDate(d.date)}</div>
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                                <span>Meta: CAD {formatCurrency(d.meta)}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                                <span>Shopify: CAD {formatCurrency(d.shopify)}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="meta" stroke="#d97706" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="shopify" stroke="#15803d" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-4 text-[10px] sm:text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-[2px] bg-amber-600" />
                    <span className="text-text-secondary">Meta (מדווח)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-[2px] bg-roas-green" />
                    <span className="text-text-secondary">Shopify (בפועל)</span>
                  </span>
                </div>

                <details className="text-[11px]">
                  <summary className="cursor-pointer text-text-secondary hover:text-text-primary select-none py-1">
                    יום-לפי-יום ↓
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-borderSubtle">
                    <table className="w-full text-[11px]">
                      <thead className="bg-surfaceMuted/60 sticky top-0">
                        <tr className="text-text-muted">
                          <th className="px-2 py-1.5 text-start font-medium">תאריך</th>
                          <th className="px-2 py-1.5 text-end font-medium">Meta</th>
                          <th className="px-2 py-1.5 text-end font-medium">Shopify</th>
                          <th className="px-2 py-1.5 text-center font-medium">פער</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconciliation.series.map(s => {
                          const delta = s.shopify - s.meta;
                          const denom = Math.max(s.meta, s.shopify, 1);
                          const deltaPct = (delta / denom) * 100;
                          let tone = 'text-text-muted';
                          if (s.meta > 0 || s.shopify > 0) {
                            if (Math.abs(deltaPct) > 50) tone = 'text-roas-red';
                            else if (Math.abs(deltaPct) > 20) tone = 'text-amber-600';
                            else tone = 'text-roas-green';
                          }
                          return (
                            <tr key={s.date} className="border-t border-borderSubtle">
                              <td className="px-2 py-1 text-text-secondary tabular-nums">{s.date.slice(5)}</td>
                              <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.meta)}</td>
                              <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.shopify)}</td>
                              <td className={cn('px-2 py-1 text-center tabular-nums font-medium', tone)}>
                                {s.meta === 0 && s.shopify === 0 ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(0)}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </section>
          )}

          {/* Ad-sets within this campaign */}
          {summary.adSets.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
                <Layers size={14} className="text-text-secondary" />
                אד-סטים ({summary.adSets.length})
              </h3>
              {/* Horizontal scroll mirrors the AdsDrawer pattern — the
                  ad-sets table has 7 columns (toggle / name / spend / budget /
                  value / ROAS / conversions) and gets wider than the drawer's
                  640px on smaller widths. `overflow-x-auto` keeps the rounded
                  border + lets the table scroll inside. */}
              {/* Same pattern as AdsDrawer: a real vertical scroll context
                  on the wrapper so the sticky thead pins correctly when
                  scrolling rows. */}
              <div className="rounded-xl border border-borderSubtle overflow-auto max-h-[50vh]">
                <table className="w-full text-xs sm:text-sm min-w-[720px]">
                  <thead className="bg-surfaceMuted/60 sticky top-0 z-10">
                    <tr className="text-text-secondary">
                      <th className="px-2 py-2 w-[36px]" aria-label="סימון" />
                      <AdSetSortHeader label="שם"          col="name"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="start"  />
                      <AdSetSortHeader label="הוצאה"       col="spend"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSetSortHeader label="תקציב יומי"  col="budget"      sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSetSortHeader label="ערך"         col="value"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSetSortHeader label="ROAS"        col="roas"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="center" />
                      {/* Per-ad-set deterministic attribution. Header doesn't
                          sort (the data is shape-inferred per row). Tooltip
                          on each cell explains the chip. */}
                      <th className="font-medium px-3 py-2 text-center text-text-secondary" title="ROAS אמיתי לפי click-id (utm_term)">
                        ROAS Shopify
                      </th>
                      <AdSetSortHeader label="המרות"       col="conversions" sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAdSets.map((a, i) => {
                      const info = roasLabel(a.roas);
                      // Same composite key the main CampaignsTable uses for
                      // ad-set rows, so a mark made here shows there and vice
                      // versa.
                      const markKey = `${a.storeId}::${a.platform}::${a.campaignId}::${a.id || ''}`;
                      const isOptimized = optimized.has(markKey);
                      const tight = a.spend > 0 && a.adSetBudgetCad && a.spend > a.adSetBudgetCad * 0.95;
                      // `!!()` so the type is strictly boolean — without it,
                      // short-circuit gives `string | boolean` (the value of
                      // `a.id` when truthy), which leaks into JSX props that
                      // expect boolean (e.g. `disabled={!canDrillToAds}` would
                      // render `disabled="123"` if added later). (#IN-06)
                      const canDrillToAds = !!(a.platform === 'Meta' && a.id);
                      return (
                        <tr
                          key={a.id || a.name || i}
                          className={cn(
                            'border-t border-borderSubtle transition-opacity',
                            isOptimized && 'opacity-50 hover:opacity-100',
                            canDrillToAds && 'cursor-pointer hover:bg-surfaceMuted/30',
                          )}
                          onClick={() => {
                            if (!canDrillToAds) return;
                            setAdDrillSet({
                              storeId: a.storeId,
                              campaignId: a.campaignId,
                              adSetId: a.id,
                              adSetName: a.name,
                            });
                          }}
                          title={canDrillToAds ? 'לחץ לראות את המודעות באד-סט' : undefined}
                        >
                          <td className="px-2 py-2 text-center w-[36px]">
                            <button
                              type="button"
                              onClick={e => {
                                // Stop the click from bubbling up to the row,
                                // which would also open AdsDrawer for this
                                // ad-set. Mirrors the pattern used in
                                // CampaignsTable.tsx (line ~778).
                                e.stopPropagation();
                                onToggle(markKey);
                              }}
                              className={cn(
                                'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                                isOptimized
                                  ? 'text-roas-green hover:bg-roas-greenBg/60'
                                  : 'text-text-muted hover:text-roas-green hover:bg-roas-greenBg/40',
                              )}
                              title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
                              aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
                              aria-pressed={isOptimized}
                            >
                              {isOptimized ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-text-primary truncate max-w-[200px]" title={a.name}>{a.name}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                          <td className="px-3 py-2 text-end tabular-nums">
                            {a.adSetBudgetCad && a.adSetBudgetCad > 0 ? (
                              <span className={cn('font-medium', tight && 'text-amber-700')}>
                                {formatCurrency(a.adSetBudgetCad)}
                              </span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                          <td className={cn('px-3 py-2 text-end tabular-nums', a.value > a.spend && 'text-roas-green font-medium')}>
                            {formatCurrency(a.value)}
                          </td>
                          <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                            {a.roas > 0 ? formatNumber(a.roas) : '—'}
                          </td>
                          {/* Deterministic ROAS per ad-set via utm_term. */}
                          <td className="px-3 py-2 text-center">
                            {(() => {
                              // Look up the pre-computed analysis instead of
                              // re-running the orders walk + Bayesian + window
                              // stability per cell per render. (IN5-01)
                              const adsetAttr = attributionByAdSet.get(a.id || a.name || '(אחר)') ?? null;
                              if (!adsetAttr) {
                                return <span className="text-text-muted text-xs">—</span>;
                              }
                              const detRoas = a.spend > 0
                                ? adsetAttr.deterministicRevenue / a.spend
                                : 0;
                              const tone =
                                adsetAttr.trust.level === 'high'    ? 'bg-roas-greenBg/60 text-roas-green'
                              : adsetAttr.trust.level === 'medium'  ? 'bg-amber-50 text-amber-700'
                              : adsetAttr.trust.level === 'unknown' ? 'bg-surfaceMuted text-text-secondary'
                              :                                       'bg-roas-redBg/60 text-roas-red';
                              const tooltip =
                                `ROAS אמיתי · ${adsetAttr.trust.label} (${adsetAttr.trust.score.toFixed(0)}/100)\n\n` +
                                `Meta דיווח: CAD ${a.value.toFixed(0)}\n` +
                                `click-id מתויג: CAD ${adsetAttr.deterministicRevenue.toFixed(0)} (${adsetAttr.deterministicOrders} הזמנות)\n` +
                                `modeled: CAD ${adsetAttr.modeledRevenue.toFixed(0)}\n\n` +
                                adsetAttr.reasons.map(r => `• ${r}`).join('\n') +
                                `\n\n💡 ${adsetAttr.recommendation}`;
                              return (
                                <div className="inline-flex flex-col items-center gap-0.5" title={tooltip}>
                                  <span className="font-semibold tabular-nums text-text-primary">
                                    {detRoas > 0 ? formatNumber(detRoas) : '—'}
                                  </span>
                                  <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', tone)}>
                                    {adsetAttr.trust.label}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Foot - tiny */}
          <div className="text-[10px] text-text-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>

      {/* Product-mapping modal — opens from the 'מוצרי Shopify משויכים'
          section. On save, persists to localStorage + cloud and the in-drawer
          chip list re-renders via the change event. */}
      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={rows[0]?.storeId ?? ''}
        storeName={summary.storeName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(rows[0]?.storeId ?? '', campaignId)] ?? []}
        onSave={(productIds) => {
          const storeIdForCampaign = rows[0]?.storeId ?? '';
          setMappedProducts(storeIdForCampaign, campaignId, productIds);
        }}
      />

      {/* Nested ad-level drawer. Date range is derived from the rows the
          campaign drawer already has — guaranteed to cover the same window. */}
      {adDrillSet && (
        <AdsDrawer
          open
          onClose={() => setAdDrillSet(null)}
          storeId={adDrillSet.storeId}
          campaignId={adDrillSet.campaignId}
          adSetId={adDrillSet.adSetId}
          adSetName={adDrillSet.adSetName}
          rangeFrom={rows.reduce(
            (min, r) => (r.date < min ? r.date : min),
            rows[0]?.date ?? '',
          )}
          rangeTo={rows.reduce(
            (max, r) => (r.date > max ? r.date : max),
            rows[0]?.date ?? '',
          )}
          adAccounts={adAccounts}
        />
      )}
    </div>
  );
}

function DrawerStat({
  label,
  value,
  prefix,
  chip,
  primary,
  compact,
  accent,
}: {
  label: string;
  value: string;
  prefix?: string;
  chip?: { text: string; tone: string };
  primary?: boolean;
  compact?: boolean;
  accent?: 'green';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-borderSubtle bg-surfaceMuted/30',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5 sm:px-3.5 sm:py-3',
      )}
    >
      <div className="text-[10px] sm:text-[11px] text-text-muted leading-tight uppercase tracking-wide">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        {prefix && (
          <span className="text-[10px] text-text-muted font-medium shrink-0">{prefix}</span>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums leading-tight',
            primary ? 'text-base sm:text-lg' : 'text-sm sm:text-base',
            accent === 'green' && 'text-roas-green',
            !accent && 'text-text-primary',
          )}
        >
          {value}
        </span>
      </div>
      {chip && (
        <span
          className={cn(
            'inline-block mt-1 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded',
            TONE_BG[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}
    </div>
  );
}


/**
 * Sort-aware <th> for the drawer's ad-sets table. Mirrors the SortHeader in
 * CampaignsTable but lives here so the drawer doesn't need to import that
 * component's narrower SortKey union.
 */
function AdSetSortHeader({
  label,
  col,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  col: AdSetSortKey;
  sortKey: AdSetSortKey;
  dir: AdSetSortDir;
  onClick: (key: AdSetSortKey) => void;
  align: 'start' | 'center' | 'end';
}) {
  const isActive = col === sortKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  return (
    <th className={cn('font-medium px-3 py-2', textAlign)}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors group select-none cursor-pointer w-full',
          justify,
          isActive
            ? 'text-primary font-semibold'
            : 'text-text-secondary hover:text-text-primary',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? (
            <ArrowUp size={12} className="text-primary" />
          ) : (
            <ArrowDown size={12} className="text-primary" />
          )
        ) : (
          <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </button>
    </th>
  );
}

/**
 * Pearson correlation coefficient. Returns 0 for degenerate cases (constant
 * arrays, length < 2, mismatched lengths). Output is clamped to [-1, 1].
 */
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  const denom = Math.sqrt(vx * vy);
  if (denom === 0) return 0;
  const r = cov / denom;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Pearson correlation with a lag applied to the second series — useful for
 * detecting attribution windows (Meta credits sooner than Shopify records).
 * Positive lag = `ys` shifted forward (compare xs[i] with ys[i + lag]).
 */
function pearsonWithLag(xs: number[], ys: number[], lag: number): number {
  if (lag === 0) return pearson(xs, ys);
  const xsShift: number[] = [];
  const ysShift: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= ys.length) continue;
    xsShift.push(xs[i]);
    ysShift.push(ys[j]);
  }
  return pearson(xsShift, ysShift);
}
