import { describe, it, expect } from 'vitest';
import { analyzeAttribution } from '@/lib/attributionAnalysis';
import { makeOrder, makeCampaign } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

describe('analyzeAttribution', () => {
  // ----------------------------------------------------------------
  // Early exits
  // ----------------------------------------------------------------

  it('returns null for non-Meta platform', () => {
    const campaign = makeCampaign({ platform: 'Google' });
    const orders = [makeOrder()];
    expect(analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty orders array', () => {
    const campaign = makeCampaign();
    expect(analyzeAttribution(campaign, [], DATE_FROM, DATE_TO)).toBeNull();
  });

  // ----------------------------------------------------------------
  // No matched orders with metaClaim > 0
  // ----------------------------------------------------------------

  it('returns unknown trust with score 30 when no orders match but metaClaim > 0', () => {
    const campaign = makeCampaign({ campaignName: 'Other Campaign', metaClaim: 500 });
    // Orders that don't match this campaign
    const orders = [makeOrder({ utmCampaign: 'Totally Different Campaign', utmId: '' })];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('unknown');
    expect(result!.trust.score).toBe(30);
    expect(result!.recommendation).toContain('utm_campaign');
  });

  // ----------------------------------------------------------------
  // No conversions on either side (metaClaim=0, no matched orders)
  // ----------------------------------------------------------------

  it('returns unknown trust with label "אין המרות" and score 0 when no conversions on either side', () => {
    const campaign = makeCampaign({ metaClaim: 0, spend: 0 });
    // Orders exist but don't match
    const orders = [makeOrder({ utmCampaign: 'Other Campaign', utmId: '' })];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('unknown');
    expect(result!.trust.label).toBe('אין המרות');
    expect(result!.trust.score).toBe(0);
  });

  // ----------------------------------------------------------------
  // High coverage (>= 0.8)
  // ----------------------------------------------------------------

  it('returns high trust for coverage >= 0.8 (5 orders × 100 CAD vs metaClaim 500)', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('high');
    expect(result!.trust.score).toBeGreaterThanOrEqual(70);
    expect(result!.trust.score).toBeLessThanOrEqual(100);
    expect(result!.coverage).toBeCloseTo(1.0, 4);
  });

  // ----------------------------------------------------------------
  // Halo (coverage >= 1.0)
  // ----------------------------------------------------------------

  it('recommendation mentions halo/giddul for coverage >= 1.0', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    // 8 orders × 100 CAD = 800 > 500 → coverage > 1.0, clamped to 2
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('high');
    // Recommendation should mention halo or budget growth
    expect(result!.recommendation.toLowerCase()).toMatch(/halo|גידול תקציב/);
  });

  // ----------------------------------------------------------------
  // Medium coverage (0.4 <= coverage < 0.8)
  // ----------------------------------------------------------------

  it('returns medium trust for coverage ~0.6 (3 orders × 100 CAD vs metaClaim 500)', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const orders = Array.from({ length: 3 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('medium');
    expect(result!.coverage).toBeCloseTo(0.6, 4);
  });

  // ----------------------------------------------------------------
  // Low coverage (< 0.4)
  // ----------------------------------------------------------------

  it('returns low trust for coverage ~0.2 (1 order × 100 CAD vs metaClaim 500)', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const orders = [makeOrder({ orderId: 'o-1', totalCad: 100, utmId: 'camp-1', date: '2026-05-10' })];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');
    expect(result!.coverage).toBeCloseTo(0.2, 4);
    expect(result!.recommendation).toContain('Meta מנפח');
  });

  // ----------------------------------------------------------------
  // Bayesian CI — sufficient sample with variance
  // ----------------------------------------------------------------

  it('roasInterval is non-null with valid low < mid < high for varied AOVs', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const aovs = [80, 100, 120, 90, 110];
    const orders = aovs.map((totalCad, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).not.toBeNull();
    const { low, mid, high } = result!.roasInterval!;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    const deterministicRevenue = aovs.reduce((s, v) => s + v, 0);
    expect(mid).toBeCloseTo(deterministicRevenue / 200, 4);
    expect(low).toBeCloseTo(2.1535, 3);
    expect(high).toBeCloseTo(2.8465, 3);
  });

  // ----------------------------------------------------------------
  // WR5-04: degenerate CI when variance=0 (all orders same AOV)
  // ----------------------------------------------------------------

  it('WR5-04: roasInterval is null for homogeneous sample (variance=0)', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).toBeNull();
  });

  // ----------------------------------------------------------------
  // CI — sample too small (< 2 orders)
  // ----------------------------------------------------------------

  it('roasInterval is null when fewer than 2 matched orders', () => {
    const campaign = makeCampaign({ metaClaim: 200, spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', totalCad: 80, utmId: 'camp-1', date: '2026-05-10' }),
    ];
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).toBeNull();
  });

  // ----------------------------------------------------------------
  // CI — spend=0
  // ----------------------------------------------------------------

  it('roasInterval is null when spend is 0', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 0 });
    const aovs = [80, 100, 120, 90, 110];
    const orders = aovs.map((totalCad, i) =>
      makeOrder({ orderId: `o-${i}`, totalCad, utmId: 'camp-1', date: '2026-05-10' }),
    );
    const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
    expect(result).not.toBeNull();
    expect(result!.roasInterval).toBeNull();
  });

  // ----------------------------------------------------------------
  // Outlier detection
  // ----------------------------------------------------------------

  it('outlierDays is non-empty when dailyMetaSeries has a clear spike day', () => {
    const campaign = makeCampaign({ metaClaim: 500, spend: 200 });
    const orders = [makeOrder({ orderId: 'o-1', totalCad: 100, utmId: 'camp-1', date: '2026-05-10' })];
    // Create 20-day series where the last day has a huge spike (>2.5σ).
    // The baseline must have some variance so stdDev != 0 and the z-score fires.
    // Values: 90,110,95,105,100,90,110,95,105,100,90,110,95,105,100,90,110,95,105 then 2000 spike
    const baseValues = [90, 110, 95, 105, 100, 90, 110, 95, 105, 100, 90, 110, 95, 105, 100, 90, 110, 95, 105];
    const series = [
      ...baseValues.map((value, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value,
      })),
      { date: '2026-05-20', value: 2000 },
    ];
    const result = analyzeAttribution(campaign, orders, '2026-05-01', '2026-05-20', series);
    expect(result).not.toBeNull();
    expect(result!.outlierDays.length).toBeGreaterThan(0);
    // The reasons should mention spikes or modeled
    const reasonsJoined = result!.reasons.join(' ');
    expect(reasonsJoined).toMatch(/spike|modeled/);
  });

  // ----------------------------------------------------------------
  // Window stability downgrade
  // ----------------------------------------------------------------

  // ----------------------------------------------------------------
  // Signed revenue handling (TEST-03 — pins AUDIT-P3-03)
  // ----------------------------------------------------------------

  describe('signed revenue handling', () => {
    it('subtracts negative totalCad orders from deterministic revenue (refunds)', () => {
      // 1 positive +100 order matches the campaign, 1 refund -30 order
      // matches the same campaign. Deterministic revenue should net out
      // to 70 (100 + -30), not 100 (refund silently dropped) and not
      // 130 (refund's absolute value naively added).
      const campaign = makeCampaign({ metaClaim: 100, spend: 50, campaignId: 'camp-1' });
      const orders = [
        makeOrder({ orderId: 'sale-1', totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
        makeOrder({ orderId: 'refund-1', totalCad: -30, utmId: 'camp-1', date: '2026-05-11' }),
      ];
      const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.deterministicRevenue).toBeCloseTo(70, 4);
      expect(result!.deterministicOrders).toBe(2);
    });

    it('does not silently emit coverage=1 for negative metaClaim with positive det', () => {
      // metaClaim < 0 is malformed input — Meta never emits negative
      // conversion_value in production. Without the signed-input guard
      // (analyzeAttribution coverage formula), the fallback branch
      // `metaClaim > 0 ? ... : (det > 0 ? 1 : 0)` would silently emit
      // coverage = 1 ("perfect coverage") for any positive det. The
      // post-TEST-03 guard returns 0 instead — a sensible "undefined
      // coverage" signal, not a false-positive trust ceiling.
      const campaign = makeCampaign({ metaClaim: -50, spend: 50, campaignId: 'camp-1' });
      const orders = [
        makeOrder({ orderId: 'sale-1', totalCad: 100, utmId: 'camp-1', date: '2026-05-10' }),
      ];
      const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      // Critical assertion: coverage MUST NOT be 1 — that's the silent bug.
      expect(result!.coverage).not.toBe(1);
      expect(result!.coverage).toBe(0);
      expect(result!.deterministicRevenue).toBeCloseTo(100, 4);
    });

    it('refund larger than positive orders drives deterministicRevenue negative', () => {
      // Edge case: matched orders are all refunds → deterministicRevenue
      // goes negative. Coverage clamping must still hold (Math.min(2, ...)),
      // and the function must not throw or produce NaN. metaClaim > 0 path.
      const campaign = makeCampaign({ metaClaim: 100, spend: 50, campaignId: 'camp-1' });
      const orders = [
        makeOrder({ orderId: 'refund-1', totalCad: -200, utmId: 'camp-1', date: '2026-05-10' }),
      ];
      const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.deterministicRevenue).toBeCloseTo(-200, 4);
      // -200 / 100 = -2, clamped by Math.min(2, ...) → still -2 (no lower clamp).
      // The clamp only caps the upper end; negative coverage is preserved
      // because it carries real semantic information ("refunds exceeded sales").
      expect(result!.coverage).toBeCloseTo(-2, 4);
      expect(Number.isFinite(result!.coverage)).toBe(true);
      expect(Number.isNaN(result!.coverage)).toBe(false);
    });

    it('WR-03: trust.score is clamped to [0, 100] when coverage is negative (refund-heavy day)', () => {
      // Negative coverage previously emitted trust.score = -200 (raw pct),
      // breaking the documented [0, 100] contract on AttributionTrust.score
      // (attributionAnalysis.ts:75). Downstream comparators (Math.max,
      // color thresholds, range checks) would treat a negative score as
      // "extreme low", but the UI label / tooltip rendered the literal
      // "-200" which is meaningless. Post-WR-03 fix: score clamps to 0.
      const campaign = makeCampaign({ metaClaim: 100, spend: 50, campaignId: 'camp-1' });
      const orders = [
        makeOrder({ orderId: 'refund-1', totalCad: -200, utmId: 'camp-1', date: '2026-05-10' }),
      ];
      const result = analyzeAttribution(campaign, orders, DATE_FROM, DATE_TO);
      expect(result).not.toBeNull();
      expect(result!.trust.score).toBeGreaterThanOrEqual(0);
      expect(result!.trust.score).toBeLessThanOrEqual(100);
      // The reason string MUST NOT render "רק -X%" — that's the nonsense
      // copy WR-03 fixed. Use the refund-specific phrasing instead.
      const reasonsJoined = result!.reasons.join(' ');
      expect(reasonsJoined).not.toMatch(/רק\s*-\d+%/);
      // Refund-heavy day must surface the net-CAD phrasing.
      expect(reasonsJoined).toMatch(/החזרים/);
    });
  });

  it('volatile windowStability downgrades trust from high to medium', () => {
    const campaign = makeCampaign({ metaClaim: 300, spend: 100 });
    // Create matched orders for a 28-day range — enough for 4 windows
    // 4 orders to give coverage ~0.8+ initially
    const orders = Array.from({ length: 4 }, (_, i) =>
      makeOrder({
        orderId: `o-${i}`,
        totalCad: 75,
        utmId: 'camp-1',
        // Spread across 4 different windows (7 days apart)
        date: `2026-05-${String(i * 7 + 1).padStart(2, '0')}`,
      }),
    );
    // Meta series with volatile values across windows — huge σ
    const metaSeries = [
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, value: 10 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-05-${String(i + 8).padStart(2, '0')}`, value: 290 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-05-${String(i + 15).padStart(2, '0')}`, value: 10 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-05-${String(i + 22).padStart(2, '0')}`, value: 290 })),
    ];
    const result = analyzeAttribution(
      campaign,
      orders,
      '2026-05-01',
      '2026-05-28',
      metaSeries,
    );
    expect(result).not.toBeNull();
    // Trust should not be 'high' after volatile stability downgrade
    expect(result!.trust.level).not.toBe('high');
  });
});
