'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  RefreshCw,
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
import { CampaignsTable } from './CampaignsTable';
import { InsightsBoard } from './InsightsBoard';
import { GoalTracker } from './GoalTracker';
import { AiReportButton } from './AiReportButton';
import { HeroOverview } from './HeroOverview';
import { CommandPalette } from './CommandPalette';
import { TabNav, type TabDef } from './TabNav';
import { SectionIntro } from './SectionIntro';
import { readDashboardState, syncUrl } from '@/lib/urlState';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

const initialPreset = 'this_month';

type TabKey = 'home' | 'analysis' | 'campaigns' | 'products' | 'detail';

const TABS: TabDef<TabKey>[] = [
  { key: 'home',      label: 'בית',     icon: <Home size={16} /> },
  { key: 'analysis',  label: 'ניתוח',    icon: <TrendingUp size={16} /> },
  { key: 'campaigns', label: 'קמפיינים', icon: <Megaphone size={16} /> },
  { key: 'products',  label: 'מוצרים',   icon: <Package size={16} /> },
  { key: 'detail',    label: 'פירוט',    icon: <Table size={16} /> },
];

export function Dashboard() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<DashboardData>(
    '/api/data',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  // Initial state — read from URL search params on first mount so a refresh
  // or bookmark restores the user's view. Falls back to defaults when no
  // params are present.
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

  // Counter that increments whenever the command palette wants to open the
  // AI report modal. AiReportButton listens to this prop via useEffect.
  const [aiReportSignal, setAiReportSignal] = useState(0);

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
      curAgg: aggregate(cur),
      prevAgg: aggregate(prev),
      storeAggs: aggregateByStore(cur),
      series: dailySeries(cur, stores),
      visibleStores: stores,
    };
  }, [data, filters]);

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header
        isRefreshing={isValidating}
        onRefresh={() => mutate()}
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
        {error && (
          <div className="rounded-xl bg-roas-redBg border border-roas-red/30 p-4 flex items-start gap-3">
            <AlertCircle className="text-roas-red shrink-0" size={20} />
            <div>
              <div className="font-semibold text-roas-red">שגיאה בטעינת הנתונים</div>
              <div className="text-sm text-text-secondary mt-1">{(error as Error).message}</div>
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
            {activeTab === 'home' && (
              <HomeTab
                data={data}
                filtered={filtered}
                filters={filters}
                setFilters={setFilters}
                aiReportSignal={aiReportSignal}
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
function HomeTab({
  data,
  filtered,
  filters,
  setFilters,
  aiReportSignal,
}: {
  data: DashboardData;
  filtered: NonNullable<ReturnType<typeof Dashboard> extends infer _ ? never : never> | {
    curAgg: ReturnType<typeof aggregate>;
    prevAgg: ReturnType<typeof aggregate>;
    storeAggs: ReturnType<typeof aggregateByStore>;
    series: ReturnType<typeof dailySeries>;
    visibleStores: string[];
    cur: DashboardData['rows'];
  };
  filters: F;
  setFilters: (next: F) => void;
  /** Increments when the command palette wants to open the AI report. */
  aiReportSignal: number;
}) {
  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
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

      {/* ===== Live snapshot (today) — still important, secondary to hero ===== */}
      <SectionIntro
        icon={<Radio size={18} />}
        title="היום עד לרגע זה"
        description="הכנסות Shopify בזמן אמת + הוצאות Meta/Google (עם פיגור ~20 דק'). רענון אוטומטי כל 15 דקות."
      />
      <TodayLive rows={data.rows} fxIlsToCad={data.fxIlsToCad} />

      {/* ===== Goal tracker — monthly revenue target with pacing + forecast ===== */}
      <GoalTracker data={data} />

      {/* ===== Insights engine — anomalies, recommendations, opportunities ===== */}
      <InsightsBoard data={data} />

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
      <PerStoreCards data={filtered.storeAggs} bare />
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
        description="הסינון מטה משפיע על גרף המגמה. הטבלאות החודשיות מציגות את כל החודשים בכל מקרה (לא מסונן)."
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
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
        <MonthlyTables rows={data.rows} stores={data.stores} bare />
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
  isRefreshing,
  onRefresh,
  commandPalette,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
  /** The Cmd-K trigger pill is rendered inside the header so it's always
   *  reachable, no matter which tab the user is on. */
  commandPalette?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 bg-primary-dark text-white shadow-sm">
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
            {commandPalette}
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-white/12 hover:bg-white/20 active:bg-white/25 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors ring-1 ring-white/10"
              disabled={isRefreshing}
              aria-label="רענן נתונים"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{isRefreshing ? 'מתעדכן…' : 'רענן'}</span>
            </button>
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
