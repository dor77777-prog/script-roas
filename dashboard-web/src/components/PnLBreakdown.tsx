'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, ChevronDown, ChevronUp, AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { Aggregate } from '@/lib/analytics';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import { sumRefundsInRange } from '@/lib/refundDayHeuristic';
import type { DailyRow } from '@/lib/types';
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
  /** Scoped DailyRow[] for the current period — used to compute refund total. */
  rows?: readonly DailyRow[];
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
  'shopify-plan': 'text-accent',
  'shopify-app':  'text-blue-700',
  'external-app': 'text-purple-700',
  email:          'text-amber-700',
  usage:          'text-status-orange',
  'one-off':      'text-ink-secondary',
  other:          'text-ink-secondary',
};

export function PnLBreakdown({ current, storeNames, rangeFrom, rangeTo, rows = [] }: Props) {
  // Default open: P&L is the "am I making money" question — too important to
  // hide behind a click. User can still collapse if they want a quieter view.
  const [open, setOpen] = useState(true);

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
  // Phase 12.5.x (2026-05-24) — pass `revenue` so % of revenue recurring
  // rows contribute the same amount here as in the upstream `aggregate()`
  // call (keeps the per-source totals reconciling to `current.fixedCosts`).
  //
  // Phase 12.5.x bugfix (2026-05-24, operator-reported): the dep array used
  // to miss `recurring` + `oneTime`. `billingForRange` reads them via
  // `readRecurring()` / `readOneTime()` from localStorage at execution time,
  // so the underlying values WERE fresh after the `'roas-billing-changed'`
  // event fired — but useMemo never re-ran because no listed dep had
  // changed. Adding `recurring` and `oneTime` (which DO update via the
  // useEffect above on the same event) forces the memo to recompute, so
  // the breakdown table reflects the new entry without a manual refresh.
  const billing = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null;
    return billingForRange({
      from: rangeFrom,
      to: rangeTo,
      storeNames,
      revenue: current.revenue,
    });
  }, [rangeFrom, rangeTo, storeNames, current.revenue, recurring, oneTime]);

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

  // Refund total for the period — sourced from the raw DailyRow[] so it
  // matches the cross-day-refund data_daily values exactly. PRESENTATIONAL
  // ONLY: does not alter the running-total cascade (the refunds are already
  // deducted from `revenue`).
  const refundTotalInPeriod = sumRefundsInRange(rows);

  // Total costs displayed in the hero strip (everything between revenue and
  // net profit). Used to size the relative bars side-by-side.
  const totalCosts = current.spend + current.cogs + current.transactionFees + current.fixedCosts;
  const maxAmount = Math.max(revenue, totalCosts, Math.abs(finalProfit), 1);

  return (
    <section className="rounded-2xl bg-elevated border border-line-subtle shadow-elevated overflow-hidden">
      {/* Hero strip — always visible. Three big numbers side-by-side with
          proportional bars so a glance answers "did I make money?" without
          expanding anything. */}
      <div
        className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 bg-gradient-to-br from-accent/[0.06] via-elevated to-elevated relative"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-accent text-white shrink-0 shadow-sm">
              <Receipt size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-muted">
                Profit &amp; Loss
              </div>
              <h2 className="text-base sm:text-xl font-bold text-ink tracking-tight leading-tight">
                כמה נשאר ביד?
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-medium text-ink-secondary hover:text-ink px-2 py-1 rounded-md hover:bg-elevated2 transition-colors shrink-0"
          >
            {open ? 'הסתר פירוט' : 'הצג פירוט מלא'}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-5">
          <HeroStat
            label="הכנסות"
            amount={revenue}
            barWidthPct={(revenue / maxAmount) * 100}
            tone="positive"
            sub={revenue > 0 ? '100% — בסיס החישוב' : 'אין הכנסות בטווח'}
          />
          <HeroStat
            label="סך עלויות"
            amount={totalCosts}
            barWidthPct={(totalCosts / maxAmount) * 100}
            tone="negative"
            sub={
              revenue > 0
                ? `${((totalCosts / revenue) * 100).toFixed(1)}% מההכנסות`
                : '—'
            }
          />
          <HeroStat
            label="רווח נטו"
            amount={finalProfit}
            barWidthPct={(Math.abs(finalProfit) / maxAmount) * 100}
            tone={finalProfit >= 0 ? 'profit' : 'loss'}
            sub={
              revenue > 0
                ? `${(current.trueMargin * 100).toFixed(1)}% מרג'ין`
                : '—'
            }
          />
        </div>
      </div>

      {open && (
        <div className="p-4 sm:p-5 border-t border-line-subtle animate-fade-in">
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
              label="הכנסות (נטו)"
              amount={revenue}
              pct={100}
              tone="positive"
              note="נטו אחרי החזרים — הברוטו לפני החזרים מוצג בשורה הבאה"
              running={revenue}
            />
            {refundTotalInPeriod > 0 && (
              <PnLLine
                label="החזרים בתקופה"
                amount={-refundTotalInPeriod}
                pct={revenue > 0 ? -(refundTotalInPeriod / revenue) * 100 : 0}
                tone="cost"
                note="כבר מנוכים מההכנסות מעל — מוצג להבהרה"
                running={null}
              />
            )}
            <PnLLine
              label="הוצאות פרסום"
              amount={-current.spend}
              pct={-pct(current.spend)}
              tone="cost"
              note={`${(current.ttSpend ?? 0) > 0 ? 'Meta + Google + TikTok' : 'Meta + Google'} · ROAS ${current.roas > 0 ? current.roas.toFixed(2) : '—'}`}
              running={afterAd}
            />
            <PnLLine
              label="עלות סחורה (COGS)"
              amount={-current.cogs}
              pct={-pct(current.cogs)}
              tone="cost"
              note={revenue > 0 ? `הערכה: ${(current.cogs / revenue * 100).toFixed(1)}% מההכנסה` : 'הערכה: COGS לפי שיעור לכל חנות'}
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
                'border-t-2 border-ink/20',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-ink">
                  רווח נטו אמיתי
                </span>
                <span className="text-[10px] text-ink-muted">
                  ({(current.trueMargin * 100).toFixed(1)}% מרג&apos;ין)
                </span>
              </div>
              <span
                className={cn(
                  'text-base sm:text-lg font-bold tabular-nums',
                  finalProfit >= 0 ? 'text-status-green' : 'text-status-red',
                )}
              >
                <span className="text-[10px] text-ink-muted font-medium ml-1">CAD</span>
                {formatCurrency(finalProfit)}
              </span>
            </li>
          </ol>

          {/* By-source breakdown */}
          {billing && hasConfiguredFixed && (
            <details className="mt-4 group">
              <summary className="cursor-pointer text-[11px] sm:text-xs text-ink-secondary hover:text-ink inline-flex items-center gap-1 select-none">
                <ChevronUp size={11} className="transition-transform group-open:rotate-180" />
                פירוט עלויות קבועות לפי קטגוריה
              </summary>
              <div className="mt-2 rounded-lg bg-elevated2/40 border border-line-subtle p-3">
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 z-[5] bg-elevated2/40">
                    <tr className="text-[10px] uppercase text-ink-muted tracking-wide">
                      <th className="text-start font-medium pb-1.5">קטגוריה</th>
                      <th className="text-end font-medium pb-1.5">סכום (יחסי לטווח)</th>
                      <th className="text-end font-medium pb-1.5">% מההכנסה</th>
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
                        // Phase 12.5 — % of revenue is range-invariant: amt
                        // and revenue scale together, so a $100/mo Klaviyo
                        // on $5K/mo revenue reads as 2% on any view length.
                        const revPct = revenue > 0 ? (amt / revenue) * 100 : 0;
                        return (
                          <tr key={s} className="border-t border-line-subtle/60">
                            <td className={cn('py-1 font-medium', SOURCE_COLOR[s])}>
                              {SOURCE_LABEL[s]}
                            </td>
                            <td className="py-1 text-end text-ink">
                              {formatCurrency(amt)}
                            </td>
                            <td className="py-1 text-end text-ink-secondary font-medium">
                              {revenue > 0 ? `${revPct.toFixed(1)}%` : '—'}
                            </td>
                            <td className="py-1 text-end text-ink-muted">
                              {sharePct.toFixed(0)}%
                            </td>
                          </tr>
                        );
                      })}
                    <tr className="border-t-2 border-ink/20 font-bold">
                      <td className="py-1.5">סך הכל</td>
                      <td className="py-1.5 text-end">{formatCurrency(billing.total)}</td>
                      <td className="py-1.5 text-end text-ink">
                        {revenue > 0
                          ? `${((billing.total / revenue) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="py-1.5 text-end">100%</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 text-[10px] text-ink-muted leading-relaxed">
                  עורכים את הנתונים דרך הכפתור <span className="font-semibold">עלויות חודשיות</span>{' '}
                  מעל ה-P&amp;L. כל שינוי מתעדכן מיד בכל החישובים.{' '}
                  <span className="text-ink-secondary">
                    עמודת <strong>% מההכנסה</strong> זהה בכל אורך טווח (סכום ההוצאה והכנסות
                    מתפרסים יחד) — מודד כמה כל שירות &quot;עולה&quot; ביחס לנפח העסק.
                  </span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One of the three big numbers in the hero strip. Each shows a label, the
 * amount in CAD with tabular nums, a proportional bar (relative to the
 * largest of the three so the eye can compare instantly), and a sub-line.
 */
function HeroStat({
  label,
  amount,
  barWidthPct,
  tone,
  sub,
}: {
  label: string;
  amount: number;
  barWidthPct: number;
  tone: 'positive' | 'negative' | 'profit' | 'loss';
  sub?: string;
}) {
  const amountColor =
    tone === 'positive' ? 'text-ink'
    : tone === 'negative' ? 'text-ink'
    : tone === 'profit' ? 'text-status-green'
    : 'text-status-red';
  const barColor =
    tone === 'positive' ? 'bg-accent'
    : tone === 'negative' ? 'bg-ink-muted/55'
    : tone === 'profit' ? 'bg-status-green'
    : 'bg-status-red';
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-muted">
        {label}
      </div>
      <div className={cn('text-xl sm:text-3xl font-bold tabular-nums leading-none', amountColor)}>
        <span className="text-[10px] sm:text-xs text-ink-muted font-medium ml-1.5 align-baseline">
          CAD
        </span>
        {formatCurrency(amount)}
      </div>
      <div className="h-1.5 sm:h-2 rounded-full bg-ink-muted/15 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', barColor)}
          style={{ width: `${Math.max(2, Math.min(100, barWidthPct))}%` }}
        />
      </div>
      {sub && (
        <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums">{sub}</div>
      )}
    </div>
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
  /** Pass `null` to suppress the "running total" column (e.g. for presentational
   * rows that annotate but do NOT advance the cascade — see the "החזרים בתקופה"
   * row in the main cascade for the canonical example). */
  running: number | null;
}) {
  return (
    <li className="flex items-center gap-3 py-2 border-b border-line-subtle/40 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink font-medium leading-snug">
          {label}
        </div>
        {note && (
          <div className="text-[10px] sm:text-[11px] text-ink-muted mt-0.5 leading-snug">
            {note}
          </div>
        )}
      </div>
      <div className="text-end shrink-0 min-w-[110px]">
        <div
          className={cn(
            'text-sm font-semibold tabular-nums leading-tight',
            tone === 'positive' && 'text-ink',
            tone === 'cost' && 'text-ink-secondary',
          )}
        >
          <span className="text-[10px] text-ink-muted font-medium ml-1">CAD</span>
          {formatCurrency(amount)}
        </div>
        <div className="text-[10px] text-ink-muted tabular-nums mt-0.5">
          {pct > 0 && tone === 'positive' ? '100%' : `${pct.toFixed(1)}%`}
        </div>
      </div>
      <div className="text-end shrink-0 hidden sm:block min-w-[110px] border-s border-line-subtle ps-3">
        <div className="text-[10px] text-ink-muted uppercase tracking-wide leading-tight">
          נשאר
        </div>
        {running === null ? (
          <span
            className="text-xs text-ink-secondary opacity-50"
            aria-label="הערה — לא משפיע על הסכום הרץ"
          >
            —
          </span>
        ) : (
          <div
            className={cn(
              'text-xs font-semibold tabular-nums leading-tight mt-0.5',
              running >= 0 ? 'text-ink' : 'text-status-red',
            )}
          >
            {formatCurrency(running)}
          </div>
        )}
      </div>
    </li>
  );
}
