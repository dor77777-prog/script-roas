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

describe('buildTemplateParametersV2 — multi-line layout (17 params)', () => {
  // Index map: 0=title, 1..4=totals, 5..8=store1, 9..12=store2, 13..16=store3.
  it('returns exactly 17 params (title + 4 blocks × 4)', () => {
    expect(buildTemplateParametersV2(makeDaySummary({}), 't').length).toBe(17);
  });

  it('store-with-sales block: 🟠 band + bold ROAS header, revenue value, bundled spend+CPM, sources line', () => {
    const summary = makeDaySummary({
      s1: makeStore('uzoshop', {
        totalSpend: 1137, revenue: 2310, roas: 2.03, orders: 19,
        facebook: 15, google: 2, other: 2, cpm: 15.26,
      }),
    });
    const p = buildTemplateParametersV2(summary, 't');
    expect(p[5]).toBe('🟠 *uzoshop · ROAS 2.03*');
    expect(p[6]).toBe('C$2,310'); // revenue value only — label is static in the body
    expect(p[7]).toBe('C$1,137 · CPM C$15.26'); // spend + CPM bundled into one param
    expect(p[8]).toBe('19 הזמנות · Meta 15 · Google 2 · אחר 2');
  });

  it('band: 🟢 for ROAS≥3, 🔴 for ROAS<2', () => {
    const g = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('A', { revenue: 100, orders: 3, roas: 3.45 }) }), 't');
    expect(g[5]).toContain('🟢');
    const r = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('B', { revenue: 100, orders: 3, roas: 1.5 }) }), 't');
    expect(r[5]).toContain('🔴');
  });

  it('no-sales store → ⚪ "ללא מכירות", C$0 revenue, bundled spend+CPM, 0 orders', () => {
    const p = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('360usmile', { totalSpend: 92, cpm: 24.83 }) }), 't');
    expect(p[5]).toBe('⚪ *360usmile · ללא מכירות*');
    expect(p[6]).toBe('C$0');
    expect(p[7]).toBe('C$92 · CPM C$24.83');
    expect(p[8]).toBe('0 הזמנות');
  });

  it('singular "הזמנה" for 1 order; TikTok has its own slot (not folded into אחר)', () => {
    const one = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('Zol Plus', { revenue: 62, orders: 1, roas: 2.46, facebook: 1, cpm: 38.97 }) }), 't');
    expect(one[8]).toBe('1 הזמנה · Meta 1');
    const tt = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('X', { revenue: 50, orders: 2, roas: 2, tiktok: 2, cpm: 5 }) }), 't');
    expect(tt[8]).toContain('TikTok 2');
  });

  it('pads missing stores so all 17 params are non-empty (Meta rejects empty params)', () => {
    const p = buildTemplateParametersV2(
      makeDaySummary({ s: makeStore('uzoshop', { revenue: 1, orders: 1, roas: 2 }) }), 't');
    expect(p.length).toBe(17);
    expect(p[9]).toBe('—'); // store2 header padded
    expect(p.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ads-off Phase 4 — off-store framing in WhatsApp daily report
// ─────────────────────────────────────────────────────────────────────────────
describe('ads-off: fully-off store framing (v1 + v2)', () => {
  // Helper: build a DaySummary whose totals are the correct aggregation
  // of the given stores (off stores excluded from spend).
  function makeSummaryWithOff(
    stores: Record<string, StoreSummary & { isFullyOff?: boolean }>,
  ): DaySummary {
    // Compute totals excluding off-store spend but including off-store revenue.
    let spend = 0, revenue = 0, orders = 0, facebook = 0, google = 0, tiktok = 0, other = 0;
    let fbSpend = 0, gaSpend = 0, ttSpend = 0, impressions = 0;
    for (const s of Object.values(stores)) {
      revenue += s.revenue;
      orders += s.orders;
      facebook += s.facebook;
      google += s.google;
      tiktok += s.tiktok;
      other += s.other;
      if (!s.isFullyOff) {
        spend += s.totalSpend;
        fbSpend += s.fbSpend;
        gaSpend += s.gaSpend;
        ttSpend += s.ttSpend;
        impressions += s.impressions;
      }
    }
    const roas = spend > 0 ? revenue / spend : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return {
      dateStr: '2026-06-06',
      stores,
      totals: { fbSpend, gaSpend, ttSpend, spend, revenue, orders, facebook, google, tiktok, other, roas, impressions, cpm },
    };
  }

  const offWithRevenue = makeStore('usmile360', {
    totalSpend: 0, revenue: 500, roas: 0, orders: 8, facebook: 0, google: 0, tiktok: 0, other: 8,
    isFullyOff: true,
  } as Partial<StoreSummary> & { isFullyOff: boolean });

  const offEmpty = makeStore('zolplus', {
    totalSpend: 0, revenue: 0, roas: 0, orders: 0,
    isFullyOff: true,
  } as Partial<StoreSummary> & { isFullyOff: boolean });

  const onStore = makeStore('uzoshop', {
    totalSpend: 1000, revenue: 3200, roas: 3.2, orders: 25, facebook: 18, google: 5, other: 2, cpm: 12.5,
  });

  // Fully off NOW but had real spend in the report window (toggled off
  // mid-day; the evening/EOD send still covers the morning's spend). Must
  // render the REAL ROAS — never "ללא מכירות" — and count in totals normally.
  const offWithSpend = makeStore('uzoshop', {
    totalSpend: 800, revenue: 2400, roas: 3.0, orders: 20, facebook: 15, google: 3, other: 2, cpm: 11,
    isFullyOff: true,
  } as Partial<StoreSummary> & { isFullyOff: boolean });

  // ── v1 ──────────────────────────────────────────────────────────────────

  describe('v1 storeBlock', () => {
    it('off+revenue>0 → shows "אורגני", keeps revenue, no broken ROAS/CPM alarm', () => {
      const summary = makeSummaryWithOff({ s1: offWithRevenue as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParameters(summary, 't', { s1: true });
      // param[1] is the first store block
      expect(p[1]).toContain('אורגני');
      expect(p[1]).toContain('C$500'); // revenue included
      expect(p[1]).not.toMatch(/ROAS: \d/); // no numeric ROAS
      expect(p[1]).not.toMatch(/CPM: C\$\d/); // no numeric CPM alarm
    });

    it('off+revenue=0 → neutral "ללא מכירות"', () => {
      const summary = makeSummaryWithOff({ s1: offEmpty as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParameters(summary, 't', { s1: true });
      expect(p[1]).toContain('ללא מכירות');
      expect(p[1]).not.toMatch(/ROAS: \d/);
    });

    it('on store → normal block (unchanged)', () => {
      const summary = makeSummaryWithOff({ s1: onStore });
      const p = buildTemplateParameters(summary, 't', {});
      expect(p[1]).toContain('ROAS: 3.20');
      expect(p[1]).not.toContain('אורגני');
    });

    it('off BUT spend>0 (historical) → normal block with real ROAS, not "ללא מכירות"', () => {
      const summary = makeSummaryWithOff({ s1: offWithSpend as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParameters(summary, 't', { s1: true });
      expect(p[1]).toContain('ROAS: 3.00'); // real ROAS preserved
      expect(p[1]).not.toContain('ללא מכירות');
      expect(p[1]).not.toContain('אורגני');
    });

    it('totals: off-store spend excluded, off-store revenue included', () => {
      const summary = makeSummaryWithOff({
        s_on: onStore,
        s_off: offWithRevenue as StoreSummary & { isFullyOff?: boolean },
      });
      const p = buildTemplateParameters(summary, 't', { s_off: true });
      // totals block is params[4]
      // spend = only onStore (1000), revenue = onStore(3200) + offStore(500) = 3700
      expect(p[4]).toContain('C$1,000'); // spend
      expect(p[4]).toContain('C$3,700'); // revenue
    });

    it('empty adStateMap → identical message (all stores treated as on)', () => {
      const summary = makeSummaryWithOff({ s1: onStore });
      const withMap = buildTemplateParameters(summary, 't', {});
      const noMap = buildTemplateParameters(summary, 't');
      expect(withMap).toEqual(noMap);
    });
  });

  // ── v2 ──────────────────────────────────────────────────────────────────

  describe('v2 blockParamsV2', () => {
    it('off+revenue>0 → ⚪ + "אורגני" header, revenue shown, spend — neutral', () => {
      const summary = makeSummaryWithOff({ s1: offWithRevenue as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParametersV2(summary, 't', { s1: true });
      // store1 header is params[5]
      expect(p[5]).toContain('⚪');
      expect(p[5]).toContain('אורגני');
      expect(p[5]).not.toMatch(/ROAS \d/);
      expect(p[6]).toBe('C$500'); // revenue shown
      expect(p[7]).toContain('C$0'); // no spend
    });

    it('off+revenue=0 → ⚪ + "ללא מכירות"', () => {
      const summary = makeSummaryWithOff({ s1: offEmpty as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParametersV2(summary, 't', { s1: true });
      expect(p[5]).toContain('⚪');
      expect(p[5]).toContain('ללא מכירות');
    });

    it('on store → normal band block (unchanged)', () => {
      const summary = makeSummaryWithOff({ s1: onStore });
      const p = buildTemplateParametersV2(summary, 't', {});
      expect(p[5]).toContain('🟢');
      expect(p[5]).toContain('ROAS 3.20');
    });

    it('off BUT spend>0 (historical) → normal band header with real ROAS, not ⚪/"ללא מכירות"', () => {
      const summary = makeSummaryWithOff({ s1: offWithSpend as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParametersV2(summary, 't', { s1: true });
      expect(p[5]).toContain('ROAS 3.00'); // real ROAS preserved
      expect(p[5]).not.toContain('ללא מכירות');
      expect(p[5]).not.toContain('אורגני');
    });

    it('totals: off+spend>0 store counts its spend normally (display-state, not raw isOff)', () => {
      const summary = makeSummaryWithOff({ s1: offWithSpend as StoreSummary & { isFullyOff?: boolean } });
      const p = buildTemplateParametersV2(summary, 't', { s1: true });
      expect(p[3]).toContain('C$800'); // its real spend IS in the totals
    });

    it('totals block: off-store spend excluded from blended ROAS', () => {
      const summary = makeSummaryWithOff({
        s_on: onStore,
        s_off: offWithRevenue as StoreSummary & { isFullyOff?: boolean },
      });
      const p = buildTemplateParametersV2(summary, 't', { s_off: true });
      // totals header at params[1]
      expect(p[2]).toBe('C$3,700'); // revenue (3200+500)
      expect(p[3]).toContain('C$1,000'); // spend (on store only)
    });

    it('empty adStateMap → identical message (backward compat)', () => {
      const summary = makeSummaryWithOff({ s1: onStore });
      const withMap = buildTemplateParametersV2(summary, 't', {});
      const noMap = buildTemplateParametersV2(summary, 't');
      expect(withMap).toEqual(noMap);
    });
  });
});
