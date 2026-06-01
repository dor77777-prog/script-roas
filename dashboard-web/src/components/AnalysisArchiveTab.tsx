'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { CalendarDays } from 'lucide-react';
import { YearSelector } from '@/components/YearSelector';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthlyTables } from '@/components/MonthlyTables';
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
      {/* Compact year + month selectors on a SINGLE row. Each is constrained to
          a fixed width so they no longer span the full screen (operator
          complaint). NativeSelect's own wrapper is `w-full`, so the width cap
          lives on these containers; still ≥36px tall + tappable on mobile. */}
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
      </div>
      <MonthlyTables stores={stores} globalStore={globalStore} year={year} month={month} />
    </div>
  );
}
