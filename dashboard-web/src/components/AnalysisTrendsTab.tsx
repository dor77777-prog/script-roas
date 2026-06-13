'use client';

import { useMemo } from 'react';
import { TrendingUp, CalendarDays } from 'lucide-react';
import { RoasChart } from '@/components/RoasChart';
import { AnnotationsPanel } from '@/components/AnnotationsPanel';
import { SectionIntro } from '@/components/SectionIntro';
import { Card } from '@/components/ui/Card';
import { Filters } from '@/components/Filters';
import { PageScope } from '@/components/ui/PageScope';
import { PageSynthesis } from '@/components/ui/PageSynthesis';
import { rangeLabelHebrew } from '@/lib/presets';
import { synthesizeTrends } from '@/lib/synthesis/trends';
import type { DashboardData, Filters as F } from '@/lib/types';
import { dailySeries } from '@/lib/analytics';
import { useStores } from '@/lib/useStores';
import { buildStoreBrandColorMap } from '@/lib/storeColors';

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
  // Self-serve stores Phase 6a — per-store ROAS lines prefer each store's
  // operator-chosen brand_color. useStores() falls back to the hardcoded 3
  // (backfilled brand_color === canonical token) so the 3 lines stay
  // byte-identical; a self-serve store's line draws in its chosen color.
  const { stores: storeList } = useStores();
  const brandColorByName = useMemo(
    () => buildStoreBrandColorMap(storeList),
    [storeList],
  );
  // Derive the archive-depth pointer from the data actually loaded instead of a
  // hardcoded "17" literal (which could silently drift from the real history).
  // We count the DISTINCT calendar months (YYYY-MM) present across every row so
  // the "עד N חודשים אחורה" copy always reflects the months that exist.
  const monthsBack = useMemo(() => {
    const months = new Set<string>();
    for (const r of data.rows) months.add(r.date.slice(0, 7)); // YYYY-MM
    return months.size;
  }, [data.rows]);
  return (
    // animate-fade-in-up restores the mount transition the Radix TabsContent
    // used to provide (now that this is a top-level tab) and matches the other
    // top-level tabs (HomeTab / PnLTab).
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<CalendarDays size={20} />}
        title="טווח לניתוח"
        description={`הסינון מטה משפיע על גרף המגמה והאנוטציות בלבד. הטבלאות החודשיות (${
          monthsBack === 1 ? 'חודש אחד אחורה' : `עד ${monthsBack} חודשים אחורה`
        }) נמצאות בטאב 'ארכיון' הנפרד.`}
      />
      <PageScope
        store={filters.store === 'All' ? 'כל החנויות' : filters.store}
        rangeLabel={rangeLabelHebrew(filters.preset, filters.range)}
        currency="CAD"
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
      {/* The bare <RoasChart> supplies its own p-3 sm:p-5 inset, so the Card
          chassis drops its default p-5 (!p-0) to avoid double padding. */}
      <Card className="!p-0 overflow-hidden">
        <RoasChart
          data={filtered.series}
          stores={filtered.visibleStores}
          rows={filtered.cur}
          range={filters.range}
          store={filters.store}
          brandColorByName={brandColorByName}
          bare
        />
      </Card>

      <AnnotationsPanel range={filters.range} store={filters.store} />
    </div>
  );
}
