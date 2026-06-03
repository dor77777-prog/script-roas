'use client';

import { RotateCcw } from 'lucide-react';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';

/**
 * Phase 05.7.3 — refund-day indicator chip + tooltip.
 *
 * Renders next to a revenue cell when the day had material refunds
 * (`refundDeductionCad > 0`). Shows a small ↩ icon; hovering (desktop) or
 * tapping (mobile) surfaces the "before refunds" gross amount + the refund
 * amount.
 *
 * Tooltip-system-redesign — Phase 3b (2026-06-03): the bespoke
 * portal + auto-flip + isTouchDevice + grace-timer machinery has been DELETED.
 * The breakdown now rides the single sanctioned `HelpTooltip` primitive in
 * `variant="rich"` mode — desktop → Radix Popover (`role="dialog"`, portalled
 * so it escapes the `overflow-auto` table wrapper that used to clip it), touch
 * → the primitive's own ⓘ / bottom-Sheet path. One ARIA tree, one skin, one
 * dismiss model across the whole app. Numbers go through `<Money>` so they are
 * overflow-safe (tabular-nums, never clipped, exact value preserved).
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

  const breakdown = (
    <div className="leading-relaxed">
      <span className="block">
        לפני החזרים:{' '}
        {grossRevenue !== null && grossRevenue !== undefined ? (
          <Money
            value={grossRevenue}
            prefix="none"
            decimals={2}
            className="font-medium text-ink"
          />
        ) : (
          <span className="font-medium">—</span>
        )}
      </span>
      <span className="block">
        סכום החזרים:{' '}
        <span className="text-status-warningFg">
          −
          <Money
            value={refundDeduction}
            prefix="none"
            decimals={2}
            className="font-medium text-status-warningFg"
          />
        </span>
      </span>
    </div>
  );

  return (
    <span className="inline-flex items-center align-middle ms-1">
      <HelpTooltip variant="rich" title="פירוט החזרים" content={breakdown}>
        <Button
          type="button"
          variant="ghost"
          aria-label="הצג פירוט החזרים"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center text-status-warningFg hover:text-status-warningFg cursor-pointer w-auto h-auto p-0"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      </HelpTooltip>
    </span>
  );
}
