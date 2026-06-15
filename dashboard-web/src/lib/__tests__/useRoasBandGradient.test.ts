import { describe, expect, it } from 'vitest';
import { useRoasBandGradient } from '../format/useRoasBandGradient';

/**
 * Task 1.3 — band signal helper.
 *
 * Centralises the ROAS-band threshold logic so every consumer
 * (CommandCenterHero, PerStoreRow, etc.) picks the same band for
 * the same number. Pure function despite the `use` prefix.
 *
 * Thresholds (locked, must match roasLabel() tones):
 *   zeroSalesWithSpend  → red-alarm   (TOP priority — wins over null→gray)
 *   roas < 2.0          → red
 *   2.0 ≤ roas < 2.7    → orange
 *   2.7 ≤ roas ≤ 3.0    → green  (3.0 = at target)
 *   roas > 3.0          → blue
 *   roas null/undefined → gray
 *
 * `isStale === true` propagates a `desaturate: true` flag downstream
 * (CSS layer turns it into a filter on the bar/glow).
 */

describe('useRoasBandGradient — band thresholds', () => {
  it('returns red when roas < 2.0', () => {
    expect(useRoasBandGradient(1.99)).toEqual({ band: 'red', desaturate: false });
    expect(useRoasBandGradient(0)).toEqual({ band: 'red', desaturate: false });
    expect(useRoasBandGradient(-5)).toEqual({ band: 'red', desaturate: false });
  });

  it('returns orange when 2.0 ≤ roas < 2.7', () => {
    expect(useRoasBandGradient(2.0)).toEqual({ band: 'orange', desaturate: false });
    expect(useRoasBandGradient(2.35)).toEqual({ band: 'orange', desaturate: false });
    expect(useRoasBandGradient(2.69)).toEqual({ band: 'orange', desaturate: false });
  });

  it('returns green when 2.7 ≤ roas ≤ 3.0 (3.0 = at target, lock-step with roasLabel)', () => {
    expect(useRoasBandGradient(2.7)).toEqual({ band: 'green', desaturate: false });
    expect(useRoasBandGradient(2.85)).toEqual({ band: 'green', desaturate: false });
    expect(useRoasBandGradient(2.99)).toEqual({ band: 'green', desaturate: false });
    expect(useRoasBandGradient(3.0)).toEqual({ band: 'green', desaturate: false });
  });

  it('returns blue when roas > 3.0 (above target)', () => {
    expect(useRoasBandGradient(3.01)).toEqual({ band: 'blue', desaturate: false });
    expect(useRoasBandGradient(5.4)).toEqual({ band: 'blue', desaturate: false });
    expect(useRoasBandGradient(1000)).toEqual({ band: 'blue', desaturate: false });
  });

  it('returns gray when roas is null or undefined', () => {
    expect(useRoasBandGradient(null)).toEqual({ band: 'gray', desaturate: false });
    expect(useRoasBandGradient(undefined)).toEqual({ band: 'gray', desaturate: false });
  });

  it('returns gray when roas is NaN (guard against bad math upstream)', () => {
    expect(useRoasBandGradient(Number.NaN)).toEqual({ band: 'gray', desaturate: false });
  });
});

describe('useRoasBandGradient — isStale flag', () => {
  it('propagates desaturate: true for every band when isStale=true', () => {
    expect(useRoasBandGradient(1.5, true)).toEqual({ band: 'red', desaturate: true });
    expect(useRoasBandGradient(2.4, true)).toEqual({ band: 'orange', desaturate: true });
    expect(useRoasBandGradient(2.8, true)).toEqual({ band: 'green', desaturate: true });
    expect(useRoasBandGradient(3.5, true)).toEqual({ band: 'blue', desaturate: true });
    expect(useRoasBandGradient(null, true)).toEqual({ band: 'gray', desaturate: true });
  });

  it('defaults isStale to false when omitted', () => {
    expect(useRoasBandGradient(2.85).desaturate).toBe(false);
  });
});

describe('useRoasBandGradient — red-alarm (spent money, ZERO sales)', () => {
  it('returns red-alarm when zeroSalesWithSpend=true, even with a null roas', () => {
    // The zero-sales store carries roas:null upstream — red-alarm must win
    // over the null→gray branch.
    expect(useRoasBandGradient(null, false, true)).toEqual({
      band: 'red-alarm',
      desaturate: false,
    });
  });

  it('red-alarm wins over a numeric roas branch too (defensive)', () => {
    expect(useRoasBandGradient(2.5, false, true)).toEqual({
      band: 'red-alarm',
      desaturate: false,
    });
  });

  it('propagates desaturate when isStale=true on the alarm band', () => {
    expect(useRoasBandGradient(null, true, true)).toEqual({
      band: 'red-alarm',
      desaturate: true,
    });
  });

  it('does NOT trip red-alarm when the flag is false (existing bands unchanged)', () => {
    expect(useRoasBandGradient(2.5, false, false)).toEqual({
      band: 'orange',
      desaturate: false,
    });
    // No-activity / no-data path: null roas + both flags false → gray (unchanged).
    expect(useRoasBandGradient(null, false, false)).toEqual({
      band: 'gray',
      desaturate: false,
    });
  });
});

describe('useRoasBandGradient — spentNoSales (regular RED below the alarm threshold)', () => {
  it('null roas + spentNoSales=true → regular RED, not gray (burning money is never "no data")', () => {
    // The $40-spend / $0-sales store: roas null upstream, NOT the >$100 alarm,
    // but must read red — not the neutral gray that an off store gets.
    expect(useRoasBandGradient(null, false, false, true)).toEqual({
      band: 'red',
      desaturate: false,
    });
  });

  it('the LOUD alarm still wins over plain red when BOTH flags are set (> $100 case)', () => {
    // A >$100/$0 store sets both predicates; the red-alarm branch is checked
    // first so it wins.
    expect(useRoasBandGradient(null, false, true, true)).toEqual({
      band: 'red-alarm',
      desaturate: false,
    });
  });

  it('null roas + spentNoSales=false → gray (genuine no-activity, spend === 0)', () => {
    expect(useRoasBandGradient(null, false, false, false)).toEqual({
      band: 'gray',
      desaturate: false,
    });
  });

  it('propagates desaturate on the regular-red spentNoSales band when stale', () => {
    expect(useRoasBandGradient(null, true, false, true)).toEqual({
      band: 'red',
      desaturate: true,
    });
  });

  it('spentNoSales does NOT override a real numeric ROAS (only the null branch)', () => {
    // Defensive: a genuine ratio classifies normally even if the flag leaked true.
    expect(useRoasBandGradient(2.8, false, false, true)).toEqual({
      band: 'green',
      desaturate: false,
    });
  });
});
