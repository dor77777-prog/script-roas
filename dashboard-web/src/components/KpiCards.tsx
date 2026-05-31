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
import { roasLabel, type Aggregate, deltaPct, getCogsRateForStore } from '@/lib/analytics';
import { RollingNumber } from './RollingNumber';
import { Sparkline } from './Sparkline';
import { MetricHelp, METRIC_HELP, type MetricHelpContent } from './MetricHelp';
import { Card } from '@/components/ui/Card';
import type { DailyRow } from '@/lib/types';

const TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-glass-2 text-ink-muted',
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
export function dailyTotals(rows: DailyRow[], pick: (r: DailyRow) => number): number[] {
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
export function dailyRoas(rows: DailyRow[]): number[] {
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

/**
 * Per-card sparkline series. Pure function — exported so the regression
 * tests can pin its shape without rendering JSX (vitest runs node).
 *
 * Audit fix 2026-05-23 (CRIT-4 / O2-CR-03): NO `netProfit` field. The
 * previous implementation built it as `revenue - spend - cogs(global 25%)`
 * per day, while the big-number on the same card displayed
 * `current.trueNetProfit` which also subtracts transaction fees AND
 * prorated fixed costs. The two shapes never matched — a card could show
 * a $400/day net while the sparkline implied $600/day. Codex's preferred
 * fix: drop the sparkline rather than fake a daily allocation of fees +
 * fixed costs that billing.ts doesn't currently prorate per day.
 */
export function computeKpiSparkData(series: DailyRow[]): {
  roas: number[];
  revenue: number[];
  spend: number[];
  grossProfit: number[];
  cogs: number[];
} {
  if (!series || series.length === 0) {
    return {
      roas: [],
      revenue: [],
      spend: [],
      grossProfit: [],
      cogs: [],
    };
  }
  return {
    roas: dailyRoas(series),
    revenue: dailyTotals(series, r => r.revenue),
    spend: dailyTotals(series, r => r.totalSpend),
    grossProfit: dailyTotals(series, r => r.grossProfit),
    // Audit fix 2026-05-23 (HIGH-7 / O2-HI-04): use the row's `r.cogs`
    // (the cron-writer's value at the per-store ${STORE}_COGS_RATE), with
    // a legacy-row fallback that matches `aggregate()` in analytics.ts.
    // Before this fix the sparkline multiplied `r.revenue * 0.25` flat —
    // a $1000-rev day at a store with a calibrated 18% COGS rate showed
    // $250 on the sparkline while the big-number's $180 reflected the
    // actual rate, breaking the card's internal consistency.
    cogs: dailyTotals(series, r =>
      r.hasCogs ? r.cogs : r.revenue * getCogsRateForStore(r.storeId),
    ),
  };
}

export function KpiCards({ current, previous, series }: Props) {
  const roasInfo = roasLabel(current.roas);
  const dRoas   = deltaPct(current.roas,        previous.roas);
  const dRev    = deltaPct(current.revenue,     previous.revenue);
  const dSpend  = deltaPct(current.spend,       previous.spend);
  const dProfit = deltaPct(current.grossProfit, previous.grossProfit);
  const dCogs   = deltaPct(current.cogs,        previous.cogs);
  const dNet    = deltaPct(current.netProfit,   previous.netProfit);
  const dTrueNet = deltaPct(current.trueNetProfit, previous.trueNetProfit);
  // Silence unused-variable warning when `dNet` (the legacy partial-net delta)
  // isn't surfaced in any card. Keeping the computation in case we want a
  // "before fixed costs" comparison later.
  void dNet;

  // Audit fix 2026-05-23 (CRIT-4): delegated to the pure
  // `computeKpiSparkData` helper exported above. The helper no longer
  // emits `netProfit` — see its docstring.
  const sparkData = useMemo(() => computeKpiSparkData(series ?? []), [series]);

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="ROAS"
        help={METRIC_HELP.roas}
        rawValue={current.roas}
        format={n => formatNumber(n)}
        chip={{ text: roasInfo.text, tone: roasInfo.tone }}
        delta={dRoas}
        icon={<Target size={14} />}
        spark={{ values: sparkData.roas, target: 3 }}
      />
      <KpiCard
        label="הכנסות"
        help={METRIC_HELP.revenue}
        rawValue={current.revenue}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dRev}
        icon={<DollarSign size={14} />}
        spark={{ values: sparkData.revenue }}
      />
      <KpiCard
        label="הוצאות פרסום"
        help={METRIC_HELP.spend}
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
        help={METRIC_HELP.grossProfit}
        rawValue={current.grossProfit}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dProfit}
        icon={<TrendingUp size={14} />}
        spark={{ values: sparkData.grossProfit }}
      />
      <KpiCard
        // Audit fix 2026-05-23 (Codex-NEW-1): dropped the hardcoded
        // `labelSuffix="(25%)"`. Live rows can use a per-store
        // ${STORE_UPPERCASE}_COGS_RATE that differs from 25% (e.g.,
        // usmile360 at 18%), and a multi-store aggregate's effective
        // rate is a revenue-weighted blend. The big-number itself is
        // correct from `aggregate()`; only the label lied — and
        // operator trust in the card suffered for it. The MetricHelp
        // popover already explains the formula in plain language.
        label="עלות סחורה"
        help={METRIC_HELP.cogs}
        rawValue={current.cogs}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dCogs}
        deltaInverse
        icon={<Package size={14} />}
        spark={{ values: sparkData.cogs }}
      />
      <KpiCard
        // Audit fix 2026-05-23 (CRIT-4 / O2-CR-03): no `spark` prop. The
        // previous sparkline plotted `revenue - spend - cogs` per day
        // while the big-number renders `trueNetProfit` which subtracts
        // transaction fees AND prorated fixed costs too — the shapes
        // disagreed. Showing a wrong sparkline is worse than no sparkline;
        // a faithful series would require per-day fee + fixed-cost
        // proration in billing.ts (out of scope here). Big-number stays;
        // sparkline removed.
        label="רווח נטו"
        help={METRIC_HELP.netProfit}
        rawValue={current.trueNetProfit}
        format={n => formatCurrency(n)}
        valuePrefix="CAD"
        delta={dTrueNet}
        icon={<Wallet size={14} />}
        accent={current.trueNetProfit >= 0 ? 'pos' : 'neg'}
      />
    </div>
  );
}

