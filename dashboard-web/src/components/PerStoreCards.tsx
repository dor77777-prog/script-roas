'use client';

import { Trophy, AlertTriangle } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { roasLabel, type StoreAgg } from '@/lib/analytics';

const STORE_COLORS: Record<string, string> = {
  uzoshop: '#1c4587',
  'Zol Plus': '#ea4335',
  '360usmile': '#34a853',
};

function colorFor(name: string, idx: number) {
  return STORE_COLORS[name] || ['#1c4587', '#ea4335', '#34a853', '#fbbc04', '#9c27b0'][idx % 5];
}

const TONE_BG: Record<string, string> = {
  red: 'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green: 'bg-roas-greenBg text-roas-green',
  blue: 'bg-roas-blueBg text-roas-blue',
  gray: 'bg-surfaceMuted text-text-muted',
};

type Props = {
  data: StoreAgg[];
  /** Wrap output in <section> with a header. False when used inside CollapsibleSection. */
  bare?: boolean;
};

export function PerStoreCards({ data, bare = false }: Props) {
  if (!data.length) return null;

  // Identify top/bottom by ROAS so we can decorate the cards inline.
  // Only mark "top" when there are >= 2 stores with positive ROAS — otherwise
  // a single-store view shouldn't get a "leader" trophy on the only card.
  const withRoas = data.filter(s => s.roas > 0);
  const topStore = withRoas.length >= 2 ? withRoas[0].store : null;
  const sortedAsc = [...withRoas].sort((a, b) => a.roas - b.roas);
  // Mark "needs attention" only if the lowest has ROAS < 2 (red zone).
  const riskyStore = withRoas.length >= 2 && sortedAsc[0].roas < 2 ? sortedAsc[0].store : null;

  const grid = (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4', !bare && 'mt-3')}>
      {data.map((s, i) => (
        <StoreCard
          key={s.store}
          agg={s}
          color={colorFor(s.store, i)}
          isTop={s.store === topStore}
          isRisky={s.store === riskyStore}
        />
      ))}
    </div>
  );

  if (bare) return <div className="p-4 sm:p-5">{grid}</div>;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
        ביצועים לפי חנות
      </h2>
      {grid}
    </section>
  );
}

function StoreCard({
  agg,
  color,
  isTop,
  isRisky,
}: {
  agg: StoreAgg;
  color: string;
  isTop: boolean;
  isRisky: boolean;
}) {
  const info = roasLabel(agg.roas);
  return (
    <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      {/* Color bar header */}
      <div
        className="px-4 sm:px-5 py-2.5 sm:py-3 text-white font-semibold flex items-center justify-between gap-2"
        style={{ background: color }}
      >
        <span className="truncate">🏪 {agg.store}</span>
        {isTop && (
          <span
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold bg-white/20 backdrop-blur-sm px-1.5 py-0.5 rounded"
            title="חנות מובילה ב-ROAS"
          >
            <Trophy size={12} /> מובילה
          </span>
        )}
        {isRisky && !isTop && (
          <span
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold bg-white/20 backdrop-blur-sm px-1.5 py-0.5 rounded"
            title="ROAS נמוך — דורש בחינה"
          >
            <AlertTriangle size={12} /> בחינה
          </span>
        )}
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="text-center">
          <div className="text-3xl sm:text-4xl font-bold text-text-primary tabular-nums">
            {formatNumber(agg.roas)}
          </div>
          <span
            className={cn(
              'inline-block mt-2 px-2.5 py-1 text-xs font-semibold rounded',
              TONE_BG[info.tone],
            )}
          >
            {info.text}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1.5 text-sm pt-2 border-t border-border">
          <Row label="הכנסות" value={`CAD ${formatCurrency(agg.revenue)}`} />
          <Row label="הוצאות" value={`CAD ${formatCurrency(agg.spend)}`} />
          <Row label="רווח גולמי" value={`CAD ${formatCurrency(agg.grossProfit)}`} bold />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-secondary">{label}:</span>
      <span
        className={cn(
          'tabular-nums',
          bold ? 'font-semibold text-text-primary' : 'text-text-primary',
        )}
      >
        {value}
      </span>
    </div>
  );
}
