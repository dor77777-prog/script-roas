'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays } from 'lucide-react';
import { YearSelector } from '@/components/YearSelector';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthlyTables, Tab, type Mode } from '@/components/MonthlyTables';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SectionIntro } from '@/components/SectionIntro';
import { PageScope } from '@/components/ui/PageScope';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { synthesizeArchive } from '@/lib/synthesis/archive';
import { buildDateRangeKey } from '@/lib/dateRange';
import type { DashboardData } from '@/lib/types';

type Props = {
  stores: DashboardData['stores'];
  /**
   * Global store filter (filters.store from Dashboard). When set to a
   * specific store, the archive scopes both the page synthesis and the
   * monthly tables to that store. 'All' (or undefined) preserves the
   * legacy all-stores behavior. Per [[home-visual-rules]] the global
   * filter applies to most pages — Archive was previously ignoring it.
   */
  globalStore?: string;
};

// Match MonthlyTables' fetcher so the SWR key is shared (no duplicate
// network request — same `/api/data?from=...&to=...` URL is hit by both
// children of AnalysisArchiveTab).
const fetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json();
};

export function AnalysisArchiveTab({ stores, globalStore }: Props) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);

  // Lifted from MonthlyTables so the mode toggle (לפי חנות / סיכום כללי) +
  // store picker sit on the SAME row as year/month (operator request
  // 2026-06-01). MonthlyTables receives these as CONTROLLED props and
  // suppresses its own internal toolbar. Seeding/sync mirrors MonthlyTables'
  // former internal logic exactly so behavior is unchanged.
  const [mode, setMode] = useState<Mode>('per-store');
  const [storeFilter, setStoreFilter] = useState<string>(
    globalStore && globalStore !== 'All' && stores.includes(globalStore)
      ? globalStore
      : stores[0] || 'All',
  );
  // Keep the store picker in sync when the operator changes the global filter
  // to a specific store — but still allow a local override afterwards (same
  // contract MonthlyTables had).
  useEffect(() => {
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) {
      setStoreFilter(globalStore);
    }
  }, [globalStore, stores]);

  // Share the SWR key with MonthlyTables so the year-wide fetch is
  // cached once and the synthesiser reads the same row set the tables
  // render. Without the shared key the synthesiser would fire its own
  // request and could disagree on the "strongest month" when the
  // network responses returned at slightly different times.
  const historyRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const { data } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', historyRange),
    fetcher,
    { revalidateOnFocus: false },
  );

  // Apply the global store filter to the synthesiser's input AND to the
  // visible scope label. The MonthlyTables child gets globalStore directly
  // and handles its own per-store filtering. 'All' (undefined or 'All')
  // preserves the all-stores behavior.
  const isStoreScoped =
    !!globalStore && globalStore !== 'All' && stores.includes(globalStore);
  const scopedRows = isStoreScoped
    ? (data?.rows ?? []).filter(r => r.storeName === globalStore)
    : (data?.rows ?? []);
  const archiveSynthesis = synthesizeArchive({
    rows: scopedRows,
    year,
  });

  return (
    // animate-fade-in-up restores the mount transition the Radix TabsContent
    // used to provide (now a top-level tab) and matches HomeTab / PnLTab.
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title={isStoreScoped ? `טבלאות חודשיות — ${globalStore}` : 'טבלאות חודשיות'}
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <PageScope
        store={isStoreScoped ? globalStore! : 'כל החנויות'}
        rangeLabel={month != null ? `${month}/${year}` : `${year}`}
        currency="CAD"
      />
      <PageSynthesis
        text={archiveSynthesis.text}
        anchorMetric={archiveSynthesis.anchorMetric}
        confidence={archiveSynthesis.confidence}
      />
      {/* All FOUR archive controls on a SINGLE aligned row (operator request
          2026-06-01): year · month · mode-toggle · store-picker. Each is
          constrained to a fixed width so they don't span the full screen.
          NativeSelect's own wrapper is `w-full`, so the width cap lives on
          these containers; still ≥36px tall + tappable on mobile. The mode
          toggle + store picker are the SAME markup MonthlyTables uses, lifted
          here and wired to MonthlyTables via controlled props (its internal
          toolbar is suppressed). items-end aligns every control to a shared
          baseline; flex-wrap keeps the row orderly on narrow screens. */}
      <div className="flex items-end gap-3 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">שנה</span>
          <div className="w-28">
            <YearSelector value={year} onChange={setYear} />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">חודש</span>
          <div className="w-40">
            <MonthSelector value={month} onChange={setMonth} />
          </div>
        </label>
        {/* div (not label): the toggle is a role="tablist" of buttons, not a
            single form control, so a <label> wrapper would mis-associate its
            caption text with the first tab's accessible name. */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">תצוגה</span>
          <div
            role="tablist"
            className="inline-flex h-9 rounded-lg border border-glass-edge bg-glass-1 overflow-hidden divide-x divide-glass-edge"
            dir="ltr"
          >
            <Tab active={mode === 'per-store'} onClick={() => setMode('per-store')}>
              לפי חנות
            </Tab>
            <Tab active={mode === 'summary'} onClick={() => setMode('summary')}>
              סיכום כללי
            </Tab>
          </div>
        </div>
        {mode === 'per-store' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">חנות</span>
            <div className="w-40">
              <NativeSelect
                aria-label="חנות"
                value={storeFilter}
                onChange={e => setStoreFilter(e.target.value)}
                className="font-medium"
              >
                {stores.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}
      </div>
      <MonthlyTables
        stores={stores}
        globalStore={globalStore}
        year={year}
        month={month}
        mode={mode}
        onModeChange={setMode}
        storeFilter={storeFilter}
        onStoreFilterChange={setStoreFilter}
      />
    </div>
  );
}
