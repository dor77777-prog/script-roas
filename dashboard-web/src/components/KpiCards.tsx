'use client';

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
import { roasLabel, type Aggregate, deltaPct } from '@/lib/analytics';

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

type Props = {
  current: Aggregate;
  previous: Aggregate;
};

export function KpiCards({ current, previous }: Props) {
  const roasInfo = roasLabel(current.roas);
  const dRoas   = deltaPct(current.roas,        previous.roas);
  const dRev    = deltaPct(current.revenue,     previous.revenue);
  const dSpend  = deltaPct(current.spend,       previous.spend);
  const dProfit = deltaPct(current.grossProfit, previous.grossProfit);
  const dCogs   = deltaPct(current.cogs,        previous.cogs);
  const dNet    = deltaPct(current.netProfit,   previous.netProfit);

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="ROAS"
        value={formatNumber(current.roas)}
        valuePrefix={null}
        chip={{ text: roasInfo.text, tone: roasInfo.tone }}
        delta={dRoas}
        icon={<Target size={14} />}
      />
      <KpiCard
        label="הכנסות"
        value={formatCurrency(current.revenue)}
        valuePrefix="CAD"
        delta={dRev}
        icon={<DollarSign size={14} />}
      />
      <KpiCard
        label="הוצאות פרסום"
        value={formatCurrency(current.spend)}
        valuePrefix="CAD"
        delta={dSpend}
        deltaInverse
        icon={<ShoppingCart size={14} />}
      />
      <KpiCard
        label="רווח גולמי"
        value={formatCurrency(current.grossProfit)}
        valuePrefix="CAD"
        delta={dProfit}
        icon={<TrendingUp size={14} />}
      />
      <KpiCard
        label="עלות סחורה"
        labelSuffix="(25%)"
        value={formatCurrency(current.cogs)}
        valuePrefix="CAD"
        delta={dCogs}
        deltaInverse
        icon={<Package size={14} />}
      />
      <KpiCard
        label="רווח נטו"
        value={formatCurrency(current.netProfit)}
        valuePrefix="CAD"
        delta={dNet}
        icon={<Wallet size={14} />}
        accent={current.netProfit >= 0 ? 'pos' : 'neg'}
      />
    </div>
  );
}

function KpiCard({
  label,
  labelSuffix,
  value,
  valuePrefix,
  chip,
  delta,
  deltaInverse = false,
  icon,
  accent,
}: {
  label: string;
  labelSuffix?: string;
  value: string;
  valuePrefix?: string | null;
  chip?: { text: string; tone: string };
  delta: ReturnType<typeof deltaPct>;
  deltaInverse?: boolean;
  icon?: React.ReactNode;
  accent?: 'pos' | 'neg';
}) {
  const isGood = deltaInverse ? delta.direction === 'down' : delta.direction === 'up';
  const isBad  = deltaInverse ? delta.direction === 'up'   : delta.direction === 'down';

  return (
    <div
      className={cn(
        'group relative rounded-xl bg-surface border border-borderSubtle p-3.5 sm:p-5',
        'shadow-card hover:shadow-cardHover hover:border-border',
        'transition-all duration-DEFAULT ease-out',
      )}
    >
      {/* Label row — small, uppercase-ish wide tracking, icon faded */}
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

      {/* Value — thin weight, large, deep navy. */}
      <div className="flex items-baseline gap-1.5 mb-2 sm:mb-2.5 min-w-0">
        {valuePrefix && (
          <span className="text-[11px] sm:text-xs font-medium text-text-muted shrink-0">
            {valuePrefix}
          </span>
        )}
        <span
          className={cn(
            'font-light tabular-nums tracking-tight leading-none truncate',
            'text-[1.625rem] sm:text-[2rem] md:text-[2.25rem]',
            accent === 'pos' && 'text-roas-green',
            accent === 'neg' && 'text-roas-red',
            !accent && 'text-text-primary',
          )}
        >
          {value}
        </span>
      </div>

      {/* Chip — optional category tag (used for the ROAS card). */}
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

      {/* Delta — sits at the bottom, very small, single line. */}
      <div
        className={cn(
          'mt-2.5 flex items-center gap-1 text-[10px] sm:text-[11px] font-medium',
          delta.direction === 'flat' && 'text-text-muted',
          isGood && 'text-roas-green',
          isBad  && 'text-roas-red',
        )}
      >
        {delta.direction === 'up'   && <TrendingUp   size={11} className="shrink-0" />}
        {delta.direction === 'down' && <TrendingDown size={11} className="shrink-0" />}
        {delta.direction === 'flat' && <Minus        size={11} className="shrink-0" />}
        <span className="tabular-nums truncate">
          {delta.direction === 'flat'
            ? 'ללא שינוי'
            : `${formatPct(delta.value, true)} מהתקופה הקודמת`}
        </span>
      </div>
    </div>
  );
}
