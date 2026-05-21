'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * newlines are not consistently rendered as line breaks.
 *
 * Why a React Portal to document.body? The dashboard's daily-detail and
 * monthly tables wrap their content in `<div className="overflow-auto
 * max-h-[70vh]">`. Tooltips on the bottom row (or top row when flipped)
 * get clipped by that wrapper. Portal + position:fixed escapes the
 * wrapper entirely and lets the tooltip float above all DOM ancestors.
 *
 * Auto-flip: on open, the tooltip measures the icon's bounding rect and
 * compares space-below vs space-above in the viewport. If there's less
 * than the tooltip's estimated height below, it flips to above.
 *
 * Mobile UX: tap toggles open/closed. Document mousedown handler closes
 * the tooltip on outside taps. The icon is 14px (touch target) sitting
 * in a 24×24 hit region via inline-flex padding.
 */

type TooltipPos = {
  top: number;
  left: number;
  placement: 'above' | 'below';
};

const TOOLTIP_HEIGHT_ESTIMATE = 88; // px — header + 2 lines + padding
const TOOLTIP_WIDTH_ESTIMATE = 200; // px — min-width 170 + padding
const GAP = 6; // px between icon and tooltip

function computePosition(anchor: DOMRect): TooltipPos {
  if (typeof window === 'undefined') {
    return { top: 0, left: 0, placement: 'below' };
  }
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spaceBelow = vh - anchor.bottom;
  const spaceAbove = anchor.top;

  // Default below; flip to above only if below doesn't fit AND above does.
  let placement: 'above' | 'below' = 'below';
  if (spaceBelow < TOOLTIP_HEIGHT_ESTIMATE && spaceAbove > spaceBelow) {
    placement = 'above';
  }

  // Right-align the tooltip's right edge to the icon's right edge in RTL.
  // In LTR pages the tooltip would otherwise stick out off-screen on the
  // right; clamp so the tooltip stays within the viewport.
  const desiredRight = anchor.right;
  let left = desiredRight - TOOLTIP_WIDTH_ESTIMATE;
  if (left < 8) left = 8;
  if (left + TOOLTIP_WIDTH_ESTIMATE > vw - 8) {
    left = vw - TOOLTIP_WIDTH_ESTIMATE - 8;
  }

  const top =
    placement === 'below'
      ? anchor.bottom + GAP
      : anchor.top - TOOLTIP_HEIGHT_ESTIMATE - GAP;
  return { top, left, placement };
}

export function RefundIndicator(props: {
  grossRevenue: number | null;
  refundDeduction: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const { grossRevenue, refundDeduction } = props;

  // Compute portal position whenever the tooltip opens (and refresh on
  // window scroll/resize while it stays open — anchor moves with the
  // user's scrolling).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (btnRef.current) {
        setPos(computePosition(btnRef.current.getBoundingClientRect()));
      }
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Close on click outside.
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
        ref={btnRef}
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
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: TOOLTIP_WIDTH_ESTIMATE - 32,
            }}
            className="z-[9999] px-3 py-2 rounded-md shadow-xl bg-slate-900 text-white text-xs leading-relaxed pointer-events-none text-start"
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
          </span>,
          document.body,
        )}
    </span>
  );
}
