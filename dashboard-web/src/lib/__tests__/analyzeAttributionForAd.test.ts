import { describe, it, expect } from 'vitest';
import { analyzeAttributionForAd } from '@/lib/attributionAnalysis';
import { makeOrder, makeAd } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

describe('analyzeAttributionForAd', () => {
  // ----------------------------------------------------------------
  // Early exits
  // ----------------------------------------------------------------

  it('returns null for non-Meta platform', () => {
    const ad = makeAd({ platform: 'Google' });
    const orders = [makeOrder()];
    expect(analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty orders array', () => {
    const ad = makeAd();
    expect(analyzeAttributionForAd(ad, [], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty adId', () => {
    const ad = makeAd({ adId: '' });
    const orders = [makeOrder()];
    expect(analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO)).toBeNull();
  });

  // ----------------------------------------------------------------
  // utm_content matching
  // ----------------------------------------------------------------

  it('matches order when utmContent equals adId', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
    expect(result!.deterministicRevenue).toBeCloseTo(100, 4);
  });

  it('matches order when utmContent has surrounding whitespace (trim tolerance)', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmContent: '  ad-1  ', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
  });

  it('does not match order when utmContent mismatches adId', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmContent: 'ad-99', totalCad: 100, date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // storeId mismatch
  // ----------------------------------------------------------------

  it('does not match order when storeId differs', () => {
    const ad = makeAd({ adId: 'ad-1', storeId: 'uzoshop', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ storeId: 'zolplus', utmContent: 'ad-1', date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // Date filter
  // ----------------------------------------------------------------

  it('does not match order outside date range', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 100, spend: 50 });
    const orders = [makeOrder({ utmContent: 'ad-1', date: '2026-06-01' })]; // outside range
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // Level-specific advice
  // ----------------------------------------------------------------

  it('recommendation mentions "utm_content" when no orders matched but metaClaim > 0', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 200, spend: 100 });
    const orders = [makeOrder({ utmContent: 'ad-99', date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('unknown');
    expect(result!.recommendation).toMatch(/utm_content/);
  });

  it('recommendation contains "ad-sets נוספים" when coverage >= 1.0 (halo)', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 200, spend: 100 });
    // 4 orders × 100 CAD = 400 > 200 → coverage > 1.0
    const orders = Array.from({ length: 4 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' }),
    );
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('high');
    expect(result!.recommendation).toContain('ad-sets נוספים');
  });

  it('recommendation contains "לכבות" for low coverage (bad ad)', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 500, spend: 200 });
    // 1 order × 50 CAD → coverage 0.1 → low
    const orders = [makeOrder({ utmContent: 'ad-1', totalCad: 50, date: '2026-05-10' })];
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');
    expect(result!.recommendation).toContain('לכבות');
  });

  // ----------------------------------------------------------------
  // Degenerate CI mirror (variance=0)
  // ----------------------------------------------------------------

  it('roasInterval is null for homogeneous sample (variance=0)', () => {
    const ad = makeAd({ adId: 'ad-1', metaClaim: 500, spend: 200 });
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' }),
    );
    const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).toBeNull();
  });

  // ----------------------------------------------------------------
  // P1-8a/P1-8b parity at AD grain (adversarial review 2026-06-11).
  // Mirrors the campaign-grain branches the 2026-06-10 batch added; the
  // shared buildAnalysis ladder previously rewarded claim=0/det>0 with
  // 'אמין 90' + 'שקול הרחבת ה-creative' (goodHalo) — scale advice during
  // a tracking outage.
  // ----------------------------------------------------------------

  describe('trust-ladder outage honesty parity (2026-06-11 review)', () => {
    it('claim=0 + det>0 → unknown-40 "הפלטפורמה מדווחת 0", NOT creative-expansion advice', () => {
      const ad = makeAd({ adId: 'ad-1', metaClaim: 0, spend: 100 });
      const orders = Array.from({ length: 2 }, (_, i) =>
        makeOrder({ orderId: `o-${i}`, utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' }),
      );
      const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      // Coverage VALUE keeps the legacy claim=0→1 fallback; only the verdict changes.
      expect(result!.coverage).toBe(1);
      expect(result!.trust.level).toBe('unknown');
      expect(result!.trust.score).toBe(40);
      expect(result!.trust.label).toBe('הפלטפורמה מדווחת 0');
      const reasonsJoined = result!.reasons.join(' ');
      expect(reasonsJoined).toMatch(/0 המרות/);
      expect(reasonsJoined).toMatch(/2 הזמנות/);
      // Recommendation = check the tag — never the goodHalo creative-scale copy.
      expect(result!.recommendation).toMatch(/Pixel|CAPI|תגית/);
      expect(result!.recommendation).not.toMatch(/הרחבת ה-creative|ad-sets נוספים/);
    });

    it('coverage 2.5 → trust capped at medium + tracking-check recommendation (no goodHalo)', () => {
      const ad = makeAd({ adId: 'ad-1', metaClaim: 100, spend: 100 });
      const orders = [
        makeOrder({ orderId: 'o-0', utmContent: 'ad-1', totalCad: 120, date: '2026-05-10' }),
        makeOrder({ orderId: 'o-1', utmContent: 'ad-1', totalCad: 130, date: '2026-05-11' }),
      ];
      const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.coverage).toBeCloseTo(2.5, 4);
      expect(result!.coverageExceedsClamp).toBe(true);
      expect(result!.trust.level).toBe('medium');
      expect(result!.trust.score).toBeLessThanOrEqual(65);
      expect(result!.recommendation).not.toMatch(/הרחבת ה-creative|ad-sets נוספים/);
      expect(result!.recommendation).toMatch(/Pixel|CAPI|תגית|תיוג/);
    });

    it('normal halo (coverage 2.0 exactly, not > 2) keeps the high-trust goodHalo advice', () => {
      const ad = makeAd({ adId: 'ad-1', metaClaim: 200, spend: 100 });
      const orders = Array.from({ length: 4 }, (_, i) =>
        makeOrder({ orderId: `o-${i}`, utmContent: 'ad-1', totalCad: 100, date: '2026-05-10' }),
      );
      const result = analyzeAttributionForAd(ad, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.coverageExceedsClamp).toBe(false);
      expect(result!.trust.level).toBe('high');
      expect(result!.recommendation).toContain('ad-sets נוספים');
    });
  });
});
