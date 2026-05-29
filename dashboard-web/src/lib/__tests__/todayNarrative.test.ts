import { describe, it, expect } from 'vitest';
import { buildTodayNarrative, type NarrativeInputs } from '../todayNarrative';

function inputs(overrides: Partial<NarrativeInputs> = {}): NarrativeInputs {
  return {
    revenue: 48250,
    roas: 2.42,
    storeAggs: [
      { store: 'uzoshop', revenue: 21180, roas: 2.81 },
      { store: 'storia', revenue: 15880, roas: 2.14 },
      { store: 'marlene', revenue: 9540, roas: 1.92 },
    ],
    monthlyGoal: 1_000_000,
    monthToDateRevenue: 720_000,
    dayOfMonth: 22,
    daysInMonth: 30,
    ...overrides,
  };
}

describe('buildTodayNarrative', () => {
  it('combines today number + ROAS + pace vs goal + top store', () => {
    const text = buildTodayNarrative(inputs());
    // Should mention the revenue (with thousands separator), the ROAS (2 decimals), and the top store.
    expect(text).toMatch(/48,250|48[,.]250/);
    expect(text).toMatch(/2\.42/);
    expect(text).toMatch(/uzoshop/i);
  });

  it('says "above goal pace" when MTD ≥ target pace', () => {
    // Target pace at day 22 of 30 = 22/30 of 1M = 733,333. MTD 800k > 733k → above.
    const text = buildTodayNarrative(inputs({ monthToDateRevenue: 800_000 }));
    expect(text).toMatch(/מעל|מקדים/);
  });

  it('says "below goal pace" when MTD < target pace', () => {
    const text = buildTodayNarrative(inputs({ monthToDateRevenue: 600_000 }));
    expect(text).toMatch(/מתחת|לפני/);
  });

  it('omits pace line when monthlyGoal is null', () => {
    const text = buildTodayNarrative(inputs({ monthlyGoal: null }));
    expect(text).not.toMatch(/יעד|מטרה/);
    // Should still mention revenue + ROAS.
    expect(text).toMatch(/48,250|48[,.]250/);
    expect(text).toMatch(/2\.42/);
  });

  it('omits top store when storeAggs is empty', () => {
    const text = buildTodayNarrative(inputs({ storeAggs: [] }));
    expect(text).not.toMatch(/uzoshop|storia|marlene/);
  });

  it('returns a fallback when revenue is 0 (no data yet today)', () => {
    const text = buildTodayNarrative(inputs({ revenue: 0, roas: 0, storeAggs: [] }));
    expect(text).toMatch(/אין נתונים|עוד אין|טוען/);
  });

  it('handles RTL number formatting (uses he-IL locale)', () => {
    const text = buildTodayNarrative(inputs({ revenue: 1234567 }));
    expect(text).toContain(new Intl.NumberFormat('he-IL').format(1234567));
  });
});
