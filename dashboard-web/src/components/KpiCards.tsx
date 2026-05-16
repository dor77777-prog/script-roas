'use client';

import { TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Target, Package, Wallet } from 'lucide-react';
import { cn, formatCurrency, formatNumber, formatPct } from '@/lib/utils';
import { roasLabel, type Aggregate, deltaPct } from '@/lib/analytics';

const TONE_BG: Record<string, string> = {
  red: 'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green: 'bg-roas-greenBg text-roas-green',
  blue: 'bg-roas-blueBg text-roas-blue',
  gray: 'bg-surfaceMuted text-text-muted',
};

type Props = {
  current: Aggregate;
  previous: Aggregate;
};

export function KpiCards({ current, previous }: Props) {
  const roasInfo = roasLabel(current.roas);
  const dRoas = deltaPct(current.roas, previous.roas);
  const dRev = deltaPct(current.revenue, previous.revenue);
  const dSpend = deltaPct(current.spend, previous.spend);
  const dProfit = deltaPct(current.grossProfit, previous.grossProfit);
  const dCogs = deltaPct(current.cogs, previous.cogs);
  const dNet = deltaPct(current.netProfit, previous.netProfit);

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="ROAS לתקופה"
        value={formatNumber(current.roas)}
        sublabel={roasInfo.text}
        sublabelClass={TONE_BG[roasInfo.tone]}
        delta={dRoas}
        icon={<Target size={16} />}
      />
      <KpiCard
        label="סך הכנסות"
        value={`CAD ${formatCurrency(current.revenue)}`}
        delta={dRev}
        icon={<DollarSign size={16} />}
      />
      <KpiCard
        label="סך הוצאות"
        value={`CAD ${formatCurrency(current.spend)}`}
        delta={dSpend}
        deltaInverse
        icon={<ShoppingCart size={16} />}
      />
      <KpiCard
        label="רווח גולמי"
        value={`CAD ${formatCurrency(current.grossProfit)}`}
        delta={dProfit}
        icon={<TrendingUp size={16} />}
      />
      <KpiCard
        label="עלות סחורה (25%)"
        value={`CAD ${formatCurrency(current.cogs)}`}
        delta={dCogs}
        deltaInverse
        icon={<Package size={16} />}
      />
      <KpiCard
        label="רווח נטו"
        value={`CAD ${formatCurrency(current.netProfit)}`}
        delta={dNet}
        icon={<Wallet size={16} />}
        accent={current.netProfit >= 0 ? 'pos' : 'neg'}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sublabel,
  sublabelClass,
  delta,
  deltaInverse = false,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  sublabelClass?: string;
  delta: ReturnType<typeof deltaPct>;
  deltaInverse?: boolean;
  icon?: React.ReactNode;
  accent?: 'pos' | 'neg';
}) {
  const isGood = deltaInverse ? delta.direction === 'down' : delta.direction === 'up';
  const isBad = deltaInverse ? delta.direction === 'up' : delta.direction === 'down';

  return (
    <div className="rounded-xl bg-surface border border-border p-3 sm:p-5 shadow-card hover:shadow-cardHover transition-shadow">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <span className="text-xs sm:text-sm font-medium text-text-secondary leading-tight">{label}</span>
        <span className="text-text-muted shrink-0">{icon}</span>
      </div>
      <div
        className={cn(
          'text-xl sm:text-2xl md:text-3xl font-bold leading-tight tabular-nums break-words',
          accent === 'pos' && 'text-roas-green',
          accent === 'neg' && 'text-roas-red',
          !accent && 'text-text-primary',
        )}
      >
        {value}
      </div>
      {sublabel && (
        <span
          className={cn(
            'inline-block mt-1.5 sm:mt-2 px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded',
            sublabelClass,
          )}
        >
          {sublabel}
        </span>
      )}
      <div
        className={cn(
          'mt-2 sm:mt-3 flex items-center gap-1 text-[10px] sm:text-xs',
          delta.direction === 'flat' && 'text-text-muted',
          isGood && 'text-roas-green',
          isBad && 'text-roas-red',
        )}
      >
        {delta.direction === 'up' && <TrendingUp size={12} />}
        {delta.direction === 'down' && <TrendingDown size={12} />}
        {delta.direction === 'flat' && <Minus size={12} />}
        <span className="tabular-nums leading-tight">
          {delta.direction === 'flat'
            ? 'ללא שינוי'
            : `${formatPct(delta.value, true)} מהקודמת`}
        </span>
      </div>
    </div>
  );
}
