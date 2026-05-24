'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import {
  AlertCircle,
  Home,
  TrendingUp,
  Package,
  Table,
  Radio,
  Target,
  Store,
  CalendarDays,
  Megaphone,
  Receipt,
  Cog,
} from 'lucide-react';
import type { DashboardData, Filters as F } from '@/lib/types';
import { computePresetRange, previousRange } from '@/lib/presets';
import { aggregate, aggregateByStore, dailySeries, filterRows } from '@/lib/analytics';
import { Filters } from './Filters';
import { KpiCards } from './KpiCards';
import { PerStoreCards } from './PerStoreCards';
import { RoasChart } from './RoasChart';
import { MonthlyTables } from './MonthlyTables';
import { DetailTable } from './DetailTable';
import { TodayLive } from './TodayLive';
import { ProductsTable } from './ProductsTable';
import { ProductCentricView } from './ProductCentricView';
import { CampaignsTable } from './CampaignsTable';
import { InsightsBoard } from './InsightsBoard';
import { GoalTracker } from './GoalTracker';
import { AiReportButton } from './AiReportButton';
import { HeroOverview } from './HeroOverview';
import { PnLBreakdown } from './PnLBreakdown';
import { BillingSettings } from './BillingSettings';
import { AnnotationsPanel } from './AnnotationsPanel';
import { CommandPalette } from './CommandPalette';
import { TabNav, type TabDef } from './TabNav';
import { SectionIntro } from './SectionIntro';
import { CloudSync } from './CloudSync';
import { SyncIndicator } from './SyncIndicator';
import { FreshnessChip } from './FreshnessChip';
import { TabFreshnessHeader } from './TabFreshnessHeader';
import { readDashboardState, syncUrl } from '@/lib/urlState';
import { buildDateRangeKey } from '@/lib/dateRange';

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

type TabKey = 'home' | 'pnl' | 'analysis' | 'campaigns' | 'products' | 'detail';

