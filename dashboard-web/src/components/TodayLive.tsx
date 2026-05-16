'use client';

import { useEffect, useState } from 'react';
import { Radio, TrendingUp, DollarSign, ShoppingCart, Target } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { aggregate, aggregateByStore, roasLabel } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

// Per-store accent dot. Kept saturated since it's a tiny element.
const STORE_COLORS: Record<string, string> = {
  uzoshop:     '#1e3a8a',
  'Zol Plus':  '#dc2626',
  '360usmile': '#15803d',
};

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function nowInIsrael(): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date());
}

export function TodayLive({
  rows,
  fxIlsToCad,
}: {
  rows: DailyRow[];
  fxIlsToCad: number | null;
}) {
  const [now, setNow] = useState(nowInIsrael());
  useEffect(() => {
    const t = setInterval(() => setNow(nowInIsrael()), 30_000);
    return () => clearInterval(t);
  }, []);

  const today = todayInIsrael();
  const todayRows = rows.filter(r => r.date === today);
  const agg = aggregate(todayRows);
  const storeAggs = aggregateByStore(todayRows);
  const roas = roasLabel(agg.roas);
  const hasAnyData = agg.revenue > 0 || agg.spend > 0;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-roas-green/30',
        'bg-gradient-to-br from-roas-greenBg/50 via-surface to-surface',
        'shadow-card animate-fade-in',
      )}
    >
      {/* Decorative top-right pulse (very subtle). */}
      <div
        aria-hidden
        className="absolute top-0 left-0 w-48 h-48 -translate-x-1/4 -translate-y-1/4 rounded-full bg-roas-green/10 blur-3xl pointer-events-none"
      />

      <div className="relative p-4 sm:p-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-roas-green opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-roas-green" />
            </span>
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-text-primary truncate">
              <Radio size={16} className="text-roas-green shrink-0" />
              היום — חי
            </h2>
            <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-roas-green text-white shrink-0">
              LIVE
            </span>
          </div>
          <div className="text-[10px] sm:text-xs text-text-secondary text-left tabular-nums shrink-0">
            <div className="font-medium">{today}</div>
            <div className="text-text-muted">עודכן {now}</div>
          </div>
        </header>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <LiveStat
            icon={<Target size={13} />}
            label="ROAS עד עכשיו"
            value={hasAnyData ? formatNumber(agg.roas) : '—'}
            badge={hasAnyData ? roas.text : 'אין נתונים'}
            badgeClass={TONE_BG[roas.tone]}
          />
          <LiveStat
            icon={<DollarSign size={13} />}
            label="הכנסות (היום)"
            value={formatCurrency(agg.revenue)}
            valuePrefix="CAD"
          />
          <LiveStat
            icon={<ShoppingCart size={13} />}
            label="הוצאות (היום)"
            value={formatCurrency(agg.spend)}
            valuePrefix="CAD"
          />
          <LiveStat
            icon={<TrendingUp size={13} />}
            label="רווח גולמי (היום)"
            value={formatCurrency(agg.grossProfit)}
            valuePrefix="CAD"
            accent={agg.grossProfit >= 0 ? 'pos' : 'neg'}
          />
        </div>

        {/* Per-store breakdown */}
        {storeAggs.length > 0 && hasAnyData && (
          <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            {storeAggs.map(s => {
              const color = STORE_COLORS[s.store] || '#0d3680';
              const info = roasLabel(s.roas);
              const hasGoogle = s.gaSpend > 0;
              return (
                <div
                  key={s.store}
                  className="rounded-xl bg-surface/90 backdrop-blur-sm border border-borderSubtle p-3 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ background: color }}
                      />
                      <span className="text-xs sm:text-sm font-semibold text-text-primary truncate">
                        {s.store}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 text-[10px] font-bold rounded tabular-nums shrink-0',
                        TONE_BG[info.tone],
                      )}
                    >
                      {s.roas > 0 ? formatNumber(s.roas) : '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] tabular-nums">
                    <Mini label="הכנסה" value={formatCurrency(s.revenue)} accent="green" />
                    <Mini label="סך הוצאה" value={formatCurrency(s.spend)} />
                    <Mini label="Meta" value={formatCurrency(s.fbSpend)} muted />
                    <Mini
                      label="Google"
                      value={hasGoogle ? formatCurrency(s.gaSpend) : '—'}
                      muted
                    />
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

        {/* Footer — FX + currencies */}
        <div className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-roas-green/15 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-xs text-text-muted">
          {fxIlsToCad !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span>שער המרה:</span>
              <span className="font-medium text-text-secondary">
                1 ILS = {fxIlsToCad.toFixed(4)} CAD
              </span>
            </span>
          )}
          <span className="text-text-subtle">·</span>
          <span>Meta: ILS</span>
          <span className="text-text-subtle">·</span>
          <span>Google: CAD</span>
          <span className="text-text-subtle">·</span>
          <span>Shopify: CAD</span>
        </div>
        <div className="mt-1.5 text-[10px] sm:text-xs text-text-muted/80 text-center leading-relaxed">
          רענון אוטומטי כל 15 דקות. Shopify ב-real-time;
          Meta/Google עם פיגור של ~20 דק' מצד הפלטפורמה.
        </div>
      </div>
    </section>
  );
}

/**
 * Length-aware sizing for the live stat values. Mirrors the helper in
 * KpiCards.tsx — kept inline here to avoid a shared utility for two callsites.
 */
function liveValueSizeClass(value: string): string {
  const len = value.length;
  if (len <= 4)  return 'text-[1.375rem] sm:text-2xl';
  if (len <= 6)  return 'text-[1.25rem] sm:text-xl';
  if (len <= 8)  return 'text-base sm:text-lg';
  return 'text-sm sm:text-base';
}

function LiveStat({
  icon,
  label,
  value,
  valuePrefix,
  badge,
  badgeClass,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valuePrefix?: string;
  badge?: string;
  badgeClass?: string;
  accent?: 'pos' | 'neg';
}) {
  return (
    <div className="rounded-xl bg-surface border border-borderSubtle p-2.5 sm:p-4 shadow-xs">
      <div className="flex items-center justify-between mb-1 sm:mb-1.5">
        <span className="text-[10px] sm:text-xs font-medium text-text-secondary tracking-wide truncate">
          {label}
        </span>
        <span className="text-text-muted/70 shrink-0">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        {valuePrefix && (
          <span className="text-[10px] sm:text-xs text-text-muted font-medium shrink-0">
            {valuePrefix}
          </span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none whitespace-nowrap',
            liveValueSizeClass(value),
            accent === 'pos' && 'text-roas-green',
            accent === 'neg' && 'text-roas-red',
            !accent && 'text-text-primary',
          )}
        >
          {value}
        </span>
      </div>
      {badge && (
        <span
          className={cn(
            'inline-block mt-1.5 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded',
            badgeClass,
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: 'green';
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-text-muted">{label}</span>
      <span
        className={cn(
          'font-semibold',
          accent === 'green' && 'text-roas-green',
          !accent && !muted && 'text-text-primary',
          muted && 'text-text-secondary',
        )}
      >
        {value}
      </span>
    </div>
  );
}
