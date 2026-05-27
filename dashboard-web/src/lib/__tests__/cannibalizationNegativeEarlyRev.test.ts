// dashboard-web/src/lib/__tests__/cannibalizationNegativeEarlyRev.test.ts
//
// P1-4 regression: cannibalizationDetection's `revenueGrowthPct` used
// `/ Math.abs(earlyRev)` as denominator, so when earlyRev is negative
// (refund-heavy early half) a less-negative late half reports artificially
// POSITIVE growth. E.g. early=−300 / late=−100 / spend+50%:
//   (−100 − (−300)) / |−300| = 200 / 300 = +0.67  ← "+67% growth, NONE"
// But BOTH halves are loss-making. The correct contract: when earlyRev <= 0,
// growth% is undefined → return null (UI shows "N/A").
//
// This file pins:
//   1. Negative earlyRev with less-negative lateRev does NOT report positive
//      growth and does NOT produce a NONE verdict.
//   2. Negative earlyRev with even-more-negative lateRev still triggers high
//      (correctly detected).
//   3. earlyRev > 0 normal path is unchanged (no regression).
//   4. earlyRev === 0 with lateRev > 0 still returns null (HIGH-11 pin).
//   5. earlyRev < 0 with lateRev > 0 (genuine recovery) returns null for
//      revenueGrowthPct (undefined growth ratio) — caller falls through to
//      the null-branch, not a false-positive NONE.

import { describe, expect, it } from 'vitest';
import {
  detectProductCannibalization,
  type CampaignDailyForCannibalization,
  type ProductDailyForCannibalization,
} from '@/lib/cannibalizationDetection';
import type { ProductMap } from '@/lib/campaignProductMap';

const STORE = 'uzoshop';

function k(platform: string, campaignId: string): string {
  return `${STORE}::${platform}::${campaignId}`;
}

const MAP: ProductMap = {
  [k('Meta', 'c1')]: ['p1'],
  [k('Meta', 'c2')]: ['p1'],
};

const FULL_RANGE = { from: '2026-05-01', to: '2026-05-14' };

function buildCampaignDaysHalf(
  campaignId: string,
  totalSpend: number,
  fromDay: number,
  toDay: number,
): CampaignDailyForCannibalization[] {
  const days = toDay - fromDay + 1;
  const perDay = totalSpend / days;
  const out: CampaignDailyForCannibalization[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    out.push({
      date: `2026-05-${String(d).padStart(2, '0')}`,
      storeId: STORE,
      platform: 'Meta',
      campaignId,
      spend: perDay,
    });
  }
  return out;
}

function buildProductDaysHalf(
  productId: string,
  totalRev: number,
  fromDay: number,
  toDay: number,
): ProductDailyForCannibalization[] {
  const days = toDay - fromDay + 1;
  const perDay = totalRev / days;
  const out: ProductDailyForCannibalization[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    out.push({
      date: `2026-05-${String(d).padStart(2, '0')}`,
      storeId: STORE,
      productId,
      productTitle: 'Test Product',
      netRevenue: perDay,
    });
  }
  return out;
}

describe('cannibalization revenueGrowthPct negative early revenue (P1-4)', () => {
  it('earlyRev<0 lateRev<0 (less negative): revenueGrowthPct is null, NOT positive', () => {
    // early=−300, late=−100, spend +50%.
    // Pre-fix: (−100 − (−300)) / |−300| = +0.67 → NONE (false positive).
    // Post-fix: earlyRev < 0 → null (undefined growth ratio).
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14), // +50% spend
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', -300, 1, 7), // negative early
        ...buildProductDaysHalf('p1', -100, 8, 14), // less negative late
      ],
    });
    expect(result).toHaveLength(1);
    // The key invariant: growth% must NOT be positive.
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
    // And it must NOT falsely report NONE (product is loss-making in both halves).
    expect(result[0].risk).not.toBe('none');
  });

  it('earlyRev<0 lateRev<0 (more negative): still captured (not masked by abs)', () => {
    // early=−100, late=−300, spend +50%. With abs denominator pre-fix:
    // (−300 − (−100)) / 100 = −2.0 → way below 0.05 → HIGH. Still correct.
    // Post-fix: null on negative early → null branch → not NONE.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14), // +50% spend
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', -100, 1, 7),  // negative early
        ...buildProductDaysHalf('p1', -300, 8, 14), // worse late
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
    // Should not be NONE — the situation is loss-making and spend grew.
    expect(result[0].risk).not.toBe('none');
  });

  it('earlyRev>0 lateRev>0 normal path unchanged: revenueGrowthPct is finite, not null', () => {
    // Regression guard: positive earlyRev must keep working exactly as before.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 120, 8, 14), // +20% spend
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 360, 8, 14), // +20% revenue
      ],
    });
    expect(result[0].metrics.revenueGrowthPct).toBeCloseTo(0.2, 6);
    expect(result[0].metrics.revenueGrowthPct).not.toBeNull();
  });

  it('earlyRev=0 lateRev>0 still returns null (HIGH-11 pin unchanged)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 0, 1, 7),
        ...buildProductDaysHalf('p1', 200, 8, 14),
      ],
    });
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
    expect(result[0].risk).toBe('none'); // genuine incrementality — unchanged
  });

  it('earlyRev<0 lateRev>0 genuine recovery: revenueGrowthPct is null (undefined ratio)', () => {
    // negative-to-positive: growth % is not calculable with a negative base.
    // The null path emits 'none' (incrementality verdict), consistent with
    // the earlyRev=0 path treatment.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14), // +50%
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', -100, 1, 7),  // negative early
        ...buildProductDaysHalf('p1', 200, 8, 14),  // positive late (recovery)
      ],
    });
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
  });
});
