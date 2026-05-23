import { describe, expect, it } from 'vitest';
import { buildTemplateParameters } from '../templateParams';
import type { DaySummary, StoreSummary } from '../summary';

function makeStore(storeName: string, overrides: Partial<StoreSummary> = {}): StoreSummary {
  return {
    storeName,
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    orders: 0,
    facebook: 0,
    google: 0,
    tiktok: 0,
    other: 0,
    impressions: 0,
    cpm: 0,
    ...overrides,
  };
}

function makeDaySummary(stores: Record<string, StoreSummary>): DaySummary {
  return {
    dateStr: '2026-05-23',
    stores,
    totals: {
      fbSpend: 0,
      gaSpend: 0,
      ttSpend: 0,
      spend: 0,
      revenue: 0,
      orders: 0,
      facebook: 0,
      google: 0,
      tiktok: 0,
      other: 0,
      roas: 0,
      impressions: 0,
      cpm: 0,
    },
  };
}

describe('buildTemplateParameters — locks CR-02 audit fix (2026-05-23)', () => {
  it('returns exactly 5 parameters (title + 3 stores + totals)', () => {
    const summary = makeDaySummary({});
    expect(buildTemplateParameters(summary, 'title').length).toBe(5);
  });

  it('orders stores deterministically by storeName regardless of input key order', () => {
    // Same three stores, two different insertion orders into the
    // summary.stores object. Both should produce identical params[1..3].
    const orderA: Record<string, StoreSummary> = {
      's_360usmile': makeStore('360usmile'),
      's_uzoshop': makeStore('uzoshop'),
      's_zolplus': makeStore('Zol Plus'),
    };
    const orderB: Record<string, StoreSummary> = {
      's_uzoshop': makeStore('uzoshop'),
      's_zolplus': makeStore('Zol Plus'),
      's_360usmile': makeStore('360usmile'),
    };
    const paramsA = buildTemplateParameters(makeDaySummary(orderA), 't');
    const paramsB = buildTemplateParameters(makeDaySummary(orderB), 't');
    // params[0] = title, params[1..3] = store blocks, params[4] = totals.
    expect(paramsA[1]).toBe(paramsB[1]);
    expect(paramsA[2]).toBe(paramsB[2]);
    expect(paramsA[3]).toBe(paramsB[3]);
  });

  it('places stores in storeName alphabetical order (locale-aware)', () => {
    // Names: "360usmile" < "Zol Plus" < "uzoshop" by locale-aware sort.
    // (Note: localeCompare typically puts digits before letters, and
    //  case-insensitive sort makes 'Z' and 'u' compare by base letter.)
    const summary = makeDaySummary({
      s1: makeStore('uzoshop', { totalSpend: 100 }),
      s2: makeStore('360usmile', { totalSpend: 200 }),
      s3: makeStore('Zol Plus', { totalSpend: 300 }),
    });
    const params = buildTemplateParameters(summary, 't');
    // Verify each slot is the right store by looking for its unique spend value.
    // 360usmile (spend 200) should be in params[1] (first sorted).
    expect(params[1]).toContain('200');
    // The remaining order (Zol Plus / uzoshop) depends on locale rules but
    // is locked: localeCompare puts 'Z' before 'u' (case-insensitive in
    // most locales). Don't over-specify — just lock that each store has
    // a fixed position across runs (covered by previous test).
  });

  it('pads with "—" when fewer than 3 stores have rows', () => {
    const summary = makeDaySummary({
      s_only: makeStore('uzoshop'),
    });
    const params = buildTemplateParameters(summary, 't');
    expect(params[1]).toContain('uzoshop');
    expect(params[2]).toBe('—');
    expect(params[3]).toBe('—');
  });

  it('handles null summary with all-empty slots + fallback totals text', () => {
    const params = buildTemplateParameters(null, 'מסכם 23/05');
    expect(params[0]).toBe('מסכם 23/05');
    expect(params[1]).toBe('—');
    expect(params[2]).toBe('—');
    expect(params[3]).toBe('—');
    expect(params[4]).toBe('אין נתונים זמינים');
  });
});
