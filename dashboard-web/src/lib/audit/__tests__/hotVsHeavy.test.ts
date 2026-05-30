// dashboard-web/src/lib/audit/__tests__/hotVsHeavy.test.ts
//
// Unit tests for the Phase C.5 reconcile core. The live harness
// (reconcileHotMetricsVsHeavy.live.test.ts) runs only with AUDIT_LIVE=1;
// these tests run on every `npm test` so regressions in the aggregation /
// drift detection logic are caught even when the operator hasn't run the
// live canary.

import { describe, expect, it } from 'vitest';
import {
  aggregateByCampaign,
  classifySource,
  detectDrift,
  type DailyRow,
  type DriftTolerances,
} from '@/lib/audit/hotVsHeavy';

const TOL: DriftTolerances = {
  spend: { absTol: 1, pctTol: 0.01 },   // $1 absolute floor, 1% relative
  metric: { absTol: 1, pctTol: 0.02 },  // 1 unit floor, 2% relative
};

function makeRow(overrides: Partial<DailyRow>): DailyRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    campaign_id: 'C1',
    ad_set_id: 'AS1',
    source: 'live_tick',
    spend_cad: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversion_value_cad: 0,
    ...overrides,
  };
}

describe('classifySource', () => {
  it('live_tick → live', () => {
    expect(classifySource('live_tick')).toBe('live');
  });

  it('daily_reconcile → heavy', () => {
    expect(classifySource('daily_reconcile')).toBe('heavy');
  });

  it('unknown source → heavy (defaults to non-live so historical rows are anchored on the reconcile side)', () => {
    expect(classifySource('manual_override')).toBe('heavy');
    expect(classifySource('')).toBe('heavy');
  });
});

describe('aggregateByCampaign — sums across ad_sets within a (campaign, source)', () => {
  it('two ad_sets in the same campaign+source are SUMMED, not overwritten (regression for the original harness bug)', () => {
    const rows: DailyRow[] = [
      makeRow({ ad_set_id: 'AS1', spend_cad: 10, impressions: 100, clicks: 5, conversions: 1, conversion_value_cad: 30 }),
      makeRow({ ad_set_id: 'AS2', spend_cad: 20, impressions: 200, clicks: 10, conversions: 2, conversion_value_cad: 60 }),
    ];
    const agg = aggregateByCampaign(rows);
    const totals = agg.get('uzoshop::meta::C1::live');
    expect(totals).toEqual({ spend_cad: 30, impressions: 300, clicks: 15, conversions: 3, conversion_value_cad: 90 });
  });

  it('live and heavy partitions stay separate even for the same (store, platform, campaign_id)', () => {
    const rows: DailyRow[] = [
      makeRow({ source: 'live_tick', spend_cad: 10 }),
      makeRow({ source: 'daily_reconcile', spend_cad: 10.5 }),
    ];
    const agg = aggregateByCampaign(rows);
    expect(agg.get('uzoshop::meta::C1::live')?.spend_cad).toBe(10);
    expect(agg.get('uzoshop::meta::C1::heavy')?.spend_cad).toBe(10.5);
  });

  it('NULL numerics are treated as 0 (Postgres semantics — a row absent of clicks reads NULL, not 0)', () => {
    const rows: DailyRow[] = [
      makeRow({ spend_cad: null, impressions: null, clicks: null, conversions: null, conversion_value_cad: null }),
    ];
    const agg = aggregateByCampaign(rows);
    expect(agg.get('uzoshop::meta::C1::live')).toEqual({
      spend_cad: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value_cad: 0,
    });
  });

  it('different campaigns produce different keys', () => {
    const rows: DailyRow[] = [
      makeRow({ campaign_id: 'C1', spend_cad: 5 }),
      makeRow({ campaign_id: 'C2', spend_cad: 7 }),
    ];
    const agg = aggregateByCampaign(rows);
    expect(agg.size).toBe(2);
  });
});

