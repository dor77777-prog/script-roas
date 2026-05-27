// dashboard-web/src/lib/__tests__/cannibalizationNullSentinel.test.ts
//
// HIGH-11 / O3-HI-03 regression: cannibalizationDetection's `revenueGrowthPct`
// used to emit the literal `Infinity` when early revenue was 0 and late
// revenue was positive. JSON.stringify renders Infinity as `null` silently —
// so a value that round-trips through cloudSync or the AI-report payload
// arrives at the consumer as `null`, while the in-memory consumer (UI)
// sees a real `Infinity`. The two halves of the system disagree on the
// same field — a class of bug that erodes operator trust the moment they
// notice the same drawer rendering different verdicts after a refresh.
//
// Fix: emit `null` explicitly (matches what JSON would produce anyway),
// type the contract as `number | null`, and audit consumers.
//
// This file pins:
//   - The detector emits `null` (not Infinity) on the early=0, late>0 path
//   - The verdict survives JSON round-trip with the same field value
//   - The composition_changed branch ALSO emits null in the same case
//   - The risk classification on the null path is `none` (incrementality,
//     not cannibalization) with an explanatory Hebrew reason.

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
      productTitle: 'p1',
      netRevenue: perDay,
    });
  }
  return out;
}

describe('cannibalization revenueGrowthPct null sentinel (HIGH-11 / O3-HI-03)', () => {
  it('emits null (not Infinity) when early=0 and late>0 — normal branch', () => {
    // Both halves active (≥3 days each). Spend grew enough to pass the
    // composition + spend-growth checks. Early revenue 0 → ratio undefined.
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
    expect(result).toHaveLength(1);
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
    // Pin against the literal Infinity that the pre-fix code emitted.
    expect(result[0].metrics.revenueGrowthPct).not.toBe(Infinity);
    expect(Number.isFinite(result[0].metrics.revenueGrowthPct ?? 0)).toBe(true);
  });

  it('the null sentinel survives JSON round-trip without value drift', () => {
    // The whole point of switching from Infinity → null: JSON.stringify
    // already renders Infinity as null silently, but the in-memory
    // consumer would see the original Infinity. Now both sides agree
    // and a JSON round-trip is the identity function on this field.
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
    const json = JSON.stringify(result[0]);
    const parsed = JSON.parse(json);
    expect(parsed.metrics.revenueGrowthPct).toBeNull();
    // Identity invariant: stringify-parse of the in-memory value matches
    // the in-memory value itself.
    expect(parsed.metrics.revenueGrowthPct).toBe(
      result[0].metrics.revenueGrowthPct,
    );
  });

  it('the null path classifies as `none` with an incrementality reason', () => {
    // Operator expectation: scaling that creates revenue from nothing
    // is the OPPOSITE of cannibalization. Pre-fix the Infinity value
    // would have evaluated `revenueGrowthPct < 0.05` as `false` because
    // Infinity is not less than 0.05 — so the HIGH/MEDIUM thresholds
    // would correctly skip. Then the LOW threshold (Infinity < spend*0.75)
    // is also false. The else-branch (`none`) would emit "+Infinity%"
    // in the Hebrew reason, mangling the operator-visible text. Now the
    // dedicated null-branch returns a clear Hebrew sentence and skips
    // the threshold ladder.
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
    expect(result[0].risk).toBe('none');
    // Reason must NOT contain the literal "Infinity" or "+Infinity%".
    expect(result[0].reason).not.toMatch(/infinity/i);
    expect(result[0].reason).not.toContain('+Infinity%');
    // Should explain the incrementality verdict in Hebrew.
    expect(result[0].reason).toMatch(/אינקרמנטלית|אפס|זינק/);
  });

  it('composition_changed branch also emits null (not Infinity) on early=0 path', () => {
    // Composition_changed branch had the same pre-fix bug. Engineer a
    // scenario that triggers composition_changed (material member missing
    // from one half) AND has early revenue = 0.
    //
    // Setup: c1 ran throughout; c2 launched in late half only (material
    // share in late → composition_changed). Product revenue 0 in early,
    // positive in late.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),   // not running
        ...buildCampaignDaysHalf('c1', 100, 8, 14),
        ...buildCampaignDaysHalf('c2', 100, 8, 14), // launched mid-range
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 0, 1, 7),    // 0 revenue early
        ...buildProductDaysHalf('p1', 300, 8, 14), // positive late
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('composition_changed');
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
    expect(result[0].metrics.revenueGrowthPct).not.toBe(Infinity);
  });

  it('emits null when both halves have 0 revenue (P1-4 updated contract)', () => {
    // Audit fix 2026-05-28 (P1-4): earlyRev <= 0 → null across the board.
    // Pre-P1-4 the both-zero case emitted 0 ("flat"). With the unified
    // earlyRev <= 0 → null contract, both-zero also returns null (the base
    // is non-positive so the ratio is undefined). The UI renders "N/A"
    // consistently for any non-positive early revenue.
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
        ...buildProductDaysHalf('p1', 0, 8, 14),
      ],
    });
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
  });

  it('non-zero early revenue still produces a finite ratio', () => {
    // Sanity guard: the null sentinel only fires on early=0. A normal
    // early=100 / late=120 → 0.20 stays as a number.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: MAP,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 120, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 360, 8, 14),
      ],
    });
    expect(result[0].metrics.revenueGrowthPct).toBeCloseTo(0.2, 6);
    expect(result[0].metrics.revenueGrowthPct).not.toBeNull();
  });
});
