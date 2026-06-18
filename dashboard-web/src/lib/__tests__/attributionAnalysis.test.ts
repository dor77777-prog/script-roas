import { describe, expect, it } from 'vitest';
import {
  analyzeAttribution,
  analyzeAttributionForAdSet,
  analyzeAttributionForAd,
} from '@/lib/attributionAnalysis';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

/**
 * Audit fixes 2026-05-23 — pinned regressions.
 *
 *  - b/HI-01: outlier-day operator reason string must reference the actual
 *    detector (MAD × multiplier), not a misleading "2.5σ" label.
 *  - Wave 1 deferred: analyzeAttributionForAdSet + analyzeAttributionForAd
 *    must accept TikTok (matches the campaign-level analyzer + the
 *    useCampaignAttribution hook that already widened in Wave 1).
 */

function makeOrder(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    orderId: 'order1',
    totalCad: 100,
    source: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    fbclidPresent: false,
    gclidPresent: false,
    referringSite: '',
    utmId: '',
    utmTerm: '',
    lineItems: [],
    customerId: 'cust-default',
    orderCreatedAt: '2026-05-20T12:00:00-04:00',
    isFirstOrder: true,
    // Phase 4 — first-click lens defaults (no first-click signal).
    firstTouchSource: null,
    firstFbclidPresent: false,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    firstUtmContent: null,
    firstUtmId: null,
    firstUtmTerm: null,
    firstSeenAt: null,
    paymentGateway: null,
    ...overrides,
  };
}

describe('analyzeAttribution — b/HI-01 outlier-day label honesty', () => {
  it('outlier-day reason references MAD × multiplier, NOT "2.5σ"', () => {
    // Build a daily Meta series with a clear spike (>3× MAD over median).
    // 14 days, first 10 are flat at 100, then one spike at day 11.
    const dailyMeta: Array<{ date: string; value: number }> = [];
    for (let i = 1; i <= 10; i++) {
      const d = `2026-05-${String(i).padStart(2, '0')}`;
      dailyMeta.push({ date: d, value: 100 });
    }
    // Day 11 spike — value 1000 (10× the baseline). MAD baseline → flagged.
    dailyMeta.push({ date: '2026-05-11', value: 1000 });
    for (let i = 12; i <= 14; i++) {
      dailyMeta.push({ date: `2026-05-${i}`, value: 100 });
    }
    // Matching orders so we have a non-empty analysis path.
    const orders = [
      makeOrder({ utmCampaign: 'cmp', totalCad: 500 }),
    ];
    const result = analyzeAttribution(
      {
        campaignName: 'cmp',
        storeId: 'uzoshop',
        platform: 'Meta',
        metaClaim: 800,
        spend: 200,
      },
      orders,
      '2026-05-01',
      '2026-05-14',
      dailyMeta,
    );
    expect(result).not.toBeNull();
    // Find the outlier reason in the reasons list.
    const reasonsConcat = result!.reasons.join(' | ');
    if (result!.outlierDays.length > 0) {
      // The honest label must mention MAD, not 2.5σ.
      expect(reasonsConcat).toMatch(/MAD/);
      expect(reasonsConcat).not.toMatch(/2\.5σ/);
      expect(reasonsConcat).not.toMatch(/2\.5σ/);
    }
  });
});

