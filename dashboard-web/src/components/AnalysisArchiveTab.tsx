'use client';

import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { CalendarDays } from 'lucide-react';
import { YearSelector } from '@/components/YearSelector';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthlyTables } from '@/components/MonthlyTables';
import { SectionIntro } from '@/components/SectionIntro';
import type { DashboardData } from '@/lib/types';

const STORES = [
  { id: 'uzoshop',   label: 'uzoshop' },
  { id: 'zolplus',   label: 'Zol Plus' },
  { id: 'usmile360', label: '360usmile' },
] as const;

type Props = {
  stores: DashboardData['stores'];
  /** Legacy — kept so Dashboard.tsx call-site doesn't need to change. Unused. */
  globalStore?: string;
};

function StorePanel({
  storeName,
  stores,
}: {
  storeName: string;
  stores: DashboardData['stores'];
}) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-ink-muted">שנה:</span>
          <YearSelector value={year} onChange={setYear} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-ink-muted">חודש:</span>
          <MonthSelector value={month} onChange={setMonth} />
        </div>
      </div>
      <div className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
        <MonthlyTables
          stores={stores}
          globalStore={storeName}
          year={year}
          month={month}
          bare
        />
      </div>
    </div>
  );
}

export function AnalysisArchiveTab({ stores }: Props) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טבלאות חודשיות"
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <Tabs.Root defaultValue={STORES[0].id} className="flex flex-col gap-4">
        <Tabs.List className="flex gap-2 border-b border-line-subtle">
          {STORES.map(s => (
            <Tabs.Trigger
              key={s.id}
              value={s.id}
              className="px-3 py-2 text-sm data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-accent"
            >
              {s.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {STORES.map(s => (
          <Tabs.Content key={s.id} value={s.id}>
            <StorePanel storeName={s.id} stores={stores} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}
