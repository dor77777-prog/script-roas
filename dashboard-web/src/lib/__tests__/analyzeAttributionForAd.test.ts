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
});