const TABS: TabDef<TabKey>[] = [
  { key: 'home',      label: 'בית',     icon: <Home size={16} /> },
  { key: 'pnl',       label: 'P&L',     icon: <Receipt size={16} /> },
  { key: 'analysis',  label: 'ניתוח',    icon: <TrendingUp size={16} /> },
  { key: 'campaigns', label: 'קמפיינים', icon: <Megaphone size={16} /> },
  { key: 'products',  label: 'מוצרים',   icon: <Package size={16} /> },
  { key: 'detail',    label: 'פירוט',    icon: <Table size={16} /> },
];

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
    <div dir="rtl" className="min-h-screen bg-background">
      {/* Keeps billing / annotations / goal / insight-states in sync across
          devices and partners by mirroring localStorage to Google Sheets. */}
      <CloudSync />
      <Header
        dataLastWriteAt={data?.dataLastWriteAt ?? null}
        commandPalette={
          data ? (
            <CommandPalette
              data={data}
              filters={filters}
              setFilters={setFilters}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onRefresh={() => mutate()}
              onOpenAiReport={() => setAiReportSignal(n => n + 1)}
            />
          ) : null
        }
      />

      {/* Tabs only render once data is in — keeps initial paint clean */}
      {data && <TabNav tabs={TABS} active={activeTab} onChange={setActiveTab} />}

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-5">
        {/* Two error sources: (a) SWR threw (network failure, malformed JSON),
          * (b) /api/data returned 200 + empty rows + error field (WR-06 degraded
          * path — preferred over status 500 so SWR consumers downstream stay
          * consistent across /api/data, /api/campaigns, /api/products, /api/ads,
          * /api/orders-attribution, etc.). Either surfaces in the same banner. */}
        {(error || data?.error) && (
          <div className="rounded-xl bg-roas-redBg border border-roas-red/30 p-4 flex items-start gap-3">
            <AlertCircle className="text-roas-red shrink-0" size={20} />
            <div>
              <div className="font-semibold text-roas-red">שגיאה בטעינת הנתונים</div>
              <div className="text-sm text-text-secondary mt-1">
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

function HomeTab({
  data,
  filtered,
  filters,
  setFilters,
  aiReportSignal,
  ordersByStore,
}: {
  data: DashboardData;
  filtered: FilteredView;
  filters: F;
  setFilters: (next: F) => void;
  /** Increments when the command palette wants to open the AI report. */
  aiReportSignal: number;
  /** Phase 05.7.8 — per-store order count for the range, keyed by storeName. */
  ordersByStore: Record<string, number>;
}) {
  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      {/* ===== Live snapshot (today) — now the FIRST section per user
                    request. Real-time read of the day-in-progress trumps the
                    Hero editorial summary as the at-a-glance default. ===== */}
      <SectionIntro
        icon={<Radio size={18} />}
        title="היום עד לרגע זה"
        description="הכנסות Shopify + הזמנות בזמן אמת + הוצאות Meta/Google/TikTok (עם פיגור ~20 דק'). רענון אוטומטי כל 10 דקות."
      />
      <TodayLive rows={data.rows} fxIlsToCad={data.fxIlsToCad} />

      {/* ===== Hero — editorial story + chart-as-background + floating KPIs ===== */}
      <HeroOverview data={data} filters={filters} />

      {/* ===== Filters — quiet, just controls. AI-report button on the right. ===== */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <div className="flex items-center gap-2 text-xs sm:text-sm text-text-secondary">
          <CalendarDays size={14} className="text-text-muted" />
          <span>שנה טווח או חנות לעדכון כל המסך</span>
        </div>
        <AiReportButton data={data} filters={filters} openSignal={aiReportSignal} />
      </div>
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      {/* ===== Goal tracker — monthly revenue target with pacing + forecast.
                Intentionally GLOBAL: ignores both `filters.store` and
                `filters.range` so the single business-wide goal stays
                meaningful regardless of how the rest of the dashboard is
                filtered. See GoalTracker.tsx docstring. ===== */}
      <GoalTracker data={data} />

      {/* ===== Insights engine — anomalies, recommendations, opportunities ===== */}
      <InsightsBoard data={data} />

      {/* ===== Activity log — events overlay on charts so anomalies have context ===== */}
      <AnnotationsPanel range={filters.range} store={filters.store} />

      {/* ===== Detailed KPI cards — full breakdown, the "drill-down" of the hero ===== */}
      <SectionIntro
        icon={<Target size={18} />}
        title="מדדים מסכמים לתקופה"
        description="הסיכום של כל החנויות הנבחרות בטווח שבחרת. כל מספר מושווה לתקופה הקודמת באותו אורך."
        formula="ROAS = הכנסות / סך הוצאות פרסום   •   רווח נטו = הכנסות − הוצאות − COGS (25%)"
      />
      <KpiCards current={filtered.curAgg} previous={filtered.prevAgg} series={filtered.cur} />

      {/* ===== Per-store cards ===== */}
      <SectionIntro
        icon={<Store size={18} />}
        title="ביצועים לפי חנות"
        description="כרטיס לכל חנות עם ה-ROAS, ההכנסות, ההוצאות, והרווח הגולמי לתקופה הנבחרת. החנות עם ROAS הכי גבוה מקבלת אייקון מובילה."
      />
      <PerStoreCards data={filtered.storeAggs} ordersByStore={ordersByStore} bare />
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
  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<Receipt size={20} />}
        title="הרווח שלך לתקופה"
        description="כל ההכנסות פחות כל ההוצאות — ad spend, COGS (25%), עמלות עיבוד (6.5%), ועלויות חודשיות קבועות (מנויים + חד-פעמיים) — עד לרווח נטו אמיתי. שנה טווח או חנות וכל המספרים יתעדכנו."
        formula="רווח נטו = הכנסות − Ad Spend − COGS − Transaction Fees − Fixed Costs"
      />

      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      <div className="space-y-3">
        <div className="flex justify-end">
          <BillingSettings storeNames={data.stores} />
        </div>
        <PnLBreakdown
          current={filtered.curAgg}
          storeNames={filtered.visibleStores}
          rangeFrom={filters.range.from}
          rangeTo={filters.range.to}
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
  };
  filters: F;
  setFilters: (next: F) => void;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טווח לניתוח"
        description="הסינון מטה משפיע על גרף המגמה בלבד. הטבלאות החודשיות מציגות עד 17 חודשים אחורה — בלי תלות בטווח שבחרת."
      />
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      <SectionIntro
        icon={<TrendingUp size={20} />}
        title="מגמת ROAS לאורך זמן"
        description="קו לכל חנות. הקו האדום-מקווקו מציין את היעד הפנימי שלך — ROAS 3.0. רוצה לראות חנות אחת? סנן למעלה."
      />
      <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
        <RoasChart data={filtered.series} stores={filtered.visibleStores} bare />
      </div>

      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טבלאות חודשיות"
        description="טבלה לכל חודש עם שורה לכל יום, עד 17 חודשים אחורה. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
        <MonthlyTables stores={data.stores} bare />
      </div>
    </div>
  );
}

