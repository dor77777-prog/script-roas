import { describe, it, expect } from 'vitest';
import { comparisonLabelHebrew } from '@/lib/presets';
import type { PresetKey } from '@/lib/types';

// The hero's featured-card delta compares against the previous equal-length
// period, so its "vs <prev>" caption must track the selected range — NOT a
// hardcoded "מול אתמול". This locks the per-preset mapping.
describe('comparisonLabelHebrew', () => {
  it('maps each preset to its previous-period caption', () => {
    const cases: Array<[PresetKey, string]> = [
      ['today', 'מול אתמול'],
      ['yesterday', 'מול שלשום'],
      ['this_month', 'מול החודש הקודם'],
      ['this_week', 'מול השבוע הקודם'],
      ['last_7_days', 'מול 7 הימים הקודמים'],
      ['last_month', 'מול החודש שלפניו'],
      ['last_30_days', 'מול 30 הימים הקודמים'],
      ['custom', 'מול התקופה הקודמת'],
    ];
    for (const [preset, label] of cases) {
      expect(comparisonLabelHebrew(preset)).toBe(label);
    }
  });

  it('never returns the hardcoded "מול אתמול" for a multi-day range', () => {
    expect(comparisonLabelHebrew('this_month')).not.toBe('מול אתמול');
    expect(comparisonLabelHebrew('last_7_days')).not.toBe('מול אתמול');
  });
});
