import { describe, it, expect } from 'vitest';
import { analyzeAttributionForAdSet } from '@/lib/attributionAnalysis';
import { makeOrder, makeAdSet } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

describe('analyzeAttributionForAdSet', () => {
  // ----------------------------------------------------------------
  // Early exits
  // ----------------------------------------------------------------

  it('returns null for non-Meta platform', () => {
    const adSet = makeAdSet({ platform: 'Google' });
    const orders = [makeOrder()];
    expect(analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty orders array', () => {
    const adSet = makeAdSet();
    expect(analyzeAttributionForAdSet(adSet, [], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty adSetId', () => {
    const adSet = makeAdSet({ adSetId: '' });
    const orders = [makeOrder()];
    expect(analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO)).toBeNull();
  });

  // ----------------------------------------------------------------
  // utm_term matching
  // ----------------------------------------------------------------

  it('matches order when utmTerm equals adSetId', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
    expect(result!.deterministicRevenue).toBeCloseTo(100, 4);
  });

  it('matches order when utmTerm has surrounding whitespace (trim tolerance)', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmTerm: '  adset-1  ', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
  });

  it('does not match order when utmTerm mismatches adSetId', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmTerm: 'adset-99', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // storeId mismatch
  // ----------------------------------------------------------------

  it('does not match order when storeId differs', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', storeId: 'uzoshop', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ storeId: 'zolplus', utmTerm: 'adset-1', date: '2026-05-10' })];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // Date filter
  // ----------------------------------------------------------------

  it('does not match order outside date range', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmTerm: 'adset-1', date: '2026-06-01' })]; // outside range
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // Level-specific advice
  // ----------------------------------------------------------------

  it('recommendation mentions "utm_term" when no orders matched but metaClaim > 0', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 200, spend: 100 });
    const orders = [makeOrder({ utmTerm: 'adset-99', date: '2026-05-10' })];
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('unknown');
    // Recommendation should mention utm_term or ad-set level parameter
    expect(result!.recommendation).toMatch(/utm_term/);
  });

  it('recommendation contains "ad-set" when coverage >= 1.0 (halo)', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 200, spend: 100 });
    // 4 orders × 100 CAD = 400 > 200 metaClaim → coverage > 1.0
    const orders = Array.from({ length: 4 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' }),
    );
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('high');
    expect(result!.recommendation).toMatch(/ad-set/);
  });

  // ----------------------------------------------------------------
  // Degenerate CI mirror (variance=0)
  // ----------------------------------------------------------------

  it('roasInterval is null for homogeneous sample (variance=0)', () => {
    const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 500, spend: 200 });
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' }),
    );
    const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).toBeNull();
  });
});
