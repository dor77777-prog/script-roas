'use client';

import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { roasLabel, type StoreAgg } from '@/lib/analytics';
import { Store } from 'lucide-react';

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

export function PerStoreCards({ data }: { data: StoreAgg[] }) {
  if (!data.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
        <Store size={18} className="text-text-secondary" />
        ביצועים לפי חנות
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((s, i) => (
          <StoreCard key={s.store} agg={s} color={colorFor(s.store, i)} />
        ))}
      </div>
    </section>
  );
}

function StoreCard({ agg, color }: { agg: StoreAgg; color: string }) {
  const info = roasLabel(agg.roas);
  return (
    <div className="rounded-xl bg-surface border border-border shadow-card overflow-hidden">
      {/* Color bar header */}
      <div className="px-5 py-3 text-white font-semibold" style={{ background: color }}>
        🏪 {agg.store}
      </div>
      <div className="p-5 space-y-3">
        <div className="text-center">
          <div className="text-4xl font-bold text-text-primary tabular-nums">{formatNumber(agg.roas)}</div>
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
      <span className={cn('tabular-nums', bold ? 'font-semibold text-text-primary' : 'text-text-primary')}>
        {value}
      </span>
    </div>
  );
}
