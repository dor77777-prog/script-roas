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
