'use client';

import { useEffect, useState } from 'react';

/**
 * Tooltip mode gate — POINTER CAPABILITY, not viewport width.
 *
 * 2026-06-10 audit fix: HelpTooltip's touch/desktop branch was selected with
 * the viewport-width hook (`useIsMobile`, max-width: 767px). That gave a
 * coarse-pointer TABLET ≥768px the hover-only desktop tooltips — surfaces it
 * can never open (no hover on touch), contradicting the documented pointer
 * matrix in ui/Tooltip.tsx §4.1 ("Pointer fine (desktop) / Pointer coarse
 * (touch)").
 *
 * The gate now follows the matrix directly:
 *   `(hover: none)`      → the primary input can't hover at all (phones,
 *                          most tablets) → tap-driven ⓘ affordances.
 *   `(pointer: coarse)`  → the primary pointer is imprecise (a finger),
 *                          even when a hover emulation exists → same.
 * Either one matching selects the touch modes (C/D); both false (a real
 * mouse/trackpad) selects the desktop modes (A/B).
 *
 * The 767px viewport-width check survives ONLY as a fallback for
 * environments without `window.matchMedia` — never as the primary signal.
 *
 * SSR note: returns `false` on the server (desktop-first baseline, mirrors
 * useIsMobile) so the first client paint matches the SSR markup; the mount
 * effect corrects it before interaction matters.
 */
export const TOUCH_TOOLTIP_QUERY = '(hover: none), (pointer: coarse)';

/** Width fallback breakpoint — used ONLY when matchMedia is unavailable. */
const WIDTH_FALLBACK_PX = 767;

function readTouchMode(): boolean {
  if (typeof window === 'undefined') return false; // SSR baseline (desktop)
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(TOUCH_TOOLTIP_QUERY).matches;
  }
  return window.innerWidth <= WIDTH_FALLBACK_PX;
}

export function useTouchTooltipMode(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(readTouchMode);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      // No matchMedia (very old engine / exotic embed) — width fallback,
      // re-read once on mount; no live tracking possible.
      setIsTouch(window.innerWidth <= WIDTH_FALLBACK_PX);
      return;
    }
    const mq = window.matchMedia(TOUCH_TOOLTIP_QUERY);
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    // `?.` — older Safari MediaQueryLists lack add/removeEventListener.
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return isTouch;
}
