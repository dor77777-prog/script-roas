'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Store,
  CalendarDays,
  Package,
  Table,
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
import { CollapsibleSection } from './CollapsibleSection';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

const initialPreset = 'yesterday';

export function Dashboard() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<DashboardData>(
    '/api/data',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  const [filters, setFilters] = useState<F>(() => ({
    preset: initialPreset,
    range: computePresetRange(initialPreset),
    store: 'All',
  }));

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
        lastUpdated={data?.lastUpdated}
        isRefreshing={isValidating}
        onRefresh={() => mutate()}
      />

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
          <div className="rounded-xl bg-surface border border-border p-8 text-center text-text-muted shadow-card">
            טוען נתונים…
          </div>
        )}

        {data && filtered && (
          <>
            {/* ===== Always visible: today's live snapshot ===== */}
            <TodayLive rows={data.rows} fxIlsToCad={data.fxIlsToCad} />

            {/* ===== Filters (compact, can hide preset palette on small screens) ===== */}
            <Filters filters={filters} stores={data.stores} onChange={setFilters} />

            {/* ===== Above the fold: KPIs + per-store breakdown ===== */}
            <KpiCards current={filtered.curAgg} previous={filtered.prevAgg} />

            <CollapsibleSection
              title="ביצועים לפי חנות"
              icon={<Store size={18} />}
              defaultOpen
              storageKey="store-breakdown"
              subtitle={`${filtered.visibleStores.length} ${filtered.visibleStores.length === 1 ? 'חנות' : 'חנויות'} בטווח הנבחר`}
            >
              <PerStoreCards data={filtered.storeAggs} bare />
            </CollapsibleSection>

            {/* ===== Trend chart (open by default) ===== */}
            <CollapsibleSection
              title="מגמת ROAS לאורך זמן"
              icon={<TrendingUp size={18} />}
              defaultOpen
              storageKey="roas-chart"
              subtitle={`${filtered.series.length} ימים`}
            >
              <RoasChart data={filtered.series} stores={filtered.visibleStores} bare />
            </CollapsibleSection>

            {/* ===== Below the fold: collapsed by default ===== */}
            <CollapsibleSection
              title="מוצרים שנמכרו"
              icon={<Package size={18} />}
              storageKey="products"
              subtitle="פירוט מכירות לפי מוצר — יומי / שבועי / חודשי / שנתי"
            >
              <ProductsTable
                range={filters.range}
                store={filters.store}
                stores={data.stores}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="טבלאות חודשיות"
              icon={<CalendarDays size={18} />}
              storageKey="monthly"
              subtitle="טבלה לכל חודש — לפי חנות או סיכום משולב"
            >
              <MonthlyTables rows={data.rows} stores={data.stores} bare />
            </CollapsibleSection>

            <CollapsibleSection
              title="פירוט יומי"
              icon={<Table size={18} />}
              storageKey="detail"
              subtitle="100 השורות האחרונות בטווח הנבחר"
            >
              <DetailTable rows={filtered.cur} bare />
            </CollapsibleSection>

            <Footer lastUpdated={data.lastUpdated} />
          </>
        )}
      </main>
    </div>
  );
}

function Header({
  lastUpdated: _lastUpdated,
  isRefreshing,
  onRefresh,
}: {
  lastUpdated?: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="bg-gradient-to-l from-primary-dark to-primary text-white shadow-md sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl md:text-2xl font-bold truncate">📊 דשבורד ROAS</h1>
          <p className="text-[10px] sm:text-xs text-blue-100/80 mt-0.5 hidden sm:block">
            מעקב יומי לכל החנויות
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 sm:gap-2 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm transition-colors shrink-0"
          disabled={isRefreshing}
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{isRefreshing ? 'מתעדכן...' : 'רענן'}</span>
        </button>
      </div>
    </header>
  );
}

function Footer({ lastUpdated }: { lastUpdated: string }) {
  return (
    <footer className="text-center text-xs text-text-muted py-6">
      עדכון אחרון:{' '}
      {new Date(lastUpdated).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
      <br />
      מתעדכן אוטומטית כל דקה
    </footer>
  );
}
