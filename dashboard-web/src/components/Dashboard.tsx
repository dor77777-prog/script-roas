'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  AlertCircle,
  Package,
  Table,
  Megaphone,
  Receipt,
  Store,
  Building2,
} from 'lucide-react';
import type { DashboardData, Filters as F } from '@/lib/types';
import { computePresetRange, previousRange, resolveCompare } from '@/lib/presets';
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
import { TopStrip } from './TopStrip';
import { Sidebar } from './Sidebar';
import { FocusMode } from './FocusMode';
import { SectionIntro } from './SectionIntro';
import { CloudSync } from './CloudSync';
import { TabFreshnessHeader } from './TabFreshnessHeader';
import { readDashboardState, syncUrl, drillToCampaigns, DEFAULT_PRESET, type TabKey } from '@/lib/urlState';
import { OPEN_CAMPAIGN_DRAWER_EVENT, type OpenCampaignDrawerDetail } from '@/components/insights/InsightActions';
import { STORE_ID_TO_NAME, type StoreId } from '@/lib/platformsByStore';
import { buildDateRangeKey, getTodayInIsraelTz } from '@/lib/dateRange';
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import { applyCogsToRows } from '@/lib/cogsSettings';
import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
import { salariesForRange } from '@/lib/salarySettings';
import { fetchJson, fetchJsonOrNull, fetchJsonStrict } from '@/lib/fetchJson';
import { useAutoRefresh } from '@/lib/hooks/useAutoRefresh';
import { CogsSettings } from '@/components/CogsSettings';
import { SalarySettings } from '@/components/SalarySettings';
import { Button } from '@/components/ui/Button';
import { AnalysisTrendsTab } from './AnalysisTrendsTab';
import { AnalysisArchiveTab } from './AnalysisArchiveTab';
import { GoalTracker } from './GoalTracker';
import { PageScope } from '@/components/ui/PageScope';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { synthesizeDetail } from '@/lib/synthesis/detail';
import { synthesizePnl } from '@/lib/synthesis/pnl';
import { CommandCenterHero } from '@/components/home/CommandCenterHero';
import { ReconcileBanner } from '@/components/home/ReconcileBanner';
import { SourceHealthChip } from '@/components/home/SourceHealthChip';
import { provenanceForRange } from '@/lib/freshness/provenance';
import type { ActiveOverridesResponse } from '@/app/api/active-overrides/route';
import type { OverridesActiveGroup } from '@/lib/home/overridesActive';
import { PerStoreRow } from '@/components/home/PerStoreRow';
import { StoreCompareGrid } from '@/components/home/StoreCompareGrid';
import {
  RoasTargetChart,
  readChartRangeFromUrl,
  type ChartCustomRange,
  type RoasChartRangeKey,
} from '@/components/home/RoasTargetChart';
import { ActivityFeed } from '@/components/home/ActivityFeed';
import { ActivityTab } from '@/components/activity/ActivityTab';
import { CustomerValueTab } from '@/components/CustomerValueTab';
import { PaymentMethodsTab } from '@/components/PaymentMethodsTab';
import { StoreDetailModal } from '@/components/home/StoreDetailModal';
import { MobileStickyRoas } from '@/components/home/MobileStickyRoas';
import { toStoreDetail } from '@/lib/home/storeDetail';
import {
  computeNewCustomerMetrics,
  computeStableNcac,
  type FirstOrderInput,
} from '@/lib/home/newCustomerMetrics';
import { computeChannelTruth, overcountByChannelFromCampaigns, CHANNELS, type Channel } from '@/lib/home/channelTruth';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import { netAdjustFactor } from '@/lib/home/revenueBasis';
import type { StoreAgg } from '@/lib/analytics';
import { InsightsBoard } from './InsightsBoard';
import {
  aggregateCpm,
  toHeroPeriod,
  toHeroDelta,
  toPerStoreData,
  toChartData,
  computeCoverage,
  toCoverageChip,
  type CoverageChip as CoverageChipData,
} from '@/lib/home/adapters';
import {
  decomposeUnknownBucket,
  type UnknownBucketBreakdown,
} from '@/lib/home/unknownBucket';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

// All client fetchers route through fetchJson → `cache: 'no-store'` so mobile
// browsers never serve a stale cached response (the root cause of "data won't
// refresh until I close/reopen the tab"). The CDN still serves its ≤60s-fresh
// copy, so this adds no origin load. See lib/fetchJson.ts.
const fetcher = (url: string) => fetchJson<DashboardData>(url);

// Phase 05.7.8 — orders fetcher (separate response shape from DashboardData).
// Returns the orders-attribution rows for the current range so the dashboard
// can surface per-store order counts (live + range-based) in cards.
type OrdersResponseShape = {
  // The /api/orders-attribution route returns full OrderAttributionRow[] (see
  // its `satisfies OrdersAttributionResponse`). Earlier this was narrowed to
  // `{ storeName, date }` because the only consumers were the per-store count
  // + Orders sparkline; the hero attribution-coverage chip (2026-06-02) needs
  // the click-id/UTM fields too, so we type the rows as the real shape. The
  // narrowed `ordersRows?: { storeName; date }[]` prop on HomeTab stays a
  // structural subset and keeps accepting these rows unchanged.
  rows: OrderAttributionRow[];
  lastUpdated: string;
  error?: string;
};
// P1-3 (2026-06-10 state-honesty sweep) — fetchJsonStrict also throws on the
// route's 200-with-error degraded body (whose `error` field previously had
// ZERO consumers), so an orders-attribution outage surfaces in the WR-06
// banner instead of silently rendering "0 הזמנות" beside real revenue.
const ordersFetcher = (url: string): Promise<OrdersResponseShape> =>
  fetchJsonStrict<OrdersResponseShape>(url);

// Operator hard requirement (2026-06-04): the dashboard opens on TODAY.
// Single source of truth in urlState.DEFAULT_PRESET (also drives the
// "omit the default from the URL" logic) — do not hardcode a preset here.
const initialPreset = DEFAULT_PRESET;

/**
 * BUG #3 fix (2026-06-04) — floor of the STABLE all-history window used by the
 * Customers-tab blended nCAC. Ad spend exists from May 2026 onward (the full
 * data_daily extent), so the stable window is `[SPEND_HISTORY_FLOOR, today-IL]`,
 * INDEPENDENT of the global date-range filter. The upstream readers clamp to the
 * actual data extent, so an over-wide floor is safe (it just selects all rows).
 */
