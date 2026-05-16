'use client';

import { useEffect, useState } from 'react';
import { Radio, TrendingUp, DollarSign, ShoppingCart, Target } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { aggregate, aggregateByStore, roasLabel } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';

const TONE_BG: Record<string, string> = {
  red: 'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green: 'bg-roas-greenBg text-roas-green',
  blue: 'bg-roas-blueBg text-roas-blue',
  gray: 'bg-surfaceMuted text-text-muted',
};

const STORE_COLORS: Record<string, string> = {
  uzoshop: '#1c4587',
  'Zol Plus': '#ea4335',
  '360usmile': '#34a853',
};

function todayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

function nowInIsrael(): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date());
}

export function TodayLive({ rows }: { rows: DailyRow[] }) {
  const [now, setNow] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNow(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = todayInIsrael();
  const todayRows = rows.filter(r => r.date === today);

  // If no rows exist yet for today, still render the section with zeros — that way
  // the user understands the live feed is wired up but no orders have come in yet.
  const agg = aggregate(todayRows);
  const storeAggs = aggregateByStore(todayRows);
  const roas = roasLabel(agg.roas);
  const hasAnyData = agg.revenue > 0 || agg.spend > 0;

  return (
    <section className="rounded-2xl border-2 border-roas-green/40 bg-gradient-to-br from-roas-greenBg/40 via-surface to-roas-blueBg/30 p-4 sm:p-6 shadow-card">
      <header className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-roas-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-roas-green"></span>
          </span>
          <h2 className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-lg font-bold text-text-primary truncate">
            <Radio size={18} className="text-roas-green shrink-0" />
            היום — חי
          </h2>
          <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-roas-green text-white shrink-0">
            LIVE
          </span>
        </div>
        <div className="text-[10px] sm:text-xs text-text-secondary text-left tabular-nums shrink-0">
          <div className="font-medium">{today}</div>
          <div className="text-text-muted">עודכן {now}</div>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <LiveCard
          icon={<Target size={14} />}
          label="ROAS עד עכשיו"
          value={hasAnyData ? formatNumber(agg.roas) : '—'}
          badge={hasAnyData ? roas.text : 'אין נתונים'}
          badgeClass={TONE_BG[roas.tone]}
        />
        <LiveCard
          icon={<DollarSign size={14} />}
          label="הכנסות (היום)"
          value={`CAD ${formatCurrency(agg.revenue)}`}
        />
        <LiveCard
          icon={<ShoppingCart size={14} />}
          label="הוצאות (היום)"
          value={`CAD ${formatCurrency(agg.spend)}`}
        />
        <LiveCard
          icon={<TrendingUp size={14} />}
          label="רווח גולמי (היום)"
          value={`CAD ${formatCurrency(agg.grossProfit)}`}
          accent={agg.grossProfit >= 0 ? 'pos' : 'neg'}
        />
      </div>

      {storeAggs.length > 0 && hasAnyData && (
        <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          {storeAggs.map((s, i) => {
            const color = STORE_COLORS[s.store] || ['#1c4587', '#ea4335', '#34a853'][i % 3];
            const info = roasLabel(s.roas);
            return (
              <div
                key={s.store}
                className="rounded-lg bg-surface/80 backdrop-blur-sm border border-border/60 p-2.5 sm:p-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span
                    className="text-[11px] sm:text-xs font-semibold truncate"
                    style={{ color }}
                  >
                    🏪 {s.store}
                  </span>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded shrink-0',
                      TONE_BG[info.tone],
                    )}
                  >
                    {s.roas > 0 ? formatNumber(s.roas) : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] sm:text-xs tabular-nums">
                  <div>
                    <div className="text-text-muted">הכנסה</div>
                    <div className="font-semibold text-text-primary">
                      {formatCurrency(s.revenue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">הוצאה</div>
                    <div className="font-semibold text-text-primary">
                      {formatCurrency(s.spend)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!hasAnyData && (
        <div className="mt-3 text-center text-xs text-text-muted">
          עוד אין נתוני היום. הטריגר ה-Live ירוץ אוטומטית כל 15 דקות.
        </div>
      )}

      <div className="mt-3 text-[10px] sm:text-xs text-text-muted/80 leading-relaxed text-center">
        רענון אוטומטי כל 15 דקות. מכירות Shopify ב-real-time;
        Meta/Google מתעדכנים עם פיגור של ~20 דקות (מצד הפלטפורמה).
      </div>
    </section>
  );
}

function LiveCard({
  icon,
  label,
  value,
  badge,
  badgeClass,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: string;
  badgeClass?: string;
  accent?: 'pos' | 'neg';
}) {
  return (
    <div className="rounded-xl bg-surface/90 backdrop-blur-sm border border-border/70 p-2.5 sm:p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1 sm:mb-2">
        <span className="text-[10px] sm:text-xs font-medium text-text-secondary leading-tight">
          {label}
        </span>
        <span className="text-text-muted shrink-0">{icon}</span>
      </div>
      <div
        className={cn(
          'text-lg sm:text-2xl font-bold tabular-nums leading-tight break-words',
          accent === 'pos' && 'text-roas-green',
          accent === 'neg' && 'text-roas-red',
          !accent && 'text-text-primary',
        )}
      >
        {value}
      </div>
      {badge && (
        <span
          className={cn(
            'inline-block mt-1 sm:mt-1.5 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded',
            badgeClass,
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
