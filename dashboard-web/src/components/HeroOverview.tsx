'use client';

import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DashboardData, Filters as F } from '@/lib/types';
import { aggregate, dailySeries, filterRows, roasLabel } from '@/lib/analytics';
import { previousRange } from '@/lib/presets';
import { cn } from '@/lib/utils';
import {
  fmtCount,
  fmtDateShort,
  fmtDeltaPct,
  fmtMoneyBare,
  fmtNum2,
} from '@/lib/format';

/**
 * Hero block for the Home tab. Inspired by Robinhood (chart-as-background),
 * Stripe ("editorial sentence" summary), and Apple Health (algorithm picks
 * the lead story). The metric tile chrome is gone — KPIs float on a soft
 * chart canvas so the user reads "the story" before any specific number.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Eyebrow:  טווח: 1.5 – 16.5 · 16 ימים                              │
 *   │ ★ Editorial sentence ★                                            │
 *   │                                                                   │
 *   │  CAD 142,318     ROAS 2.85    CAD 49,830    CAD 13,200            │
 *   │  הכנסות           [chip]      הוצאות         רווח נטו              │
 *   │  +12.4%          +0.18        −4.2%         +18.0%                │
 *   │                                                                   │
 *   │ ╱╲    ▁ ▂ ▃ ▄ ▅ ▆ ▇  (area chart, soft, sits at the bottom)        │
 *   └──────────────────────────────────────────────────────────────────┘
 */

type Props = {
  data: DashboardData;
  filters: F;
};

const TONE_CHIP: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

