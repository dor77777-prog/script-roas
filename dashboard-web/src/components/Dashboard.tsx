'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  AlertCircle,
  Package,
  Table,
  Megaphone,
  Receipt,
  Menu,
} from 'lucide-react';
import type { DashboardData, Filters as F } from '@/lib/types';
import { computePresetRange, previousRange } from '@/lib/presets';
import { aggregate, aggregateByStore, dailySeries, filterRows } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Filters } from './Filters';
import { DetailTable } from './DetailTable';
import { ProductsTable } from './ProductsTable';
import { ProductCentricView } from './ProductCentricView';
import { CampaignsTable } from './CampaignsTable';
import { CampaignsTopList, type CampaignTopListPoint } from './CampaignsTopList';
import { aggregate as aggregateCampaigns } from '@/lib/campaignsAggregator';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import { rangeLabelHebrew } from '@/lib/presets';
import { AiReportButton } from './AiReportButton';
import { TabHeader } from './TabHeader';
import { PnLBreakdown } from './PnLBreakdown';
import { BillingSettings } from './BillingSettings';
import { AnnotationsPanel } from './AnnotationsPanel';
import {
  annotationsInScope,
  readAnnotations,
  type Annotation,
} from '@/lib/annotations';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { FocusMode } from './FocusMode';
import { SectionIntro } from './SectionIntro';
import { CloudSync } from './CloudSync';
import { SyncIndicator } from './SyncIndicator';
import { FreshnessChip } from './FreshnessChip';
import { TabFreshnessHeader } from './TabFreshnessHeader';
import { readDashboardState, syncUrl, drillToCampaigns, type TabKey } from '@/lib/urlState';
import { buildDateRangeKey } from '@/lib/dateRange';
import { Button } from '@/components/ui/Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { AnalysisTrendsTab } from './AnalysisTrendsTab';
import { AnalysisArchiveTab } from './AnalysisArchiveTab';
import { GoalTracker } from './GoalTracker';
import { PageScope } from '@/components/ui/PageScope';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { synthesizeDetail } from '@/lib/synthesis/detail';
import { synthesizePnl } from '@/lib/synthesis/pnl';
import { CommandCenterHero } from '@/components/home/CommandCenterHero';
import { PerStoreRow } from '@/components/home/PerStoreRow';
import {
  RoasTargetChart,
  readChartRangeFromUrl,
  type ChartCustomRange,
  type RoasChartRangeKey,
} from '@/components/home/RoasTargetChart';
import { ActivityFeed } from '@/components/home/ActivityFeed';
import { InsightsBoard } from './InsightsBoard';
import {
  aggregateCpm,
  toHeroPeriod,
  toHeroDelta,
  toNetSparkValues,
  toPerStoreData,
  toChartData,
  toSecondarySparklines,
} from '@/lib/home/adapters';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

// Phase 05.7.8 — orders fetcher (separate response shape from DashboardData).
// Returns the orders-attribution rows for the current range so the dashboard
// can surface per-store order counts (live + range-based) in cards.
type OrdersResponseShape = {
  rows: Array<{ storeName: string; date: string }>;
  lastUpdated: string;
  error?: string;
};
const ordersFetcher = async (url: string): Promise<OrdersResponseShape> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<OrdersResponseShape>;
};

const initialPreset = 'this_month';

/**
 * Wraps tab-switch state updates in the browser's native View Transitions
 * API (Chromium 111+, Firefox 132+, Safari 18+ — ~78% global support as of
 * 2026-05). Falls back to a plain state update on unsupported browsers so
 * the dashboard never breaks. Inside the VT callback the React state
 * update is wrapped in startTransition so React doesn't tear during the
 * snapshot the browser takes for the cross-fade.
 */
function useTabTransition() {
  return (next: TabKey, setActiveTab: (k: TabKey) => void) => {
    const doc = document as typeof document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        startTransition(() => setActiveTab(next));
      });
    } else {
      setActiveTab(next);
    }
  };
}

