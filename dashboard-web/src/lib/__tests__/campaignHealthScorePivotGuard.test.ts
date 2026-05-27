import { describe, it, expect } from 'vitest';
import { roasToScore } from '@/lib/campaignHealthScore';

// A6 latent ÷0 guard (2026-05-27): the profitability score maps
// [1.0, pivot] → [0, 100] via `(baseRoas - 1) / (pivot - 1)`. A pivot of
// exactly 1.0 would make the denominator 0 → Infinity/NaN. `roasToScore`
// floors the pivot so the result is always finite & clamped to [0, 100].
describe('roasToScore — pivot ÷0 latent guard (A6)', () => {
  it('a pivot of 1.0 never produces Infinity or NaN', () => {
    const score = roasToScore(2.0, 1.0);
    expect(Number.isFinite(score)).toBe(true);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('a pivot of exactly 1.0 with a ROAS above break-even clamps to 100', () => {
    // With the 1.01 floor, any ROAS > 1.01 saturates the [1.0, 1.01] band.
    expect(roasToScore(2.0, 1.0)).toBe(100);
  });

  it('still maps the normal band correctly (Meta pivot 3.0)', () => {
    expect(roasToScore(1.0, 3.0)).toBe(0); // break-even
    expect(roasToScore(2.0, 3.0)).toBe(50); // healthy
    expect(roasToScore(3.0, 3.0)).toBe(100); // great
    expect(roasToScore(4.0, 3.0)).toBe(100); // clamps above pivot
  });

  it('clamps a below-break-even ROAS to 0 regardless of pivot', () => {
    expect(roasToScore(0.5, 1.0)).toBe(0);
    expect(roasToScore(0.5, 3.0)).toBe(0);
  });
});
