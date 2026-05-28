import { describe, it, expect } from 'vitest';
import {
  HEAVY_REFUND_PCT_THRESHOLD,
  HEAVY_REFUND_ABS_THRESHOLD,
  isHeavyRefundDay,
  sumRefundsInRange,
  heavyRefundDates,
} from '../refundDayHeuristic';
import type { DailyRow } from '../types';

function row(over: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-01',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0,
    revenue: 0, roas: 0, grossProfit: 0, cogs: 0, netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
    ...over,
  };
}

describe('thresholds', () => {
  it('expose locked constants', () => {
    expect(HEAVY_REFUND_PCT_THRESHOLD).toBe(0.20);
    expect(HEAVY_REFUND_ABS_THRESHOLD).toBe(500);
  });
});

describe('isHeavyRefundDay', () => {
  it('false when refundDeduction is null/0', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: null, grossRevenue: 1000 }))).toBe(false);
    expect(isHeavyRefundDay(row({ refundDeduction: 0, grossRevenue: 1000 }))).toBe(false);
  });
  it('true at exactly 20% of gross', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 200, grossRevenue: 1000 }))).toBe(true);
  });
  it('false just below 20% (and absolute < $500)', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 199, grossRevenue: 1000 }))).toBe(false);
  });
  it('true at exactly $500 even when pct is tiny', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 500, grossRevenue: 100000 }))).toBe(true);
  });
  it('true at $499.99 with high pct, true at $500 with low pct — OR semantics', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 499.99, grossRevenue: 2000 }))).toBe(true);
    expect(isHeavyRefundDay(row({ refundDeduction: 500, grossRevenue: 50000 }))).toBe(true);
  });
  it('falls back to revenue+refundDeduction when grossRevenue is null (legacy row)', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 200, revenue: 800, grossRevenue: null }))).toBe(true);
  });
  it('false when refund is below abs threshold AND there is no gross signal (revenue=0, grossRevenue=null)', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 1, revenue: 0, grossRevenue: null }))).toBe(false);
  });
  it('true when refund hits abs threshold even with no gross signal — abs short-circuit fires first', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 500, revenue: 0, grossRevenue: null }))).toBe(true);
  });
});

describe('sumRefundsInRange', () => {
  it('returns 0 for empty input', () => {
    expect(sumRefundsInRange([])).toBe(0);
  });
  it('sums refundDeduction, treating null as 0', () => {
    const rows = [
      row({ refundDeduction: 100 }),
      row({ refundDeduction: null }),
      row({ refundDeduction: 250.5 }),
    ];
    expect(sumRefundsInRange(rows)).toBe(350.5);
  });
});

describe('heavyRefundDates', () => {
  it('returns sorted unique dates of heavy days only', () => {
    const rows = [
      row({ date: '2026-05-20', refundDeduction: 1000, grossRevenue: 2000 }),
      row({ date: '2026-05-05', refundDeduction: 50,   grossRevenue: 1000 }),
      row({ date: '2026-05-12', refundDeduction: 600,  grossRevenue: 10000 }),
      row({ date: '2026-05-20', refundDeduction: 100,  grossRevenue: 1000 }),
    ];
    const dates = heavyRefundDates(rows);
    expect(dates).toEqual(['2026-05-12', '2026-05-20']);
  });
  it('returns [] when nothing is heavy', () => {
    expect(heavyRefundDates([row({ refundDeduction: 10, grossRevenue: 1000 })])).toEqual([]);
  });
});
