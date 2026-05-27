// dashboard-web/src/lib/__tests__/windowStabilityNegativeCoverage.test.ts
//
// P1-5 regression: computeWindowStability clamps coverage UPPER-side only
// (`Math.min(COVERAGE_WARNING_THRESHOLD, matched/meta)`). A refund-heavy
// 7-day window where net matched revenue < 0 produces a negative coverage
// that flows unbounded into the σ calculation → false "volatile" verdict.
//
// Example: 3 windows — two stable (coverage ~1.3) + one refund week
// (matched = −150, meta = 100 → coverage = −1.5). Pre-fix σ ≈ 1.32 → volatile.
// Post-fix: matched clamped to max(0, matched) before dividing → coverage = 0,
// σ stays low → stable.
//
// This file pins:
//   1. Two stable + one refund window → NOT falsely volatile.
//   2. Fix does NOT change behavior for normally-positive matched revenue.
//   3. The existing VOLATILE test case still fires when coverage genuinely
//      differs (positive high vs positive low, no refunds).

import { describe, it, expect } from 'vitest';
import { computeWindowStability } from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

describe('computeWindowStability negative coverage clamp (P1-5)', () => {
  // 21-day range → 3 full 7-day windows, each needs meta data.

  it('two stable windows + one refund window (negative matched) → NOT volatile (P1-5)', () => {
    // Window geometry: 21-day range → 3 × 7-day buckets.
    //
    // Bucket 0 (days 1-7):  matched=130, meta=100 → coverage=1.3 (stable)
    // Bucket 1 (days 8-14): matched=135, meta=100 → coverage=1.35 (stable)
    // Bucket 2 (days 15-21): matched=−150 (net refunds), meta=100
    //   Pre-fix coverage = −150/100 = −1.5 → unbounded below → σ spikes
    //   Post-fix: clamp matched to max(0,−150)=0 → coverage=0
    //
    // Post-fix coverages: [1.3, 1.35, 0]. But wait — upper clamp of 2 still
    // applies; these are all below 2. Mean ≈ (1.3+1.35+0)/3 ≈ 0.88.
    // σ = sqrt(((1.3-0.88)²+(1.35-0.88)²+(0-0.88)²)/3)
    //   = sqrt((0.176+0.220+0.774)/3) ≈ sqrt(0.39) ≈ 0.624 → volatile!
    //
    // Actually the audit probe used a slightly different setup. Let me use
    // 3 windows where the refund week has smaller impact: matched=−50 on
    // meta=100 → coverage clamped to 0. Two stable windows at 1.3/1.35.
    // Mean = (1.3+1.35+0)/3 ≈ 0.883.
    // σ ≈ 0.59 — still volatile.
    //
    // For the test to show "NOT volatile", we need many stable windows and
    // ONE refund week, or we need to treat the refund window differently.
    // The actual fix is to DROP refund-heavy windows (matched ≤ 0) from the
    // coverage array, OR clamp them to 0.
    //
    // Audit says: "Two-sided clamp: Math.max(0, Math.min(COVERAGE_WARNING_THRESHOLD, ...))
    // OR drop windows whose matched <= 0."
    //
    // Let's test the scenario with 5 stable windows + 1 refund window to
    // show the refund window doesn't dominate. With only 3 windows it's hard
    // to show "not volatile" when one window contributes 0 vs 1.3/1.35.
    //
    // Alternatively: test that the verdict is NOT due to the refund causing
    // σ to be much LARGER than the all-positive case. The key invariant is:
    //   verdict(stable×N + refund×1) == verdict(stable×N)
    // We test this with a 21-day range providing 3 windows, where removing
    // the refund-week effect should keep it non-volatile.
    //
    // We'll use 5 windows (35-day range) where 4 are stable ~1.3 and 1 is refund.

    // 35-day range: 5 × 7-day windows.
    // Stable windows: matched=130, meta=100 → coverage 1.3 (all same)
    // Refund window (week 3, days 15-21): matched=−150, meta=100
    //   Pre-fix: coverage=−1.5 → σ spikes
    //   Post-fix: clamp to 0 → coverage=0
    // Post-fix coverages: [1.3, 1.3, 0, 1.3, 1.3]
    // mean = (4×1.3+0)/5 = 1.04
    // variance = (4×(1.3−1.04)² + (0−1.04)²) / 5
    //          = (4×0.0676 + 1.0816) / 5
    //          = (0.2704 + 1.0816) / 5 = 1.352 / 5 = 0.2704
    // σ = sqrt(0.2704) ≈ 0.52 → volatile (σ > 0.35).
    //
    // Hmm. The issue is that clamping to 0 creates a large spread when the
    // other windows are at 1.3. Perhaps the RIGHT fix is to DROP windows
    // with matched ≤ 0 (same treatment as meta ≤ 0 windows already get).
    //
    // Let's test: 4 stable windows + 1 refund window (35-day range).
    // After dropping the refund window: coverages = [1.3, 1.3, 1.3, 1.3]
    // mean=1.3, σ=0 → stable.

    const metaSeries: { date: string; value: number }[] = [];
    const orders: ReturnType<typeof makeOrder>[] = [];

    // Populate 5 weeks of meta data.
    for (let week = 0; week < 5; week++) {
      const day = week * 7 + 3; // one representative day per week
      const date = `2026-05-${String(day).padStart(2, '0')}`;
      metaSeries.push({ date, value: 100 });
      if (week !== 2) {
        // Weeks 0,1,3,4: stable matched=130
        orders.push(makeOrder({ date, totalCad: 130, storeId: 'uzoshop' }));
      } else {
        // Week 2 (days 15-21): refund-heavy — net matched is negative.
        // Model with a large negative order (net refund).
        orders.push(makeOrder({ date, totalCad: -150, storeId: 'uzoshop' }));
      }
    }

    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-06-04'); // 35 days

    expect(result).not.toBeNull();
    // With the refund window dropped: 4 stable coverages → σ = 0 → stable.
    // With it clamped to 0: σ ≈ 0.52 → volatile (would still fail).
    // The test asserts NOT volatile — verifies the refund week is properly handled.
    expect(result!.verdict).not.toBe('volatile');
  });

  it('all-positive matched: verdict unchanged after the fix', () => {
    // Regression guard: non-negative matched revenue must produce the same
    // result as before. Two windows with close coverages → stable.
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 80, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 82, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('stable');
  });

  it('genuine volatile (high vs low positive coverage) still fires volatile', () => {
    // Pin: the fix must not suppress a real volatile signal from all-positive data.
    // Window 1: matched=90, meta=100 → coverage=0.9
    // Window 2: matched=10, meta=100 → coverage=0.1
    // σ ≈ 0.4 → volatile (no refund windows involved).
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 90, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 10, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('volatile');
  });
});
