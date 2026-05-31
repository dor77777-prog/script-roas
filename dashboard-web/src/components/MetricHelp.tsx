'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * Inline help affordance for a metric. Renders a small "?" icon that opens
 * a popover on hover / focus / click describing what the metric is, how
 * it's calculated, and what "good" looks like.
 *
 * Design: subtle by default (the icon is muted; appears on hover of the
 * parent surface via group-hover). When the user actually wants to learn,
 * one tap reveals the popover; click outside or another metric to dismiss.
 *
 * For tooltips that need rich content (formulas, examples), we use a
 * controlled popover rather than the native title attribute.
 */

/**
 * HIGH-5 audit fix (2026-05-23): mirror the v2 d/CR-08 RefundIndicator
 * grace-timer pattern (commit a271b3a). Pre-fix MetricHelp's button
 * onMouseLeave fired `setOpen(false)` IMMEDIATELY, so any cursor transit
 * from the "?" icon down into the popover (a few pixels of physical gap
 * to cross) closed the popover before the user could read or interact
 * with it. 200ms matches OS-level tooltip dismiss timings (macOS /
 * Win HelpTip) and is short enough that an accidental hover doesn't
 * linger after the cursor moves on.
 */
const HIDE_GRACE_MS = 200;

export type MetricHelpContent = {
  /** Short metric name, "ROAS" / "CTR" / etc. */
  name: string;
  /** What it measures, in plain Hebrew. */
  whatIs: string;
  /** Calculation expressed as a short LTR formula. */
  formula?: string;
  /** What a good value looks like — keep it concrete. */
  good?: string;
  /** Optional context: when this metric matters most. */
  context?: string;
};

type Props = {
  content: MetricHelpContent;
  className?: string;
  /** Light affordance: just show "?" without a colored background. Default true. */
  subtle?: boolean;
};

export function MetricHelp({ content, className, subtle = true }: Props) {
  const [open, setOpen] = useState(false);
  // HIGH-5 audit fix (2026-05-23): grace timer ref. Tracking via ref
  // instead of state so we can cancel synchronously inside the re-entry
  // mouseEnter handler without waiting for React to flush a state update
  // that would race with the timer's setOpen(false). Mirrors RefundIndicator.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide() {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      setOpen(false);
      hideTimerRef.current = null;
    }, HIDE_GRACE_MS);
  }
  // Clear any pending timer on unmount so we don't setState on a dead
  // component (also stops the StrictMode warning).
  useEffect(() => {
    return () => cancelHide();
  }, []);

  return (
    <span className={cn('relative inline-block', className)}>
      <Button
        type="button"
        variant="ghost"
        onClick={e => { e.stopPropagation(); cancelHide(); setOpen(o => !o); }}
        // HIGH-5: mouseEnter on the button cancels any pending hide
        // timer (so re-entry within the grace window keeps it open).
        // mouseLeave SCHEDULES the hide instead of executing it
        // immediately — the cursor gets 200ms to land in the popover
        // (which fires its own cancelHide on mouseEnter).
        onMouseEnter={() => { cancelHide(); setOpen(true); }}
        onMouseLeave={scheduleHide}
        onFocus={() => { cancelHide(); setOpen(true); }}
        onBlur={scheduleHide}
        aria-label={`הסבר על ${content.name}`}
        className={cn(
          'w-4 h-4 rounded-full',
          subtle
            ? 'text-ink-subtle hover:text-ink-secondary opacity-60 hover:opacity-100'
            : 'text-ink-secondary hover:text-ink bg-glass-2 hover:bg-line',
        )}
      >
        <Info size={11} />
      </Button>

      {open && (
        <div
          role="tooltip"
          dir="rtl"
          // Position below the trigger; on small screens it falls back to fixed-bottom.
          className={cn(
            'absolute z-30 top-full mt-2 end-0',
            'w-[260px] sm:w-[300px] max-w-[min(90vw,320px)]',
            'rounded-xl bg-glass-2 text-ink border border-glass-edge p-3 shadow-overlay',
            'text-xs leading-relaxed animate-fade-in',
            'pointer-events-auto',
          )}
          // HIGH-5: symmetric grace-timer handling on the popover surface
          // — mouseEnter cancels, mouseLeave schedules. This means cursor
          // can transit popover ↔ button freely without flicker.
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="font-semibold text-ink mb-1.5">{content.name}</div>
          <div className="text-ink-secondary">{content.whatIs}</div>
          {content.formula && (
            <code
              dir="ltr"
              className="inline-block mt-2 px-1.5 py-0.5 rounded text-[10px] bg-glass-edge text-ink tabular-nums"
            >
              {content.formula}
            </code>
          )}
          {content.good && (
            <div className="mt-2 pt-2 border-t border-glass-edge">
              <span className="text-emerald-500 font-semibold">טוב:</span>{' '}
              <span className="text-ink-secondary">{content.good}</span>
            </div>
          )}
          {content.context && (
            <div className="mt-1.5 text-[10px] text-ink-subtle">
              {content.context}
            </div>
          )}
          {/* Small triangle pointer to anchor the tooltip to the trigger */}
          <div
            aria-hidden
            className="absolute -top-1.5 end-1.5 w-2.5 h-2.5 bg-glass-2 border border-glass-edge rotate-45"
          />
        </div>
      )}
    </span>
  );
}

