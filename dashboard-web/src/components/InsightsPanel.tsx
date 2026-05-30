'use client';

import { Trophy, AlertTriangle, Calendar } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { DailyRow } from '@/lib/types';
import type { StoreAgg } from '@/lib/analytics';
import { InsightCard } from '@/components/ui/InsightCard';

type Props = {
  storeAggs: StoreAgg[];
  rows: DailyRow[];
};

export function InsightsPanel({ storeAggs, rows }: Props) {
  // Top store by ROAS
  const top = storeAggs[0];
  // Bottom store by ROAS (lowest non-zero)
  const bottomList = [...storeAggs].filter(s => s.roas > 0).sort((a, b) => a.roas - b.roas);
  const bottom = bottomList[0];

  // Best day by overall ROAS (across stores, weighted)
  const byDate = new Map<string, { revenue: number; spend: number }>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { revenue: 0, spend: 0 });
    const e = byDate.get(r.date)!;
    e.revenue += r.revenue;
    e.spend += r.totalSpend;
  }
  let bestDate: string | null = null;
  let bestRoas = 0;
  let bestRevenue = 0;
  for (const [date, agg] of byDate) {
    if (!agg.spend) continue;
    const roas = agg.revenue / agg.spend;
    if (roas > bestRoas) {
      bestRoas = roas;
      bestDate = date;
      bestRevenue = agg.revenue;
    }
  }

  if (!storeAggs.length) return null;

  return (
    <section>
      <InsightCard tone="info" title="תובנות מהירות">
        <div className="divide-y divide-status-blue/20 -mx-4 -mb-2">
          {top && (
            <InsightRow
              icon={<Trophy className="text-status-warning" size={20} />}
              primary={`חנות מובילה: ${top.store}`}
              secondary={`ROAS ${formatNumber(top.roas)}  •  הכנסות CAD ${formatCurrency(top.revenue)}`}
            />
          )}
          {bottom && bottom.store !== top?.store && (
            <InsightRow
              icon={<AlertTriangle className="text-status-red" size={20} />}
              primary={`דורש תשומת לב: ${bottom.store}`}
              secondary={`ROAS ${formatNumber(bottom.roas)}`}
            />
          )}
          {bestDate && (
            <InsightRow
              icon={<Calendar className="text-accent" size={20} />}
              primary={`יום הכי טוב בתקופה: ${formatDate(bestDate)}`}
              secondary={`ROAS ${formatNumber(bestRoas)}  •  הכנסות CAD ${formatCurrency(bestRevenue)}`}
            />
          )}
        </div>
      </InsightCard>
    </section>
  );
}

function InsightRow({
  icon,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-semibold text-ink')}>{primary}</div>
        <div className="text-xs text-ink-secondary mt-0.5">{secondary}</div>
      </div>
    </div>
  );
}
