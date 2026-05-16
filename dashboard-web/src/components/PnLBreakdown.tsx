'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, ChevronDown, ChevronUp, AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { Aggregate } from '@/lib/analytics';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import {
  billingForRange,
  readOneTime,
  readRecurring,
  type CostSource,
  type OneTimeCost,
  type RecurringCost,
} from '@/lib/billing';

/**
 * P&L Breakdown — full income statement for the selected period.
 *
 *   Revenue
 *   − Ad Spend
 *   − COGS (25%)
 *   − Transaction Fees (6.5%)
 *   − Fixed (Recurring subs + one-time charges, prorated)
 *   = True Net Profit
 *
 * The "Fixed" line is sourced from the live billing data layer
 * (lib/billing — managed via the BillingSettings modal). When the user
 * hasn't added anything yet, we point them to the UI button, not to a
 * source file.
 */

type Props = {
  current: Aggregate;
  storeNames: string[];
  /** First/last day of the aggregate — used to scope the billing data. */
  rangeFrom?: string;
  rangeTo?: string;
};

const SOURCE_LABEL: Record<CostSource, string> = {
  'shopify-plan': 'Shopify Plan',
  'shopify-app':  'אפליקציה דרך Shopify',
  'external-app': 'אפליקציה חיצונית',
  email:          'שירות אימייל',
  usage:          'חיוב סף / overage',
  'one-off':      'חד-פעמי',
  other:          'אחר',
};

const SOURCE_COLOR: Record<CostSource, string> = {
  'shopify-plan': 'text-primary',
  'shopify-app':  'text-blue-700',
  'external-app': 'text-purple-700',
  email:          'text-amber-700',
  usage:          'text-roas-orange',
  'one-off':      'text-text-secondary',
  other:          'text-text-secondary',
};

