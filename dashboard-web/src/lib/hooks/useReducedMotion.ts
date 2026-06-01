'use client';

import { useEffect, useState } from 'react';

/**
 * `useReducedMotion` — reactive read of the OS "reduce motion" preference.
 *
 * Returns `true` when `prefers-reduced-motion: reduce` matches. SSR-safe
 * (returns `false` when there is no `window`/`matchMedia`). Subscribes to the
 * media query so a runtime preference change is reflected.
 *
 * Components use this to GATE JS-driven entrance/pulse animation CLASSES (the
 * CSS-level `@media (prefers-reduced-motion: reduce)` sweep in globals.css
 * already neutralises every animation/transition duration globally, but a
 * class-level gate lets a component decide NOT to apply an animation class at
 * all — e.g. so a freshly-arrived feed row never even queues a slide-in — and
 * is the part the DOM tests can assert on, since jsdom does not evaluate the
 * CSS media query). The DOM test runner's matchMedia stub reports `true` for
 * this query by default.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    // addEventListener is the modern API; older Safari needs addListener.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}
