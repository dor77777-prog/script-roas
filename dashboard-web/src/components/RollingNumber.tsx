'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * RollingNumber — animates a numeric value to a new value over a short
 * duration. Inspired by motion-number / Stripe's KPI tick animation:
 * when the underlying data refreshes, the visible digit "rolls" from
 * the old value to the new one rather than crossfading abruptly.
 *
 * Implementation notes:
 *  - Uses a spring-like ease-out-cubic (not bounce) — research said
 *    bouncy easings feel dated for fintech dashboards.
 *  - Total animation budget: 400-700ms (longer for bigger jumps,
 *    capped). Anything past ~700ms feels sluggish on a live dashboard.
 *  - Respects prefers-reduced-motion: in that mode it snaps to the new
 *    value instantly (no animation).
 *  - Formats via a caller-provided function so currency / sign / etc.
 *    rules stay co-located with how the number is rendered elsewhere.
 *  - Tabular-nums on the wrapping element so the width doesn't twitch
 *    while digits roll.
 */

type Props = {
  value: number;
  /** Function that converts the live numeric value into a string for
   *  display. Pass null to skip animation and render raw. */
  format: (n: number) => string;
  /** Override animation duration in ms (default: scales 400-700 with delta). */
  durationMs?: number;
  className?: string;
};

export function RollingNumber({ value, format, durationMs, className }: Props) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Respect prefers-reduced-motion: snap, no animation.
    if (typeof window !== 'undefined') {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        setDisplay(value);
        fromRef.current = value;
        return;
      }
    }

    // Skip animation on the first commit (mount) — animate only on updates.
    if (fromRef.current === value) return;

    const from = display;
    const to = value;
    fromRef.current = to;

    // Duration scales with the relative size of the change. Tiny diffs animate
    // quickly so the dashboard feels snappy; big diffs get a touch more time
    // so the eye can track the count.
    const fallbackBase = Math.max(Math.abs(to), Math.abs(from), 1);
    const relChange = Math.abs(to - from) / fallbackBase;
    const auto = 400 + Math.min(300, Math.round(relChange * 1200));
    const duration = durationMs ?? auto;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    function tick(t: number) {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / duration);
      // ease-out-cubic — matches the rest of the dashboard's motion system
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (to - from) * eased;
      setDisplay(next);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        startRef.current = null;
        rafRef.current = null;
      }
    }
    startRef.current = null;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      startRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return (
    <span className={cn('tabular-nums', className)}>
      {format(display)}
    </span>
  );
}