/** Pre-built content for the canonical metrics in this dashboard. */
export const METRIC_HELP: Record<string, MetricHelpContent> = {
  roas: {
    name: 'ROAS',
    whatIs: 'יחס בין הכנסות (Shopify) להוצאות פרסום. כמה דולר חוזר על כל דולר שהשקעת בפרסום.',
    formula: 'ROAS = Revenue / Ad Spend',
    good: 'מעל 2.7 סביר, מעל 3.0 טוב, מעל 4.0 מצוין.',
    context: 'מחושב משוקלל — סך הכנסות חלקי סך הוצאות בתקופה.',
  },
  revenue: {
    name: 'הכנסות',
    whatIs: 'סך כל ההזמנות מ-Shopify בתקופה, אחרי החזרים ולפני COGS. במטבע החנות (CAD).',
    formula: 'Σ current_total_price',
    context: 'מקור: Shopify Admin API. real-time, ללא פיגור.',
  },
  spend: {
    name: 'הוצאות פרסום',
    whatIs: 'סך כל ההוצאה ב-Meta + Google ב-CAD. הוצאת Meta מומרת מ-ILS לפי שער יומי של ECB.',
    formula: 'Σ (Meta spend × FX) + Google spend',
    context: 'יש פיגור של ~20 דקות מצד הפלטפורמות.',
  },
  grossProfit: {
    name: 'רווח גולמי',
    whatIs: 'הכנסות פחות הוצאות פרסום, לפני COGS. כמה כסף "אמיתי" נשאר אחרי שהשקענו בפרסום.',
    formula: 'Revenue − Ad Spend',
  },
  cogs: {
    name: 'עלות סחורה (COGS)',
    whatIs: 'הערכה של עלות המוצרים שנמכרו. מחושב כ-25% מההכנסה — הערכה שמרנית של ממוצע בכל החנויות.',
    formula: 'Revenue × 0.25',
    context: 'לא משפיע על ROAS. אפשר לעדכן את האחוז בקוד (Config.gs).',
  },
  netProfit: {
    name: 'רווח נטו',
    whatIs: 'הרווח האמיתי שנותר אחרי כל ההוצאות הישירות והקבועות. זה המספר ש"באמת" נכנס לכיס בסוף התקופה.',
    formula: 'Revenue − Ad Spend − COGS (25%) − Fees (6.5%) − Fixed',
    good: 'חיובי = רווחי. שלילי = מפסידים. המרג\'ין הבריא לתחום: 8-15%.',
    context: 'Fixed = Shopify + apps + email לכל חנות, מוצב יחסית לימים בטווח.',
  },
  ctr: {
    name: 'CTR',
    whatIs: 'אחוז האנשים שראו את המודעה ולחצו עליה. מודד עד כמה המודעה מעניינת.',
    formula: 'Clicks / Impressions',
    good: 'מעל 1% סביר, מעל 2% טוב, מעל 3% מצוין.',
  },
  cpc: {
    name: 'CPC',
    whatIs: 'עלות ממוצעת של קליק על מודעה.',
    formula: 'Spend / Clicks',
    good: 'תלוי בנישה. שווה לעקוב למגמה — עלייה חדה היא סימן אזהרה.',
  },
  cpa: {
    name: 'CPA',
    whatIs: 'עלות ממוצעת לרכישה. כמה הוצאתי בפרסום כדי להביא לקוח אחד.',
    formula: 'Spend / Conversions',
    context: 'מתחת לרווח גולמי לפר-לקוח = הקמפיין רווחי.',
  },
  conversions: {
    name: 'המרות',
    whatIs: 'מספר רכישות שיוחסו לקמפיין על ידי Meta/Google.',
    context: 'יכול להיות שונה ממספר ההזמנות ב-Shopify בגלל attribution windows.',
  },
  conversionValue: {
    name: 'ערך המרות',
    whatIs: 'סך כל ההכנסות מהמרות שיוחסו לקמפיין, במטבע החשבון מומר ל-CAD.',
    context: 'הפלטפורמות מדווחות זאת בפיגור של 24-72 שעות.',
  },
};