export function Dashboard() {
  // Initial state — read from URL search params on first mount so a refresh
  // or bookmark restores the user's view. Falls back to defaults when no
  // params are present.
  // NOTE: filters must be declared before useSWR so buildDateRangeKey can
  // use filters.range as the SWR key (Phase 5 — range-keyed pagination).
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'home';
    return readDashboardState(
      {
        tab: 'home',
        filters: { preset: initialPreset, range: computePresetRange(initialPreset), store: 'All' },
      },
      window.location.search,
    ).tab;
  });
  const startTabTransition = useTabTransition();
  const handleTabChange = (next: TabKey) => startTabTransition(next, setActiveTab);
  const [filters, setFilters] = useState<F>(() => {
    const defaults = {
      preset: initialPreset,
      range: computePresetRange(initialPreset),
      store: 'All',
    } as F;
    if (typeof window === 'undefined') return defaults;
    return readDashboardState({ tab: 'home', filters: defaults }, window.location.search).filters;
  });

  const { data, error, isLoading, mutate } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', filters.range),
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  // Phase 05.7.8 — fetch orders for the same range so per-store cards can show
  // "X הזמנות" alongside revenue/spend. Keeps the data path separate from
  // /api/data (which doesn't carry per-store order counts) without baking
  // it into the heavier dashboard payload.
  const { data: ordersData } = useSWR(
    buildDateRangeKey('/api/orders-attribution', filters.range),
    ordersFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  // Counter that increments whenever the command palette wants to open the
  // AI report modal. AiReportButton listens to this prop via useEffect.
  const [aiReportSignal, setAiReportSignal] = useState(0);

  // Mobile (< md) drawer state for the off-canvas Sidebar. The hamburger in
  // the top header strip toggles this open; tap-outside on the backdrop or
  // any nav item closes it. On desktop (md and up) the Sidebar ignores
  // this prop and renders as the usual right-rail.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // `aggregate()` reads billing from localStorage to compute fixedCosts. The
  // `filtered` memo below doesn't know billing exists, so editing a cost
  // wouldn't refresh KPI / PnL / per-store totals until the page reloaded.
  // This tick increments on every 'roas-billing-changed' dispatch and is
  // included in the memo deps to force a re-aggregate.
  //
  // Phase 12.5.x audit fix (2026-05-24, MEDIUM #3) — also invalidate the
  // SWR cache for /api/data on the same event. The client-side aggregate
  // above re-runs immediately via billingTick, which handles KPI/PnL/per-
  // store cards correctly. But components that consume `data.rows` directly
  // (DetailTable, MonthlyTables) still see the stale response until the
  // 60s refreshInterval fires. mutate() marks the entry stale; SWR
  // re-fetches on next access — cheap (idempotent) and keeps the whole
  // dashboard in sync after a billing edit.
  const [billingTick, setBillingTick] = useState(0);
  const { mutate: swrMutate } = useSWRConfig();
  useEffect(() => {
    const dataKey = buildDateRangeKey('/api/data', filters.range);
    const bump = () => {
      setBillingTick(t => t + 1);
      if (dataKey) swrMutate(dataKey);
    };
    window.addEventListener('roas-billing-changed', bump);
    return () => window.removeEventListener('roas-billing-changed', bump);
  }, [filters.range, swrMutate]);

  // Mirror state into the URL so refresh / bookmark / share survive. Uses
  // replaceState so we don't pollute the back-button stack.
  useEffect(() => {
    syncUrl({ tab: activeTab, filters });
  }, [activeTab, filters]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const cur = filterRows(data.rows, filters.range, filters.store);
    const prevR = previousRange(filters.range);
    const prev = filterRows(data.rows, prevR, filters.store);
    const stores = filters.store === 'All' ? data.stores : [filters.store];
    return {
      cur,
      // Phase 05.7.8 — pass the request range so fixed-cost proration uses
      // the user-selected window, not the data-derived min/max date.
      curAgg: aggregate(cur, filters.range),
      prevAgg: aggregate(prev, prevR),
      // Audit fix 2026-05-23 (d/CR-02): forward filters.range so per-store
      // cards prorate fixed costs over the user's selected window, matching
      // the top-level aggregate above. Without this they prorate over the
      // data-derived min/max date — per-store and top-level numbers diverge.
      storeAggs: aggregateByStore(cur, filters.range),
      // Audit fix 2026-05-23 (CRIT-3 + HIGH-8): pass the operator's selected
      // range so `dailySeries` walks every calendar day. Without it, a
      // mid-range data outage was rendered as a 1-day step between the
      // surrounding active points on RoasChart's categorical X-axis
      // (CRIT-3), and missing per-store cells on partially-covered days
      // appeared as ROAS=0 dots (HIGH-8). With it, gap days emit `null`
      // per-store and RoasChart's `connectNulls={false}` shows the gap.
      series: dailySeries(cur, stores, filters.range),
      visibleStores: stores,
    };
    // billingTick: re-aggregate on billing edits so live values stay in sync.
  }, [data, filters, billingTick]);

  // Phase 05.7.8 — per-store order count map for the current range. Filters
  // the same way `filtered.cur` does so cards stay in sync with the global
  // store dropdown. Seeds zero for every visible store so a store with no
  // orders in the range renders "0" instead of "—" (— means "still loading").
  const ordersByStore = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (data?.stores) {
      for (const s of data.stores) {
        if (filters.store === 'All' || s === filters.store) out[s] = 0;
      }
    }
    const rows = ordersData?.rows ?? [];
    for (const r of rows) {
      const storeName = r.storeName;
      if (!storeName) continue;
      if (filters.store !== 'All' && storeName !== filters.store) continue;
      out[storeName] = (out[storeName] ?? 0) + 1;
    }
    return out;
  }, [ordersData, data, filters.store]);

  return (
    <div dir="rtl" className="min-h-screen bg-canvas flex">
      {/* Sidebar on the start-side (right in RTL). On mobile (< md) it
          collapses to an off-canvas drawer triggered by the hamburger in
          the top header strip below. */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isMobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* Main column — header strip + tab content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Keeps billing / annotations / goal / insight-states in sync across
            devices and partners by mirroring localStorage to Google Sheets. */}
        <CloudSync />
        <FocusMode />

        {/* Top strip — freshness chip, command palette, sync indicator.
            The full <Header> (logo, brand, deep navy gradient) is no
            longer needed since the Sidebar carries the brand. We keep a
            slim, theme-aware top strip so the chips that used to live
            inside <Header> have a home. */}
        <header
          role="banner"
          className="sticky top-0 z-30 bg-glass-1/85 backdrop-blur-xl border-b border-glass-edge px-4 py-2 flex items-center justify-between md:justify-end gap-2"
        >
          {/* Mobile-only hamburger — opens the off-canvas Sidebar drawer.
              On md and up the Sidebar is the persistent right-rail, so the
              hamburger is hidden via `md:hidden`. Sits on the start side
              (right in RTL) so it's reachable with the right thumb. */}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden"
            aria-label="פתח תפריט"
          >
            <Menu size={20} />
          </Button>

          <div className="flex items-center gap-2">
            <FreshnessChip dataLastWriteAt={data?.dataLastWriteAt ?? null} />
            {data && (
              <CommandPalette
                data={data}
                filters={filters}
                setFilters={setFilters}
                activeTab={activeTab}
                setActiveTab={handleTabChange}
                onRefresh={() => mutate()}
                onOpenAiReport={() => setAiReportSignal(n => n + 1)}
              />
            )}
            <SyncIndicator />
          </div>
        </header>

        <main className="max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-5">
          {/* Two error sources: (a) SWR threw (network failure, malformed JSON),
            * (b) /api/data returned 200 + empty rows + error field (WR-06 degraded
            * path — preferred over status 500 so SWR consumers downstream stay
            * consistent across /api/data, /api/campaigns, /api/products, /api/ads,
            * /api/orders-attribution, etc.). Either surfaces in the same banner. */}
          {(error || data?.error) && (
            <div className="rounded-xl bg-status-redBg border border-[color-mix(in_oklab,var(--status-red)_30%,transparent)] p-4 flex items-start gap-3">
              <AlertCircle className="text-status-red shrink-0" size={20} />
              <div>
                <div className="font-semibold text-status-red">שגיאה בטעינת הנתונים</div>
                <div className="text-sm text-ink-secondary mt-1">
                  {error ? (error as Error).message : data?.error}
                </div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="space-y-4 animate-fade-in">
              <div className="skeleton h-40 sm:h-48 rounded-2xl" aria-hidden />
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-28 sm:h-36 rounded-xl" aria-hidden />
                ))}
              </div>
              <div className="sr-only">טוען נתונים…</div>
            </div>
          )}

          {data && filtered && (
            <>
              {/* Phase 05.7.6 — per-tab freshness chip + global refresh button.
                  Rendered once at the top so it appears on every tab. The
                  chip reflects data_daily.updated_at which is a good proxy
                  for all 4 daily tables (they all bump on the same cron tick).
                  The refresh button fires sync-now for all 3 stores +
                  polls until backend is done + SWR-mutates every key. */}
              <TabFreshnessHeader dataLastWriteAt={data.dataLastWriteAt ?? null} />
              {activeTab === 'home' && (
                <HomeTab
                  data={data}
                  filtered={filtered}
                  filters={filters}
                  setFilters={setFilters}
                  aiReportSignal={aiReportSignal}
                  ordersByStore={ordersByStore}
                  ordersRows={ordersData?.rows}
                />
              )}
              {activeTab === 'pnl' && (
                <PnLTab
                  data={data}
                  filtered={filtered}
                  filters={filters}
                  setFilters={setFilters}
                />
              )}
              {activeTab === 'analysis' && (
                <AnalysisTab data={data} filtered={filtered} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'campaigns' && (
                <CampaignsTab data={data} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'products' && (
                <ProductsTab data={data} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'detail' && (
                <DetailTab filtered={filtered} filters={filters} setFilters={setFilters} stores={data.stores} />
              )}

              <Footer lastUpdated={data.lastUpdated} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// Tab: HOME — at-a-glance snapshot. No filters; this is the "what's
// happening right now + this period" view.
// ============================================================================
type FilteredView = {
  curAgg: ReturnType<typeof aggregate>;
  prevAgg: ReturnType<typeof aggregate>;
  storeAggs: ReturnType<typeof aggregateByStore>;
  series: ReturnType<typeof dailySeries>;
  visibleStores: string[];
  cur: DashboardData['rows'];
};

// ----------------------------------------------------------------------------
// HomeTab — Task 3.1 (UI/UX overhaul). 5-locked-section structure per
// [[home-visual-rules]] + mockup-04-final.html (per-store swap 2026-05-31):
//
//   1. TabHeader (title + range/store filters + AI report button)
//   2. PerStoreRow (3 stores, semantic emphasis, per-platform CPM)
//   3. CommandCenterHero (2-row hero strip — banded Net + KPIs)
//   4. RoasTargetChart (independent chart range, target line, pins)
//   5. InsightsBoard + ActivityFeed (bottom 2-up grid)
//
// Per-store-first ordering: user feedback 2026-05-31 — the first glance
// answers "what's happening per store?", and the business-wide total is the
// follow-up. Hero stays the editorial summary, just one slot lower.
//
// AnnotationsPanel stays as a thin overlay above the hero — it owns the
// "add an event marker" UI used by RoasTargetChart's pins; ergonomically
// it belongs near the chart but technically it writes to localStorage so
// either placement works. Top is the historical placement; keeping it
// preserves muscle memory.
// ----------------------------------------------------------------------------
function HomeTab({
  data,
  filtered,
  filters,
  setFilters,
  aiReportSignal,
  ordersByStore,
  ordersRows,
}: {
  data: DashboardData;
  filtered: FilteredView;
  filters: F;
  setFilters: (next: F) => void;
  /** Increments when the command palette wants to open the AI report. */
  aiReportSignal: number;
  /** Phase 05.7.8 — per-store order count for the range, keyed by storeName. */
  ordersByStore: Record<string, number>;
  /**
   * Raw orders-attribution rows for the active range. Threaded through so
   * the Hero strip's per-day Orders sparkline can bucket the same row set
   * the per-store order count already consumes — no second SWR fetch.
   */
  ordersRows?: Array<{ storeName: string; date: string }>;
}) {
  // Chart range is INDEPENDENT of the page-level filter range — operator can
  // browse a 90-day trend without losing the "today" snapshot above. Seeded
  // from `?chartRange=…` URL params so refresh / share preserves the choice.
  const [chartRange, setChartRange] = useState<RoasChartRangeKey>('30');
  const [chartCustomRange, setChartCustomRange] = useState<
    ChartCustomRange | undefined
  >(undefined);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const parsed = readChartRangeFromUrl(window.location.search);
    setChartRange(parsed.range);
    setChartCustomRange(parsed.customRange);
  }, []);

  // Resolve chart range → concrete from/to. Custom takes its own bounds;
  // the named presets compute from "today in IL" (matches the page-level
  // presets — same helper).
  const chartFromTo = useMemo<{ from: string; to: string }>(() => {
    if (chartRange === 'custom' && chartCustomRange) return chartCustomRange;
    switch (chartRange) {
      case '7':   return computePresetRange('last_7_days');
      case '30':  return computePresetRange('last_30_days');
      case '90': {
        // No `last_90_days` preset — synthesize directly from today.
        const today = computePresetRange('today');
        const fromDate = new Date(today.from + 'T00:00:00Z');
        fromDate.setUTCDate(fromDate.getUTCDate() - 89);
        return { from: fromDate.toISOString().slice(0, 10), to: today.to };
      }
      case 'mtd': return computePresetRange('this_month');
      case 'qtd': {
        const today = computePresetRange('today');
        const todayDate = new Date(today.from + 'T00:00:00Z');
        const m = todayDate.getUTCMonth();
        const qStart = Math.floor(m / 3) * 3;
        const from = new Date(Date.UTC(todayDate.getUTCFullYear(), qStart, 1));
        return { from: from.toISOString().slice(0, 10), to: today.to };
      }
      case 'ytd': {
        const today = computePresetRange('today');
        const todayDate = new Date(today.from + 'T00:00:00Z');
        const from = new Date(Date.UTC(todayDate.getUTCFullYear(), 0, 1));
        return { from: from.toISOString().slice(0, 10), to: today.to };
      }
      default: return computePresetRange('last_30_days');
    }
  }, [chartRange, chartCustomRange]);

  // ---- /api/campaigns — single fetch for both Hero CPM + PerStoreRow per-
  // platform CPM. Stored in SWR so the existing Campaigns tab share its
  // cache. CPM-previous-period fetched separately for the delta line.
  const campaignsKey = buildDateRangeKey('/api/campaigns', filters.range);
  const { data: campaignsData } = useSWR<CampaignsResponse>(
    campaignsKey,
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  const prevRange = useMemo(() => previousRange(filters.range), [filters.range]);
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', prevRange),
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  // Previous-period rows for the hero delta — /api/data only returns the
  // current range so the previous baseline needs its own fetch.
  const { data: dataPrev } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', prevRange),
    fetcher,
    { revalidateOnFocus: false },
  );

  // ---- Chart range data — independent of page filters so the picker can
  // walk 7d/30d/90d/MTD/QTD/YTD without losing the snapshot above.
  const { data: chartDataResp } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', chartFromTo),
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: chartCampaignsResp } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', chartFromTo),
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // ---- Hero — current + previous + spark ---------------------------------
  const heroCpm = useMemo(
    () =>
      aggregateCpm(
        campaignsData?.rows,
        filters.range.from,
        filters.range.to,
        filters.store,
      ),
    [campaignsData, filters.range, filters.store],
  );
  const heroCpmPrev = useMemo(
    () =>
      aggregateCpm(
        campaignsDataPrev?.rows,
        prevRange.from,
        prevRange.to,
        filters.store,
      ),
    [campaignsDataPrev, prevRange, filters.store],
  );
  // Sum of order counts across visible stores for the current range — the
  // hero's "Orders" big number. Previous-range orders fall back to 0 (we
  // skip the extra fetch to keep the home tab lean).
  const heroOrders = useMemo(() => {
    let total = 0;
    for (const k of Object.keys(ordersByStore)) total += ordersByStore[k] ?? 0;
    return total;
  }, [ordersByStore]);
  const prevAggFromPrevData = useMemo(() => {
    if (!dataPrev) return null;
    const prevCur = filterRows(dataPrev.rows, prevRange, filters.store);
    return aggregate(prevCur, prevRange);
  }, [dataPrev, prevRange, filters.store]);
  const heroPeriod = useMemo(
    () => toHeroPeriod(filtered.curAgg, heroCpm, heroOrders),
    [filtered.curAgg, heroCpm, heroOrders],
  );
  const heroDelta = useMemo(() => {
    if (!prevAggFromPrevData) return undefined;
    return toHeroDelta(
      filtered.curAgg,
      prevAggFromPrevData,
      heroCpm,
      heroCpmPrev,
      heroOrders,
      0,
    );
  }, [filtered.curAgg, prevAggFromPrevData, heroCpm, heroCpmPrev, heroOrders]);
  const netSparkValues = useMemo(
    () => toNetSparkValues(filtered.series),
    [filtered.series],
  );
  // Bug F (2026-05-31) — every secondary hero card carries a per-day
  // sparkline so the strip stops feeling empty. The adapter reuses the
  // exact (series, orders, campaigns) inputs the rest of the Home tab
  // already consumes so no extra SWR fetch is introduced.
  const secondarySparklines = useMemo(
    () =>
      toSecondarySparklines({
        series: filtered.series,
        range: filters.range,
        store: filters.store,
        ordersRows,
        campaignsRows: campaignsData?.rows,
      }),
    [filtered.series, filters.range, filters.store, ordersRows, campaignsData],
  );

  // ---- Per-store row ------------------------------------------------------
  const storeIdByName = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const r of data.rows) {
      if (!out[r.storeName]) out[r.storeName] = r.storeId;
    }
    return out;
  }, [data.rows]);
  const perStoreData = useMemo(
    () =>
      toPerStoreData(
        filtered.storeAggs,
        campaignsData?.rows,
        filters.range,
        ordersByStore,
        storeIdByName,
      ),
    [
      filtered.storeAggs,
      campaignsData,
      filters.range,
      ordersByStore,
      storeIdByName,
    ],
  );

  // ---- Annotation pins for RoasTargetChart -------------------------------
  // Bug fix (2026-05-31): the chart's annotation pins were stubbed empty in
  // the Wave-3 redesign. Wire them to the same localStorage-backed source
  // the AnnotationsPanel writes to so launching a campaign / logging a sale
  // immediately shows up as a pin on the chart, matching the pre-overhaul
  // RoasChart behavior. Subscribes to the existing 'roas-annotations-changed'
  // event so a new annotation surfaces without a refresh.
  const [annotationsAll, setAnnotationsAll] = useState<Annotation[]>([]);
  useEffect(() => {
    setAnnotationsAll(readAnnotations());
    const onChange = () => setAnnotationsAll(readAnnotations());
    window.addEventListener('roas-annotations-changed', onChange);
    return () => window.removeEventListener('roas-annotations-changed', onChange);
  }, []);
  // Scope to the CHART date range (independent from the page filter range)
  // so pins disappear when the operator narrows the chart picker to a
  // window that doesn't contain that annotation. Store filter follows the
  // page-level scope — pins for store-scoped events hide when the operator
  // narrows to a different store.
  const chartAnnotations = useMemo(
    () => annotationsInScope(annotationsAll, chartFromTo, filters.store),
    [annotationsAll, chartFromTo, filters.store],
  );

  // ---- ROAS chart data ----------------------------------------------------
  const chartScope = useMemo(() => {
    const stores =
      filters.store === 'All'
        ? (chartDataResp?.stores ?? data.stores)
        : [filters.store];
    const cur = chartDataResp
      ? filterRows(chartDataResp.rows, chartFromTo, filters.store)
      : [];
    const series = dailySeries(cur, stores, chartFromTo);
    const agg = aggregate(cur, chartFromTo);
    const cpm = aggregateCpm(
      chartCampaignsResp?.rows,
      chartFromTo.from,
      chartFromTo.to,
      filters.store,
    );
    return { series, agg, cpm };
  }, [
    chartDataResp,
    chartCampaignsResp,
    chartFromTo,
    filters.store,
    data.stores,
  ]);
  const chartProp = useMemo(
    () =>
      toChartData(
        chartScope.series,
        chartScope.agg,
        chartScope.cpm,
        prevAggFromPrevData,
        chartAnnotations,
      ),
    [chartScope, prevAggFromPrevData, chartAnnotations],
  );

  const handleStoreSelect = (storeId: string) => {
    drillToCampaigns({ store: storeId });
  };

  // Range label for PageScope — the operator's preset key picks the human
  // label, with a custom-range fallback when the picker is in custom mode.
  // Shared with every other top-level tab via `rangeLabelHebrew` so the
  // format never drifts between Home / Trends / P&L / Campaigns / etc.
  const rangeLabel = rangeLabelHebrew(filters.preset, filters.range);

  // Hero range label is the same in the current build (a future iteration
  // could pull the active range-tab label exactly from the segmented
  // control); for now the preset label reads naturally.
  const heroRangeLabel = rangeLabel;

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      {/* 1. Header — title + filters + AI report ----------------------------- */}
      <TabHeader
        title="בית"
        description="שנה טווח או חנות לעדכון כל המסך."
        filterSlot={<Filters filters={filters} stores={data.stores} onChange={setFilters} />}
        actionSlot={<AiReportButton data={data} filters={filters} openSignal={aiReportSignal} />}
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabel}
        currency="CAD"
      />

      {/* Activity-log overlay — annotation pin authoring (writes feed pins) */}
      <AnnotationsPanel range={filters.range} store={filters.store} />

      {/* 2. Per-store row — 3 stores w/ semantic emphasis ------------------- */}
      {/* Per-store FIRST (was section 3): user prefers "per store" before    */}
      {/* the business-wide hero summary. Locked 2026-05-31.                  */}
      <PerStoreRow stores={perStoreData} onStoreSelect={handleStoreSelect} />

      {/* 3. Hero strip — 2 rows × 3 cards (business-wide summary) ----------- */}
      <CommandCenterHero
        current={heroPeriod}
        delta={heroDelta}
        rangeLabel={heroRangeLabel}
        netSparkValues={netSparkValues}
        secondarySparklines={secondarySparklines}
        updatedAt={data.dataLastWriteAt ?? undefined}
      />

      {/* 4. ROAS-vs-target chart — independent date range ------------------- */}
      <RoasTargetChart
        range={chartRange}
        customRange={chartCustomRange}
        data={chartProp}
        scopeLabel={
          filters.store === 'All'
            ? `${data.stores.length} חנויות`
            : filters.store
        }
        updatedAt={chartDataResp?.dataLastWriteAt ?? undefined}
        onRangeChange={(next, custom) => {
          setChartRange(next);
          setChartCustomRange(custom);
        }}
      />

      {/* 5. Bottom 2-up — Insights board + Activity feed -------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsBoard data={data} />
        <ActivityFeed
          store={filters.store === 'All' ? undefined : filters.store}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Tab: P&L — dedicated profit & loss surface. Pulled out of HomeTab to give
// it room to breathe; the home tab is for "at a glance" while this one is
// the "where did the money go?" deep dive.
// ============================================================================
function PnLTab({
  data,
  filtered,
  filters,
  setFilters,
}: {
  data: DashboardData;
  filtered: FilteredView;
  filters: F;
  setFilters: (next: F) => void;
}) {
  const pnlSynthesis = synthesizePnl({ agg: filtered.curAgg });
  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<Receipt size={20} />}
        title="הרווח שלך לתקופה"
        description="כל ההכנסות פחות כל ההוצאות — ad spend, COGS (25%), עמלות עיבוד (6.5%), ועלויות חודשיות קבועות (מנויים + חד-פעמיים) — עד לרווח נטו אמיתי. שנה טווח או חנות וכל המספרים יתעדכנו."
        formula="רווח נטו = הכנסות − Ad Spend − COGS − Transaction Fees − Fixed Costs"
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabelHebrew(filters.preset, filters.range)}
        currency="CAD"
      />
      <PageSynthesis
        text={pnlSynthesis.text}
        anchorMetric={pnlSynthesis.anchorMetric}
        confidence={pnlSynthesis.confidence}
      />

      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      <GoalTracker data={data} />

      <div className="space-y-3">
        <div className="flex justify-end">
          <BillingSettings storeNames={data.stores} />
        </div>
        <PnLBreakdown
          current={filtered.curAgg}
          storeNames={filtered.visibleStores}
          rangeFrom={filters.range.from}
          rangeTo={filters.range.to}
          rows={filtered.cur}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Tab: ANALYSIS — trend chart + monthly breakdown tables.
// ============================================================================
function AnalysisTab({
  data,
  filtered,
  filters,
  setFilters,
}: {
  data: DashboardData;
  filtered: {
    series: ReturnType<typeof dailySeries>;
    visibleStores: string[];
    cur: DashboardData['rows'];
  };
  filters: F;
  setFilters: (next: F) => void;
}) {
  return (
    <Tabs defaultValue="trends" variant="underline" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="trends">מגמות</TabsTrigger>
        <TabsTrigger value="archive">היסטוריה</TabsTrigger>
      </TabsList>
      <TabsContent value="trends">
        <AnalysisTrendsTab data={data} filtered={filtered} filters={filters} setFilters={setFilters} />
      </TabsContent>
      <TabsContent value="archive">
        <AnalysisArchiveTab stores={data.stores} globalStore={filters.store} />
      </TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Tab: CAMPAIGNS — campaign + ad-set performance with ROAS / CTR / CPC / CPA.
// ============================================================================
const campaignsFetcher = async (url: string): Promise<CampaignsResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<CampaignsResponse>;
};

function QuadrantScatterCard({
  filters,
}: {
  filters: { store: string; range: { from: string; to: string } };
}) {
  const { data: swrData } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', filters.range),
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  const points = useMemo<CampaignTopListPoint[]>(() => {
    if (!swrData) return [];
    const aggregated = aggregateCampaigns(
      swrData.rows,
      'campaign',
      filters.store,
      'all',
      filters.range,
      swrData.currentEffectiveStatus,
    );
    return aggregated
      .filter((a) => a.spend > 0 && a.conversions > 0)
      .map((a) => ({
        name: a.campaignName,
        platform: a.platform,
        storeName: a.storeName,
        roas: a.conversionValue / a.spend,
        cac: a.spend / a.conversions,
        spend: a.spend,
      }));
  }, [swrData, filters.store, filters.range]);

  return <CampaignsTopList data={points} title="הקמפיינים הבולטים — מנצחים ולתשומת לב" />;
}

function CampaignsTab({
  data,
  filters,
  setFilters,
}: {
  data: DashboardData;
  filters: F;
  setFilters: (next: F) => void;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<Megaphone size={20} />}
        title="ביצועי קמפיינים ומודעות"
        description="קמפיין-לכל-קמפיין ואד-סט-לכל-אד-סט: כמה הוצאת, כמה החזיר, ROAS, CTR, CPC ו-CPA. ממויין כברירת מחדל לפי ROAS — שורות עליונות הן הזוכות. לחיצה על האייקון מימין לשורה פותחת ישירות את הקמפיין ב-Meta/Google Ads Manager."
        formula="ROAS = ערך המרות / הוצאה · CTR = קליקים / חשיפות · CPA = הוצאה / המרות"
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabelHebrew(filters.preset, filters.range)}
        currency="CAD"
      />
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />
      <QuadrantScatterCard filters={filters} />
      <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
        <CampaignsTable
          range={filters.range}
          store={filters.store}
          stores={data.stores}
          dailyRows={data.rows}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Tab: PRODUCTS — products sold breakdown with its own scope.
// ============================================================================
type ProductsSubTab = 'table' | 'pivot';

const PRODUCTS_SUBTABS: { key: ProductsSubTab; label: string; description: string }[] = [
  {
    key: 'table',
    label: 'מוצרים שנמכרו',
    description: 'כל פריט שנמכר בחנויות שלך — הזמנות, יחידות, ברוטו ונטו, מקובץ לפי תקופה.',
  },
  {
    key: 'pivot',
    label: 'מוצרים → קמפיינים',
    description: 'פיבוט הפוך: לכל מוצר ממופה, אילו קמפיינים מקדמים אותו ומה ה-ROAS האמיתי שלהם.',
  },
];

function ProductsTab({
  data,
  filters,
  setFilters,
}: {
  data: DashboardData;
  filters: F;
  setFilters: (next: F) => void;
}) {
  // Operator-reported 2026-05-26: scrolling past a 30-day ProductsTable to
  // reach the bottom-of-page pivot was painful. Split the two views into
  // sub-tabs — operator picks "טבלה" or "פיבוט" up front, each tab renders
  // a single full-height view. Sub-tab state is local (not URL-persisted)
  // because it's an in-page nav, not part of the shareable dashboard state.
  const [subTab, setSubTab] = useState<ProductsSubTab>('table');
  const active = PRODUCTS_SUBTABS.find((t) => t.key === subTab) ?? PRODUCTS_SUBTABS[0];

  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<Package size={20} />}
        title={active.label}
        description={active.description}
        formula={subTab === 'table' ? 'ברוטו = מחיר × כמות   •   נטו = ברוטו − הנחות − החזרים' : undefined}
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabelHebrew(filters.preset, filters.range)}
        currency="CAD"
      />

      {/* Show global filter too so user knows what date range is active */}
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      {/* Sub-tab segmented control — same visual pattern as ProductsTable's
          period switcher so it feels native to the tab. dir="ltr" on the
          rail keeps the divide-x borders consistent under RTL. */}
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="תצוגות בטאב מוצרים"
          className="inline-flex rounded-lg border border-glass-edge bg-glass-1 overflow-hidden divide-x divide-glass-edge"
          dir="ltr"
        >
          {PRODUCTS_SUBTABS.map((t) => (
            <Button
              key={t.key}
              role="tab"
              variant={subTab === t.key ? 'primary' : 'ghost'}
              aria-selected={subTab === t.key}
              onClick={() => setSubTab(t.key)}
              className={cn(
                'px-4 sm:px-5 py-2 h-auto text-xs sm:text-sm font-medium min-w-[140px] rounded-none',
                subTab === t.key
                  ? ''
                  : 'text-ink-secondary',
              )}
              dir="rtl"
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {subTab === 'table' && (
        <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
          <ProductsTable
            range={filters.range}
            store={filters.store}
            stores={data.stores}
          />
        </div>
      )}

      {/* Phase 05.7.x (2026-05-23) — Product-centric pivot view. Shows
          each product expandable to all campaigns mapping it, grouped
          by platform with intra-platform spend share + allocated
          revenue. Defaults to multi-mapped products only; operator
          can toggle to see solo too. Renders a "select a store" hint
          when filters.store === 'All' (mappings are per-store). */}
      {subTab === 'pivot' && (
        <ProductCentricView storeId={filters.store} range={filters.range} />
      )}
    </div>
  );
}

// ============================================================================
// Tab: DETAIL — raw daily log for power users.
// ============================================================================
function DetailTab({
  filtered,
  filters,
  setFilters,
  stores,
}: {
  filtered: { cur: DashboardData['rows'] };
  filters: F;
  setFilters: (next: F) => void;
  stores: string[];
}) {
  const detailSynthesis = synthesizeDetail({ rows: filtered.cur });
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<Table size={20} />}
        title="פירוט יומי"
        description="כל שורה בטבלה היא (יום × חנות) — הוצאות פייסבוק, גוגל, הכנסות, ROAS, ורווח. עד 100 שורות אחרונות בטווח הנבחר. ROAS אדום עם '0' = יום שהוצאת בו כסף אבל לא היו מכירות (כשל)."
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabelHebrew(filters.preset, filters.range)}
        currency="CAD"
      />
      <PageSynthesis
        text={detailSynthesis.text}
        anchorMetric={detailSynthesis.anchorMetric}
        confidence={detailSynthesis.confidence}
      />
      <Filters filters={filters} stores={stores} onChange={setFilters} />
      <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
        <DetailTable rows={filtered.cur} bare />
      </div>
    </div>
  );
}

// ============================================================================
// Footer
// ============================================================================
function Footer({ lastUpdated }: { lastUpdated: string }) {
  return (
    <footer className="text-center text-[11px] sm:text-xs text-ink-muted py-6 tabular-nums">
      <span className="inline-block">
        עדכון אחרון:{' '}
        <span className="text-ink-secondary font-medium">
          {new Date(lastUpdated).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
        </span>
      </span>
      <span className="mx-2 text-ink-subtle">·</span>
      <span>מתעדכן אוטומטית כל דקה</span>
    </footer>
  );
}
