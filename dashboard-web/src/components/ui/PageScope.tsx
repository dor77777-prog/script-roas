import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * PageScope — the scope line that lives directly under every top-level page
 * H1 to tell the operator *what they are looking at*: which store, which
 * platform (when relevant), which date range, and which currency.
 *
 * Read order (RTL DOM order): store → platform → range → currency → extra.
 * The DOM order is the canonical reading order — the visual order on screen is
 * flipped automatically by the page's `dir="rtl"` ancestor.
 *
 * Latin identifiers (store, platform, currency) are wrapped in `<bdi dir="ltr">`
 * so they render LTR inside the surrounding RTL run without flipping their
 * internal character order (e.g. "uzoshop", "Meta", "CAD" stay readable).
 * The range label is Hebrew text (e.g. "30 ימים") and must stay RTL — so it is
 * NOT wrapped in <bdi>.
 *
 * Consumed by every top-level page header in Wave 5 Task 5.9. The date-range
 * picker on the ROAS chart is a separate component (RoasTargetChart, Task 3.X)
 * — PageScope only displays the active range label.
 */
export interface PageScopeProps {
  store: string;
  platform?: string;
  rangeLabel: string;
  currency?: string;
  extra?: ReactNode;
  className?: string;
}

export function PageScope({
  store,
  platform,
  rangeLabel,
  currency = 'CAD',
  extra,
  className,
}: PageScopeProps) {
  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-2 text-xs text-ink-muted tabular-nums',
        className,
      )}
      role="status"
      aria-label="scope"
    >
      <span data-scope-item>
        <bdi dir="ltr">{store}</bdi>
      </span>
      {platform && (
        <>
          <span aria-hidden>•</span>
          <span data-scope-item>
            <bdi dir="ltr">{platform}</bdi>
          </span>
        </>
      )}
      <span aria-hidden>•</span>
      <span data-scope-item>{rangeLabel}</span>
      <span aria-hidden>•</span>
      <span data-scope-item>
        <bdi dir="ltr">{currency}</bdi>
      </span>
      {extra && (
        <>
          <span aria-hidden>•</span>
          {extra}
        </>
      )}
    </div>
  );
}
