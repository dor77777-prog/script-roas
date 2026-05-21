'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

/**
 * Phase 05.7.3 — refund-day indicator chip + tooltip.
 *
 * Renders next to a revenue cell when the day had material refunds
 * (`refundDeductionCad > 0`). Shows a small ↩ icon; hovering (desktop) or
 * tapping (mobile) surfaces a styled popover with the "before refunds"
 * gross amount + the refund amount.
 *
 * Why not the native `title` attribute? It's unreliable across browsers:
 * 1.5+ second delay before showing, no support on touch devices, and
 * newlines are not consistently rendered as line breaks. The 2026-05-21
 * first-pass implementation used `title`; users reported nothing appeared
 * on hover. Replaced with a CSS+state tooltip that pops instantly.
 *
 * Mobile UX: tap toggles open/closed. A document-level click handler
 * closes the tooltip when the user taps elsewhere — same pattern as the
 * existing CampaignDrawer trigger.
 *
 * Positioning: the tooltip is `absolute` and anchors BELOW the icon —
 * top-row tooltips would otherwise be clipped by the surrounding table
 * wrapper's `overflow-auto`. Top-anchored bubbles only show fully on the
 * last visible row; bottom-anchored bubbles work on every row except the
 * very last (an acceptable trade since the totals row is what the user
 * already sees).
 */
export function RefundIndicator(props: {
  grossRevenue: number | null;
  refundDeduction: number | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const { grossRevenue, refundDeduction } = props;

  // Close on click outside (mobile + safety for desktop)
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

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

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center align-middle ms-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="הצג פירוט החזרים"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 cursor-pointer"
      >
        <RotateCcw size={14} />
      </button>
      {open && (
        <span
          className="absolute z-50 top-full right-0 mt-1.5 px-3 py-2 rounded-md shadow-xl bg-slate-900 text-white text-xs leading-relaxed pointer-events-none text-start min-w-[170px]"
          dir="rtl"
        >
          <span className="block font-semibold text-amber-300 mb-1">
            יום עם החזרים
          </span>
          <span className="block">
            לפני החזרים:{' '}
            <span className="tabular-nums font-medium">{grossLabel}</span>
          </span>
          <span className="block">
            סכום החזרים:{' '}
            <span className="tabular-nums font-medium text-amber-200">
              −{refundLabel}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
