'use client';

import { CalendarDays } from 'lucide-react';
import { MonthlyTables } from '@/components/MonthlyTables';
import { SectionIntro } from '@/components/SectionIntro';
import type { DashboardData } from '@/lib/types';

type Props = {
  stores: DashboardData['stores'];
  globalStore: string;
};

export function AnalysisArchiveTab({ stores, globalStore }: Props) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טבלאות חודשיות"
        description="טבלה לכל חודש עם שורה לכל יום, עד 17 חודשים אחורה. ROAS צבוע: אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3). יום עם הוצאה אך ללא מכירה מסומן בשחור עם '0'."
      />
      <div className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
        <MonthlyTables stores={stores} globalStore={globalStore} bare />
      </div>
    </div>
  );
}
