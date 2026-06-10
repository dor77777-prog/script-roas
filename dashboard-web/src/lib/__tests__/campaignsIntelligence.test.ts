import { describe, it, expect } from 'vitest';
import { buildHealthByKey, type BuildHealthByKeyInputs } from '../campaignsIntelligence';
import type { AdStateMap } from '../adState';

function inputs(overrides: Partial<BuildHealthByKeyInputs> = {}): BuildHealthByKeyInputs {
  return {
    aggregated: [],
    trueRevenueByKey: new Map(),
    dailyByCampaign: new Map(),
    productMap: {},
    campaignsDaily: [],
    productsDaily: [],
    localRange: { from: '2026-05-01', to: '2026-05-28' },
    ...overrides,
  };
}

/** Minimal aggregated row for a campaign with spend=0 */
function makeOffAgg(overrides: Record<string, unknown> = {}) {
  return {
    key: 'uzoshop::Meta::c1',
    storeId: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Paused Campaign',
    spend: 0,
    conversions: 0,
    conversionValue: 0,
    impressions: 0,
    clicks: 0,
    ...overrides,
  } as never;
}

describe('buildHealthByKey', () => {
  it('returns an empty Map when aggregated is empty', () => {
    const result = buildHealthByKey(inputs());
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns a Map with one entry per aggregated row', () => {
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
      { key: 'uzo|meta|c2', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c2', campaignName: 'B', spend: 500, conversions: 5, conversionValue: 1500 } as never,
    ];
    const result = buildHealthByKey(inputs({ aggregated: agg }));
    expect(result.size).toBe(2);
    expect(result.has('uzo|meta|c1')).toBe(true);
    expect(result.has('uzo|meta|c2')).toBe(true);
  });

  it('builds platform-vs-shopify ROAS lookups correctly (audit fix HIGH-01)', () => {
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    const trueRevenueByKey = new Map([
      ['uzo|meta|c1', { trueRevenue: 3000, deterministicRevenue: 2200, spend: 1000 } as never],
    ]);
    const result = buildHealthByKey(inputs({ aggregated: agg, trueRevenueByKey }));
    expect(result.size).toBe(1);
  });

  it('does not throw when productMap is empty (no cohorts to compute)', () => {
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    expect(() => buildHealthByKey(inputs({ aggregated: agg }))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ads-off Phase 4 — guard: off campaign with zero spend → insufficient/unknown
// ─────────────────────────────────────────────────────────────────────────

describe('buildHealthByKey — ads-off guard', () => {
  // KEY FAILING TEST: off campaign with spend=0 → grade must be 'unknown'
  // AND the reason must mention "כבויים" (ads off), not the generic "מדגם קטן מדי".
  // Before the guard is implemented, reason[0] will say "מדגם קטן מדי" (existing
  // insufficient gate), not the ads-off reason. After the guard, it says "מודעות כבויות".
  it('reason string mentions ads-off (not generic small-sample) when OFF+spend=0', () => {
    const adStateMap: AdStateMap = { 'uzoshop:meta': false };
    const agg = [makeOffAgg({ platform: 'Meta', storeId: 'uzoshop', spend: 0 })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::Meta::c1');
    expect(health).toBeDefined();
    expect(health!.insufficient).toBe(true);
    expect(health!.grade).toBe('unknown');
    // The reason must come from the ads-off guard, not from the generic isInsufficient path.
    expect(health!.reasons[0]).toMatch(/כבויות|כבוי/);
  });

  it('returns insufficient/unknown when (store,platform) is OFF and spend===0', () => {
    const adStateMap: AdStateMap = { 'uzoshop:meta': false };
    const agg = [makeOffAgg({ platform: 'Meta', storeId: 'uzoshop', spend: 0 })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::Meta::c1');
    expect(health).toBeDefined();
    expect(health!.insufficient).toBe(true);
    expect(health!.grade).toBe('unknown');
  });

  it('returns normal computed grade when ads are ON and spend===0 (organic/normal insufficient path)', () => {
    // With ads ON + spend=0, the existing insufficient gate in computeCampaignHealth fires.
    // The reason should be the generic "מדגם קטן מדי", NOT the ads-off reason.
    const adStateMap: AdStateMap = {}; // empty = everything ON
    const agg = [makeOffAgg({ platform: 'Meta', storeId: 'uzoshop', spend: 0 })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::Meta::c1');
    expect(health).toBeDefined();
    expect(health!.insufficient).toBe(true);
    // NOT the ads-off reason — the generic insufficient reason fires here
    expect(health!.reasons[0]).not.toMatch(/כבויות|כבוי/);
  });

  it('returns NORMAL computed grade when ads are OFF but spend>0 (historical data)', () => {
    const adStateMap: AdStateMap = { 'uzoshop:meta': false };
    // Campaign has real historical spend — must still score normally
    const agg = [makeOffAgg({ platform: 'Meta', storeId: 'uzoshop', spend: 500, conversions: 10, conversionValue: 1500 })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::Meta::c1');
    expect(health).toBeDefined();
    // Has real spend → NOT insufficient from ads-off guard
    expect(health!.insufficient).toBe(false);
    expect(health!.grade).not.toBe('unknown');
  });

  it('platform case: "Meta" (title-case) matches adStateMap key "uzoshop:meta" (lowercase)', () => {
    // Platform in Aggregated is 'Meta'; adStateKey uses lowercase 'meta'.
    const adStateMap: AdStateMap = { 'uzoshop:meta': false };
    const agg = [makeOffAgg({ platform: 'Meta', storeId: 'uzoshop', spend: 0 })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::Meta::c1');
    expect(health!.insufficient).toBe(true);
    expect(health!.grade).toBe('unknown');
    expect(health!.reasons[0]).toMatch(/כבויות|כבוי/);
  });

  it('different platform (TikTok) still ON → normal insufficient path, not ads-off reason', () => {
    // uzoshop:meta is OFF but TikTok for uzoshop is ON
    const adStateMap: AdStateMap = { 'uzoshop:meta': false };
    const agg = [makeOffAgg({
      key: 'uzoshop::TikTok::c2',
      platform: 'TikTok',
      storeId: 'uzoshop',
      spend: 0,
    })];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap }));
    const health = result.get('uzoshop::TikTok::c2');
    expect(health).toBeDefined();
    // TikTok is ON → ads-off guard NOT triggered; generic insufficient reason fires
    expect(health!.insufficient).toBe(true);
    expect(health!.reasons[0]).not.toMatch(/כבויות|כבוי/);
  });

  it('empty adStateMap (all ON) — behavior unchanged, no regression', () => {
    // This is the default path: adStateMap={} means nothing is off.
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'Meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    const result = buildHealthByKey(inputs({ aggregated: agg, adStateMap: {} }));
    const health = result.get('uzo|meta|c1');
    expect(health).toBeDefined();
    expect(health!.insufficient).toBe(false);
  });

  it('omitted adStateMap (undefined) — behavior unchanged, no regression', () => {
    // adStateMap optional — absence treated as empty (all ON)
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'Meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    const result = buildHealthByKey(inputs({ aggregated: agg }));
    const health = result.get('uzo|meta|c1');
    expect(health).toBeDefined();
    expect(health!.insufficient).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P1-7 (audit 2026-06-10) — the health-trajectory input must exclude the
// in-progress Israel day. dailyByCampaign (built component-side from the
// visible range) includes today, whose lagged-attribution ROAS understates
// the day every morning; analyzeCpmVsRoas then read a fake "ROAS collapsing"
// recent half and the grade swung B↔C by time of day. Chart display keeps
// today — only the trajectory feed drops it.
// ─────────────────────────────────────────────────────────────────────────

describe('buildHealthByKey — partial-day trajectory exclusion (P1-7)', () => {
  function todayInIsrael(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const agg = [
    { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'Meta' as const, campaignId: 'c1', campaignName: 'A', spend: 500, conversions: 10, conversionValue: 1500 } as never,
  ];

  it("today's partial-day crash point does NOT drag the trajectory below neutral", () => {
    const today = todayInIsrael();
    // 5 completed healthy days (flat CPM 10 / ROAS 3) + today's partial day
    // with ROAS 0 (orders not yet attributed). Pre-fix the 6-point series
    // read FLAT+DOWN (warning → trajectory 40); post-fix the 5 completed
    // flat days read FLAT+FLAT (neutral → trajectory 60).
    const series = [
      ...[6, 5, 4, 3, 2].map((n) => ({ date: addDays(today, -n), cpm: 10, roas: 3 })),
      { date: addDays(today, -1), cpm: 10, roas: 3 },
      { date: today, cpm: 10, roas: 0 },
    ];
    const result = buildHealthByKey(
      inputs({ aggregated: agg, dailyByCampaign: new Map([['uzo|meta|c1', series]]) }),
    );
    expect(result.get('uzo|meta|c1')!.components.trajectory).toBe(60);
  });

  it('a COMPLETED-day crash still drags the trajectory (no over-suppression)', () => {
    const today = todayInIsrael();
    // Same shape but the crash day is YESTERDAY (completed) — must still
    // read as a real decline (warning → trajectory 40).
    const series = [
      ...[7, 6, 5, 4, 3, 2].map((n) => ({ date: addDays(today, -n), cpm: 10, roas: 3 })),
      { date: addDays(today, -1), cpm: 10, roas: 0 },
    ];
    const result = buildHealthByKey(
      inputs({ aggregated: agg, dailyByCampaign: new Map([['uzo|meta|c1', series]]) }),
    );
    expect(result.get('uzo|meta|c1')!.components.trajectory).toBeLessThan(60);
  });
});
