'use client';

import { useEffect, useRef, useState } from 'react';

export interface UseCountUpOptions {
  /** Animation duration in ms. Default 900 (matches the approved mockup tween). */
  durationMs?: number;
}

/** ease-out cubic — quick start, gentle settle. Mirrors the mockup's tween. */
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

/**
 * Reads the OS reduced-motion preference. SSR-safe (returns false when there
 * is no `window`/`matchMedia`). In the DOM test runner the matchMedia stub is
 * configured to report `true` for this query so count-ups render their FINAL
 * value synchronously and existing number assertions keep passing.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * `useCountUp` — animate a number from its currently-displayed value up to
 * `target`, easing out over `durationMs`, using `requestAnimationFrame`.
 *
 * Behaviour:
 *   • First client mount climbs from 0 → target (the "numbers come alive"
 *     effect). Subsequent target changes (e.g. switching the date range)
 *     spring from the CURRENTLY-DISPLAYED value → the new target, so a
 *     mid-flight retarget continues smoothly instead of snapping back to 0.
 *   • `prefers-reduced-motion: reduce` → no animation; the value jumps to the
 *     target immediately (accessibility default, also how the DOM tests run).
 *   • `target == null` / `NaN` → returns 0 and resets the spring origin to 0,
 *     so the caller can render an em-dash and the next real value climbs from
 *     scratch. (Callers decide the placeholder; the hook only returns numbers.)
 *
 * SSR note: the lazy initialiser returns the final value on the server. Real
 * dashboard numbers are client-fetched (the hero/cards show skeletons during
 * SSR), so this branch never renders an actual value server-side and there is
 * no hydration mismatch; on the client the initialiser climbs from 0.
 */
export function useCountUp(
  target: number | null | undefined,
  options: UseCountUpOptions = {},
): number {
  const { durationMs = 900 } = options;
  // Reject null / NaN / ±Infinity — a non-finite target would interpolate to
  // NaN mid-tween (0 + (Infinity−0)·eased) and blank the number. Caller renders
  // the em-dash placeholder for the null result.
  const safeTarget =
    target == null || !Number.isFinite(target) ? null : target;

  const [value, setValue] = useState<number>(() => {
    if (safeTarget == null) return 0;
    if (typeof window === 'undefined') return safeTarget; // SSR baseline
    return prefersReducedMotion() ? safeTarget : 0;
  });

  // Currently-displayed value, kept in a ref so the rAF loop can read the live
  // number without re-subscribing the effect on every frame. Updated each
  // render so a retarget starts from where the eye currently sees the number.
  const valueRef = useRef<number>(value);
  valueRef.current = value;

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (safeTarget == null) {
      setValue(0);
      return;
    }
    if (prefersReducedMotion()) {
      setValue(safeTarget);
      return;
    }
    const from = valueRef.current;
    const to = safeTarget;
    if (from === to) {
      setValue(to);
      return;
    }
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start == null) start = ts;
      const p = Math.min(1, (ts - start) / durationMs);
      setValue(from + (to - from) * easeOutCubic(p));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [safeTarget, durationMs]);

  return safeTarget == null ? 0 : value;
}
