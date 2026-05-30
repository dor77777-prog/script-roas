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

/**
 * d/CR-08 (audit 2026-05-23): grace period before hide-on-mouseleave so
 * the cursor can transit the gap between the icon and the body-portal
 * tooltip (which is position: fixed, NOT a DOM descendant of the wrapper
 * — so any move into the tooltip fires the wrapper's onMouseLeave and
 * the tooltip used to disappear before the user could read it).
 *
 * 200ms matches OS-level tooltip dismiss timings (macOS / Win HelpTip)
 * and is short enough that an actual unintended hover doesn't linger.
 */
const HIDE_GRACE_MS = 200;

/**
 * d/CR-08: touch-device detection. On mobile, a tap fires the synthetic
 * sequence pointerdown → mouseenter → mousedown → mouseup → click →
 * mouseleave. The historic mouseenter/leave wiring made tap-to-open
 * essentially impossible: the tooltip flashed open and disappeared in
 * the same frame as the leave event from the tap-and-release motion.
 *
 * The runtime check fires once on first use, since the answer doesn't
 * change for the lifetime of the page session. Browsers without
 * pointerdown.pointerType (older iOS) fall back to ontouchstart.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    // navigator.maxTouchPoints is the canonical signal on modern browsers
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window
  );
}

export function RefundIndicator(props: {
  grossRevenue: number | null;
  refundDeduction: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // Portal ref so onMouseLeave's grace timer can be cancelled when the
  // cursor re-enters EITHER the wrapper OR the floating tooltip body.
  const portalRef = useRef<HTMLSpanElement | null>(null);
  // Grace timer for delayed-hide. Tracking via ref instead of state so we
  // can cancel synchronously inside a re-entry event handler without
  // waiting for React to flush.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { grossRevenue, refundDeduction } = props;

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
  // component (also stops the warning that would surface in StrictMode).
  useEffect(() => {
    return () => cancelHide();
  }, []);

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

  // Close on click outside. d/CR-08 (audit 2026-05-23): also treat a click
  // INSIDE the portal-rendered tooltip as "inside" — the portal is a
  // document.body descendant, NOT a wrapRef descendant, so the original
  // single-ref check would close the tooltip the moment the user clicked
  // anywhere within it (e.g., to select the amount text to copy).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideWrap = wrapRef.current?.contains(target) ?? false;
      const insidePortal = portalRef.current?.contains(target) ?? false;
      if (!insideWrap && !insidePortal) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // d/CR-08: snapshot touch-vs-mouse once on first render. The event
  // wiring below branches on this so:
  //   - touch device: ONLY the explicit click toggles open/close.
  //     mouseenter / mouseleave fire from the synthetic tap sequence
  //     (down → enter → up → leave) on iOS/Android and would otherwise
  //     close the tooltip in the same frame it opened.
  //   - mouse device: hover opens, hover-leave starts the grace timer
  //     (cancelled if the cursor re-enters wrapper OR portal). The
  //     click still toggles for keyboard users + accessibility parity.
  const touch = useRef(isTouchDevice()).current;

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
      // d/CR-08: hover-to-open only on mouse devices. On touch, the
      // synthetic mouseenter from a tap would race with the immediate
      // mouseleave from tap-and-release, closing the tooltip in the same
      // frame it opened. Touch users get explicit click-to-toggle below.
      onMouseEnter={touch ? undefined : () => { cancelHide(); setOpen(true); }}
      onMouseLeave={touch ? undefined : scheduleHide}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label="הצג פירוט החזרים"
        onClick={(e) => {
          e.stopPropagation();
          // d/CR-08: explicit toggle works on BOTH touch and mouse so the
          // keyboard / a11y story stays intact. On touch this is the ONLY
          // way the tooltip opens (no hover events bound). On mouse this
          // is a redundant manual toggle — useful for "pinning" the
          // tooltip open while the cursor moves freely.
          cancelHide();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center text-status-warning-fg hover:text-status-warning cursor-pointer"
      >
        <RotateCcw size={14} />
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={portalRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: TOOLTIP_WIDTH_ESTIMATE - 32,
            }}
            // d/CR-08: dropped `pointer-events-none` so the cursor can
            // actually transit INTO the tooltip without falling through
            // to whatever's underneath (and without firing the wrapper's
            // mouseleave). pointerEvents-auto means we own the events on
            // the tooltip surface — onMouseEnter cancels the grace timer
            // so the tooltip stays open while the mouse is inside; the
            // click-outside handler above also walks portalRef so a click
            // inside the tooltip body (e.g., to select-and-copy the
            // refund amount) doesn't dismiss.
            onMouseEnter={touch ? undefined : cancelHide}
            onMouseLeave={touch ? undefined : scheduleHide}
            className="z-[9999] px-3 py-2 rounded-md shadow-xl bg-ink text-canvas text-xs leading-relaxed text-start"
            dir="rtl"
          >
            <span className="block font-semibold text-status-warning-fg mb-1">
              יום עם החזרים
            </span>
            <span className="block">
              לפני החזרים:{' '}
              <span className="tabular-nums font-medium">{grossLabel}</span>
            </span>
            <span className="block">
              סכום החזרים:{' '}
              <span className="tabular-nums font-medium text-status-warning-fg">
                −{refundLabel}
              </span>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
