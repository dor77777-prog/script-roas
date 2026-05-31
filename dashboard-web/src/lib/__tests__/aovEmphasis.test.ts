import { describe, expect, it } from 'vitest';
import { aovEmphasis } from '../format/aovEmphasis';

/**
 * Task 1.5 — semantic AOV emphasis classifier.
 *
 * Thresholds (CAD):
 *   aov > 70  → 'aov-good'  (green ▴)
 *   aov < 50  → 'aov-bad'   (red ▾)
 *   otherwise → 'aov-mid'   (neutral white)
 *
 * Null / undefined / NaN must yield `null` so the caller can omit
 * the className entirely (no CSS hook ⇒ no semantic colour applied).
 */
describe('aovEmphasis', () => {
  // ── plan-required cases ────────────────────────────────────────────
  it('returns "aov-good" for clearly-good AOV (80 CAD)', () => {
    expect(aovEmphasis(80)).toBe('aov-good');
  });

  it('returns "aov-bad" for clearly-bad AOV (45 CAD)', () => {
    expect(aovEmphasis(45)).toBe('aov-bad');
  });

  it('returns "aov-mid" for in-band AOV (60 CAD)', () => {
    expect(aovEmphasis(60)).toBe('aov-mid');
  });

  it('returns null for nullish AOV (no class applied)', () => {
    expect(aovEmphasis(null)).toBeNull();
  });

  // ── boundary cases — strict > 70 and < 50 ──────────────────────────
  it('treats exactly 70 as "aov-mid" (strict > 70 threshold)', () => {
    expect(aovEmphasis(70)).toBe('aov-mid');
  });

  it('treats 70.01 as "aov-good" (just over threshold)', () => {
    expect(aovEmphasis(70.01)).toBe('aov-good');
  });

  it('treats exactly 50 as "aov-mid" (strict < 50 threshold)', () => {
    expect(aovEmphasis(50)).toBe('aov-mid');
  });

  it('treats 49.99 as "aov-bad" (just under threshold)', () => {
    expect(aovEmphasis(49.99)).toBe('aov-bad');
  });

  // ── nullish + NaN variants ────────────────────────────────────────
  it('returns null for undefined', () => {
    expect(aovEmphasis(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(aovEmphasis(NaN)).toBeNull();
  });

  // ── extreme values ────────────────────────────────────────────────
  it('handles very large AOV as good', () => {
    expect(aovEmphasis(10_000)).toBe('aov-good');
  });

  it('handles zero AOV as bad', () => {
    expect(aovEmphasis(0)).toBe('aov-bad');
  });

  it('handles negative AOV as bad', () => {
    expect(aovEmphasis(-15)).toBe('aov-bad');
  });
});
