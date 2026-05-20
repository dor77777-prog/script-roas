'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X,
  ExternalLink,
  Maximize2,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  TrendingUp,
  Package,
  Minimize2,
  Edit3,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import {
  analyzeAttribution,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import { analyzeCpmVsRoas } from '@/lib/cpmRoasAnalysis';
import { useCampaignAttribution } from '@/lib/hooks/useCampaignAttribution';
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
import { AttributionAnalysisPanel } from './AttributionAnalysisPanel';
import {
  MetaShopifyReconciliation,
  buildReconciliation,
} from './MetaShopifyReconciliation';
import { ProductChannelBreakdown } from './ProductChannelBreakdown';
import {
  AdSetTable,
  type AdSetSortKey,
  type AdSetSortDir,
} from './AdSetTable';
import { ProductPickerModal } from './ProductPickerModal';
import {
  readProductMap,
  campaignKey,
  setMappedProducts,
  type ProductMap,
} from '@/lib/campaignProductMap';
import { buildDateRangeKey } from '@/lib/dateRange';

/**
 * Slide-in campaign drilldown drawer. Linear/Vercel-style: full context
 * pane but the dashboard stays visible. Composes 4 sub-panels:
 * AttributionAnalysisPanel, ProductChannelBreakdown,
 * MetaShopifyReconciliation, AdSetTable (DOM order pinned by UI-SPEC).
 */

type Props = {
  /** Rows already filtered to this campaign — drawer aggregates internally. */
  rows: CampaignRow[];
  campaignId: string;
  storeId: string;
  open: boolean;
  onClose: () => void;
  /** storeId → ad-account IDs, used to build Ads Manager deep links. */
  adAccounts: AdAccountMap;
  /** User-selected date window (NOT min/max of rows.date — channel
   *  breakdown needs mapped-product orders on campaign-paused days too). */
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

export function CampaignDrawer({ rows, campaignId, storeId, open, onClose, adAccounts, rangeFrom, rangeTo }: Props) {
  // Drawer-local sort state. Default spend-desc matches the pre-sortable
  // hardcoded ordering so first paint doesn't jump.
  const [sortKey, setSortKey] = useState<AdSetSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSetSortDir>('desc');
  // Drawer can expand to fullscreen for users who want more space to inspect
  // charts (especially CPM-over-time + AdSetTable). Toggle button sits next
  // to the X close button in the header — same icon language as VS Code.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // CPM chart can overlay ROAS on a second Y axis when the user enables it.
  const [showRoasOverlay, setShowRoasOverlay] = useState(false);
  // Analysis baseline: 'half' = first-half vs second-half within the
  // range; 'prev' = compare to the equally-long window immediately
  // before the range.
  const [cpmAnalysisMode, setCpmAnalysisMode] = useState<'half' | 'prev'>('half');

  function handleSort(key: AdSetSortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc'); // first click on a new column → "largest first"
    }
  }

  // Ad-set → ads drilldown (Meta only).
  const [adDrillSet, setAdDrillSet] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);

  // Product-mapping picker state. Cloud-synced via the change event.
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    setProductMap(readProductMap());
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, []);

  // SWR fetches — lazy while open, SWR-deduped per session.
  // Keys include the range so a range change triggers a fresh fetch (no stale cache).
  //
  // WR-05: the productsData SWR fetch was removed alongside the
  // buildReconciliation `productsData` parameter. The helper switched
  // to orders-attribution line items as its Shopify-actual basis
  // (CODEX-NEW-P2-01) and stopped reading the products-daily netRevenue
  // fallback; the SWR call was left in flight as dead weight and is
  // now gone.
  const drawerRange = { from: rangeFrom, to: rangeTo };
  // Equal-length window immediately before the current range. Only used
  // by the CPM-vs-ROAS analysis when the mode toggle is set to 'prev'.
  const prevRange = useMemo(() => {
    const fromMs = Date.UTC(
      Number(rangeFrom.slice(0, 4)),
      Number(rangeFrom.slice(5, 7)) - 1,
      Number(rangeFrom.slice(8, 10)),
    );
    const toMs = Date.UTC(
      Number(rangeTo.slice(0, 4)),
      Number(rangeTo.slice(5, 7)) - 1,
      Number(rangeTo.slice(8, 10)),
    );
    const spanDays = Math.round((toMs - fromMs) / 86400000) + 1;
    const prevToMs = fromMs - 86400000;
    const prevFromMs = prevToMs - (spanDays - 1) * 86400000;
    return {
      from: new Date(prevFromMs).toISOString().slice(0, 10),
      to: new Date(prevToMs).toISOString().slice(0, 10),
    };
  }, [rangeFrom, rangeTo]);
  // All campaign rows for the date range — used by buildReconciliation to
  // compute the Google series (other Google campaigns promoting same products).
  // SWR dedupes against CampaignsTable's identical key so no extra network call.
  const { data: campaignsData } = useSWR<CampaignsResponse>(
    open ? buildDateRangeKey('/api/campaigns', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Previous-period campaign rows — only fetched when the user actually
  // switches the analysis baseline to 'prev', so the default open path
  // costs zero extra network.
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    open && cpmAnalysisMode === 'prev' ? buildDateRangeKey('/api/campaigns', prevRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Drawer needs the full lineItems column for productChannelBreakdown.
  // buildDateRangeKey always produces "?from=...&to=..." so &lineItems=true
  // safely appends as a second query param. The route default is false —
  // explicit opt-in here keeps CampaignsTable on the lighter payload.
  const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
    ordersAttrBaseKey ? `${ordersAttrBaseKey}&lineItems=true` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  // Optimization marks — shared with CampaignsTable via lib/campaignOptimized.
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
  // Esc — coordinated via the shared drawer stack so nested AdsDrawer
  // pops alone instead of collapsing the whole stack (#WR-01).
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
    const byDay = new Map<string, { spend: number; value: number; impressions: number }>();
    // adSetBudgetCad: latest non-null daily budget (most-recent wins,
    // not summed — budget is current-state, not period-cumulative).
    const byAdSet = new Map<string, {
      id: string; name: string; storeId: string; platform: string; campaignId: string;
      spend: number; value: number; clicks: number; impressions: number; conversions: number;
      adSetBudgetCad: number | null;
    }>();
    for (const r of rows) {
      spend += r.spend;
      value += r.conversionValue;
      clicks += r.clicks;
      impressions += r.impressions;
      conversions += r.conversions;

      if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, value: 0, impressions: 0 });
      const d = byDay.get(r.date)!;
      d.spend += r.spend;
      d.value += r.conversionValue;
      d.impressions += r.impressions;

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
      .map(([date, v]) => ({
        date,
        spend: v.spend,
        value: v.value,
        impressions: v.impressions,
        // CPM per day: zero impressions -> 0. UI gates the CPM chart on
        // impressions > 0 anyway, but compute defensively here so any
        // future consumer of dailyArr gets a sane value.
        cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
        // ROAS per day for the CPM-vs-ROAS overlay. Same zero-spend guard
        // we use everywhere — empty days show 0 so the overlay line just
        // stays at the bottom rather than producing Infinity.
        roas: v.spend > 0 ? v.value / v.spend : 0,
      }));
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

  // Per-ad-set attribution Map — hook preserves IN5-01 (no per-cell recompute).
  const attributionByAdSet = useCampaignAttribution({ summary, rows, ordersAttrData, rangeFrom, rangeTo });

  // Stabilize mappedIds reference (RESEARCH.md §7 caveat). Inline
  // `productMap[...] ?? []` would return a fresh [] every render and defeat
  // the productChannelBreakdown memo below.
  const mappedIds = useMemo(
    () => {
      const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';
      return productMap[campaignKey(storeId, platformForCampaign, campaignId)] ?? [];
    },
    [productMap, rows, summary?.platform, storeId, campaignId],
  );

  // Per-product channel breakdown (Phase 1). Triple-gate (Meta-only,
  // mapped products, ≥3 mapped-product orders) is concentrated here so
  // the JSX guard is a single truthy check. Range uses rangeFrom/rangeTo
  // (user window) — NOT min/max(rows.date), which would miss orders on
  // campaign-paused days.
  const productChannelBreakdown = useMemo(() => {
    if (!summary || summary.platform !== 'Meta') return null;
    if (mappedIds.length === 0) return null;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return null;
    const breakdown = analyzeProductChannel({
      productIds: mappedIds,
      orders: ordersRows,
      storeId,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    if (breakdown.totalOrders < 3) return null;
    return breakdown;
  }, [summary, ordersAttrData, rows, mappedIds, storeId, rangeFrom, rangeTo]);

  if (!open || !summary) return null;

  // FIX-03 (5.2.2.1): storeId arrives as a required prop. Removed rows[0].storeId derivation (which was unreachable but defensive-noisy per AUDIT-P2-11).

  // Reconciliation + analysis: helpers gate their own mounts (return null
  // when not applicable). Reconciliation lives in MetaShopifyReconciliation
  // (T-F); analyzeAttribution stays in @/lib/attributionAnalysis.
  // WR-05: buildReconciliation now only reads `summary.platform`.
  // Pass a minimal projection rather than the full summary — both
  // documents the contract at the call site and removes the noise
  // of unused fields.
  const reconciliation = buildReconciliation({
    summary: { platform: summary.platform },
    mappedIds,
    storeId,
    campaignsData,
    ordersData: ordersAttrData,
    productMap,
    rangeFrom,
    rangeTo,
  });
  const analysis = analyzeAttribution(
    { campaignName: summary.campaignName, campaignId, storeId, platform: summary.platform, metaClaim: summary.value, spend: summary.spend },
    ordersAttrData?.rows ?? [],
    rangeFrom,
    rangeTo,
    summary.dailyArr.map(d => ({ date: d.date, value: d.value })),
  );
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
        default: {
          // Exhaustiveness check (WR-04). If a future AdSetSortKey value
          // is added but a case is forgotten, TypeScript fails the
          // `never` assignment at compile time. Returns 0 at runtime so
          // an unhandled key collapses sort to "stable" rather than
          // returning undefined and producing arbitrary order.
          const _exhaustive: never = sortKey;
          void _exhaustive;
          return 0;
        }
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
      <div
        className="absolute inset-0 bg-text-primary/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside
        dir="rtl"
        className={cn(
          'relative bg-surface max-w-full',
          'h-full overflow-y-auto',
          'shadow-elevated animate-fade-in-up',
          // Side-drawer mode: 640px panel anchored to the start (right in RTL)
          // Fullscreen mode: stretches edge-to-edge so charts + tables breathe
          !isFullscreen && 'w-full sm:w-[min(640px,100vw)] ml-0 sm:ms-auto',
          isFullscreen && 'w-full',
        )}
      >
        <header className="sticky top-0 bg-surface/95 backdrop-blur-md z-10 px-4 sm:px-6 py-4 border-b border-borderSubtle">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/8 text-primary shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <h2 id="campaign-drawer-title" className="text-base sm:text-lg font-semibold text-text-primary tracking-tight truncate">
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
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsFullscreen(v => !v)}
                aria-label={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
                title={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
                className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors"
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-primary hover:text-primary-dark font-medium">
              <ExternalLink size={13} />
              פתח ב-{summary.platform} Ads Manager
            </a>
          )}
        </header>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <DrawerStat label="ROAS" value={summary.roas > 0 ? formatNumber(summary.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} primary />
            <DrawerStat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
            <DrawerStat label="ערך המרות" value={formatCurrency(summary.value)} prefix="CAD" accent={summary.value > summary.spend ? 'green' : undefined} />
            <DrawerStat label="המרות" value={formatNumber(summary.conversions, 0)} />
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <DrawerStat label="CTR" value={summary.impressions > 0 ? `${(summary.ctr * 100).toFixed(2)}%` : '—'} compact />
            <DrawerStat label="CPC" value={summary.clicks > 0 ? `CAD ${formatCurrency(summary.cpc, 2)}` : '—'} compact />
            <DrawerStat label="CPA" value={summary.conversions > 0 ? `CAD ${formatCurrency(summary.cpa, 2)}` : '—'} compact />
          </div>

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
                          <div dir="rtl" className="rounded-lg bg-text-primary text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                            <div className="text-white/70 mb-1 text-[10px]">{formatDate(d.date)}</div>
                            <div>הוצאה: <span className="font-semibold">CAD {formatCurrency(d.spend)}</span></div>
                            <div>ערך המרות: <span className="font-semibold text-emerald-300">CAD {formatCurrency(d.value)}</span></div>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#15803d" strokeWidth={1.5} fill="url(#drawer-value)" />
                    <Area type="monotone" dataKey="spend" stroke="#dc2626" strokeWidth={1.5} fill="url(#drawer-spend)" />
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

          {/* CPM over time — cost per 1000 impressions, CAD. Only shows when
              the user picked a range of at least 3 days AND there are at least
              2 days with actual impressions (a single point is not a chart).
              Days with zero impressions are filtered out — they have no
              meaningful CPM and would visually drop the line to zero. */}
          {(() => {
            const cpmSeries = summary.dailyArr.filter(d => d.impressions > 0);
            const fromMs = Date.UTC(
              Number(rangeFrom.slice(0, 4)),
              Number(rangeFrom.slice(5, 7)) - 1,
              Number(rangeFrom.slice(8, 10)),
            );
            const toMs = Date.UTC(
              Number(rangeTo.slice(0, 4)),
              Number(rangeTo.slice(5, 7)) - 1,
              Number(rangeTo.slice(8, 10)),
            );
            const rangeDays = Math.round((toMs - fromMs) / 86400000) + 1;
            if (rangeDays < 3 || cpmSeries.length < 2) return null;
            // Build the previous-period per-day series for THIS campaign
            // by filtering campaignsDataPrev to rows matching this drawer's
            // campaignId. Mirrors the live `summary` aggregation but for
            // the historical window. Only used when the user picks the
            // 'prev' analysis baseline.
            const prevDaily = (() => {
              if (cpmAnalysisMode !== 'prev') return undefined;
              const rows = (campaignsDataPrev?.rows ?? []).filter(r => r.campaignId === campaignId);
              if (rows.length === 0) return undefined;
              const byDay = new Map<string, { spend: number; impressions: number; value: number }>();
              for (const r of rows) {
                if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, impressions: 0, value: 0 });
                const d = byDay.get(r.date)!;
                d.spend += r.spend;
                d.impressions += r.impressions;
                d.value += r.conversionValue;
              }
              return Array.from(byDay.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .filter(([, v]) => v.impressions > 0)
                .map(([date, v]) => ({
                  date,
                  cpm: (v.spend / v.impressions) * 1000,
                  roas: v.spend > 0 ? v.value / v.spend : 0,
                }));
            })();
            // Smart analysis runs over the same filtered series the chart
            // draws — empty/zero days are excluded so a single dud day
            // doesn't poison the trend calculation.
            const analysis = analyzeCpmVsRoas(
              cpmSeries.map(d => ({ date: d.date, cpm: d.cpm, roas: d.roas })),
              prevDaily ? { prev: prevDaily } : undefined,
            );
            const fmtRangeShort = (from: string, to: string) => {
              const f = from.slice(5).replace('-', '/');
              const t = to.slice(5).replace('-', '/');
              return `${f}—${t}`;
            };
            const halfMidIdx = Math.floor(cpmSeries.length / 2);
            const firstHalfDates = cpmSeries.length >= 4
              ? `${cpmSeries[0].date.slice(5).replace('-', '/')}—${cpmSeries[halfMidIdx - 1].date.slice(5).replace('-', '/')}`
              : '';
            const secondHalfDates = cpmSeries.length >= 4
              ? `${cpmSeries[halfMidIdx].date.slice(5).replace('-', '/')}—${cpmSeries[cpmSeries.length - 1].date.slice(5).replace('-', '/')}`
              : '';
            const baselineLabel = analysis.mode === 'previous-period'
              ? `השוואה: ${fmtRangeShort(rangeFrom, rangeTo)} מול ${fmtRangeShort(prevRange.from, prevRange.to)} (תקופה קודמת באותו אורך)`
              : firstHalfDates && secondHalfDates
              ? `השוואה: חצי שני (${secondHalfDates}) מול חצי ראשון (${firstHalfDates})`
              : 'השוואה: חצי שני vs חצי ראשון של הטווח';
            const isLoadingPrev = cpmAnalysisMode === 'prev' && !campaignsDataPrev;
            const toneBg: Record<typeof analysis.tone, string> = {
              positive: 'bg-roas-greenBg/40 border-roas-green/30 text-roas-green',
              warning:  'bg-amber-50 border-amber-300 text-amber-800',
              negative: 'bg-roas-redBg/40 border-roas-red/30 text-roas-red',
              neutral:  'bg-surfaceMuted border-borderSubtle text-text-secondary',
            };
            return (
              <section>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-text-secondary" />
                    CPM לאורך זמן
                    <span className="text-[10px] font-medium text-text-muted">
                      (עלות ל-1000 חשיפות, CAD)
                    </span>
                  </h3>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Analysis baseline toggle — same UX as CampaignsTable. */}
                    <div className="inline-flex items-center gap-0.5 rounded-md border border-borderSubtle bg-surface p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setCpmAnalysisMode('half')}
                        className={cn(
                          'px-2 py-0.5 rounded transition-colors',
                          cpmAnalysisMode === 'half'
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        חצי-חצי
                      </button>
                      <button
                        type="button"
                        onClick={() => setCpmAnalysisMode('prev')}
                        className={cn(
                          'px-2 py-0.5 rounded transition-colors',
                          cpmAnalysisMode === 'prev'
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        vs תקופה קודמת
                      </button>
                    </div>
                    {/* ROAS overlay toggle — a tiny switch that adds a second
                        line + right Y-axis for ROAS so the user can compare
                        auction cost vs return-on-spend at a glance. */}
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showRoasOverlay}
                        onChange={e => setShowRoasOverlay(e.target.checked)}
                        className="rounded border-borderSubtle text-primary focus:ring-primary/30 cursor-pointer"
                      />
                      הוסף ROAS לגרף
                    </label>
                  </div>
                </div>
                <div className="h-40 sm:h-44 rounded-xl bg-surfaceMuted/40 border border-borderSubtle p-2" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cpmSeries} margin={{ top: 8, right: showRoasOverlay ? 56 : 16, left: 4, bottom: 0 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#7a8a9a' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={d => {
                          const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                          return m ? `${m[2]}/${m[1]}` : String(d);
                        }}
                        padding={{ left: 12, right: 12 }}
                      />
                      <YAxis
                        yAxisId="cpm"
                        tick={{ fontSize: 10, fill: '#7a8a9a' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={v => `C$${Number(v).toFixed(2)}`}
                        width={68}
                        domain={[
                          (dataMin: number) => Math.max(0, dataMin * 0.88),
                          (dataMax: number) => dataMax * 1.12,
                        ]}
                        allowDecimals
                      />
                      {showRoasOverlay && (
                        <YAxis
                          yAxisId="roas"
                          orientation="right"
                          tick={{ fontSize: 10, fill: '#15803d' }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => Number(v).toFixed(2)}
                          width={42}
                          domain={[
                            (dataMin: number) => Math.max(0, dataMin * 0.88),
                            (dataMax: number) => dataMax * 1.12,
                          ]}
                          allowDecimals
                        />
                      )}
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const d = payload[0].payload as {
                            date: string;
                            cpm: number;
                            impressions: number;
                            spend: number;
                            roas: number;
                          };
                          return (
                            <div dir="rtl" className="rounded-lg bg-text-primary text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                              <div className="text-white/70 mb-1 text-[10px]">{formatDate(d.date)}</div>
                              <div>CPM: <span className="font-semibold text-amber-200">CAD {formatCurrency(d.cpm, 2)}</span></div>
                              {showRoasOverlay && (
                                <div>ROAS: <span className="font-semibold text-emerald-300">{formatNumber(d.roas, 2)}</span></div>
                              )}
                              <div className="text-white/70 text-[10px] mt-0.5">
                                {formatNumber(d.impressions, 0)} חשיפות · CAD {formatCurrency(d.spend, 2)}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Line
                        yAxisId="cpm"
                        type="monotone"
                        dataKey="cpm"
                        stroke="#d97706"
                        strokeWidth={1.75}
                        dot={{ r: 2.5, fill: '#d97706', stroke: 'none' }}
                        activeDot={{ r: 4, fill: '#d97706', stroke: 'white', strokeWidth: 1.5 }}
                      />
                      {showRoasOverlay && (
                        <Line
                          yAxisId="roas"
                          type="monotone"
                          dataKey="roas"
                          stroke="#15803d"
                          strokeWidth={1.75}
                          strokeDasharray="5 3"
                          dot={{ r: 2.5, fill: '#15803d', stroke: 'none' }}
                          activeDot={{ r: 4, fill: '#15803d', stroke: 'white', strokeWidth: 1.5 }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* Mini legend — only when overlay is on. The CPM-only state
                    is unambiguous (one orange line, axis label says CPM). */}
                {showRoasOverlay && (
                  <div className="flex items-center justify-center gap-4 text-[10px] text-text-muted mt-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3 h-[2px] bg-amber-600" />
                      CPM (ציר שמאל)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3 border-t-2 border-dashed border-roas-green" />
                      ROAS (ציר ימין)
                    </span>
                  </div>
                )}
                {/* Smart analysis box — speaks only when there are enough
                    points and only as a hint, not a directive. */}
                {analysis.hasData && (
                  <div className={cn('mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed', toneBg[analysis.tone])}>
                    <div className="text-[10px] opacity-70 mb-1">
                      {baselineLabel}
                      {isLoadingPrev && <span className="ms-2 opacity-50">· טוען נתוני תקופה קודמת...</span>}
                    </div>
                    <span className="font-semibold ml-1">ניתוח:</span>
                    <span>{analysis.text}</span>
                  </div>
                )}
              </section>
            );
          })()}

          {/* Mapped products — Meta only (Google PMax delivery is feed-
              governed; manual tagging would mislead). */}
          {summary.platform === 'Meta' && (
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
                    <li key={id} title={id} className="inline-flex items-center gap-1 text-[11px] bg-primary/8 text-primary px-2 py-0.5 rounded-md font-mono">
                      <Package size={10} />
                      <span className="truncate max-w-[120px]">{id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {analysis && (
            <AttributionAnalysisPanel analysis={analysis} spend={summary.spend} value={summary.value} />
          )}

          {productChannelBreakdown && <ProductChannelBreakdown breakdown={productChannelBreakdown} />}

          {reconciliation && <MetaShopifyReconciliation reconciliation={reconciliation} />}

          {summary.adSets.length > 0 && (
            <AdSetTable
              adSets={sortedAdSets}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              attributionByAdSet={attributionByAdSet}
              optimized={optimized}
              onToggleOptimized={onToggle}
              onDrillAds={setAdDrillSet}
            />
          )}

          <div className="text-[10px] text-text-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={storeId}
        storeName={summary.storeName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(storeId, summary.platform, campaignId)] ?? []}
        onSave={(productIds) => {
          setMappedProducts(storeId, summary.platform, campaignId, productIds);
        }}
      />

      {/* Nested ad-level drawer uses the same user-selected range. */}
      {adDrillSet && (
        <AdsDrawer
          open
          onClose={() => setAdDrillSet(null)}
          storeId={adDrillSet.storeId}
          campaignId={adDrillSet.campaignId}
          adSetId={adDrillSet.adSetId}
          adSetName={adDrillSet.adSetName}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          adAccounts={adAccounts}
        />
      )}
    </div>
  );
}

function DrawerStat({ label, value, prefix, chip, primary, compact, accent }: {
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
