'use client';

import { useCountUp } from '@/lib/hooks/useCountUp';

export interface CountUpProps {
  /** Target number. `null`/`undefined`/`NaN` → renders the em-dash placeholder. */
  value: number | null | undefined;
  /** Formats a numeric frame to its display string (called every frame). */
  format: (n: number) => string;
  /** Animation duration in ms. Default 900 (matches the approved mockup). */
  durationMs?: number;
  className?: string;
}

/**
 * `<CountUp>` — animated number that climbs from 0 (then between values on
 * change) up to `value`, formatting each frame via `format`. Reduced-motion
 * aware + SSR-safe through {@link useCountUp}.
 *
 * For MONEY use `<Money countUp>` instead — it keeps the overflow-safe compact
 * floor + exact-value title/sr-only. `<CountUp>` is for non-money readouts
 * (ROAS `x.xx`, order counts) where the caller owns the formatter. Renders an
 * inline `<span>`; size/colour/`tabular-nums` are inherited from the wrapping
 * element (these readouts already sit inside a styled `<bdi dir="ltr">`).
 */
export function CountUp({ value, format, durationMs, className }: CountUpProps) {
  const animated = useCountUp(value, { durationMs });
  const isEmpty = value == null || Number.isNaN(value);
  return <span className={className}>{isEmpty ? '—' : format(animated)}</span>;
}
