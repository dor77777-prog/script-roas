import { describe, it, expect } from 'vitest';
import { firstClickDelta } from '@/components/firstClickDelta';

describe('firstClickDelta', () => {
  it('positive delta when first-click ROAS exceeds last-click', () => {
    const d = firstClickDelta(3, 2)!;
    expect(d.delta).toBeCloseTo(1, 6);
    expect(d.direction).toBe('up');
    expect(d.label).toContain('+'); // "+1.00x" style
  });

  it('negative delta when first-click is below last-click', () => {
    const d = firstClickDelta(1.5, 2.5)!;
    expect(d.delta).toBeCloseTo(-1, 6);
    expect(d.direction).toBe('down');
  });

  it('flat when equal', () => {
    const d = firstClickDelta(2, 2)!;
    expect(d.delta).toBe(0);
    expect(d.direction).toBe('flat');
  });

  it('null when either side is non-finite (no comparison possible)', () => {
    expect(firstClickDelta(NaN, 2)).toBeNull();
    expect(firstClickDelta(2, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('null when last-click ROAS is 0 (cannot frame a meaningful delta)', () => {
    expect(firstClickDelta(3, 0)).toBeNull();
  });
});
