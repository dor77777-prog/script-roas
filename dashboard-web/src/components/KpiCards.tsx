'use client';

import { useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  ShoppingCart,
  Target,
  Package,
  Wallet,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber, formatPct } from '@/lib/utils';
import { roasLabel, type Aggregate, deltaPct, COGS_RATE_OF_REVENUE } from '@/lib/analytics';
import { RollingNumber } from './RollingNumber';
import { Sparkline } from './Sparkline';
import type { DailyRow } from '@/lib/types';

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

/** Length-aware sizing so long numbers don't get truncated. */
function valueSizeClass(value: string): string {
  const len = value.length;
  if (len <= 4) {
    return 'text-[1.75rem] sm:text-[2rem] xl:text-[1.625rem] 2xl:text-[2rem]';
  }
  if (len <= 6) {
    return 'text-[1.5rem] sm:text-[1.75rem] xl:text-[1.375rem] 2xl:text-[1.75rem]';
  }
  if (len <= 8) {
    return 'text-[1.25rem] sm:text-[1.5rem] xl:text-[1.125rem] 2xl:text-[1.5rem]';
  }
  if (len <= 10) {
    return 'text-[1.125rem] sm:text-[1.375rem] xl:text-[1rem] 2xl:text-[1.25rem]';
  }
  return 'text-[1rem] sm:text-[1.125rem] xl:text-[0.875rem] 2xl:text-[1rem]';
}

type Props = {
  current: Aggregate;
  previous: Aggregate;
  /** Daily rows scoped to the same range as `current` — used to build the
   *  bullet sparkline in each card. Optional; without it, sparklines hide. */
  series?: DailyRow[];
};

/** Build a per-day total for a metric across the current rows. */
function dailyTotals(rows: DailyRow[], pick: (r: DailyRow) => number): number[] {
  if (!rows || rows.length === 0) return [];
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + pick(r));
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);
}

/** Per-day ROAS = sum(revenue) / sum(spend) for that day (weighted). */
function dailyRoas(rows: DailyRow[]): number[] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, { rev: number; spend: number }>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { rev: 0, spend: 0 });
    const e = map.get(r.date)!;
    e.rev += r.revenue;
    e.spend += r.totalSpend;
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => (v.spend > 0 ? v.rev / v.spend : 0));
}

export function KpiCards({ current, previous, series }: Props) {
  const roasInfo = roasLabel(current.roas);
  const dRoas   = deltaPct(current.roas,        previous.roas);
  const dRev    = deltaPct(current.revenue,     previous.revenue);
  const dSpend  = deltaPct(current.spend,       previous.spend);
  const dProfit = deltaPct(current.grossProfit, previous.grossProfit);
  const dCogs   = deltaPct(current.cogs,        previous.cogs);
  const dNet    = deltaPct(current.netProfit,   previous.netProfit);

  // Pre-compute the per-day series for each metric once. useMemo because
  // dailyTotals walks the whole rows array per call.
  const sparkData = useMemo(() => {
    if (!series || series.length === 0) {
      return {
        roas: [] as number[],
        revenue: [] as number[],
        spend: [] as number[],
        grossProfit: [] as number[],
        cogs: [] as number[],
        netProfit: [] as number[],
      };
    }
    const revenue = dailyTotals(series, r => r.revenue);
    const spend = dailyTotals(series, r => r.totalSpend);
    const grossProfit = dailyTotals(series, r => r.grossProfit);
    const cogs = dailyTotals(series, r => r.revenue * COGS_RATE_OF_REVENUE);
    const netProfit = revenue.map((rev, i) => rev - (spend[i] ?? 0) - (cogs[i] ?? 0));
    return {
      roas: dailyRoas(series),
      revenue,
      spend,
      grossProfit,
      cogs,
      netProfit,
    };
  }, [series]);

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="ROAS"
        rawValue={current.roas}
        format={n => formatNumber(n)}
        chip={{ text: roasInfo.text, tone: roasInfo.tone }}
        delta={dRoas}
        icon={<Target size={14} />}
        spark={{ values: sparkData.roas, target: 3 }}
      />
      <KpiCard
        label="הכנסות"
        rawValue={current.revenue}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dRev}
        icon={<DollarSign size={14} />}
        spark={{ values: sparkData.revenue }}
      />
      <KpiCard
        label="הוצאות פרסום"
        rawValue={current.spend}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dSpend}
        deltaInverse
        icon={<ShoppingCart size={14} />}
        spark={{ values: sparkData.spend }}
      />
      <KpiCard
        label="רווח גולמי"
        rawValue={current.grossProfit}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dProfit}
        icon={<TrendingUp size={14} />}
        spark={{ values: sparkData.grossProfit }}
      />
      <KpiCard
        label="עלות סחורה"
        labelSuffix="(25%)"
        rawValue={current.cogs}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dCogs}
        deltaInverse
        icon={<Package size={14} />}
        spark={{ values: sparkData.cogs }}
      />
      <KpiCard
        label="רווח נטו"
        rawValue={current.netProfit}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dNet}
        icon={<Wallet size={14} />}
        accent={current.netProfit >= 0 ? 'pos' : 'neg'}
        spark={{ values: sparkData.netProfit }}
      />
    </div>
  );
}

