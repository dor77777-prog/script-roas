import { describe, it, expect } from 'vitest';
import { bandForRoas, isSpendAlarm, ALARM_SPEND_THRESHOLD_CAD } from '@/lib/roasBands';
describe('roasBands single source', () => {
  it('locked thresholds', () => {
    expect(bandForRoas(1.99)).toBe('red');
    expect(bandForRoas(2.0)).toBe('orange');
    expect(bandForRoas(2.69)).toBe('orange');
    expect(bandForRoas(2.7)).toBe('green');
    expect(bandForRoas(3.0)).toBe('green');
    expect(bandForRoas(3.01)).toBe('blue');
  });
  it('gray when no spend', () => { expect(bandForRoas(0, { spend: 0 })).toBe('gray'); });
  it('gray wins over the threshold ladder when spend is 0', () => {
    expect(bandForRoas(5, { spend: 0 })).toBe('gray');
  });
  it('unnormalized input falls through to red (callers own null/NaN/≤0 normalization)', () => {
    expect(bandForRoas(NaN)).toBe('red'); // fall-through, not policy
    expect(bandForRoas(0)).toBe('red');   // fall-through, not policy
    expect(bandForRoas(-1)).toBe('red');  // fall-through, not policy
  });
  it('alarm ONLY above $100 spend with zero sales', () => {
    expect(ALARM_SPEND_THRESHOLD_CAD).toBe(100);
    expect(isSpendAlarm({ spend: 148, revenue: 0 })).toBe(true);
    expect(isSpendAlarm({ spend: 99,  revenue: 0 })).toBe(false);
    expect(isSpendAlarm({ spend: 148, revenue: 12 })).toBe(false);
    expect(isSpendAlarm({ spend: ALARM_SPEND_THRESHOLD_CAD, revenue: 0 })).toBe(false); // exactly $100 = still 'morning'
  });
});
