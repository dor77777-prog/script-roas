'use client';

import { useEffect, useState } from 'react';

/**
 * `useIsMobile` — reactive viewport-width breakpoint hook.
 *
 * Returns `true` when the viewport is at/below the phone breakpoint. Used to
 * switch the home page (and other surfaces) into a compact, thumb-friendly
 * mobile layout WITHOUT touching the md+ desktop experience (which the
 * operator likes as-is). Pairs with Tailwind's responsive classes for the
 * purely-CSS parts; this hook is for the cases that need a JS branch
 * (e.g. render a swipeable carousel vs a grid, or a bottom-sheet vs a modal).
 *
 * Mirrors ThemeProvider's matchMedia pattern: a lazy SSR-safe initializer +
 * a `change` listener so it stays in sync on resize / orientation change.
 *
 * @param maxWidthPx the phone breakpoint (default 767 = just below Tailwind `md`).
 *
 * SSR note: returns `false` on the server (desktop-first baseline) so the
 * first client paint matches the SSR markup; the effect then corrects it on
 * mount. Components that must avoid a one-frame desktop flash on a real phone
 * can gate their mobile-only enhancement on `mounted` if needed, but for the
 * home layout the correction is imperceptible (it runs before paint via the
 * synchronous initializer on the client).
 */
export function useIsMobile(maxWidthPx = 767): boolean {
  const query = `(max-width: ${maxWidthPx}px)`;

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false; // SSR baseline (desktop)
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    setIsMobile(mq.matches);
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);

  return isMobile;
}
