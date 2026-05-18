import { describe, it, expect } from 'vitest';
import { computeWindowStability } from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

describe('computeWindowStability', () => {
  // ----------------------------------------------------------------
  // Range < 14 days → null
  // ----------------------------------------------------------------

  it('returns null when date range is less than 14 days', () => {
    const result = computeWindowStability([], [], '2026-05-01', '2026-05-07');
    expect(result).toBeNull();
  });

  it('returns null for exactly 13 days (borderline below minimum)', () => {
    const result = computeWindowStability([], [], '2026-05-01', '2026-05-13');
    expect(result).toBeNull();
  });

  // ----------------------------------------------------------------
  // No usable coverage data → null
  // ----------------------------------------------------------------

  it('returns null when no matched orders and no metaSeries', () => {
    const result = computeWindowStability([], [], '2026-05-01', '2026-05-21');
    expect(result).toBeNull();
  });

  it('returns null when coverages.length < 2 (single window with meta data)', () => {
    // One window with meta data — can't compute σ from a single point
    const metaSeries = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      value: 100,
    }));
    // 14-day range: 2 full windows. But only the first window has meta data → 1 coverage point
    // → coverages.length < 2 → null
    const metaOnlyFirstWindow = metaSeries; // only first 7 days have data
    const result = computeWindowStability([], metaOnlyFirstWindow, '2026-05-01', '2026-05-14');
    // Both windows exist but second window has meta=0 → filtered out → 1 coverage
    expect(result).toBeNull();
  });

  // ----------------------------------------------------------------
  // Tail bucket rules (IN5-03)
  // ----------------------------------------------------------------

  it('IN5-03: includes tail bucket when >= 3 days (17 days = 2 full + 3 tail → windowCountWithData includes tail)', () => {
    // 17 days: 2 full 7-day windows + 3 tail days → tail >= 3 → included
    // Each window needs meta data to count
    const metaSeries = Array.from({ length: 17 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      value: 100,
    }));
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 80, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 80, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-15', totalCad: 80, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-17');
    expect(result).not.toBeNull();
    // windowCountWithData should be 3 (2 full + 1 tail with >= 3 days),
    // since each bucket has meta data.
    expect(result!.windowCountWithData).toBe(3);
  });

  it('IN5-03: excludes tail bucket when < 3 days (15 days = 2 full + 1 tail → windowCountWithData 2)', () => {
    // 15 days: 2 full windows + 1 tail day → tail < 3 → excluded
    const metaSeries = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      value: 100,
    }));
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 80, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 80, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-15');
    expect(result).not.toBeNull();
    // windowCountWithData should be 2 (tail excluded since 1 day < 3)
    expect(result!.windowCountWithData).toBe(2);
  });

  // ----------------------------------------------------------------
  // Verdict thresholds
  // ----------------------------------------------------------------

  it('verdict is stable when coverage σ < 0.15', () => {
    // Two windows with near-identical coverages (low σ)
    // Window 1: meta=100, matched=80 → coverage=0.8
    // Window 2: meta=100, matched=82 → coverage=0.82
    // mean=0.81, σ = sqrt(((0.8-0.81)²+(0.82-0.81)²)/2) = sqrt(0.0001) = 0.01 → stable
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

  it('verdict is volatile when coverage σ > 0.35', () => {
    // Two windows where coverages are very different.
    // To get coverage = matched/meta_window_sum, we need small meta sums.
    // Window 1 (days 1-7): meta=100 total (one day at 100), matched=90 → coverage=0.9
    // Window 2 (days 8-14): meta=100 total (one day at 100), matched=10 → coverage=0.1
    // mean=0.5, σ = sqrt(((0.9-0.5)²+(0.1-0.5)²)/2) = sqrt(0.16) = 0.4 → volatile
    const metaSeries = [
      { date: '2026-05-03', value: 100 }, // only day in window 1 with meta
      { date: '2026-05-10', value: 100 }, // only day in window 2 with meta
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 90, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 10, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('volatile');
  });

  it('verdict is mixed when coverage σ is between 0.15 and 0.35', () => {
    // Window 1: meta=100, matched=90 → coverage=0.9
    // Window 2: meta=100, matched=40 → coverage=0.4
    // mean=0.65, σ = sqrt(((0.9-0.65)²+(0.4-0.65)²)/2) = sqrt(0.03125) ≈ 0.25 → mixed
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 90, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 40, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    // σ ≈ 0.25, in range [0.15, 0.35] → mixed
    expect(result!.verdict).toBe('mixed');
  });

  // ----------------------------------------------------------------
  // Non-finite metaSeries value skipped
  // ----------------------------------------------------------------

  it('non-finite value in metaSeries is skipped and does not contaminate bucket', () => {
    // Window 1: meta_valid=100 (day 3) + NaN day 7 skipped → meta_sum=100
    // Window 2: meta=100 (day 10)
    // The NaN is skipped explicitly per line 440 in attributionAnalysis.ts
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-07', value: NaN }, // NaN should be skipped
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: 80, storeId: 'uzoshop' }),
      makeOrder({ date: '2026-05-10', totalCad: 80, storeId: 'uzoshop' }),
    ];
    // Window 1 meta: only day 3 (100, NaN skipped) → meta_window1 = 100
    // coverage_1 = 80/100 = 0.8, coverage_2 = 80/100 = 0.8 → stable
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    expect(result!.stdDev).toBeDefined();
    expect(Number.isNaN(result!.stdDev)).toBe(false);
    // Both coverages ~0.8 → stdDev should be very small (stable)
    expect(result!.stdDev).toBeLessThan(0.15);
  });

  // ----------------------------------------------------------------
  // Non-finite order totalCad skipped
  // ----------------------------------------------------------------

  it('non-finite order totalCad is skipped and does not corrupt bucket', () => {
    // Window 1: meta=100 (day 3), NaN order skipped + 80 valid → coverage = 80/100 = 0.8
    // Window 2: meta=100 (day 10), order 80 → coverage = 0.8
    const metaSeries = [
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-10', value: 100 },
    ];
    const orders = [
      makeOrder({ date: '2026-05-03', totalCad: NaN, storeId: 'uzoshop' }), // NaN skipped
      makeOrder({ date: '2026-05-03', totalCad: 80, storeId: 'uzoshop' }), // valid
      makeOrder({ date: '2026-05-10', totalCad: 80, storeId: 'uzoshop' }),
    ];
    const result = computeWindowStability(orders, metaSeries, '2026-05-01', '2026-05-14');
    expect(result).not.toBeNull();
    expect(Number.isNaN(result!.meanCoverage)).toBe(false);
    expect(Number.isNaN(result!.stdDev)).toBe(false);
    // The NaN order should not have inflated coverage (both windows ~0.8)
    expect(result!.meanCoverage).toBeCloseTo(0.8, 2);
  });
});
