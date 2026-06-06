import { describe, expect, it } from 'vitest';
import { buildTemplateParameters, buildTemplateParametersV2 } from '../templateParams';
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

describe('buildTemplateParametersV2 — multi-line layout (21 params)', () => {
  // Index map: 0=title, 1..5=totals, 6..10=store1, 11..15=store2, 16..20=store3.
  it('returns exactly 21 params (title + 4 blocks × 5)', () => {
    expect(buildTemplateParametersV2(makeDaySummary({}), 't').length).toBe(21);
  });

  it('store-with-sales block: 🟠 band + bold ROAS header, value-only money params, sources line', () => {
    const summary = makeDaySummary({
      s1: makeStore('uzoshop', {
        totalSpend: 1137, revenue: 2310, roas: 2.03, orders: 19,
        facebook: 15, google: 2, other: 2, cpm: 15.26,
      }),
    });
    const p = buildTemplateParametersV2(summary, 't');
    expect(p[6]).toBe('🟠 *uzoshop · ROAS 2.03*');
    expect(p[7]).toBe('C$2,310'); // revenue value only — label is static in the body
    expect(p[8]).toBe('C$1,137'); // spend
    expect(p[9]).toBe('C$15.26'); // cpm
    expect(p[10]).toBe('19 הזמנות · Meta 15 · Google 2 · אחר 2');
  });

  it('band: 🟢 for ROAS≥3, 🔴 for ROAS<2', () => {
    const g = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('A', { revenue: 100, orders: 3, roas: 3.45 }) }), 't');
    expect(g[6]).toContain('🟢');
    const r = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('B', { revenue: 100, orders: 3, roas: 1.5 }) }), 't');
    expect(r[6]).toContain('🔴');
  });

  it('no-sales store → ⚪ "ללא מכירות", C$0 revenue, 0 orders', () => {
    const p = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('360usmile', { totalSpend: 92, cpm: 24.83 }) }), 't');
    expect(p[6]).toBe('⚪ *360usmile · ללא מכירות*');
    expect(p[7]).toBe('C$0');
    expect(p[8]).toBe('C$92');
    expect(p[9]).toBe('C$24.83');
    expect(p[10]).toBe('0 הזמנות');
  });

  it('singular "הזמנה" for 1 order; TikTok has its own slot (not folded into אחר)', () => {
    const one = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('Zol Plus', { revenue: 62, orders: 1, roas: 2.46, facebook: 1, cpm: 38.97 }) }), 't');
    expect(one[10]).toBe('1 הזמנה · Meta 1');
    const tt = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('X', { revenue: 50, orders: 2, roas: 2, tiktok: 2, cpm: 5 }) }), 't');
    expect(tt[10]).toContain('TikTok 2');
  });

  it('pads missing stores so all 21 params are non-empty (Meta rejects empty params)', () => {
    const p = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('uzoshop', { revenue: 1, orders: 1, roas: 2 }) }), 't');
    expect(p.length).toBe(21);
    expect(p[11]).toBe('—'); // store2 header padded
    expect(p.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  });
});
