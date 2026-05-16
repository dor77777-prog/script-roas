'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

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

  return (
    <span className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`הסבר על ${content.name}`}
        className={cn(
          'inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors',
          subtle
            ? 'text-text-subtle hover:text-text-secondary opacity-60 hover:opacity-100'
            : 'text-text-secondary hover:text-text-primary bg-surfaceMuted hover:bg-border',
        )}
      >
        <Info size={11} />
      </button>

      {open && (
        <div
          role="tooltip"
          dir="rtl"
          // Position below the trigger; on small screens it falls back to fixed-bottom.
          className={cn(
            'absolute z-30 top-full mt-2 right-0',
            'w-[260px] sm:w-[300px] max-w-[min(90vw,320px)]',
            'rounded-xl bg-text-primary text-white p-3 shadow-elevated',
            'text-xs leading-relaxed animate-fade-in',
            'pointer-events-auto',
          )}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="font-semibold text-white mb-1.5">{content.name}</div>
          <div className="text-white/80">{content.whatIs}</div>
          {content.formula && (
            <code
              dir="ltr"
              className="inline-block mt-2 px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white/90 tabular-nums"
            >
              {content.formula}
            </code>
          )}
          {content.good && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <span className="text-emerald-300 font-semibold">טוב:</span>{' '}
              <span className="text-white/80">{content.good}</span>
            </div>
          )}
          {content.context && (
            <div className="mt-1.5 text-[10px] text-white/55">
              {content.context}
            </div>
          )}
          {/* Small triangle pointer to anchor the tooltip to the trigger */}
          <div
            aria-hidden
            className="absolute -top-1.5 right-1.5 w-2.5 h-2.5 bg-text-primary rotate-45"
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
