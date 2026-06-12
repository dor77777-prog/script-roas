import { describe, it, expect } from 'vitest';
import { bandForRoas, alarmState, ALARM_SPEND_THRESHOLD_CAD } from '@/lib/roasBands';
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
  it('alarm ONLY above $100 spend with zero sales', () => {
    expect(ALARM_SPEND_THRESHOLD_CAD).toBe(100);
    expect(alarmState({ spend: 148, revenue: 0 })).toBe(true);
    expect(alarmState({ spend: 99,  revenue: 0 })).toBe(false);
    expect(alarmState({ spend: 148, revenue: 12 })).toBe(false);
  });
});