describe('detectDrift — paired comparison', () => {
  it('no drift when live and heavy agree exactly on all 5 metrics', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 100, impressions: 1000, clicks: 50, conversions: 5, conversion_value_cad: 300 });
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 100, impressions: 1000, clicks: 50, conversions: 5, conversion_value_cad: 300 });
    const agg = aggregateByCampaign([live, heavy]);
    const report = detectDrift(agg, TOL, 'today');
    expect(report.drifts).toEqual([]);
    expect(report.bothCount).toBe(1);
    expect(report.onlyLive).toEqual([]);
    expect(report.onlyHeavy).toEqual([]);
  });

  it('catches drift on spend_cad (the original harness check)', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 100 });
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 130 });   // 30% drift
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, 'today');
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0]).toContain('spend_cad');
    expect(report.drifts[0]).toContain('live=100.00');
    expect(report.drifts[0]).toContain('heavy=130.00');
  });

  it('catches drift on impressions (multi-metric — new in Phase C.5 extension)', () => {
    const live = makeRow({ source: 'live_tick', impressions: 1000 });
    const heavy = makeRow({ source: 'daily_reconcile', impressions: 2000 });
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, 'today');
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0]).toContain('impressions');
  });

  it('catches drift on conversions and conversion_value_cad independently', () => {
    const live = makeRow({ source: 'live_tick', conversions: 5, conversion_value_cad: 100 });
    const heavy = makeRow({ source: 'daily_reconcile', conversions: 50, conversion_value_cad: 1000 });
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, 'today');
    expect(report.drifts.some(d => d.includes('conversions:'))).toBe(true);
    expect(report.drifts.some(d => d.includes('conversion_value_cad'))).toBe(true);
  });

  it('within tolerance does not flag (1% rel within $100 spend)', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 100 });
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 100.5 }); // 0.5% drift
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, 'today');
    expect(report.drifts).toEqual([]);
  });

  it('absolute $1 floor still applies even when relative% would flag — e.g. $0.50 → $1.00 (a noisy 100% rel) is excused', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 0.5 });
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 1 });
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, 'today');
    expect(report.drifts).toEqual([]);
  });

  it('onlyLive: campaign appears in live partition but not heavy → reported, no drift line', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 100 });
    const report = detectDrift(aggregateByCampaign([live]), TOL, 'today');
    expect(report.onlyLive).toEqual([{ store: 'uzoshop', platform: 'meta', campaign_id: 'C1' }]);
    expect(report.onlyHeavy).toEqual([]);
    expect(report.bothCount).toBe(0);
    expect(report.drifts).toEqual([]);
  });

  it('onlyHeavy: campaign appears in heavy partition but not live → reported, no drift line', () => {
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 100 });
    const report = detectDrift(aggregateByCampaign([heavy]), TOL, 'today');
    expect(report.onlyHeavy).toEqual([{ store: 'uzoshop', platform: 'meta', campaign_id: 'C1' }]);
    expect(report.onlyLive).toEqual([]);
    expect(report.bothCount).toBe(0);
  });

  it('aggregation-bug regression: $50 + $50 ad_sets vs single $100 heavy → no drift (without aggregation we got a phantom 50%)', () => {
    const rows: DailyRow[] = [
      makeRow({ source: 'live_tick', ad_set_id: 'AS1', spend_cad: 50, impressions: 500, clicks: 25, conversions: 2, conversion_value_cad: 150 }),
      makeRow({ source: 'live_tick', ad_set_id: 'AS2', spend_cad: 50, impressions: 500, clicks: 25, conversions: 3, conversion_value_cad: 150 }),
      makeRow({ source: 'daily_reconcile', ad_set_id: 'AS1', spend_cad: 100, impressions: 1000, clicks: 50, conversions: 5, conversion_value_cad: 300 }),
    ];
    const report = detectDrift(aggregateByCampaign(rows), TOL, 'today');
    expect(report.drifts).toEqual([]);
    expect(report.bothCount).toBe(1);
  });

  it('preserves the date label in drift output so multi-date runs can be diff-ed', () => {
    const live = makeRow({ source: 'live_tick', spend_cad: 100 });
    const heavy = makeRow({ source: 'daily_reconcile', spend_cad: 130 });
    const report = detectDrift(aggregateByCampaign([live, heavy]), TOL, '2026-05-29');
    expect(report.drifts[0]).toContain('2026-05-29');
  });
});
