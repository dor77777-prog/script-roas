/**
 * Pure geometry helpers for the Sparkline component. Extracted from
 * Sparkline.tsx so the math is unit-testable independently of the SVG
 * render (vitest is configured for `node` environment + `src/lib/` glob).
 *
 * c/HI-05 (audit-2026-05-23-v2): the previous inline math used
 *   const range = max - min || 1;
 * which silently swapped a degenerate range (all-equal values, all-equal-
 * to-target) for `1`. The Y formula
 *   y = pad + (1 - (v - min) / range) * innerH
 * then evaluated to `pad + innerH` — the BOTTOM of the box — for every
 * point, regardless of the actual value. A constant ROAS of 3.0 looked
 * like "trending toward zero" instead of a centered flat line.
 *
 * The helpers below treat range === 0 as a first-class case and place
 * the line at the vertical center of the box, which correctly
 * communicates "no change."
 */

export type SparklineGeometry = {
  points: Array<{ x: number; y: number }>;
  targetY: number | null;
  /** True when min === max (and target, if present, equals them too).
   *  Caller can use this to suppress the optional target reference line
   *  since it'd visually overlap the data line. */
  degenerate: boolean;
};

/**
 * Compute the SVG-space points (and optional target Y position) for a
 * sparkline. Pure function — depends only on its inputs.
 *
 * Contract:
 *   - `values.length >= 2` is the caller's gate (mirrors the Sparkline
 *     component's early return). Passing 0 or 1 still works but renders
 *     a single point or empty path.
 *   - When all values (plus target, if any) are identical, the line is
 *     centered vertically at `pad + innerH / 2` — c/HI-05 fix.
 *   - `pad` is the px breathing room on all four sides.
 */
export function computeSparklineGeometry(
  values: ReadonlyArray<number>,
  width: number,
  height: number,
  pad: number,
  target?: number,
): SparklineGeometry {
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  // Include target in min/max so the data line never crosses the implied
  // axis without the target moving too. The previous `Math.min(...values,
  // target ?? Infinity)` worked but the Infinity sentinel was a footgun:
  // if `values` was empty the `min` collapsed to `Infinity` instead of a
  // sensible value. Use an explicit array build.
  const allVals = target !== undefined ? [...values, target] : [...values];
  if (allVals.length === 0) {
    return { points: [], targetY: null, degenerate: true };
  }
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min;
  const degenerate = range === 0;

  // c/HI-05: when range is degenerate (all values equal, possibly equal
  // to target), place every point at the vertical center of the box. The
  // operator's mental model for a flat sparkline is "centered, not
  // trending" — pinning to the bottom (the old bug) reads as "crashing".
  const centerY = pad + innerH / 2;

  const n = values.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = degenerate
      ? centerY
      : pad + (1 - (v - min) / range) * innerH;
    return { x, y };
  });

  const targetY = target !== undefined
    ? (degenerate ? centerY : pad + (1 - (target - min) / range) * innerH)
    : null;

  return { points, targetY, degenerate };
}
