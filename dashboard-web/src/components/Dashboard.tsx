'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { RefreshCw, AlertCircle } from 'lucide-react';
import type { DashboardData, Filters as F } from '@/lib/types';
import { computePresetRange, previousRange } from '@/lib/presets';
import { aggregate, aggregateByStore, dailySeries, filterRows } from '@/lib/analytics';
import { Filters } from './Filters';
import { KpiCards } from './KpiCards';
import { PerStoreCards } from './PerStoreCards';
import { RoasChart } from './RoasChart';
import { InsightsPanel } from './InsightsPanel';
import { MonthlyTables } from './MonthlyTables';
import { DetailTable } from './DetailTable';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

const initialPreset = 'this_month';

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

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-6">
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
            <Filters
              filters={filters}
              stores={data.stores}
              onChange={setFilters}
            />

            <KpiCards current={filtered.curAgg} previous={filtered.prevAgg} />

            <InsightsPanel storeAggs={filtered.storeAggs} rows={filtered.cur} />

            <PerStoreCards data={filtered.storeAggs} />

            <RoasChart data={filtered.series} stores={filtered.visibleStores} />

            <MonthlyTables rows={data.rows} stores={data.stores} />

            <DetailTable rows={filtered.cur} />

            <Footer lastUpdated={data.lastUpdated} />
          </>
        )}
      </main>
    </div>
  );
}

function Header({
  lastUpdated,
  isRefreshing,
  onRefresh,
}: {
  lastUpdated?: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="bg-primary text-white shadow-sm sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">דשבורד ROAS</h1>
          <p className="text-xs text-blue-100/80 mt-0.5">מעקב יומי לכל החנויות</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm transition-colors"
          disabled={isRefreshing}
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'מתעדכן...' : 'רענן'}
        </button>
      </div>
    </header>
  );
}

function Footer({ lastUpdated }: { lastUpdated: string }) {
  return (
    <footer className="text-center text-xs text-text-muted py-6">
      עדכון אחרון: {new Date(lastUpdated).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}
      <br />
      מתעדכן אוטומטית כל דקה
    </footer>
  );
}