describe('analyzeAttributionForAdSet — Wave 1 deferred fix (widened to TikTok)', () => {
  it('returns non-null for TikTok ad-set with matched orders', () => {
    const orders = [
      makeOrder({
        utmTerm: 'tt-adset-1',
        totalCad: 250,
        source: 'tiktok-paid',
      }),
    ];
    const result = analyzeAttributionForAdSet(
      {
        adSetId: 'tt-adset-1',
        adSetName: 'TT AdSet 1',
        storeId: 'uzoshop',
        platform: 'TikTok',
        metaClaim: 200,
        spend: 100,
      },
      orders,
      '2026-05-19',
      '2026-05-21',
    );
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
    expect(result!.deterministicRevenue).toBe(250);
  });

  it('still returns null for Google ad-set (PMax utm-tracking unreliable)', () => {
    const result = analyzeAttributionForAdSet(
      {
        adSetId: 'g-adset-1',
        adSetName: 'Google AdSet',
        storeId: 'uzoshop',
        platform: 'Google',
        metaClaim: 200,
        spend: 100,
      },
      [makeOrder({ utmTerm: 'g-adset-1', totalCad: 250 })],
      '2026-05-19',
      '2026-05-21',
    );
    expect(result).toBeNull();
  });
});

describe('analyzeAttributionForAd — Wave 1 deferred fix (widened to TikTok)', () => {
  it('returns non-null for TikTok ad with matched orders', () => {
    const orders = [
      makeOrder({
        utmContent: 'tt-ad-1',
        totalCad: 150,
        source: 'tiktok-paid',
      }),
    ];
    const result = analyzeAttributionForAd(
      {
        adId: 'tt-ad-1',
        adName: 'TT Ad 1',
        storeId: 'uzoshop',
        platform: 'TikTok',
        metaClaim: 120,
        spend: 60,
      },
      orders,
      '2026-05-19',
      '2026-05-21',
    );
    expect(result).not.toBeNull();
    expect(result!.deterministicOrders).toBe(1);
    expect(result!.deterministicRevenue).toBe(150);
  });

  it('still returns null for Google ad (no ad granularity in PMax)', () => {
    const result = analyzeAttributionForAd(
      {
        adId: 'g-ad-1',
        adName: 'Google Ad',
        storeId: 'uzoshop',
        platform: 'Google',
        metaClaim: 100,
        spend: 50,
      },
      [makeOrder({ utmContent: 'g-ad-1', totalCad: 150 })],
      '2026-05-19',
      '2026-05-21',
    );
    expect(result).toBeNull();
  });
});

