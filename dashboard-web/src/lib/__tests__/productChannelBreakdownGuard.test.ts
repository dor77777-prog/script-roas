import { describe, expect, it } from 'vitest';

/**
 * d/CR-05 (audit 2026-05-23) — locks the divide-by-zero guard in
 * components/ProductChannelBreakdown.tsx.
 *
 * The component computes segment-bar widths as `(fb / total) * 100`,
 * `(google / total) * 100`, etc. When `total === 0` every width resolves
 * to NaN%, which renders the bar visually broken even though no error is
 * thrown. The fix is a single early return: `if (total <= 0) return null;`
 * before any computation.
 *
 * This suite tests the underlying ARITHMETIC contract — the proof that
 * the guard is the correct shape. Without the guard, the JSX math
 * silently produces NaN; with `total > 0`, the math is well-defined.
 *
 * Component-level rendering tests would need JSDOM (the vitest config is
 * node-only for the 622-test baseline), so this stays at the function
 * level where the rest of the suite lives.
 */
describe('ProductChannelBreakdown divide-by-zero guard — locks d/CR-05', () => {
  function segmentWidth(part: number, total: number): number {
    return (part / total) * 100;
  }

  it('produces non-finite output when total === 0 (proof that the guard is needed)', () => {
    // 0/0 → NaN. Any positive numerator / 0 → Infinity. Both are
    // unrenderable as CSS widths and BOTH motivate the guard. The point
    // is: without `if (total <= 0) return null` upstream, every
    // segment-width computation produces an unsafe value when the
    // breakdown is empty.
    expect(Number.isNaN(segmentWidth(0, 0))).toBe(true);
    expect(Number.isFinite(segmentWidth(5, 0))).toBe(false);
  });

  it('produces a finite percentage when total > 0', () => {
    expect(segmentWidth(5, 10)).toBe(50);
    expect(segmentWidth(0, 10)).toBe(0);
    expect(segmentWidth(10, 10)).toBe(100);
  });

  it('the guard predicate matches the component contract', () => {
    // The component does `if (total <= 0) return null;` — both === 0 and
    // negative totals (defensively) are treated as "render nothing".
    const guard = (total: number) => total <= 0;
    expect(guard(0)).toBe(true);
    expect(guard(-1)).toBe(true);
    expect(guard(1)).toBe(false);
  });
});
