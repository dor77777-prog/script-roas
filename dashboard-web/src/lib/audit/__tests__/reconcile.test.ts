import { describe, it, expect } from 'vitest';
import { withinTolerance, agree, type Violation } from '../reconcile';

describe('withinTolerance (cross-source L2: ≤1% OR ≤$1)', () => {
  it('passes when absolute diff ≤ $1 even if pct large', () => {
    expect(withinTolerance(0.5, 1.4)).toBe(true); // diff 0.9 ≤ $1
  });
  it('passes when pct diff ≤ 1% even if absolute large', () => {
    expect(withinTolerance(10000, 10090)).toBe(true); // 0.9% ≤ 1%
  });
  it('fails when both pct > 1% and abs > $1', () => {
    expect(withinTolerance(100, 110)).toBe(false); // 10% and $10
  });
  it('treats two zeros as equal', () => {
    expect(withinTolerance(0, 0)).toBe(true);
  });
});

describe('agree (same-source L1: exact within epsilon)', () => {
  it('passes for floats within epsilon', () => {
    expect(agree([6736.19, 6736.1900001, 6736.19]).length).toBe(0);
  });
  it('returns a violation when one source diverges', () => {
    const v: Violation[] = agree([100, 100, 137], { label: 'revenue' });
    expect(v.length).toBe(1);
    expect(v[0].label).toBe('revenue');
  });
});

describe('boundary cases', () => {
  it('withinTolerance passes at the $1 floor and fails just past both thresholds', () => {
    expect(withinTolerance(100, 101)).toBe(true);   // exactly $1 → within abs floor
    expect(withinTolerance(100, 102)).toBe(false);  // $2 and 2% → fails both
  });
  it('withinTolerance handles one-side-zero via the non-zero denominator', () => {
    expect(withinTolerance(0, 0.99)).toBe(true);    // ≤ $1
    expect(withinTolerance(0, 1.01)).toBe(false);   // > $1 and 100%
  });
  it('agree returns [] for a single-element array', () => {
    expect(agree([42])).toEqual([]);
  });
  it('agree detects an outlier regardless of position', () => {
    expect(agree([100, 137, 100], { label: 'mid' }).length).toBe(1);
  });
  it('agree tolerates a tiny spread on all-negative values', () => {
    expect(agree([-1000.00, -1000.005]).length).toBe(0); // spread 0.005 ≤ 1¢ floor
  });
});
