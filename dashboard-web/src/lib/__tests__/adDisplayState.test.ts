import { describe, it, expect } from 'vitest';
import { adDisplayState, isStoreFullyOff, adDisplayBand } from '@/lib/adState';

describe('adDisplayState — gated on off && spend===0', () => {
  it('normal when not off', () => {
    expect(adDisplayState({ revenue: 100, spend: 50, off: false })).toBe('normal');
  });
  it('normal when off but spend>0 (historical row, never retroactively rewritten)', () => {
    expect(adDisplayState({ revenue: 100, spend: 50, off: true })).toBe('normal');
  });
  it('organic when off + spend 0 + revenue>0', () => {
    expect(adDisplayState({ revenue: 100, spend: 0, off: true })).toBe('organic');
  });
  it('off-empty when off + spend 0 + revenue 0', () => {
    expect(adDisplayState({ revenue: 0, spend: 0, off: true })).toBe('off-empty');
  });
  it('off-negative when off + spend 0 + revenue<0', () => {
    expect(adDisplayState({ revenue: -20, spend: 0, off: true })).toBe('off-negative');
  });
  it('treats null spend/revenue as 0', () => {
    expect(adDisplayState({ revenue: null, spend: null, off: true })).toBe('off-empty');
  });
});

describe('isStoreFullyOff — ALL applicable platforms off', () => {
  it('false when no applicable platforms', () => {
    expect(isStoreFullyOff('uzoshop', {}, [])).toBe(false);
  });
  it('false when at least one applicable platform is on', () => {
    const map = { 'uzoshop:meta': false }; // google still on (missing = on)
    expect(isStoreFullyOff('uzoshop', map, ['meta', 'google'])).toBe(false);
  });
  it('true only when every applicable platform is off', () => {
    const map = { 'uzoshop:meta': false, 'uzoshop:google': false };
    expect(isStoreFullyOff('uzoshop', map, ['meta', 'google'])).toBe(true);
  });
});

describe('adDisplayBand — off-state → band override (null = normal)', () => {
  it('organic → blue', () => expect(adDisplayBand('organic')).toBe('blue'));
  it('off-empty → gray', () => expect(adDisplayBand('off-empty')).toBe('gray'));
  it('off-negative → gray', () => expect(adDisplayBand('off-negative')).toBe('gray'));
  it('normal → null (caller keeps existing band)', () => expect(adDisplayBand('normal')).toBeNull());
});