// ============================================================================
// Tab: CAMPAIGNS — campaign + ad-set performance with ROAS / CTR / CPC / CPA.
// ============================================================================
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
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />
      <div className="rounded-xl bg-surface border border-borderSubtle shadow-card overflow-hidden">
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
function ProductsTab({
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
        icon={<Package size={20} />}
        title="מוצרים שנמכרו"
        description="כל פריט שנמכר בחנויות שלך, מקובץ לפי תקופה. אפשר לראות יום ספציפי, שבוע, חודש, חצי-שנה, או שנה. הסינון מימין משלים את הסינון הגלובלי — בחר חנות בודדת או יום בודד כדי להתמקד. מוצג לכל מוצר: הזמנות, יחידות, ברוטו ונטו."
        formula="ברוטו = מחיר × כמות   •   נטו = ברוטו − הנחות − החזרים"
      />

      {/* Show global filter too so user knows what date range is active */}
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
        <ProductsTable
          range={filters.range}
          store={filters.store}
          stores={data.stores}
        />
      </div>

      {/* Phase 05.7.x (2026-05-23) — Product-centric pivot view. Shows
          each product expandable to all campaigns mapping it, grouped
          by platform with intra-platform spend share + allocated
          revenue. Defaults to multi-mapped products only; operator
          can toggle to see solo too. Renders a "select a store" hint
          when filters.store === 'All' (mappings are per-store). */}
      <ProductCentricView storeId={filters.store} range={filters.range} />
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
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<Table size={20} />}
        title="פירוט יומי"
        description="כל שורה בטבלה היא (יום × חנות) — הוצאות פייסבוק, גוגל, הכנסות, ROAS, ורווח. עד 100 שורות אחרונות בטווח הנבחר. ROAS שחור עם '0' = יום שהוצאת בו כסף אבל לא היו מכירות (כשל)."
      />
      <Filters filters={filters} stores={stores} onChange={setFilters} />
      <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
        <DetailTable rows={filtered.cur} bare />
      </div>
    </div>
  );
}

// ============================================================================
// Header + Footer
// ============================================================================
function Header({
  commandPalette,
  dataLastWriteAt,
}: {
  /** The Cmd-K trigger pill is rendered inside the header so it's always
   *  reachable, no matter which tab the user is on. */
  commandPalette?: React.ReactNode;
  /**
   * Phase 05.7.6 — ISO timestamp of the most-recent data_daily row write
   * (cron-live / cron-daily / event-sync-now). Surfaced as a chip in the
   * header so the operator can see when data was last refreshed without
   * jumping to /operator > Jobs.
   */
  dataLastWriteAt: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 bg-primary-dark text-white shadow-sm">
      {/* Deep navy gradient with a subtle inner highlight; closer to Stripe/Linear than the
          previous flat-ish gradient. */}
      <div
        className="relative bg-gradient-to-br from-primary-dark via-primary to-primary-light"
        style={{
          backgroundImage:
            'linear-gradient(120deg, #091c4a 0%, #0d3680 55%, #1d4ed8 110%)',
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(at_top_left,_rgba(255,255,255,0.08),_transparent_50%)] pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg md:text-xl font-semibold tracking-tight truncate flex items-center gap-2">
              <span aria-hidden>📊</span>
              <span>דשבורד ROAS</span>
            </h1>
            <p className="text-[10px] sm:text-xs text-white/65 mt-0.5 hidden sm:block tracking-wide">
              מעקב הוצאות ↔ הכנסות לכל החנויות
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Phase 05.7.6: freshness chip. Hidden on the smallest screens
                so the header doesn't wrap; on sm+ it sits left of the
                command-palette + sync indicators. */}
            <span className="hidden sm:inline-flex">
              <FreshnessChip dataLastWriteAt={dataLastWriteAt} />
            </span>
            {commandPalette}
            <SyncIndicator />
            {/* Operator console (D-D1) — sibling Next.js route at /operator.
                NOT a TabKey: stays out of the in-page TabNav so the main
                dashboard's tab semantics don't drift. Sub-views land in
                plans 13-16. */}
            <Link
              href="/operator"
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-white/12 hover:bg-white/20 active:bg-white/25 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors ring-1 ring-white/10"
              aria-label="ניהול"
            >
              <Cog size={14} />
              <span className="hidden sm:inline">ניהול</span>
            </Link>
            {/* Phase 05.7.9 — header "Refresh" button removed per operator
                request. It only called SWR mutate() (local cache revalidate),
                which the auto-poll already does every 60s, and visually it
                competed with the real "רענן הכל" button in TabFreshnessHeader
                (which fires a full Inngest sync). Removing avoids confusion. */}
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer({ lastUpdated }: { lastUpdated: string }) {
  return (
    <footer className="text-center text-[11px] sm:text-xs text-text-muted py-6 tabular-nums">
      <span className="inline-block">
        עדכון אחרון:{' '}
        <span className="text-text-secondary font-medium">
          {new Date(lastUpdated).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
        </span>
      </span>
      <span className="mx-2 text-text-subtle">·</span>
      <span>מתעדכן אוטומטית כל דקה</span>
    </footer>
  );
}
