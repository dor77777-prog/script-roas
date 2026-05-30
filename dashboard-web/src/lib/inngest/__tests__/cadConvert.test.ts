import { describe, expect, it, vi } from 'vitest';
import { makeCadConvert } from '@/lib/inngest/cadConvert';

describe('makeCadConvert', () => {
  it('passes through CAD amount unchanged', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'CAD', '2026-05-30')).toBe(100);
  });

  it('multiplies by rate for non-CAD currency', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'USD', '2026-05-30')).toBe(140);
  });

  it('returns 0 for zero amount (no FX call)', async () => {
    const getRate = vi.fn().mockResolvedValue(1.4);
    const convert = makeCadConvert(getRate);
    expect(await convert(0, 'USD', '2026-05-30')).toBe(0);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('returns null for non-finite amount (no FX call)', async () => {
    const getRate = vi.fn();
    const convert = makeCadConvert(getRate);
    expect(await convert(Number.NaN, 'USD', '2026-05-30')).toBeNull();
    expect(getRate).not.toHaveBeenCalled();
  });

  it('returns null when FX getRate rejects (caller preserves prior column)', async () => {
    const convert = makeCadConvert(async () => {
      throw new Error('FX timeout');
    });
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('returns null when FX getRate returns NaN', async () => {
    const convert = makeCadConvert(async () => Number.NaN);
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('returns null when FX getRate returns <= 0', async () => {
    const convert = makeCadConvert(async () => 0);
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('uppercases currency before comparing', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'usd', '2026-05-30')).toBe(140);
  });
});
