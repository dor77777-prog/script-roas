'use client';

import { RotateCcw } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

/**
 * Phase 05.7.3 — refund-day indicator chip + tooltip.
 *
 * Renders next to a revenue cell when the day had material refunds
 * (`refundDeductionCad > 0`). Shows a small ↩ icon; hovering surfaces the
 * "before refunds" gross amount via the standard `title` tooltip — same
 * pattern as the existing roas-cell hint, no third-party tooltip lib needed.
 *
 * Renders nothing when there are no refunds or the columns aren't populated
 * (legacy rows pre-migration). The parent always passes both fields so the
 * component is the single decision point — no scattered `if (refund > 0)`
 * branches across tables.
 */
export function RefundIndicator(props: {
  grossRevenue: number | null;
  refundDeduction: number | null;
}) {
  const { grossRevenue, refundDeduction } = props;
  if (
    refundDeduction === null ||
    refundDeduction === undefined ||
    refundDeduction <= 0
  ) {
    return null;
  }
  const grossLabel =
    grossRevenue !== null && grossRevenue !== undefined
      ? formatNumber(grossRevenue)
      : '—';
  const refundLabel = formatNumber(refundDeduction);
  const tooltip = `יום עם החזרים\nלפני החזרים: ${grossLabel}\nסכום החזרים: ${refundLabel}`;
  return (
    <span
      className="inline-flex items-center justify-center align-middle ms-1 text-amber-700 dark:text-amber-300"
      title={tooltip}
      aria-label={tooltip}
    >
      <RotateCcw size={12} />
    </span>
  );
}