export function HeroOverview({ data, filters }: Props) {
  const { story, kpis, chartData } = useMemo(() => {
    const cur = filterRows(data.rows, filters.range, filters.store);
    const prev = filterRows(data.rows, previousRange(filters.range), filters.store);
    const curAgg = aggregate(cur);
    const prevAgg = aggregate(prev);
    const stores = filters.store === 'All' ? data.stores : [filters.store];
    const series = dailySeries(cur, stores);

    // Build chart data: total daily revenue across visible stores so the
    // background curve reflects the same scope as the KPIs above it.
    const chartData = series.map(d => ({
      date: d.date,
      revenue: d.totalRevenue,
      spend: d.totalSpend,
      roas: d.totalRoas,
    }));

    // Editorial sentence — picks the most important delta and writes one
    // sentence. Quiet when nothing moved meaningfully.
    const dRev = prevAgg.revenue > 0 ? (curAgg.revenue - prevAgg.revenue) / prevAgg.revenue : 0;
    const dRoas = prevAgg.roas > 0 ? curAgg.roas - prevAgg.roas : 0;
    const dNet = prevAgg.netProfit !== 0
      ? (curAgg.netProfit - prevAgg.netProfit) / Math.abs(prevAgg.netProfit)
      : 0;
    let story: string;
    if (curAgg.spend === 0 && curAgg.revenue === 0) {
      story = 'אין עדיין נתונים לטווח הזה.';
    } else if (Math.abs(dRev) >= 0.05) {
      const verb = dRev > 0 ? 'עלו' : 'ירדו';
      story = `הכנסות ${verb} ב-${Math.abs(dRev * 100).toFixed(0)}% מהתקופה הקודמת, ROAS ${curAgg.roas >= 2.7 ? 'בריא' : curAgg.roas >= 2 ? 'סביר' : 'דורש בחינה'} על ${curAgg.roas.toFixed(2)}.`;
    } else if (Math.abs(dRoas) >= 0.2) {
      const verb = dRoas > 0 ? 'השתפר' : 'נחלש';
      story = `ROAS ${verb} ב-${Math.abs(dRoas).toFixed(2)} נקודות, מ-${prevAgg.roas.toFixed(2)} ל-${curAgg.roas.toFixed(2)}.`;
    } else if (Math.abs(dNet) >= 0.1) {
      const verb = dNet > 0 ? 'עלה' : 'ירד';
      story = `רווח נטו ${verb} ב-${Math.abs(dNet * 100).toFixed(0)}%, ROAS יציב על ${curAgg.roas.toFixed(2)}.`;
    } else {
      story = `הביצועים יציבים. ROAS ${curAgg.roas.toFixed(2)}, רווח נטו של ${curAgg.netProfit >= 0 ? '' : 'מינוס '}CAD ${Math.abs(Math.round(curAgg.netProfit)).toLocaleString('he-IL')}.`;
    }

    const kpis = {
      curAgg,
      prevAgg,
      dRev,
      dRoas,
      dSpend: prevAgg.spend > 0 ? (curAgg.spend - prevAgg.spend) / prevAgg.spend : 0,
      dNet,
    };

    return { story, kpis, chartData };
  }, [data, filters]);

  const daysInRange =
    Math.round(
      (new Date(filters.range.to + 'T00:00:00Z').getTime() -
        new Date(filters.range.from + 'T00:00:00Z').getTime()) /
        86400000,
    ) + 1;

  const roasInfo = roasLabel(kpis.curAgg.roas);
  const storeLabel = filters.store === 'All' ? 'כל החנויות' : filters.store;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-br from-primary-dark via-primary to-primary-light text-white',
        'shadow-elevated',
      )}
      style={{
        backgroundImage:
          'linear-gradient(135deg, #091c4a 0%, #0d3680 55%, #1d4ed8 105%)',
      }}
    >
      {/* Decorative dot grid + side glow */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div
        aria-hidden
        className="absolute top-0 right-0 w-72 h-72 -translate-y-1/2 translate-x-1/3 rounded-full bg-cyan-300/15 blur-3xl pointer-events-none"
      />

      {/* Background chart — locked to the bottom half of the hero, very soft */}
      {chartData.length > 1 && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[55%] opacity-50 pointer-events-none"
          dir="ltr"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="hero-revenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#a5d4ff" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#a5d4ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, 'auto']} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#cfe6ff"
                strokeWidth={2}
                fill="url(#hero-revenue)"
                isAnimationActive
                animationDuration={600}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Content */}
      <div className="relative p-5 sm:p-7 md:p-9">
        {/* Eyebrow row */}
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs uppercase tracking-[0.14em] text-white/65 mb-3 sm:mb-4">
          <span className="font-semibold text-white">{storeLabel}</span>
          <span className="text-white/40">·</span>
          <span className="tabular-nums">
            {fmtDateShort(filters.range.from)} — {fmtDateShort(filters.range.to)}
          </span>
          <span className="text-white/40">·</span>
          <span className="tabular-nums">{daysInRange} ימים</span>
        </div>

        {/* Editorial story line — the centerpiece */}
        <h2
          className="text-lg sm:text-2xl md:text-[1.75rem] font-light leading-snug tracking-tight text-white max-w-3xl mb-6 sm:mb-8"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          {story}
        </h2>

        {/* Floating KPI strip — no card chrome, just hairline dividers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 sm:gap-x-8 gap-y-5 sm:gap-y-6">
          <FloatingKpi
            label="הכנסות"
            value={fmtMoneyBare(kpis.curAgg.revenue)}
            valuePrefix="CAD"
            delta={kpis.dRev}
          />
          <div className="lg:border-r lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="ROAS"
              value={fmtNum2(kpis.curAgg.roas)}
              chip={{ text: roasInfo.text, tone: roasInfo.tone }}
              delta={null}
              rawDelta={kpis.dRoas}
            />
          </div>
          <div className="lg:border-r lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="הוצאות פרסום"
              value={fmtMoneyBare(kpis.curAgg.spend)}
              valuePrefix="CAD"
              delta={kpis.dSpend}
              inverseDelta
            />
          </div>
          <div className="lg:border-r lg:border-white/12 lg:ps-7">
            <FloatingKpi
              label="רווח נטו"
              value={fmtMoneyBare(kpis.curAgg.netProfit)}
              valuePrefix="CAD"
              delta={kpis.dNet}
              accent={kpis.curAgg.netProfit >= 0 ? 'positive' : 'negative'}
            />
          </div>
        </div>

        {/* Bottom row: orders + units + product count (mini context) */}
        <div className="mt-5 sm:mt-7 pt-4 sm:pt-5 border-t border-white/12 flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-2 text-[11px] sm:text-xs text-white/70 tabular-nums">
          <ContextStat label="ROAS לתקופה הקודמת" value={fmtNum2(kpis.prevAgg.roas)} />
          <ContextStat label="הכנסות שכבר נצברו" value={<>CAD {fmtMoneyBare(kpis.curAgg.revenue)}</>} />
          <ContextStat label="ימי פעילות" value={fmtCount(daysInRange)} />
        </div>
      </div>
    </section>
  );
}