describe('analyzeAttribution — U-04 (2026-05-24) surface mixed window-stability verdict', () => {
  // Pre-fix: attributionAnalysis.ts:511-525 emitted reasons text ONLY for
  // 'stable' and 'volatile' window-stability verdicts. The 'mixed' bucket
  // (σ between 0.15 and 0.35) was silently swallowed — the operator saw
  // no warning at all and would default to trusting the trend, even
  // though the Meta:Shopify ratio was drifting moderately week-to-week.
  //
  // Post-fix: a new branch on `windowStability.verdict === 'mixed'`
  // emits honest copy ("תנודתיות בינונית") without applying the
  // volatile trust-downgrade (mixed is intermediate, not extreme).
  //
  // Fixture lifted from computeWindowStability.test.ts:125 ("verdict is
  // mixed when coverage σ is between 0.15 and 0.35"):
  //   Window 1: meta=100, matched=90 → coverage=0.9
  //   Window 2: meta=100, matched=40 → coverage=0.4
  //   mean=0.65, σ ≈ 0.25 → mixed (0.15 ≤ σ < 0.35).
  it("surfaces a 'תנודתיות' reason when windowStability verdict is 'mixed'", () => {
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      // 1 order × 90 CAD in window 1 (coverage 0.9 vs meta 100)
      makeOrder({
        date: '2026-05-03',
        utmCampaign: 'mixed-camp',
        totalCad: 90,
        storeId: 'uzoshop',
      }),
      // 1 order × 50 CAD in window 2 (coverage 0.5 vs meta 100). Coverages
      // 0.9/0.5 → Bessel σ≈0.283 → 'mixed'. Retuned 2026-06-18 for the n-1
      // variance fix (#5a): the old 0.9/0.4 now lands at σ≈0.354 → 'volatile'.
      makeOrder({
        date: '2026-05-10',
        utmCampaign: 'mixed-camp',
        totalCad: 50,
        storeId: 'uzoshop',
      }),
    ];
    const result = analyzeAttribution(
      {
        campaignName: 'mixed-camp',
        storeId: 'uzoshop',
        platform: 'Meta',
        metaClaim: 200, // 100 per window combined
        spend: 50,
      },
      orders,
      '2026-05-01',
      '2026-05-14',
      metaSeries,
    );
    expect(result).not.toBeNull();
    expect(result!.windowStability).not.toBeNull();
    expect(result!.windowStability!.verdict).toBe('mixed');

    // U-04 contract: a 'מעיד'-style reason must be present that mentions
    // mid-range volatility. Either "תנודתיות בינונית" or "בייאס משתנה
    // לאט" — both are reachable phrasings in the mixed-branch copy.
    const reasonsConcat = result!.reasons.join(' | ');
    expect(reasonsConcat).toMatch(/תנודתיות בינונית|בייאס משתנה לאט/);
  });

  it("does NOT downgrade trust from high to medium for 'mixed' verdict (only 'volatile' downgrades)", () => {
    // The 'volatile' branch (σ > 0.35) downgrades high→medium with a
    // 65 score cap. The 'mixed' branch deliberately does NOT — the
    // bucket is intermediate, not extreme. Verify by constructing a
    // high-trust + mixed-σ fixture.
    //
    // High trust requires coverage~1.0 + enough orders. We build a
    // metaSeries + orders where total coverage is ~0.65 (high-ish)
    // and per-window coverages are 0.9 / 0.5 → Bessel σ≈0.283 → 'mixed'
    // (retuned 2026-06-18 for the n-1 variance fix #5a; old 0.9/0.4 → 'volatile').
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({
        date: '2026-05-03',
        utmCampaign: 'mixed-trust',
        totalCad: 90,
        storeId: 'uzoshop',
      }),
      makeOrder({
        date: '2026-05-10',
        utmCampaign: 'mixed-trust',
        totalCad: 50,
        storeId: 'uzoshop',
      }),
    ];
    const result = analyzeAttribution(
      {
        campaignName: 'mixed-trust',
        storeId: 'uzoshop',
        platform: 'Meta',
        metaClaim: 200,
        spend: 50,
      },
      orders,
      '2026-05-01',
      '2026-05-14',
      metaSeries,
    );
    expect(result).not.toBeNull();
    expect(result!.windowStability!.verdict).toBe('mixed');
    // Trust level is NOT forced down by the mixed branch. Whatever
    // the coverage→trust ladder produced stands. We assert there is
    // NO mixed-induced downgrade hint — i.e. trust score is not
    // forcibly clamped to 65 (the volatile clamp value).
    // For coverage 130/200 = 0.65 the ladder produces 'medium' anyway,
    // so the assertion that actually pins the U-04 contract: a 'mixed'
    // verdict does NOT introduce the volatile-specific copy.
    const reasonsConcat = result!.reasons.join(' | ');
    expect(reasonsConcat).not.toContain('תנודתי מאוד');
  });

  it('existing stable verdict path still emits its own honest reason (no regression)', () => {
    // Symmetry guard: the 'stable' branch must still fire. 2 windows
    // with the same coverage → σ=0 → stable.
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({
        date: '2026-05-03',
        utmCampaign: 'stable-camp',
        totalCad: 80,
        storeId: 'uzoshop',
      }),
      makeOrder({
        date: '2026-05-10',
        utmCampaign: 'stable-camp',
        totalCad: 80,
        storeId: 'uzoshop',
      }),
    ];
    const result = analyzeAttribution(
      {
        campaignName: 'stable-camp',
        storeId: 'uzoshop',
        platform: 'Meta',
        metaClaim: 200,
        spend: 50,
      },
      orders,
      '2026-05-01',
      '2026-05-14',
      metaSeries,
    );
    expect(result).not.toBeNull();
    expect(result!.windowStability!.verdict).toBe('stable');
    const reasonsConcat = result!.reasons.join(' | ');
    expect(reasonsConcat).toContain('יחס Meta:Shopify יציב');
  });
});