const SPEND_HISTORY_FLOOR = '2026-05-01';

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

  // P1-19 (2026-06-10 audit): IL-midnight rollover. filters.range was computed
  // ONCE in the useState initializer, so a session left open across Israel
  // midnight (the operator's documented pattern) kept showing YESTERDAY
  // labeled "היום" indefinitely — with a green freshness chip — and
  // stableNcacRange's `to` froze at the mount date. A minute-tick +
  // visibilitychange listener tracks the IL day; when it rolls, every
  // non-custom relative preset re-derives its range and stableNcacRange's
  // `to` advances.
  const [ilToday, setIlToday] = useState(() => getTodayInIsraelTz());
  useEffect(() => {
    const check = () =>
      setIlToday(prev => {
        const now = getTodayInIsraelTz();
        return now === prev ? prev : now;
      });
    const iv = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  useEffect(() => {
    setFilters(f => {
      if (f.preset === 'custom') return f;
      const next = computePresetRange(f.preset);
      if (next.from === f.range.from && next.to === f.range.to) return f;
      return { ...f, range: next };
    });
  }, [ilToday]);

  const { data: rawData, error, isLoading, mutate } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', filters.range),
    fetcher,
    // refreshInterval 0 — periodic refresh is driven by the single coordinated
    // useAutoRefresh(60s) above so this key re-renders TOGETHER with the others
    // (no offset per-hook timer). revalidateOnFocus stays for instant catch-up.
    // keepPreviousData — a RANGE change rotates the SWR key; without this SWR
    // drops `data` to undefined mid-fetch, which flips the `data && filtered`
    // gate below false and UNMOUNTS the whole tab subtree (skeleton flash) →
    // every tab's local UI state (e.g. the Activity סטטיסטיקות sub-tab, scroll,
    // open drawers) is reset, bouncing the operator off their view. Keeping the
    // previous data on screen during the refetch preserves the mount (same
    // guarantee the auto-refresh path already gives — see useAutoRefresh above).
    { refreshInterval: 0, revalidateOnFocus: true, keepPreviousData: true },
  );
  // Editable COGS % — recompute each row's cogs/netProfit from the operator's
  // effective % at the earliest read point so every downstream consumer
  // (hero, per-store, P&L, GoalTracker, Detail, insights) is retroactively
  // adjusted. Default settings reproduce the stored 25% → no behavior change.
  const [cogsSettings] = useCogsSettings();
  const data = useMemo(
    () => (rawData ? { ...rawData, rows: applyCogsToRows(rawData.rows, cogsSettings) } : rawData),
    [rawData, cogsSettings],
  );
  // Editable salaries (2026-06-02) — business-level deduction (default 7% of
  // revenue, per-month overridable). Threaded into the `filtered` memo's
  // aggregate() calls below so it subtracts in trueNetProfit ONLY (hero net
  // card, P&L cascade, insights). Operating profit (rev − adSpend − COGS) is
  // computed separately in lib/home/adapters.ts and is untouched.
  const [salarySettings] = useSalarySettings();

  // Phase 05.7.8 — fetch orders for the same range so per-store cards can show
  // "X הזמנות" alongside revenue/spend. Keeps the data path separate from
  // /api/data (which doesn't carry per-store order counts) without baking
  // it into the heavier dashboard payload.
  // P1-3 — read `error` too: pre-fix only {data} was destructured, so an
  // orders-attribution failure was fully silent (no banner) while the
  // order-derived KPIs (הזמנות / AOV / coverage) quietly zeroed/vanished.
  const { data: ordersData, error: ordersError } = useSWR(
    buildDateRangeKey('/api/orders-attribution', filters.range),
    ordersFetcher,
    // refreshInterval 0 — periodic refresh is driven by the single coordinated
    // useAutoRefresh(60s) above so this key re-renders TOGETHER with the others
    // (no offset per-hook timer). revalidateOnFocus stays for instant catch-up.
    // keepPreviousData — same rationale as the /api/data SWR above: a range
    // change rotates this key too, so hold the previous per-store orders on
    // screen during the refetch instead of blipping them to undefined.
    { refreshInterval: 0, revalidateOnFocus: true, keepPreviousData: true },
  );

  // DQ-3 (Wave 3 data-trust) — active manual-spend overrides for the visible
  // range. When the operator pinned ad-spend by hand (e.g. during an account
  // outage), the Hero Spend KPI + the P&L Ad-Spend line carry a "● ידני" flag
  // so the number isn't mistaken for a live/source-pulled figure. Self-soft-
  // fails to null (fetchJsonOrNull) → the flag simply doesn't show on a blip.
  const { data: activeOverrides } = useSWR<ActiveOverridesResponse | null>(
    buildDateRangeKey('/api/active-overrides', filters.range),
    fetchJsonOrNull,
    { refreshInterval: 0, revalidateOnFocus: true },
  );

  // Collapse byStorePlatform into ONE group for the current store scope.
  // 'All' = any active override (across all stores/platforms); a specific store
  // = only that store's groups. Notes from multiple matching groups are joined,
  // and lastEditedAt is the latest across them. undefined → render no flag.
  const overrideFlag = useMemo<{ note?: string; lastEditedAt?: string } | null>(() => {
    const byStorePlatform = activeOverrides?.byStorePlatform;
    if (!byStorePlatform) return null;
    const entries = Object.entries(byStorePlatform).filter(([key]) => {
      if (filters.store === 'All') return true;
      // key = `${displayStore}::${platform}` — match the store portion.
      return key.slice(0, key.indexOf('::')) === filters.store;
    });
    if (entries.length === 0) return null;
    const notes: string[] = [];
    let lastEditedAt: string | undefined;
    for (const [, group] of entries as Array<[string, OverridesActiveGroup]>) {
      if (group.note) notes.push(group.note);
      if (group.lastEditedAt && (!lastEditedAt || group.lastEditedAt > lastEditedAt)) {
        lastEditedAt = group.lastEditedAt;
      }
    }
    return {
      note: notes.length > 0 ? Array.from(new Set(notes)).join(' · ') : undefined,
      lastEditedAt,
    };
  }, [activeOverrides, filters.store]);

  // BUG #3 fix (2026-06-04) — STABLE all-history window for the Customers-tab
  // blended nCAC. The headline LTV:nCAC / payback / verdict on the לקוחות tab
  // must NOT bounce as the operator narrows the global date filter, and its
  // numerator (new-customer orders) and denominator (spend) must be over the
  // SAME window. We fetch BOTH sources over a FIXED `[SPEND_HISTORY_FLOOR,
  // today-IL]` range (independent of `filters.range`) so the value is stable —
  // ad-spend history is May-2026+, so this window IS the full data extent.
  // These keys are distinct from the range-scoped keys above, so they ride the
  // single useAutoRefresh(60s) tick like every other key but never re-fire when
  // the user changes the date filter (only at IL-midnight, when `to` rolls).
  // P1-19: `to` rides the shared ilToday tick so the window actually rolls at
  // IL-midnight (the [] deps froze it at the mount date, contradicting the
  // comment above).
  const stableNcacRange = useMemo(
    () => ({ from: SPEND_HISTORY_FLOOR, to: ilToday }),
    [ilToday],
  );
  const { data: stableSpendData } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', stableNcacRange),
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: true },
  );
  const { data: stableOrdersData } = useSWR(
    buildDateRangeKey('/api/orders-attribution', stableNcacRange),
    ordersFetcher,
    { refreshInterval: 0, revalidateOnFocus: true },
  );

  // Honest hero-only attribution-coverage chip (2026-06-02). Computed from the
  // SAME current-range orders-attribution rows the per-store counts already
  // consume — no second fetch. null while rows are unwired / there are no
  // orders, so the hero header collapses cleanly. Quiet by default; prominent
  // only when >30% of orders carry no click-id/UTM. HERO ONLY — never per-store.
  const coverageChip: CoverageChipData | null = useMemo(
    () =>
      toCoverageChip(
        computeCoverage(
          (ordersData?.rows ?? []).filter(
            (r) => filters.store === 'All' || r.storeName === filters.store,
          ),
        ),
      ),
    [ordersData, filters.store],
  );

  // WS7 A.3 — descriptive decomposition of the unknown/direct order bucket,
  // feeding the hero CoverageChip's expand/disclosure. Built from the SAME
  // `filters.store`-filtered current-range rows the coverage chip consumes
  // above (no second fetch), so the chip's "{unknown}%" and the panel's
  // "{unknownOrders}" can never disagree. DESCRIPTIVE only — it never
  // redistributes the unknown share across channels.
  const unknownBreakdown: UnknownBucketBreakdown = useMemo(
    () =>
      decomposeUnknownBucket(
        (ordersData?.rows ?? []).filter(
          (r) => filters.store === 'All' || r.storeName === filters.store,
        ),
      ),
    [ordersData, filters.store],
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

  // Re-aggregate on salary edits so true-net values stay in sync (mirror
  // billingTick). `salariesForRange` is recomputed in the `filtered` memo and
  // this tick forces that memo to re-run when the operator edits salaries.
  const [salaryTick, setSalaryTick] = useState(0);
  useEffect(() => {
    const bump = () => setSalaryTick((t) => t + 1);
    window.addEventListener('roas-salary-changed', bump);
    return () => window.removeEventListener('roas-salary-changed', bump);
  }, []);

  // Silent COORDINATED auto-refresh (2026-06-03; cadence widened to 120s on
  // 2026-06-06 to cut Vercel function/observability cost): every 120s AND on focus,
  // revalidate EVERY SWR key in the app IN ONE BATCH. This is the single
  // driver of periodic refresh — the per-hook `refreshInterval`s on the
  // current-period Home sources (/api/data, /api/orders-attribution) are set
  // to 0 so they NEVER fire on their own offset schedule. Result: revenue,
  // spend, MER, order counts, NC-ROAS, attribution coverage, per-store cards
  // and CPM all refetch from the SAME tick and re-render TOGETHER, from one
  // consistent snapshot (operator-reported "data not uniform" fix). This is
  // READ-ONLY (revalidate = GET refetch — never a write; SWR dedupes in-flight
  // requests), so it cannot cause double-writes; the only writers are the
  // idempotent crons + the manual "Refresh All" button.
  //
  // BUG #2 fix (2026-06-04): call `mutate(() => true)` with NO data argument.
  // The previous `mutate(() => true, undefined, { revalidate: true })` passed
  // THREE args, so SWR did NOT take its "no data → just revalidate" early path;
  // with `populateCache` defaulting to true it synchronously ran
  // `set({ data: undefined })` for EVERY matched key before the refetch
  // resolved (upstream comment: "Data can be `undefined` here."). Tabs that gate
  // a loading/empty branch on `!data` then re-rendered that branch → the mounted
  // view (open drawer / expanded sub-view / scroll / sub-selection) unmounted and
  // remounted → the operator was bounced back to a default screen on every tick.
  // With no data arg (SWR's bound mutate receives < 3 args), SWR revalidates in
  // the BACKGROUND and keeps the previous data on screen throughout the refetch.
  // No reload, no undefined blip → filters, scroll, and open panels are preserved.
  // (Coverage: autoRefreshKeepsView.dom.test.tsx.)
  useAutoRefresh(
    () => { void swrMutate(() => true); },
    { intervalMs: 120_000 },
  );

  // Mirror state into the URL so refresh / bookmark / share survive. Uses
  // replaceState so we don't pollute the back-button stack.
  useEffect(() => {
    syncUrl({ tab: activeTab, filters });
  }, [activeTab, filters]);

  // Reconcile React state FROM the URL on browser back/forward AND on
  // programmatic pushState navigations. `drillToCampaigns` (Home store-modal →
  // Campaigns) pushes `tab=campaigns` + `c_store`/`c_drill` then dispatches a
  // popstate; the back button likewise changes the URL. `syncUrl` above is
  // one-way (state → URL), so without this listener the URL would change while
  // `activeTab`/`filters` stayed put — the symptom being a drill that "does
  // nothing". The tab-local `c_*` params are owned by each tab's own component
  // (re-hydrated on its mount), so we reconcile only the global tab + filters
  // here. `replaceState` (syncUrl / syncTabLocalUrl) does NOT fire popstate, so
  // this never loops. The tab change routes through `handleTabChange` (via a
  // ref so the listener stays subscribed once, with no stale closure) so
  // back/forward + drill get the SAME View-Transition cross-fade user-initiated
  // tab clicks get — not an instant, inconsistent jump. `setFilters` is stable.
  const handleTabChangeRef = useRef(handleTabChange);
  handleTabChangeRef.current = handleTabChange;
  useEffect(() => {
    const onPop = () => {
      const next = readDashboardState(
        {
          tab: 'home',
          filters: { preset: initialPreset, range: computePresetRange(initialPreset), store: 'All' },
        },
        window.location.search,
      );
      handleTabChangeRef.current(next.tab);
      setFilters(next.filters);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The "פתח קמפיין" primary action on InsightActions (insights board + the WS3
  // action list, both on Home) dispatches `roas-open-campaign-drawer`. Its only
  // subscriber is CampaignsTable, which is mounted ONLY on the campaigns tab —
  // so from Home the click fired into the void (operator-reported 2026-06-05).
  // Bridge it: when the campaigns tab is NOT mounted, route through the proven
  // drillToCampaigns path (switch tab + open the drawer via c_drill on mount).
  // When already on the campaigns tab, CampaignsTable's own listener handles it.
  useEffect(() => {
    function onInsightOpenCampaign(e: Event) {
      const d = (e as CustomEvent<OpenCampaignDrawerDetail>).detail;
      if (!d?.campaignId || !d?.storeId || !d?.platform) return;
      if (activeTab === 'campaigns') return; // CampaignsTable owns the drawer there.
      const lower = d.platform === 'Meta' ? 'meta' : d.platform === 'Google' ? 'google' : 'tiktok';
      drillToCampaigns({
        store: STORE_ID_TO_NAME[d.storeId as StoreId],
        campaign: { storeId: d.storeId, platform: lower, campaignId: d.campaignId },
      });
    }
    window.addEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onInsightOpenCampaign);
    return () => window.removeEventListener(OPEN_CAMPAIGN_DRAWER_EVENT, onInsightOpenCampaign);
  }, [activeTab]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const cur = filterRows(data.rows, filters.range, filters.store);
    const prevR = previousRange(filters.range);
    const prev = filterRows(data.rows, prevR, filters.store);
    const stores = filters.store === 'All' ? data.stores : [filters.store];
    // P1-31b (2026-06-10 audit, operator-approved D4): when the operator
    // filters to ONE store, billingForRange used to derive its store universe
    // from the (single-store) rows — so every "All"-scoped fixed cost charged
    // its FULL business-wide amount to that one store, inflating its true-net
    // burden vs the per-store cards (which already fair-share via
    // aggregateByStore's CRIT-1 threading). Passing the FULL store universe +
    // the unfiltered per-store revenue split makes the single-store view carry
    // only its fair share — consistent with the hero per-store cards. For the
    // 'All' view this matches the row-derived behavior (no change).
    const scopedStoreNames = filters.store === 'All' ? undefined : data.stores;
    const revenueByStoreFor = (range: { from: string; to: string }): Record<string, number> | undefined => {
      if (filters.store === 'All') return undefined;
      const allRows = filterRows(data.rows, range, 'All');
      const out: Record<string, number> = {};
      for (const r of allRows) out[r.storeName] = (out[r.storeName] ?? 0) + r.revenue;
      return out;
    };
    return {
      cur,
      // Phase 05.7.8 — pass the request range so fixed-cost proration uses
      // the user-selected window, not the data-derived min/max date.
      curAgg: aggregate(cur, filters.range, scopedStoreNames, revenueByStoreFor(filters.range), salariesForRange(salarySettings, cur, filters.range)),
      prevAgg: aggregate(prev, prevR, scopedStoreNames, revenueByStoreFor(prevR), salariesForRange(salarySettings, prev, prevR)),
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
      // 2026-06-11 adversarial review (D4 internal reconciliation): expose the
      // EXACT store-scope threading values curAgg was built with so downstream
      // consumers (PnLBreakdown's by-source fixed-costs table) can call
      // billingForRange with the SAME universe + revenue split — keeping the
      // per-source rows reconciling to curAgg.fixedCosts in single-store view.
      // Both are undefined in the 'All' view (byte-identical behavior).
      scopedStoreNames,
      revenueByStore: revenueByStoreFor(filters.range),
    };
    // billingTick: re-aggregate on billing edits so live values stay in sync.
    // salarySettings/salaryTick: re-aggregate on salary edits (business-level
    // salaries subtract in trueNetProfit via salariesForRange above).
  }, [data, filters, billingTick, salarySettings, salaryTick]);

  // DQ-4 (Wave 3 data-trust) — provenance verdict over the in-scope daily rows
  // the hero KPIs are built from (filtered.cur). 'finalized' (green "סופי"),
  // 'live_estimate' (blue "אומדן חי"), or 'unknown' (renders nothing). Computed
  // here so it can thread into the Hero; the P&L computes its own from `rows`.
  const provenanceVerdict = useMemo(
    () => provenanceForRange(filtered?.cur ?? []).verdict,
    [filtered],
  );

  // Phase 05.7.8 — per-store order count map for the current range. Filters
  // the same way `filtered.cur` does so cards stay in sync with the global
  // store dropdown.
  // P1-3 (2026-06-10) — `null` until the orders-attribution fetch SETTLES
  // (loading or failed): pre-fix this seeded 0 per store BEFORE the fetch
  // landed, which made PerStoreRow's documented '—'-for-null contract
  // unreachable — loading (and outages) rendered as a real "0 הזמנות".
  // Once data is present, a store absent from the rows still seeds a REAL 0.
  const ordersByStore = useMemo<Record<string, number> | null>(() => {
    if (!ordersData) return null;
    const out: Record<string, number> = {};
    if (data?.stores) {
      for (const s of data.stores) {
        if (filters.store === 'All' || s === filters.store) out[s] = 0;
      }
    }
    for (const r of ordersData.rows ?? []) {
      const storeName = r.storeName;
      if (!storeName) continue;
      if (filters.store !== 'All' && storeName !== filters.store) continue;
      out[storeName] = (out[storeName] ?? 0) + 1;
    }
    return out;
  }, [ordersData, data, filters.store]);

  // Phase 3 — rows feeding the NC-ROAS / nCAC lens (hero + store modal). Built
  // here (where `ordersData` lives) over the SAME current-range orders-
  // attribution rows the per-store counts + coverage chip already consume — no
  // extra fetch — then threaded into HomeTab. Each OrderAttributionRow carries
  // storeName / totalCad / isFirstOrder after the Phase-3 reader change.
  const firstOrderRows = useMemo<FirstOrderInput[]>(() => {
    const rows = ordersData?.rows ?? [];
    return rows.map((r) => ({
      storeName: r.storeName,
      totalCad: r.totalCad,
      isFirstOrder: r.isFirstOrder,
      source: r.source, // channel-nc-roas-split (Wave 2) — per-channel split reads this
    }));
  }, [ordersData]);

  // Wave 2 — mapping-aware inputs for the "לקוחות" (CustomerValueTab) headline.
  // Computed HERE (CustomerValueTab lives in this component, not HomeTab) with
  // the SAME pure helpers + agg the Home NC tile uses — NEVER recomputed from
  // raw account totals. blendedNcac drives the verdict / LTV:nCAC / payback;
  // spendByMonth feeds the per-cohort nCAC (best-effort over the current-range
  // data_daily rows — months outside the range degrade to the muted state).
  //
  // BUG #3 fix (2026-06-04) — `blendedNcac` is computed over the STABLE
  // all-spend-history window (`stableNcacRange`), NOT `filtered.curAgg.spend`
  // (the short selected range). nCAC = spend ÷ new-customer-orders bounced
  // ($32 ↔ $53) because the denominator was a few-days subset that the live
  // cron nudges every ~10 min, AND the numerator/denominator sat on DIFFERENT
  // windows from the all-history LTV it divides into. Now BOTH the spend
  // (mapping-aware `aggregate(...).spend` over the stable data_daily rows) and
  // the new-customer order count (stable orders_attribution, isFirstOrder===true)
  // span the SAME May+ window → stable + LTV-aligned. The Home-page nCAC /
  // NC-ROAS tile below stays range-specific (intentionally). Scope-aware:
  // narrowing the store still re-scopes both sides over the same full window.
  // A3 (2026-06-04): the customer-value scope is OWNED here (single source of
  // truth) so the SAME scope drives the LTV/curve (computeCustomerValue, via
  // the `scope` prop) AND the mapping-aware nCAC inputs below. Previously
  // blendedNcac/spendByMonth keyed off the GLOBAL filter while the tab's
  // compute keyed off its own in-tab selector → picking a store in the tab
  // divided that store's LTV by the business-wide nCAC. Initialized from /
  // synced to the global filter (the tab's selector then drives it locally).
  // Lazy-init from the synchronously-available global filter (from the URL) so a
  // store-scoped deep link doesn't flash business-wide for one frame before the
  // effect corrects it. (data?.stores is undefined at mount, so do NOT gate the
  // initializer on it; the effect still corrects a URL store missing from data.)
  const [customersScope, setCustomersScope] = useState<string>(() =>
    filters.store !== 'All' ? filters.store : 'all',
  );
  useEffect(() => {
    if (filters.store === 'All') return;
    if ((data?.stores ?? []).includes(filters.store)) setCustomersScope(filters.store);
  }, [filters.store, data?.stores]);
  const customersScopeStore = customersScope === 'all' ? undefined : customersScope;
  const customersScopeFilter = customersScope === 'all' ? 'All' : customersScope;

  const customersBlendedNcac = useMemo(() => {
    const stableRows = stableSpendData?.rows;
    const stableOrders = stableOrdersData?.rows;
    if (!stableRows || !stableOrders) return null;
    // Mapping-aware all-history spend (same agg.spend source — never raw totals).
    const stableSpend = aggregate(
      filterRows(stableRows, stableNcacRange, customersScopeFilter),
      stableNcacRange,
    ).spend;
    const stableFirstOrderRows: FirstOrderInput[] = stableOrders.map((r) => ({
      storeName: r.storeName,
      totalCad: r.totalCad,
      isFirstOrder: r.isFirstOrder,
    }));
    return computeStableNcac(stableFirstOrderRows, stableSpend, customersScopeStore);
  }, [stableSpendData, stableOrdersData, stableNcacRange, customersScopeFilter, customersScopeStore]);
  // A2 (2026-06-04): per-cohort nCAC spend MUST come from the SAME stable
  // May-2026+ window as the blended nCAC + the footer caption — NOT the
  // selected range (which left May "אין נתוני הוצאה" while the caption claims
  // "from May 2026", and made June a volatile single-day artifact ~6× off the
  // $52 headline). Mapping-aware via filterRows over the per-store-attributed
  // data_daily rows (same source the headline aggregates).
  const customersSpendByMonth = useMemo(() => {
    const stableRows = stableSpendData?.rows;
    if (!stableRows) return undefined;
    const scoped = filterRows(stableRows, stableNcacRange, customersScopeFilter);
    const out: Record<string, number> = {};
    for (const r of scoped) {
      const m = r.date.slice(0, 7);
      out[m] = (out[m] ?? 0) + (r.totalSpend ?? 0);
    }
    return out;
  }, [stableSpendData, stableNcacRange, customersScopeFilter]);

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

        {/* Top strip — Horizon floating navbar (non-sticky). The full <Header>
            (logo, brand, deep navy gradient) is no longer needed since the
            Sidebar carries the brand; TopStrip owns the breadcrumb/title +
            the freshness chip, command palette, sync indicator, and AI-export.
            It mounts the CommandPalette even while `data` is null so ⌘K + the
            nav/preset/theme commands are usable during the first load. */}
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-8">
          <TopStrip
            activeTab={activeTab}
            data={data ?? null}
            filters={filters}
            setFilters={setFilters}
            setActiveTab={handleTabChange}
            onRefresh={() => mutate()}
            onOpenAiReport={() => setAiReportSignal(n => n + 1)}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            dataLastWriteAt={data?.dataLastWriteAt ?? null}
          />
        </div>

        <main className="max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-5">
          {/* Three error sources: (a) SWR threw (network failure, malformed JSON),
            * (b) /api/data returned 200 + empty rows + error field (WR-06 degraded
            * path — preferred over status 500 so SWR consumers downstream stay
            * consistent across /api/data, /api/campaigns, /api/products, /api/ads,
            * /api/orders-attribution, etc.), (c) P1-3 — the orders-attribution
            * fetch failed (thrown !ok OR its 200-with-error body via the strict
            * fetcher). Pre-fix (c) was fully silent: real revenue rendered beside
            * vanished order KPIs with no banner. Each failing source is NAMED. */}
          {(error || data?.error || ordersError) && (
            <div
              role="alert"
              data-testid="dashboard-degraded-banner"
              className="rounded-xl bg-status-redBg border border-[color-mix(in_oklab,var(--status-red)_30%,transparent)] p-4 flex items-start gap-3"
            >
              <AlertCircle className="text-status-redFg shrink-0" size={20} />
              <div>
                <div className="font-semibold text-status-redFg">שגיאה בטעינת הנתונים</div>
                {(error || data?.error) && (
                  <div className="text-sm text-ink-secondary mt-1">
                    נתוני הדשבורד (/api/data):{' '}
                    {error ? (error as Error).message : data?.error}
                  </div>
                )}
                {ordersError != null && (
                  <div className="text-sm text-ink-secondary mt-1">
                    נתוני ההזמנות (/api/orders-attribution) לא נטענו — מדדי הזמנות / AOV /
                    כיסוי-שיוך מוצגים כ&quot;—&quot;:{' '}
                    {ordersError instanceof Error ? ordersError.message : String(ordersError)}
                  </div>
                )}
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <TabFreshnessHeader dataLastWriteAt={data.dataLastWriteAt ?? null} />
                {/* DQ-5 (Wave 3 data-trust) — SourceHealthChip self-fetches
                    /api/freshness-summary and renders nothing while healthy;
                    it appears only when a store×platform pipe is stuck/broken,
                    sitting beside the freshness header. */}
                <SourceHealthChip />
              </div>
              {activeTab === 'home' && (
                <>
                  {/* DQ-1 (Wave 3 data-trust) — ReconcileBanner self-fetches
                      /api/operator/reconcile and is INVISIBLE unless there are
                      cross-source violations; mounted above the Home hero. */}
                  <ReconcileBanner />
                  <HomeTab
                    data={data}
                    filtered={filtered}
                    filters={filters}
                    setFilters={setFilters}
                    aiReportSignal={aiReportSignal}
                    ordersByStore={ordersByStore}
                    ordersRows={ordersData?.rows}
                    firstOrderRows={firstOrderRows}
                    coverage={coverageChip}
                    coverageBreakdown={unknownBreakdown}
                    provenanceVerdict={provenanceVerdict}
                    overrideNote={overrideFlag?.note}
                    overrideLastEditedAt={overrideFlag?.lastEditedAt}
                    onSeeActivity={() => handleTabChange('activity')}
                  />
                </>
              )}
              {activeTab === 'activity' && (
                <ActivityTab
                  data={data}
                  filters={filters}
                  stores={data.stores}
                  onChange={setFilters}
                />
              )}
              {activeTab === 'customers' && (
                <CustomerValueTab
                  stores={data.stores}
                  globalStore={filters.store}
                  scope={customersScope}
                  onScopeChange={setCustomersScope}
                  blendedNcac={customersBlendedNcac}
                  spendByMonth={customersSpendByMonth}
                />
              )}
              {activeTab === 'pnl' && (
                <PnLTab
                  data={data}
                  filtered={filtered}
                  filters={filters}
                  setFilters={setFilters}
                  overrideNote={overrideFlag?.note}
                  overrideLastEditedAt={overrideFlag?.lastEditedAt}
                />
              )}
              {activeTab === 'archive' && (
                <AnalysisArchiveTab stores={data.stores} globalStore={filters.store} />
              )}
              {activeTab === 'trends' && (
                <AnalysisTrendsTab data={data} filtered={filtered} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'campaigns' && (
                <CampaignsTab data={data} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'products' && (
                <ProductsTab data={data} filters={filters} setFilters={setFilters} />
              )}
              {activeTab === 'payments' && (
                <PaymentMethodsTab stores={data.stores} globalStore={filters.store} />
              )}
              {activeTab === 'detail' && (
                <DetailTab filtered={filtered} filters={filters} setFilters={setFilters} stores={data.stores} adStateMap={data.adStateMap ?? {}} storeApplicablePlatforms={data.storeApplicablePlatforms ?? {}} />
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
  /**
   * 2026-06-11 adversarial review (D4 internal reconciliation) — the exact
   * store-scope threading values `curAgg` was aggregated with (P1-31b D4):
   * the FULL store universe + the UNFILTERED per-store revenue split for the
   * current range. Threaded into PnLBreakdown so its by-source fixed-costs
   * table reconciles to `curAgg.fixedCosts` under a single-store filter.
   * Both undefined in the 'All' view.
   */
  scopedStoreNames?: string[];
  revenueByStore?: Record<string, number>;
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
  firstOrderRows,
  coverage,
  coverageBreakdown,
  provenanceVerdict,
  overrideNote,
  overrideLastEditedAt,
  onSeeActivity,
}: {
  data: DashboardData;
  filtered: FilteredView;
  filters: F;
  setFilters: (next: F) => void;
  /** Increments when the command palette wants to open the AI report. */
  aiReportSignal: number;
  /** Phase 05.7.8 — per-store order count for the range, keyed by storeName.
   *  P1-3: `null` while the orders-attribution fetch is unsettled/failed →
   *  hero Orders + per-store orders/AOV render "—" instead of a fake 0. */
  ordersByStore: Record<string, number> | null;
  /**
   * Raw orders-attribution rows for the active range. Threaded through so
   * the Hero strip's per-day Orders sparkline can bucket the same row set
   * the per-store order count already consumes — no second SWR fetch. Typed
   * as the full OrderAttributionRow (the render site already passes the full
   * rows): the sparkline reads the {storeName,date} subset, while
   * channel-overcount-delta (WS2 #12) reads {source,totalCad,date} for the
   * per-channel verified-revenue side.
   */
  ordersRows?: OrderAttributionRow[];
  /**
   * Phase 3 — minimal rows feeding the NC-ROAS / nCAC lens (hero subordinate
   * tile + per-store modal row). Carries storeName / totalCad / isFirstOrder
   * from the same current-range orders-attribution rows; built upstream so no
   * extra fetch. Empty = zeroed newCustomer block (back-compat).
   */
  firstOrderRows: FirstOrderInput[];
  /**
   * Honest attribution-coverage chip (2026-06-02) — HERO ONLY. Computed
   * upstream from the same current-range orders-attribution rows. null hides
   * it (no orders / unwired). Never passed to per-store cards.
   */
  coverage?: CoverageChipData | null;
  /**
   * WS7 A.3 — descriptive decomposition of the unknown/direct order bucket,
   * computed upstream from the same `filters.store`-filtered current-range rows
   * the coverage chip consumes. Threaded into <CommandCenterHero> so the hero
   * CoverageChip can expand into an inline <UnknownBucketPanel> when prominent.
   */
  coverageBreakdown?: UnknownBucketBreakdown;
  /**
   * DQ-4 (Wave 3 data-trust) — provenance verdict over the in-scope daily rows.
   * Threaded to the Hero so the Spend/period cell shows a "סופי" / "אומדן חי"
   * trust chip. 'unknown' (back-compat for freshness-less historical rows)
   * renders nothing.
   */
  provenanceVerdict?: 'finalized' | 'live_estimate' | 'unknown';
  /**
   * DQ-3 (Wave 3 data-trust) — active manual-spend override summary for the
   * current store scope: a "● ידני" flag next to the Hero Spend KPI. Both omit
   * → no flag.
   */
  overrideNote?: string;
  overrideLastEditedAt?: string;
  /**
   * Switches the dashboard to the "פעילות" (Activity) tab — wired to the
   * "ראה הכל" link in the Home <ActivityFeed> footer.
   */
  onSeeActivity?: () => void;
}) {
  // Salary settings (business-level) — read reactively so the hero's
  // Net-Profit *delta* baseline is salary-deducted in lock-step with the
  // current-period agg (`filtered.curAgg`, built upstream in Dashboard with
  // the same `salariesForRange`). Without this, the prev baseline would be
  // NON-salary-deducted and `toHeroDelta` (cur.trueNetProfit −
  // prev.trueNetProfit) would skew the delta. The setter is unused here.
  const [salarySettings] = useSalarySettings();
  // Chart range is INDEPENDENT of the page-level filter range — operator can
  // browse a 90-day trend without losing the "today" snapshot above. Seeded
  // from `?chartRange=…` URL params so refresh / share preserves the choice.
  const [chartRange, setChartRange] = useState<RoasChartRangeKey>('30');
  const [chartCustomRange, setChartCustomRange] = useState<
    ChartCustomRange | undefined
  >(undefined);
  // Per-store drill-down MODAL — clicking a store card opens this (instead of
  // jumping straight to Campaigns). `null` = closed. The modal's data is built
  // by `toStoreDetail` from the state HomeTab already holds (no new fetch).
  const [modalStoreId, setModalStoreId] = useState<string | null>(null);
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
  // Period-compare resolution — chosen baseline + active range + preset →
  // UI-ready { range, show, caption }. `compare.range` is ALWAYS a valid
  // window (falls back to previousRange when baseline is 'none'), so every
  // prev-period fetch + aggregate below keeps working; `compare.show` gates
  // whether the delta lines render at all.
  const compare = useMemo(
    () => resolveCompare(filters.compareBaseline, filters.range, filters.preset),
    [filters.compareBaseline, filters.range, filters.preset],
  );
  const prevRange = compare.range;
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', prevRange),
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  // Previous-period rows for the hero delta — /api/data only returns the
  // current range so the previous baseline needs its own fetch.
  const { data: rawDataPrev } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', prevRange),
    fetcher,
    { revalidateOnFocus: false },
  );
  const [cogsSettings] = useCogsSettings();
  const dataPrev = useMemo(
    () => (rawDataPrev ? { ...rawDataPrev, rows: applyCogsToRows(rawDataPrev.rows, cogsSettings) } : rawDataPrev),
    [rawDataPrev, cogsSettings],
  );
  // Previous-range ORDER counts — /api/data doesn't carry per-store order
  // counts (that's why the current range uses a dedicated orders-attribution
  // fetch); the prev range needs its own so the hero's Orders delta + the
  // store modal's Orders/AOV deltas are REAL, not "cur − 0". Historical range
  // → no focus revalidation needed.
  const { data: ordersDataPrev } = useSWR<OrdersResponseShape>(
    buildDateRangeKey('/api/orders-attribution', prevRange),
    ordersFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  // ---- Chart range data — independent of page filters so the picker can
  // walk 7d/30d/90d/MTD/QTD/YTD without losing the snapshot above.
  const { data: rawChartDataResp } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', chartFromTo),
    fetcher,
    { revalidateOnFocus: false },
  );
  const chartDataResp = useMemo(
    () => (rawChartDataResp ? { ...rawChartDataResp, rows: applyCogsToRows(rawChartDataResp.rows, cogsSettings) } : rawChartDataResp),
    [rawChartDataResp, cogsSettings],
  );
  const { data: chartCampaignsResp } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', chartFromTo),
    campaignsFetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // ---- Chart "previous period" — the window immediately BEFORE the chart's
  // own picker range (Task 3, 2026-06-09 consistency audit). Previously the
  // chart footer's "ROAS תקופה קודמת" reused `prevAggFromPrevData`, which is the
  // PAGE filter's previous range — so a chart set to 30d compared against the
  // page filter's prior window (e.g. yesterday) and mislabeled it as the chart's
  // prior period. Fetch + aggregate the chart range's OWN previous window so the
  // comparison is same-length and same-frame. Only roas/revenue are read by
  // toChartData, so no salaries arg is needed (mirrors chartScope.agg).
  const chartPrevRange = useMemo(() => previousRange(chartFromTo), [chartFromTo]);
  const { data: rawChartPrevDataResp } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', chartPrevRange),
    fetcher,
    { revalidateOnFocus: false },
  );
  const chartPrevAgg = useMemo(() => {
    if (!rawChartPrevDataResp) return null;
    const rows = applyCogsToRows(rawChartPrevDataResp.rows, cogsSettings);
    const cur = filterRows(rows, chartPrevRange, filters.store);
    return aggregate(cur, chartPrevRange);
  }, [rawChartPrevDataResp, cogsSettings, chartPrevRange, filters.store]);

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
  // hero's "Orders" big number. The previous-range counterpart is
  // `prevOrdersTotal` (a dedicated prev orders-attribution fetch) so the
  // Orders delta is real, not "cur − 0".
  // P1-3 — null while the orders fetch is unsettled/failed → the hero Orders
  // card renders "—" (toHeroPeriod's null path), never a fake 0.
  const heroOrders = useMemo<number | null>(() => {
    if (!ordersByStore) return null;
    let total = 0;
    for (const k of Object.keys(ordersByStore)) total += ordersByStore[k] ?? 0;
    return total;
  }, [ordersByStore]);
  const prevAggFromPrevData = useMemo(() => {
    if (!dataPrev) return null;
    const prevCur = filterRows(dataPrev.rows, prevRange, filters.store);
    // Salary-deduct the prev baseline so it matches `filtered.curAgg` (also
    // salary-deducted upstream). toHeroDelta computes the Net-Profit delta as
    // `cur.trueNetProfit − prev.trueNetProfit`; mismatched deduction here would
    // overstate the prev baseline and skew the delta.
    //
    // 2026-06-11 adversarial review (D4 cur/prev threading parity): the same
    // parity requirement holds for FIXED COSTS. `filtered.curAgg` is built
    // with the P1-31b D4 store-scope threading (scopedStoreNames = full store
    // universe + unfiltered per-store revenue split → a store-filtered view
    // carries only its fair share of All-scoped fixed costs). This prev
    // baseline used to pass `undefined, undefined` — full-burden convention —
    // so the trueNetProfit delta mixed fair-share cur with full-burden prev
    // under a store filter. Mirror the EXACT convention from the `filtered`
    // memo: same scopedStoreNames expression, and the revenue split computed
    // over the UNFILTERED dataPrev rows for prevRange.
    const scopedStoreNames = filters.store === 'All' ? undefined : data.stores;
    const revenueByStorePrev = (() => {
      if (filters.store === 'All') return undefined;
      const allRows = filterRows(dataPrev.rows, prevRange, 'All');
      const out: Record<string, number> = {};
      for (const r of allRows) out[r.storeName] = (out[r.storeName] ?? 0) + r.revenue;
      return out;
    })();
    return aggregate(
      prevCur,
      prevRange,
      scopedStoreNames,
      revenueByStorePrev,
      salariesForRange(salarySettings, prevCur, prevRange),
    );
  }, [dataPrev, prevRange, filters.store, salarySettings, data.stores]);
  // Mobile B1 — previous-range ROAS per store, for the per-store card delta
  // chip. Reuses the SAME `dataPrev` SWR payload the hero delta already
  // fetched (no extra network call); `aggregateByStore` gives us each store's
  // prev ROAS. `undefined` while prev data is still loading so the adapter
  // leaves `roasDeltaPct` omitted rather than rendering a misleading 0.
  const prevRoasByStore = useMemo<Record<string, number> | undefined>(() => {
    if (!dataPrev) return undefined;
    const prevCur = filterRows(dataPrev.rows, prevRange, filters.store);
    const out: Record<string, number> = {};
    for (const sa of aggregateByStore(prevCur, prevRange)) {
      out[sa.store] = sa.roas;
    }
    return out;
  }, [dataPrev, prevRange, filters.store]);
  // Per-store drill MODAL — the FULL previous-range StoreAgg per store (mirrors
  // `prevRoasByStore` but keeps every field so the modal's KPI deltas can be
  // computed). Reuses the SAME `dataPrev` SWR payload (no extra network call).
  // `undefined` while prev data loads → the adapter leaves all deltas null.
  const prevStoreAggByName = useMemo<Record<string, StoreAgg> | undefined>(() => {
    if (!dataPrev) return undefined;
    // Build across ALL stores (not filters.store) so the drill modal can show
    // KPI deltas for whichever store is opened, independent of the page filter.
    const prevCur = filterRows(dataPrev.rows, prevRange, 'All');
    const out: Record<string, StoreAgg> = {};
    for (const sa of aggregateByStore(prevCur, prevRange)) {
      out[sa.store] = sa;
    }
    return out;
  }, [dataPrev, prevRange]);
  // Previous-range order counts per store — the "table" we now retain so
  // Orders/AOV deltas are honest. Built across ALL stores (modal can open any
  // visible store); `null` (not 0) while the prev fetch is loading so deltas
  // stay omitted rather than misleading.
  const prevOrdersByStore = useMemo<Record<string, number> | null>(() => {
    if (!ordersDataPrev) return null;
    const out: Record<string, number> = {};
    for (const r of ordersDataPrev.rows ?? []) {
      if (!r.storeName) continue;
      out[r.storeName] = (out[r.storeName] ?? 0) + 1;
    }
    return out;
  }, [ordersDataPrev]);
  // Prev-range orders total scoped to the SAME visible stores as `heroOrders`
  // (the current-range total), so the hero's Orders delta compares like-for-like.
  const prevOrdersTotal = useMemo<number | null>(() => {
    if (!prevOrdersByStore) return null;
    let total = 0;
    for (const k of Object.keys(prevOrdersByStore)) {
      if (filters.store === 'All' || k === filters.store) total += prevOrdersByStore[k] ?? 0;
    }
    return total;
  }, [prevOrdersByStore, filters.store]);
  const heroPeriod = useMemo(
    () => toHeroPeriod(filtered.curAgg, heroCpm, heroOrders),
    [filtered.curAgg, heroCpm, heroOrders],
  );
  // Phase 3 — NC-ROAS / nCAC subordinate tile. Scoped to the global store
  // filter (undefined = all visible stores). MER spend = mapping-aware
  // `filtered.curAgg.spend` (NEVER recomputed from raw account totals) so the
  // ratio stays consistent with the hero's MER band. Its OWN band lives inside
  // CommandCenterHero — this never touches the hero ROAS band gradient.
  const heroNewCustomer = useMemo(() => {
    const scope = filters.store === 'All' ? undefined : filters.store;
    // Wave 1: re-base gross new-customer revenue onto NET via the blended
    // net÷gross factor of the current agg (business-wide or store-scoped),
    // so NC-ROAS reconciles in scale with the hero's net MER band.
    const { factor: ncNetAdj } = netAdjustFactor(filtered.curAgg.revenue, filtered.curAgg.grossRevenue);
    const m = computeNewCustomerMetrics(firstOrderRows, filtered.curAgg.spend, scope, ncNetAdj);
    // Wave 2 channel-nc-roas-split + per-channel-net-profit — same range + net
    // factor; per-platform spend; keepRate = 1 − effective COGS% − fees%.
    const cogsRate = filtered.curAgg.revenue > 0 ? filtered.curAgg.cogs / filtered.curAgg.revenue : 0;
    const keepRate = Math.max(0, 1 - cogsRate - TRANSACTION_FEES_RATE);
    // channel-overcount-delta (WS2 #12) — platform-claimed conversion value
    // (Σ campaigns conversionValue) vs Shopify click-ID-verified revenue
    // (Σ ALL orders by source) per channel, same range + store scope.
    const overcountFull = overcountByChannelFromCampaigns(
      campaignsData?.rows ?? [],
      ordersRows ?? [],
      filters.range.from,
      filters.range.to,
      scope,
    );
    const overcountByChannel = CHANNELS.reduce((acc, ch) => {
      acc[ch] = overcountFull[ch].overcountPct;
      return acc;
    }, {} as Record<Channel, number | null>);
    const channelMetrics = computeChannelTruth(
      firstOrderRows,
      { meta: filtered.curAgg.fbSpend, google: filtered.curAgg.gaSpend, tiktok: filtered.curAgg.ttSpend },
      scope,
      ncNetAdj,
      keepRate,
      overcountByChannel,
    );
    return {
      ...m,
      channelTruth: {
        metrics: channelMetrics,
        blendedNcRoas: m.ncRoas,
        blendedNcac: m.nCac,
        unclassifiableShare: m.unclassifiableShare,
      },
    };
  }, [
    firstOrderRows,
    filtered.curAgg.spend,
    filtered.curAgg.fbSpend,
    filtered.curAgg.gaSpend,
    filtered.curAgg.ttSpend,
    filtered.curAgg.revenue,
    filtered.curAgg.grossRevenue,
    filters.store,
    filters.range,
    campaignsData?.rows,
    ordersRows,
  ]);
  // A non-default compare baseline is ON, but the prior period has NO spend/
  // revenue panel to compare against. KEY OFF data_daily emptiness (revenue +
  // spend both 0), NOT orders: data_daily ad-spend/revenue starts May-2026, so
  // a 2025 "שנה שעברה" baseline is empty even though orders_attribution still
  // has 2023+ orders (prevOrdersTotal > 0). Requiring orders==0 too meant the
  // hint never fired for prev_year. When unavailable we hide EVERY delta line
  // (heroDelta = undefined) and show one explicit hint instead of leaking a
  // lone orders-vs-partial-baseline delta.
  const comparisonUnavailable = useMemo(() => {
    if (!compare.show) return false;
    const p = prevAggFromPrevData;
    return !p || ((p.revenue ?? 0) === 0 && (p.spend ?? 0) === 0);
  }, [compare.show, prevAggFromPrevData]);
  const heroDelta = useMemo(() => {
    if (comparisonUnavailable || !prevAggFromPrevData) return undefined;
    return toHeroDelta(
      filtered.curAgg,
      prevAggFromPrevData,
      heroCpm,
      heroCpmPrev,
      heroOrders,
      prevOrdersTotal,
    );
  }, [comparisonUnavailable, filtered.curAgg, prevAggFromPrevData, heroCpm, heroCpmPrev, heroOrders, prevOrdersTotal]);
  // (W3.2 2026-06-13) The per-card hero sparklines were removed when
  // CommandCenterHero was rebuilt on the Horizon <Widget> primitive, so the
  // `netSparkValues` / `secondarySparklines` memos that fed them are dead —
  // the hero no longer consumes either prop. Dropped here to stop computing
  // (and passing) values nothing reads. The underlying daily series still
  // drive the RoasTargetChart, and the `toNetSparkValues` / `toSecondarySparklines`
  // adapters + the exported <NetSparkline>/<MiniSparkline> components remain for
  // any surface that wants them.

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
        data?.dataLastWriteAt ?? null,
        // Mobile B1 — per-store ROAS spark (from the per-day series the Home
        // tab already computes) + delta-vs-prev-range chip (from the prev
        // SWR payload the hero delta already fetched). Desktop ignores both.
        filtered.series,
        compare.show ? prevRoasByStore : undefined,
        data?.adStateMap ?? {},
        data?.storeApplicablePlatforms ?? {},
      ),
    [
      filtered.storeAggs,
      campaignsData,
      filters.range,
      ordersByStore,
      storeIdByName,
      data?.dataLastWriteAt,
      filtered.series,
      compare.show,
      prevRoasByStore,
      data?.adStateMap,
      data?.storeApplicablePlatforms,
    ],
  );

  // ---- Per-store drill MODAL data ----------------------------------------
  // Built ONLY when a store card is clicked (`modalStoreId` set). Pure
  // `toStoreDetail` over the state HomeTab already holds — current StoreAgg
  // (filtered.storeAggs), prev StoreAgg (prevStoreAggByName), the per-day
  // series, campaign rows, and the per-store order count. No new fetch.
  // prevOrders comes from the dedicated prev orders-attribution fetch
  // (`prevOrdersByStore`) so the modal's Orders AND AOV deltas are real; null
  // while that fetch loads → those two deltas stay omitted until it lands.
  const storeDetail = useMemo(() => {
    if (modalStoreId === null) return null;
    // Resolve the display name for the selected storeId via the per-store row
    // (it carries both id + name); fall back to the storeIdByName inverse.
    const fromRow = perStoreData.find((s) => s.storeId === modalStoreId);
    const storeName =
      fromRow?.storeName ??
      Object.keys(storeIdByName).find((name) => storeIdByName[name] === modalStoreId) ??
      modalStoreId;
    const cur = filtered.storeAggs.find((s) => s.store === storeName);
    if (!cur) return null;
    return toStoreDetail({
      storeId: modalStoreId,
      storeName,
      cur,
      prev: compare.show ? (prevStoreAggByName?.[storeName] ?? null) : null,
      series: filtered.series,
      campaignRows: campaignsData?.rows,
      range: filters.range,
      orders: ordersByStore?.[storeName] ?? 0,
      prevOrders: compare.show
        ? prevOrdersByStore
          ? (prevOrdersByStore[storeName] ?? 0)
          : null
        : null,
      updatedAt: data?.dataLastWriteAt ?? null,
      // Phase 3 — per-store NC-ROAS / nCAC. toStoreDetail filters these by
      // storeName internally; MER spend = the store's mapping-aware cur.spend.
      firstOrderRows,
      // Ads-off Phase 2 — thread adOff from the per-store row so the modal
      // header band + ROAS hero mirrors the card it opened from.
      adOff: fromRow?.adOff,
    });
  }, [
    modalStoreId,
    perStoreData,
    storeIdByName,
    filtered.storeAggs,
    filtered.series,
    prevStoreAggByName,
    campaignsData,
    filters.range,
    ordersByStore,
    prevOrdersByStore,
    compare.show,
    data?.dataLastWriteAt,
    firstOrderRows,
  ]);

  // Close the drill modal if its store leaves the visible set — e.g. the store
  // filter narrows to a DIFFERENT store, so the open store is no longer shown.
  // A RANGE change keeps the modal open (the store stays visible) and lets
  // `storeDetail` recompute for the new range, rather than surprising the
  // operator by closing it.
  useEffect(() => {
    if (modalStoreId !== null && !perStoreData.some((s) => s.storeId === modalStoreId)) {
      setModalStoreId(null);
    }
  }, [perStoreData, modalStoreId]);

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
        chartPrevAgg,
        chartAnnotations,
      ),
    [chartScope, chartPrevAgg, chartAnnotations],
  );

  // Clicking a store card now OPENS the drill MODAL (was: drill straight to
  // Campaigns). The modal's footer / campaign rows still drill via
  // `drillToCampaigns` (wired on the modal's onOpenCampaigns below).
  const handleStoreSelect = (storeId: string) => {
    setModalStoreId(storeId);
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

  // B3 (mobile) — collapsing sticky ROAS summary headline. Fed from the MAIN
  // page range (the same `heroPeriod` the hero ROAS card uses), NOT the
  // RoasTargetChart's independent range — so it MATCHES the hero and UPDATES
  // when the operator changes the top range selector. The delta is the SAME
  // signed ROAS-POINTS value the hero ROAS card shows (`heroDelta.roas`), so the
  // two never disagree (previously the sticky showed a % while the card showed
  // points — the same change read as two different numbers).

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      {/* B3 — MOBILE-ONLY collapsing sticky ROAS summary. Pinned at top-0 of the
          Home scroll area (TopStrip is non-sticky as of reskin-w2c, so there is
          no app header to sit beneath). Hidden at md+. */}
      <MobileStickyRoas
        roas={heroPeriod.roas}
        target={3.0}
        deltaRoas={heroDelta?.roas ?? null}
        rangeLabel={rangeLabel}
      />

      {/* 1. Header — title + filters --------------------------------------- */}
      {/* AI-export trigger lives ONCE in the Horizon navbar (TopStrip), per the
          canonical mockup (home-approved.html:96). The old TabHeader actionSlot
          trigger was removed to dedupe; the AiReportButton below still mounts
          (modal-only via `triggerless`) so the navbar/⌘K openSignal has a
          listener that owns the report modal + all its data states. */}
      <TabHeader
        title="בית"
        description="שנה טווח או חנות לעדכון כל המסך."
        filterSlot={
          <Filters
            filters={filters}
            stores={data.stores}
            onChange={setFilters}
            showCompareBaseline
            showSavedViews
          />
        }
      />
      <AiReportButton
        data={data}
        filters={filters}
        openSignal={aiReportSignal}
        triggerless
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
      <SectionIntro
        icon={<Store size={20} />}
        title="לפי חנות"
        description="מצב ה-ROAS, ההוצאה, ההכנסה וה-CPM של כל חנות בנפרד — לטווח הנבחר."
      />
      <PerStoreRow stores={perStoreData} onStoreSelect={handleStoreSelect} rangeLabel={rangeLabel} />

      {/* Cross-store comparison grid — renders its own section heading. Shares
          the exact per-store data array PerStoreRow consumes. */}
      <StoreCompareGrid stores={perStoreData} />

      {/* Per-store drill-down MODAL — opens on store-card click; reuses the
          campaign modal's Sheet shell. Renders nothing while closed (data null).
          onOpenCampaigns closes the modal THEN drills to the Campaigns tab
          pre-filtered by the store. */}
      <StoreDetailModal
        data={storeDetail}
        open={modalStoreId !== null}
        onClose={() => setModalStoreId(null)}
        rangeLabel={rangeLabel}
        onOpenCampaigns={(campaign) => {
          // Capture the store NAME before closing (storeDetail goes null once
          // modalStoreId clears). `store` filters the Campaigns tab (c_store);
          // `campaign` (when a row was clicked) deep-links its drawer (c_drill).
          // drillToCampaigns writes the URL + dispatches popstate → the
          // listener above switches activeTab to 'campaigns'.
          const storeName = storeDetail?.storeName;
          setModalStoreId(null);
          drillToCampaigns({ store: storeName, campaign });
        }}
      />

      {/* 3. Hero strip — 2 rows × 3 cards (business-wide summary) ----------- */}
      <SectionIntro
        icon={<Building2 size={20} />}
        title="סיכום עסקי"
        description="המספרים המצרפיים של כל העסק — רווח תפעולי, הכנסה, הוצאה, ROAS, הזמנות ו-CPM — מאוחדים על פני כל החנויות."
      />
      <CommandCenterHero
        current={heroPeriod}
        delta={heroDelta}
        rangeLabel={heroRangeLabel}
        coverage={coverage ?? null}
        coverageBreakdown={coverageBreakdown}
        comparisonLabel={compare.caption}
        comparisonUnavailable={comparisonUnavailable}
        updatedAt={data.dataLastWriteAt ?? undefined}
        newCustomer={heroNewCustomer}
        provenanceVerdict={provenanceVerdict}
        overrideNote={overrideNote}
        overrideLastEditedAt={overrideLastEditedAt}
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

      {/* 5. Bottom 2-up — Insights board + Activity feed --------------------
          items-start: the two columns have very different natural heights (the
          insights/action board is tall, the live feed is a short snapshot). The
          grid default (align-items: stretch) forced the SHORT feed card to the
          tall column's height → its content stacked at the top and the leftover
          stretched height showed as dead white space. Top-aligning lets each
          card take its own content height (no forced equal-height, no gap). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <InsightsBoard data={data} />
        <ActivityFeed
          store={filters.store === 'All' ? undefined : filters.store}
          onSeeAll={onSeeActivity}
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
  overrideNote,
  overrideLastEditedAt,
}: {
  data: DashboardData;
  filtered: FilteredView;
  filters: F;
  setFilters: (next: F) => void;
  /**
   * DQ-3 (Wave 3 data-trust) — active manual-spend override summary for the
   * current store scope; threaded to the P&L Ad-Spend line's "● ידני" flag.
   */
  overrideNote?: string;
  overrideLastEditedAt?: string;
}) {
  const pnlSynthesis = synthesizePnl({ agg: filtered.curAgg });
  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<Receipt size={20} />}
        title="הרווח שלך לתקופה"
        description="כל ההכנסות פחות כל ההוצאות — ad spend, COGS, עמלות עיבוד, עלויות חודשיות קבועות (מנויים + חד-פעמיים), ומשכורות — עד לרווח נטו אמיתי. השיעורים בפועל (COGS, שכר) מוצגים בשורות למטה ומתעדכנים כשעורכים אותם. שנה טווח או חנות וכל המספרים יתעדכנו."
        formula="רווח נטו = הכנסות − Ad Spend − COGS − Transaction Fees − Fixed Costs − Salaries"
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

      <GoalTracker data={data} range={filters.range} />

      <PnLBreakdown
        current={filtered.curAgg}
        storeNames={filtered.visibleStores}
        // 2026-06-11 adversarial review (D4 internal reconciliation): the SAME
        // store-scope threading curAgg was aggregated with, so the by-source
        // fixed-costs table reconciles to the cascade's fixedCosts line under
        // a single-store filter. Both undefined in the 'All' view.
        scopedStoreNames={filtered.scopedStoreNames}
        revenueByStore={filtered.revenueByStore}
        rangeFrom={filters.range.from}
        rangeTo={filters.range.to}
        rows={filtered.cur}
        overrideNote={overrideNote}
        overrideLastEditedAt={overrideLastEditedAt}
      />

      <div className="space-y-3">
        <div className="flex justify-end">
          <BillingSettings storeNames={data.stores} />
        </div>
        <CogsSettings
          storeNames={data.stores}
          currentMonth={getTodayInIsraelTz().slice(0, 7)}
          monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
        />
        <SalarySettings
          currentMonth={getTodayInIsraelTz().slice(0, 7)}
          monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Tab: CAMPAIGNS — campaign + ad-set performance with ROAS / CTR / CPC / CPA.
// ============================================================================
const campaignsFetcher = (url: string): Promise<CampaignsResponse> =>
  fetchJson<CampaignsResponse>(url);

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
          adStateMap={data.adStateMap}
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
  adStateMap,
  storeApplicablePlatforms,
}: {
  filtered: { cur: DashboardData['rows'] };
  filters: F;
  setFilters: (next: F) => void;
  stores: string[];
  adStateMap?: AdStateMap;
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
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
        <DetailTable rows={filtered.cur} bare adStateMap={adStateMap} storeApplicablePlatforms={storeApplicablePlatforms} />
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
      {/* Copy-truth (2026-06-10 audit P1-26): the auto-refresh interval is
          120s (useAutoRefresh intervalMs above) — "כל דקה" was stale since
          the Inngest cost cut. */}
      <span>מתעדכן אוטומטית כל 2 דקות</span>
    </footer>
  );
}