export function PnLBreakdown({ current, storeNames, rangeFrom, rangeTo }: Props) {
  const [open, setOpen] = useState(false);

  // Hydrate live billing data after mount + re-render when user adds entries
  // via BillingSettings (custom event from lib/billing).
  const [recurring, setRecurring] = useState<RecurringCost[]>([]);
  const [oneTime, setOneTime] = useState<OneTimeCost[]>([]);
  useEffect(() => {
    setRecurring(readRecurring());
    setOneTime(readOneTime());
    function refresh() {
      setRecurring(readRecurring());
      setOneTime(readOneTime());
    }
    window.addEventListener('roas-billing-changed', refresh);
    return () => window.removeEventListener('roas-billing-changed', refresh);
  }, []);

  // Per-source breakdown for the inside-the-card display. Use the same range
  // the aggregate covers so the totals line up exactly with `current.fixedCosts`.
  const billing = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null;
    return billingForRange({ from: rangeFrom, to: rangeTo, storeNames });
  }, [rangeFrom, rangeTo, storeNames]);

  // Active recurring entries scoped to the visible stores (or "All").
  const activeForScope = useMemo(() => {
    const scopeSet = new Set(storeNames);
    return recurring.filter(r => r.active && (r.store === 'All' || scopeSet.has(r.store)));
  }, [recurring, storeNames]);

  const revenue = current.revenue;
  const pct = (n: number) => (revenue > 0 ? (n / revenue) * 100 : 0);

  const afterAd     = revenue - current.spend;
  const afterCogs   = afterAd - current.cogs;
  const afterFees   = afterCogs - current.transactionFees;
  const finalProfit = afterFees - current.fixedCosts;

  // "Configured" means: at least one active recurring entry OR at least one
  // one-time entry inside the visible range.
  const oneTimeInScope = useMemo(() => {
    if (!rangeFrom || !rangeTo) return [] as OneTimeCost[];
    const scopeSet = new Set(storeNames);
    return oneTime.filter(o =>
      o.date >= rangeFrom && o.date <= rangeTo &&
      (o.store === 'All' || scopeSet.has(o.store)),
    );
  }, [oneTime, rangeFrom, rangeTo, storeNames]);

  const hasConfiguredFixed = activeForScope.length > 0 || oneTimeInScope.length > 0;

  return (
    <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          'w-full text-start px-4 sm:px-6 py-3 sm:py-4',
          'border-b border-borderSubtle',
          'bg-gradient-to-l from-primary/4 to-surface',
          'hover:from-primary/8 hover:to-surfaceMuted/40 transition-colors',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-primary/10 text-primary shrink-0">
              <Receipt size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-text-primary tracking-tight leading-tight">
                P&amp;L מפורט
              </h2>
              <div className="text-[11px] sm:text-xs text-text-muted mt-0.5 leading-tight">
                כל ההוצאות, שורה אחר שורה, עד הרווח הנקי האמיתי
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="text-end">
              <div className="text-[10px] text-text-muted uppercase tracking-wide">
                רווח נטו
              </div>
              <div
                className={cn(
                  'text-sm sm:text-base font-bold tabular-nums leading-tight',
                  finalProfit >= 0 ? 'text-roas-green' : 'text-roas-red',
                )}
              >
                <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
                {formatCurrency(finalProfit)}
              </div>
              {revenue > 0 && (
                <div className="text-[10px] text-text-muted tabular-nums leading-tight">
                  {(current.trueMargin * 100).toFixed(1)}% מרג&apos;ין
                </div>
              )}
            </div>
            <ChevronDown
              size={18}
              className={cn(
                'text-text-muted transition-transform duration-DEFAULT',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </div>
        </div>
      </button>

      {open && (
        <div className="p-4 sm:p-5 animate-fade-in">
          {!hasConfiguredFixed && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="text-[11px] sm:text-xs text-amber-900 leading-relaxed">
                <strong>טרם הוגדרו עלויות חודשיות.</strong> ה-P&amp;L כרגע משקלל רק
                COGS (25%) ו-Transaction Fees (6.5%) — בלי Shopify Plan,
                אפליקציות, או שירות אימייל. לחץ על{' '}
                <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-amber-100 font-semibold">
                  <SettingsIcon size={10} /> עלויות חודשיות
                </span>{' '}
                למעלה כדי להוסיף אותן (מנוי Shopify, Klaviyo, וכו&apos;).
              </div>
            </div>
          )}

          <ol className="space-y-px">
            <PnLLine
              label="הכנסות"
              amount={revenue}
              pct={100}
              tone="positive"
              note="כולל החזרות שכבר מוקזזות (current_total_price)"
              running={revenue}
            />
            <PnLLine
              label="הוצאות פרסום"
              amount={-current.spend}
              pct={-pct(current.spend)}
              tone="cost"
              note={`Meta + Google · ROAS ${current.roas > 0 ? current.roas.toFixed(2) : '—'}`}
              running={afterAd}
            />
            <PnLLine
              label="עלות סחורה (COGS)"
              amount={-current.cogs}
              pct={-pct(current.cogs)}
              tone="cost"
              note="הערכה: 25% מההכנסה (ממוצע היסטורי 25-26%)"
              running={afterCogs}
            />
            <PnLLine
              label="עמלות עיבוד תשלום"
              amount={-current.transactionFees}
              pct={-pct(current.transactionFees)}
              tone="cost"
              note={`PayPal + המרת מטבע · ${(TRANSACTION_FEES_RATE * 100).toFixed(1)}%`}
              running={afterFees}
            />
            <PnLLine
              label="הוצאות קבועות (יחסי)"
              amount={-current.fixedCosts}
              pct={-pct(current.fixedCosts)}
              tone="cost"
              note={
                hasConfiguredFixed
                  ? `${activeForScope.length} מנויים פעילים${oneTimeInScope.length > 0 ? ` + ${oneTimeInScope.length} חד-פעמיים` : ''} · ${current.daysCovered} ימים מתוך 30`
                  : 'לא הוגדרו עלויות — לחץ על "עלויות חודשיות" למעלה'
              }
              running={finalProfit}
            />

            {/* Final result line */}
            <li
              className={cn(
                'flex items-center justify-between gap-3 px-1 py-3 mt-1.5',
                'border-t-2 border-text-primary/20',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-text-primary">
                  רווח נטו אמיתי
                </span>
                <span className="text-[10px] text-text-muted">
                  ({(current.trueMargin * 100).toFixed(1)}% מרג&apos;ין)
                </span>
              </div>
              <span
                className={cn(
                  'text-base sm:text-lg font-bold tabular-nums',
                  finalProfit >= 0 ? 'text-roas-green' : 'text-roas-red',
                )}
              >
                <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
                {formatCurrency(finalProfit)}
              </span>
            </li>
          </ol>

          {/* By-source breakdown */}
          {billing && hasConfiguredFixed && (
            <details className="mt-4 group">
              <summary className="cursor-pointer text-[11px] sm:text-xs text-text-secondary hover:text-text-primary inline-flex items-center gap-1 select-none">
                <ChevronUp size={11} className="transition-transform group-open:rotate-180" />
                פירוט עלויות קבועות לפי קטגוריה
              </summary>
              <div className="mt-2 rounded-lg bg-surfaceMuted/40 border border-borderSubtle p-3">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-[10px] uppercase text-text-muted tracking-wide">
                      <th className="text-start font-medium pb-1.5">קטגוריה</th>
                      <th className="text-end font-medium pb-1.5">סכום (יחסי לטווח)</th>
                      <th className="text-end font-medium pb-1.5">% מהקבועים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(billing.bySource) as CostSource[])
                      .filter(s => billing.bySource[s] > 0)
                      .sort((a, b) => billing.bySource[b] - billing.bySource[a])
                      .map(s => {
                        const amt = billing.bySource[s];
                        const sharePct = billing.total > 0 ? (amt / billing.total) * 100 : 0;
                        return (
                          <tr key={s} className="border-t border-borderSubtle/60">
                            <td className={cn('py-1 font-medium', SOURCE_COLOR[s])}>
                              {SOURCE_LABEL[s]}
                            </td>
                            <td className="py-1 text-end text-text-primary">
                              {formatCurrency(amt)}
                            </td>
                            <td className="py-1 text-end text-text-muted">
                              {sharePct.toFixed(0)}%
                            </td>
                          </tr>
                        );
                      })}
                    <tr className="border-t-2 border-text-primary/20 font-bold">
                      <td className="py-1.5">סך הכל</td>
                      <td className="py-1.5 text-end">{formatCurrency(billing.total)}</td>
                      <td className="py-1.5 text-end">100%</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 text-[10px] text-text-muted leading-relaxed">
                  עורכים את הנתונים דרך הכפתור <span className="font-semibold">עלויות חודשיות</span>{' '}
                  מעל ה-P&amp;L. כל שינוי מתעדכן מיד בכל החישובים.
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function PnLLine({
  label,
  amount,
  pct,
  tone,
  note,
  running,
}: {
  label: string;
  amount: number;
  pct: number;
  tone: 'positive' | 'cost';
  note?: string;
  running: number;
}) {
  return (
    <li className="flex items-center gap-3 py-2 border-b border-borderSubtle/40 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary font-medium leading-snug">
          {label}
        </div>
        {note && (
          <div className="text-[10px] sm:text-[11px] text-text-muted mt-0.5 leading-snug">
            {note}
          </div>
        )}
      </div>
      <div className="text-end shrink-0 min-w-[110px]">
        <div
          className={cn(
            'text-sm font-semibold tabular-nums leading-tight',
            tone === 'positive' && 'text-text-primary',
            tone === 'cost' && 'text-text-secondary',
          )}
        >
          <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
          {formatCurrency(amount)}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums mt-0.5">
          {pct > 0 && tone === 'positive' ? '100%' : `${pct.toFixed(1)}%`}
        </div>
      </div>
      <div className="text-end shrink-0 hidden sm:block min-w-[110px] border-r border-borderSubtle pr-3">
        <div className="text-[10px] text-text-muted uppercase tracking-wide leading-tight">
          נשאר
        </div>
        <div
          className={cn(
            'text-xs font-semibold tabular-nums leading-tight mt-0.5',
            running >= 0 ? 'text-text-primary' : 'text-roas-red',
          )}
        >
          {formatCurrency(running)}
        </div>
      </div>
    </li>
  );
}