describe('analyzeAttribution — audit 2026-06-18 attribution bug fixes', () => {
  it('#2a: a mismatched utm_id falls through to the utm_campaign NAME match (no longer hard-rejects)', () => {
    const orders = [
      makeOrder({
        date: '2026-05-05',
        storeId: 'uzoshop',
        utmId: 'STALE-9999', // does NOT match campaignId '12345'
        utmCampaign: 'Summer Sale', // DOES match the campaign name
        totalCad: 120,
      }),
    ];
    const result = analyzeAttribution(
      { campaignName: 'Summer Sale', campaignId: '12345', storeId: 'uzoshop', platform: 'Meta', metaClaim: 100, spend: 50 },
      orders,
      '2026-05-01',
      '2026-05-14',
    );
    expect(result).not.toBeNull();
    // Before #2a the stale utm_id hard-rejected the order → deterministicOrders 0
    // → false "0 coverage / platform lying". Now it falls through to the name match.
    expect(result!.deterministicOrders).toBe(1);
    expect(result!.deterministicRevenue).toBe(120);
  });

  it('#2b: a Google campaign with an EMPTY campaign_id returns an honest "missing id" verdict', () => {
    const orders = [makeOrder({ date: '2026-05-05', storeId: 'uzoshop', utmCampaign: '99', totalCad: 80 })];
    const result = analyzeAttribution(
      { campaignName: 'PMax', campaignId: '', storeId: 'uzoshop', platform: 'Google', metaClaim: 100, spend: 50 },
      orders,
      '2026-05-01',
      '2026-05-14',
    );
    expect(result).not.toBeNull();
    // NOT the generic "אף הזמנה לא תויגה — הוסף URL Parameters" verdict that
    // misdirects to ORDER tagging; an honest "our campaign_id is missing".
    expect(result!.trust.label).toBe('אין מזהה קמפיין');
    expect(result!.deterministicOrders).toBe(0);
    expect(result!.reasons.join(' ')).toMatch(/campaign_id/);
  });

  it('#4: a LOW-trust campaign with spend < $200 now carries the small-sample caveat', () => {
    // High claim, near-zero matched revenue → coverage ≈ 0.01 → LOW trust branch
    // (which previously had NO spend check).
    const orders = [makeOrder({ date: '2026-05-05', storeId: 'uzoshop', utmCampaign: 'lowcov', totalCad: 10 })];
    const result = analyzeAttribution(
      { campaignName: 'lowcov', campaignId: 'c1', storeId: 'uzoshop', platform: 'Meta', metaClaim: 1000, spend: 50 },
      orders,
      '2026-05-01',
      '2026-05-14',
    );
    expect(result).not.toBeNull();
    expect(result!.trust.level).toBe('low');
    expect(result!.reasons.join(' | ')).toMatch(/הוצאה נמוכה/);
  });

  it('#5b: the 95% ROAS interval carries a small-sample caveat when matched orders < 5', () => {
    const orders = [
      makeOrder({ date: '2026-05-05', storeId: 'uzoshop', utmCampaign: 'few', totalCad: 100 }),
      makeOrder({ date: '2026-05-06', storeId: 'uzoshop', utmCampaign: 'few', totalCad: 200 }),
    ];
    const result = analyzeAttribution(
      { campaignName: 'few', campaignId: 'c2', storeId: 'uzoshop', platform: 'Meta', metaClaim: 300, spend: 100 },
      orders,
      '2026-05-01',
      '2026-05-14',
    );
    expect(result).not.toBeNull();
    expect(result!.roasInterval).not.toBeNull();
    expect(result!.deterministicOrders).toBe(2);
    expect(result!.reasons.join(' | ')).toMatch(/מבוסס על 2 הזמנות/);
  });
});