function FloatingKpi({
  label,
  value,
  valuePrefix,
  delta,
  rawDelta,
  chip,
  accent,
  inverseDelta = false,
}: {
  label: string;
  value: React.ReactNode;
  valuePrefix?: string;
  /** Pass null when there's no percentage delta (e.g. ROAS uses points diff). */
  delta: number | null;
  rawDelta?: number; // signed absolute value (used for ROAS-style deltas)
  chip?: { text: string; tone: string };
  accent?: 'positive' | 'negative';
  inverseDelta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] sm:text-xs uppercase tracking-[0.12em] font-semibold text-white/65">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5 sm:gap-2">
        {valuePrefix && (
          <span className="text-[10px] sm:text-xs text-white/55 font-medium">{valuePrefix}</span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none',
            'text-[1.5rem] sm:text-[2rem] md:text-[2.25rem]',
            accent === 'negative' ? 'text-orange-200' : 'text-white',
          )}
        >
          {value}
        </span>
      </div>
      {chip && (
        <span
          className={cn(
            'inline-flex w-fit items-center mt-1 px-1.5 py-0.5 text-[10px] font-semibold rounded',
            TONE_CHIP[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}
      {delta !== null && (
        <DeltaPill value={delta} inverse={inverseDelta} />
      )}
      {delta === null && rawDelta !== undefined && (
        <RawDeltaPill value={rawDelta} />
      )}
    </div>
  );
}

function DeltaPill({ value, inverse }: { value: number; inverse?: boolean }) {
  // Reserved-red rule: "down" in metrics that should grow (revenue, ROAS, net
  // profit) is shown in a muted *amber* not red — because it's information,
  // not yet an actionable failure. Red is reserved for things broken.
  // For "spend" (inverse), a down delta is *good*, so it gets the positive
  // treatment.
  const isFlat = Math.abs(value) < 0.005;
  const dirIsUp = value > 0;
  const isPositive = inverse ? !dirIsUp : dirIsUp;
  const Icon = isFlat ? Minus : dirIsUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium tabular-nums',
        isFlat && 'text-white/55',
        !isFlat && isPositive && 'text-emerald-300',
        !isFlat && !isPositive && 'text-amber-200',
      )}
    >
      <Icon size={11} className="shrink-0" />
      {isFlat ? <span>ללא שינוי</span> : <>{fmtDeltaPct(value)} <span className="text-white/45">מהקודמת</span></>}
    </span>
  );
}

function RawDeltaPill({ value }: { value: number }) {
  // For ROAS: show as absolute points change ("+0.42 נק׳").
  const isFlat = Math.abs(value) < 0.01;
  const Icon = isFlat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium tabular-nums',
        isFlat && 'text-white/55',
        !isFlat && value > 0 && 'text-emerald-300',
        !isFlat && value < 0 && 'text-amber-200',
      )}
    >
      <Icon size={11} className="shrink-0" />
      {isFlat
        ? <span>יציב</span>
        : <><bdi dir="ltr">{value > 0 ? '+' : '−'}{Math.abs(value).toFixed(2)}</bdi> <span className="text-white/45">נק׳</span></>
      }
    </span>
  );
}

function ContextStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-white/55">{label}</span>
      <span className="font-semibold text-white/90 tabular-nums">{value}</span>
    </span>
  );
}
