'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { YearSelector } from '@/components/YearSelector';
import { MonthSelector } from '@/components/MonthSelector';
import { MonthlyTables } from '@/components/MonthlyTables';
import { SectionIntro } from '@/components/SectionIntro';
import type { DashboardData } from '@/lib/types';

type Props = {
  stores: DashboardData['stores'];
  /** Legacy — kept so Dashboard.tsx call-site doesn't need to change. Unused. */
  globalStore?: string;
};

export function AnalysisArchiveTab({ stores }: Props) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);

  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טבלאות חודשיות"
        description="טבלה לכל חודש עם שורה לכל יום. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
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
      <MonthlyTables stores={stores} year={year} month={month} />
    </div>
  );
}
