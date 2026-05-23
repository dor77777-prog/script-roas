import { describe, expect, it } from 'vitest';
import { computeSparklineGeometry } from '@/lib/sparklineGeometry';

/**
 * Regression suite for c/HI-05 (audit-2026-05-23-v2). The old inline math
 * in Sparkline.tsx used `const range = max - min || 1;` which silently
 * coerced a degenerate range (all-equal values) to 1; the Y formula then
 * placed every point at the BOTTOM of the chart box, regardless of value.
 * A constant ROAS of 3.0 visually read as "trending toward zero."
 */
describe('computeSparklineGeometry', () => {
  const W = 96;
  const H = 28;
  const PAD = 2;
  const innerH = H - PAD * 2; // 24
  const innerW = W - PAD * 2; // 92
  const expectedCenterY = PAD + innerH / 2; // 14

  describe('degenerate input (c/HI-05 regression)', () => {
    it('centers the line vertically when all values are identical', () => {
      const { points, degenerate } = computeSparklineGeometry([3, 3, 3, 3, 3], W, H, PAD);
      expect(degenerate).toBe(true);
      // Every point must sit at the vertical center of the box, NOT at the
      // bottom (which was the old `range = 0 || 1` bug). This is the load-
      // bearing assertion for c/HI-05.
      for (const p of points) {
        expect(p.y).toBeCloseTo(expectedCenterY, 5);
      }
    });

    it('centers when all values equal the target', () => {
      const { points, targetY, degenerate } = computeSparklineGeometry(
        [3, 3, 3, 3],
        W,
        H,
        PAD,
        3,
      );
      expect(degenerate).toBe(true);
      for (const p of points) {
        expect(p.y).toBeCloseTo(expectedCenterY, 5);
      }
      expect(targetY).toBeCloseTo(expectedCenterY, 5);
    });

    it('handles all-zero values without producing NaN or Infinity', () => {
      const { points, degenerate } = computeSparklineGeometry([0, 0, 0], W, H, PAD);
      expect(degenerate).toBe(true);
      for (const p of points) {
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.y).toBeCloseTo(expectedCenterY, 5);
      }
    });
  });

  describe('non-degenerate input', () => {
    it('places min value at the BOTTOM of the box and max at the TOP', () => {
      const { points, degenerate } = computeSparklineGeometry([10, 30], W, H, PAD);
      expect(degenerate).toBe(false);
      // Y is inverted in SVG — the "top" is the small Y.
      const minY = PAD; // value 30 (max) → top of box
      const maxY = PAD + innerH; // value 10 (min) → bottom of box
      expect(points[1].y).toBeCloseTo(minY, 5);
      expect(points[0].y).toBeCloseTo(maxY, 5);
    });

    it('positions middle values proportionally', () => {
      const { points } = computeSparklineGeometry([0, 50, 100], W, H, PAD);
      // Value 50 sits exactly at the chart's vertical midpoint.
      expect(points[1].y).toBeCloseTo(PAD + innerH * 0.5, 5);
    });

    it('spaces X coordinates evenly across innerW', () => {
      const { points } = computeSparklineGeometry([1, 2, 3, 4, 5], W, H, PAD);
      expect(points).toHaveLength(5);
      expect(points[0].x).toBeCloseTo(PAD, 5);
      expect(points[4].x).toBeCloseTo(PAD + innerW, 5);
      // Evenly spaced — equal step.
      const step = points[1].x - points[0].x;
      expect(step).toBeGreaterThan(0);
      for (let i = 1; i < points.length; i++) {
        expect(points[i].x - points[i - 1].x).toBeCloseTo(step, 5);
      }
    });

    it('includes target in the min/max for axis alignment', () => {
      // Values 5..7, target 10 — target is the new max, so the data should
      // compress into the lower part of the chart.
      const { points, targetY } = computeSparklineGeometry([5, 6, 7], W, H, PAD, 10);
      // Target at the top (smallest Y = pad)
      expect(targetY).toBeCloseTo(PAD, 5);
      // Max data point (7) should land between center and the target line,
      // strictly below the target.
      expect(points[2].y).toBeGreaterThan(PAD);
    });

    it('targetY is null when no target is given', () => {
      const { targetY } = computeSparklineGeometry([1, 2, 3], W, H, PAD);
      expect(targetY).toBeNull();
    });
  });
});
