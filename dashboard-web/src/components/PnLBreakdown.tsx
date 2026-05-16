'use client';

import { useState } from 'react';
import { Receipt, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { Aggregate } from '@/lib/analytics';
import {
  EMAIL_COST_PER_STORE_MONTHLY,
  STORE_FIXED_COSTS,
  TRANSACTION_FEES_RATE,
} from '@/lib/costs';

/**
 * P&L Breakdown — full income statement for the selected period. Mirrors the
 * standard SaaS / e-commerce profit waterfall so the user can read top-down:
 *
 *   Revenue
 *   − Ad Spend
 *   − COGS (25%)
 *   − Transaction Fees (6.5%)
 *   − Fixed (Shopify + apps + email, prorated)
 *   = True Net Profit
 *
 * Each cost line shows: amount + percent of revenue + the calc behind it.
 * Designed to be collapsible — it's reference material, not a daily check-in.
 */

type Props = {
  current: Aggregate;
  /** Stores in scope (used to indicate which fixed costs were applied). */
  storeNames: string[];
};

export function PnLBreakdown({ current, storeNames }: Props) {
  const [open, setOpen] = useState(false);

  const revenue = current.revenue;
  // Margin defined relative to revenue so each line speaks in the same unit.
  const pct = (n: number) => (revenue > 0 ? (n / revenue) * 100 : 0);

  // Check whether the user has actually configured per-store fixed costs.
  // If not, the breakdown still works (email is included), but we flag it so
  // the user knows the line is incomplete.
  const hasConfiguredFixed = storeNames.some(s => {
    const c = STORE_FIXED_COSTS[s];
    return c && (c.shopifyPlan > 0 || c.apps > 0);
  });

  // Total profit through each step (running balance).
  const afterAd     = revenue - current.spend;
  const afterCogs   = afterAd - current.cogs;
  const afterFees   = afterCogs - current.transactionFees;
  const finalProfit = afterFees - current.fixedCosts;

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

          {/* Summary chip + chevron */}
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

      {/* Body */}
      {open && (
        <div className="p-4 sm:p-5 animate-fade-in">
          {!hasConfiguredFixed && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
              <div className="text-[11px] sm:text-xs text-amber-900 leading-relaxed">
                לא הוגדרו עלויות Shopify + אפליקציות לכל חנות. רק עלות האימייל
                (${EMAIL_COST_PER_STORE_MONTHLY} לחנות לחודש) נכללת בקבועים.
                ערוך ב-<code className="text-[10px] bg-amber-100 px-1 rounded font-mono">dashboard-web/src/lib/costs.ts</code> כדי להוסיף את הסכומים האמיתיים.
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
                current.daysCovered > 0
                  ? `Shopify + apps + email · ${storeNames.length} חנויות · ${current.daysCovered} ימים מתוך 30`
                  : 'אין ימים בטווח'
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

          {/* Per-store fixed cost detail */}
          {storeNames.length > 0 && (
            <details className="mt-4 group">
              <summary className="cursor-pointer text-[11px] sm:text-xs text-text-secondary hover:text-text-primary inline-flex items-center gap-1 select-none">
                <ChevronUp
                  size={11}
                  className="transition-transform group-open:rotate-180"
                />
                פירוט עלויות קבועות לפי חנות
              </summary>
              <div className="mt-2 rounded-lg bg-surfaceMuted/40 border border-borderSubtle p-3">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-[10px] uppercase text-text-muted tracking-wide">
                      <th className="text-start font-medium pb-1.5">חנות</th>
                      <th className="text-end font-medium pb-1.5">Shopify</th>
                      <th className="text-end font-medium pb-1.5">Apps</th>
                      <th className="text-end font-medium pb-1.5">Email</th>
                      <th className="text-end font-medium pb-1.5">סה&quot;כ חודשי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeNames.map(s => {
                      const c = STORE_FIXED_COSTS[s] ?? { shopifyPlan: 0, apps: 0 };
                      const monthly =
                        c.shopifyPlan + c.apps + EMAIL_COST_PER_STORE_MONTHLY;
                      return (
                        <tr key={s} className="border-t border-borderSubtle/60">
                          <td className="py-1 font-medium text-text-primary">{s}</td>
                          <td className="py-1 text-end">{formatCurrency(c.shopifyPlan)}</td>
                          <td className="py-1 text-end">{formatCurrency(c.apps)}</td>
                          <td className="py-1 text-end">
                            {formatCurrency(EMAIL_COST_PER_STORE_MONTHLY)}
                          </td>
                          <td className="py-1 text-end font-semibold text-text-primary">
                            {formatCurrency(monthly)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-2 text-[10px] text-text-muted leading-relaxed">
                  לעדכון הסכומים: ערוך את <code className="bg-surface px-1 rounded font-mono">STORE_FIXED_COSTS</code>
                  {' '}ב-<code className="bg-surface px-1 rounded font-mono">dashboard-web/src/lib/costs.ts</code>.
                  התוכנית הבאה: שליפה אוטומטית מ-Shopify Billing API.
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
