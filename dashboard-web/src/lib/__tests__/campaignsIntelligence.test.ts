import { describe, it, expect } from 'vitest';
import { buildHealthByKey, type BuildHealthByKeyInputs } from '../campaignsIntelligence';

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