function KpiCard({
  label,
  labelSuffix,
  rawValue,
  format,
  valuePrefix,
  chip,
  delta,
  deltaInverse = false,
  icon,
  accent,
  spark,
}: {
  label: string;
  labelSuffix?: string;
  rawValue: number;
  format: (n: number) => string;
  valuePrefix?: string;
  chip?: { text: string; tone: string };
  delta: ReturnType<typeof deltaPct>;
  deltaInverse?: boolean;
  icon?: React.ReactNode;
  accent?: 'pos' | 'neg';
  spark?: { values: number[]; target?: number };
}) {
  const isGood = deltaInverse ? delta.direction === 'down' : delta.direction === 'up';
  const isBad  = deltaInverse ? delta.direction === 'up'   : delta.direction === 'down';

  // Format the *final* (settled) value for sizing, so the card layout doesn't
  // jump mid-animation. Animation tweens the displayed digits only.
  const settledValueString = format(rawValue);

  // Sparkline color follows the card's tone: red for "bad" trend, green for
  // "good" trend, primary for neutral.
  const sparkColor =
    accent === 'pos' ? 'rgb(21, 128, 61)' // roas-green
    : accent === 'neg' ? 'rgb(220, 38, 38)' // roas-red
    : 'rgb(13, 54, 128)'; // primary

  return (
    <div
      className={cn(
        'group relative rounded-xl bg-surface border border-borderSubtle p-3.5 sm:p-5',
        'shadow-card hover:shadow-cardHover hover:border-border',
        'transition-all duration-DEFAULT ease-out',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-text-muted shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            {icon}
          </span>
          <span className="text-[11px] sm:text-xs font-medium text-text-secondary tracking-wide truncate">
            {label}
            {labelSuffix && (
              <span className="text-text-muted font-normal ml-1">{labelSuffix}</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mb-2 sm:mb-2.5 min-w-0">
        {valuePrefix && (
          <span className="text-[11px] sm:text-xs font-medium text-text-muted shrink-0">
            {valuePrefix}
          </span>
        )}
        <RollingNumber
          value={rawValue}
          format={format}
          className={cn(
            'font-light tracking-tight leading-none whitespace-nowrap',
            valueSizeClass(settledValueString),
            accent === 'pos' && 'text-roas-green',
            accent === 'neg' && 'text-roas-red',
            !accent && 'text-text-primary',
          )}
        />
      </div>

      {chip && (
        <span
          className={cn(
            'inline-flex items-center mt-0.5 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold rounded-md',
            TONE_BG[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div
          className={cn(
            'flex items-center gap-1 text-[10px] sm:text-[11px] font-medium',
            delta.direction === 'flat' && 'text-text-muted',
            isGood && 'text-roas-green',
            isBad  && 'text-amber-600',
          )}
        >
          {delta.direction === 'up'   && <TrendingUp   size={11} className="shrink-0" />}
          {delta.direction === 'down' && <TrendingDown size={11} className="shrink-0" />}
          {delta.direction === 'flat' && <Minus        size={11} className="shrink-0" />}
          <span className="tabular-nums">
            {delta.direction === 'flat'
              ? 'ללא שינוי'
              : `${formatPct(delta.value, true)}`}
          </span>
        </div>
        {spark && spark.values.length >= 2 && (
          <div
            style={{ color: sparkColor }}
            className="opacity-70 group-hover:opacity-100 transition-opacity"
            dir="ltr"
          >
            <Sparkline
              values={spark.values}
              target={spark.target}
              width={80}
              height={22}
              filled
              showEndpoint
            />
          </div>
        )}
      </div>
    </div>
  );
}
