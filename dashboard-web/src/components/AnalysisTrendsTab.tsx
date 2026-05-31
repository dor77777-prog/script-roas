'use client';

import { TrendingUp, CalendarDays } from 'lucide-react';
import { RoasChart } from '@/components/RoasChart';
import { AnnotationsPanel } from '@/components/AnnotationsPanel';
import { SectionIntro } from '@/components/SectionIntro';
import { Filters } from '@/components/Filters';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { synthesizeTrends } from '@/lib/synthesis/trends';
import type { DashboardData, Filters as F } from '@/lib/types';
import { dailySeries } from '@/lib/analytics';

type Props = {
  data: DashboardData;
  filtered: {
    series: ReturnType<typeof dailySeries>;
    visibleStores: string[];
    cur: DashboardData['rows'];
  };
  filters: F;
  setFilters: (next: F) => void;
};

export function AnalysisTrendsTab({ data, filtered, filters, setFilters }: Props) {
  const trendsSynthesis = synthesizeTrends({ rows: filtered.cur });
  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טווח לניתוח"
        description="הסינון מטה משפיע על גרף המגמה בלבד. הטבלאות החודשיות מציגות עד 17 חודשים אחורה — בלי תלות בטווח שבחרת."
      />
      <PageSynthesis
        text={trendsSynthesis.text}
        anchorMetric={trendsSynthesis.anchorMetric}
        confidence={trendsSynthesis.confidence}
      />
      <Filters filters={filters} stores={data.stores} onChange={setFilters} />

      <SectionIntro
        icon={<TrendingUp size={20} />}
        title="מגמת ROAS לאורך זמן"
        description="קו לכל חנות. הקו האדום-מקווקו מציין את היעד הפנימי שלך — ROAS 3.0. רוצה לראות חנות אחת? סנן למעלה."
      />
      <div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">
        <RoasChart data={filtered.series} stores={filtered.visibleStores} rows={filtered.cur} bare />
      </div>

      <AnnotationsPanel range={filters.range} store={filters.store} />
    </div>
  );
}
