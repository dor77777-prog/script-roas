/**
 * roasBandRounding.test.ts — FIX #24 (display-rounding crosses band thresholds).
 *
 * Bug: the band was classified from the UNROUNDED ROAS while the displayed
 * digits are rounded to 2 decimals. A value like 2.698 displays as "2.70"
 * (green territory) but `bandForRoas(2.698)` returned 'orange' (since
 * 2.698 < 2.7) — the painted colour belonged to the LOWER band than the
 * digits shown.
 *
 * Fix: classify from the SAME rounded-to-2dp value that is displayed, done
 * INSIDE bandForRoas so every ROAS surface is fixed at once.
 */
import { describe, expect, it } from 'vitest';
import { bandForRoas } from '@/lib/roasBands';

describe('bandForRoas — bands the DISPLAYED (2dp-rounded) value (FIX #24)', () => {
  it('2.698 displays as 2.70 → band must be green (matches the rounded reading)', () => {
    // toFixed(2) of 2.698 is "2.70" → the displayed number is at the green
    // threshold, so the band must be green, not the unrounded orange.
    expect(Number((2.698).toFixed(2))).toBe(2.7);
    expect(bandForRoas(2.698)).toBe('green');
  });

  it('1.998 displays as 2.00 → band must be orange (crosses red→orange)', () => {
    expect(Number((1.998).toFixed(2))).toBe(2.0);
    expect(bandForRoas(1.998)).toBe('orange');
  });

  it('3.006 displays as 3.01 → band must be blue (rounds above target)', () => {
    expect(Number((3.006).toFixed(2))).toBe(3.01);
    expect(bandForRoas(3.006)).toBe('blue');
  });

  it('2.994 displays as 2.99 → band stays green (does NOT round up to blue)', () => {
    expect(Number((2.994).toFixed(2))).toBe(2.99);
    expect(bandForRoas(2.994)).toBe('green');
  });

  it('1.994 displays as 1.99 → band stays red (does NOT round up to orange)', () => {
    expect(Number((1.994).toFixed(2))).toBe(1.99);
    expect(bandForRoas(1.994)).toBe('red');
  });

  it('values already at 2 decimals are unchanged (no-regression)', () => {
    expect(bandForRoas(1.99)).toBe('red');
    expect(bandForRoas(2.0)).toBe('orange');
    expect(bandForRoas(2.69)).toBe('orange');
    expect(bandForRoas(2.7)).toBe('green');
    expect(bandForRoas(3.0)).toBe('green');
    expect(bandForRoas(3.01)).toBe('blue');
  });

  it('spend===0 still wins → gray, regardless of rounding', () => {
    expect(bandForRoas(2.698, { spend: 0 })).toBe('gray');
  });
});
