// src/lib/home/__tests__/revenueBasis.test.ts
import { describe, it, expect } from 'vitest';
import { netAdjustFactor } from '@/lib/home/revenueBasis';

describe('netAdjustFactor', () => {
  it('returns net/gross when both valid', () => {
    expect(netAdjustFactor(90, 100)).toEqual({ factor: 0.9, degraded: false });
  });
  it('gross <= 0 → factor 1, degraded', () => {
    expect(netAdjustFactor(0, 0)).toEqual({ factor: 1, degraded: true });
    expect(netAdjustFactor(50, 0)).toEqual({ factor: 1, degraded: true });
  });
  it('null/NaN gross or net → factor 1, degraded', () => {
    expect(netAdjustFactor(90, null as unknown as number)).toEqual({ factor: 1, degraded: true });
    expect(netAdjustFactor(NaN, 100)).toEqual({ factor: 1, degraded: true });
  });
  it('clamps to [0, 1.5] (guards bad data where net >> gross)', () => {
    expect(netAdjustFactor(300, 100).factor).toBe(1.5);
    expect(netAdjustFactor(-10, 100).factor).toBe(0);
  });
});
