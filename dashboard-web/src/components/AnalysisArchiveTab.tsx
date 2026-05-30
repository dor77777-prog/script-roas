'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { MonthlyTables } from '@/components/MonthlyTables';
import { YearSelector } from '@/components/YearSelector';
import { SectionIntro } from '@/components/SectionIntro';
import type { DashboardData } from '@/lib/types';

type Props = {
  stores: DashboardData['stores'];
  globalStore: string;
};

export function AnalysisArchiveTab({ stores, globalStore }: Props) {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טבלאות חודשיות"
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <YearSelector value={year} onChange={setYear} />
      <div className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
        <MonthlyTables stores={stores} globalStore={globalStore} year={year} bare />
      </div>
    </div>
  );
}