function KpiCard({
  label,
  labelSuffix,
  help,
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
  /** When provided, an inline "?" affordance is rendered next to the label
   *  that opens a popover on hover/focus/click with definition + formula. */
  help?: MetricHelpContent;
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
  // "good" trend, accent (dashboard primary) for neutral. All three resolve
  // through theme-aware CSS vars so the sparkline brightens in dark mode
  // without per-mode plumbing. Sparkline reads `color` via currentColor;
  // the parent div sets `style.color = sparkColor`, so the var resolution
  // cascades naturally.
  const sparkColor =
    accent === 'pos' ? 'var(--status-green)'
    : accent === 'neg' ? 'var(--status-red)'
    : 'var(--accent)';

  return (
    <Card
      className={cn(
        // `group` lets descendant `group-hover:*` utilities target this
        // card; the override `!p-3.5 sm:!p-5` replaces the Card primitive's
        // default `p-5` with the original responsive sizing.
        'group !p-3.5 sm:!p-5',
        'hover:border-glass-edge-hot',
        'transition-all duration-DEFAULT ease-out',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-ink-muted shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            {icon}
          </span>
          <span className="text-[11px] sm:text-xs font-medium text-ink-secondary tracking-wide truncate">
            {label}
            {labelSuffix && (
              <span className="text-ink-muted font-normal ms-1">{labelSuffix}</span>
            )}
          </span>
          {help && <MetricHelp content={help} />}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mb-2 sm:mb-2.5 min-w-0">
        {valuePrefix && (
          <span className="text-[11px] sm:text-xs font-medium text-ink-muted shrink-0">
            {valuePrefix}
          </span>
        )}
        <RollingNumber
          value={rawValue}
          format={format}
          className={cn(
            'font-light tracking-tight leading-none whitespace-nowrap',
            valueSizeClass(settledValueString),
            accent === 'pos' && 'text-status-green',
            accent === 'neg' && 'text-status-red',
            !accent && 'text-ink',
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
            delta.direction === 'flat' && 'text-ink-muted',
            isGood && 'text-status-green',
            isBad  && 'text-status-warning',
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
    </Card>
  );
}
