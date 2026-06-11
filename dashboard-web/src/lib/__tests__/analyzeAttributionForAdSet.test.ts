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

  // ----------------------------------------------------------------
  // P1-8a/P1-8b parity at AD-SET grain (adversarial review 2026-06-11).
  // The campaign-grain ladder gained these branches on 2026-06-10; the
  // shared buildAnalysis ladder (this grain) was missed — a claim=0/det>0
  // ad-set scored 'אמין 90' + 'שקול גידול תקציב' (goodHalo) during the
  // exact tracking outage the campaign panel flags.
  // ----------------------------------------------------------------

  describe('trust-ladder outage honesty parity (2026-06-11 review)', () => {
    it('claim=0 + det>0 → unknown-40 "הפלטפורמה מדווחת 0", NOT high-trust scale advice', () => {
      const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 0, spend: 100 });
      const orders = Array.from({ length: 2 }, (_, i) =>
        makeOrder({ orderId: `o-${i}`, utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' }),
      );
      const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      // Coverage VALUE keeps the legacy claim=0→1 fallback; only the verdict changes.
      expect(result!.coverage).toBe(1);
      expect(result!.trust.level).toBe('unknown');
      expect(result!.trust.score).toBe(40);
      expect(result!.trust.label).toBe('הפלטפורמה מדווחת 0');
      const reasonsJoined = result!.reasons.join(' ');
      expect(reasonsJoined).toMatch(/0 המרות/);
      expect(reasonsJoined).toMatch(/2 הזמנות/);
      // Recommendation = check the conversion tag — NEVER the goodHalo scale copy.
      expect(result!.recommendation).toMatch(/Pixel|CAPI|תגית/);
      expect(result!.recommendation).not.toMatch(/גידול תקציב|פתיחת ad-set/);
    });

    it('coverage 2.5 → trust capped at medium + tracking-check recommendation (no goodHalo)', () => {
      // Meta claims $100; Shopify sees $250 tagged → coverage 2.5 (> threshold).
      const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 100, spend: 100 });
      const orders = [
        makeOrder({ orderId: 'o-0', utmTerm: 'adset-1', totalCad: 120, date: '2026-05-10' }),
        makeOrder({ orderId: 'o-1', utmTerm: 'adset-1', totalCad: 130, date: '2026-05-11' }),
      ];
      const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.coverage).toBeCloseTo(2.5, 4);
      expect(result!.coverageExceedsClamp).toBe(true);
      expect(result!.trust.level).toBe('medium');
      expect(result!.trust.score).toBeLessThanOrEqual(65);
      expect(result!.recommendation).not.toMatch(/גידול תקציב|פתיחת ad-set/);
      expect(result!.recommendation).toMatch(/Pixel|CAPI|תגית|תיוג/);
    });

    it('normal halo (coverage 2.0 exactly, not > 2) keeps the high-trust goodHalo advice', () => {
      // Symmetry guard: the cap is strict-greater — the pre-existing halo
      // test fixture (400/200 = 2.0) must keep its behavior.
      const adSet = makeAdSet({ adSetId: 'adset-1', metaClaim: 200, spend: 100 });
      const orders = Array.from({ length: 4 }, (_, i) =>
        makeOrder({ orderId: `o-${i}`, utmTerm: 'adset-1', totalCad: 100, date: '2026-05-10' }),
      );
      const result = analyzeAttributionForAdSet(adSet, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.coverageExceedsClamp).toBe(false);
      expect(result!.trust.level).toBe('high');
      expect(result!.recommendation).toMatch(/גידול תקציב/);
    });
  });
});
