import { describe, it, expect } from 'vitest';
import { aggregate } from '@/lib/analytics';
import type { DailyRow, DateRange } from '@/lib/types';

function row(over: Partial<DailyRow>): DailyRow {
  const revenue = over.revenue ?? 10000;
  const totalSpend = over.totalSpend ?? 3000;
  return {
    date: '2026-06-15', storeId: 'uzoshop', storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend, revenue,
    roas: revenue / (totalSpend || 1), grossProfit: revenue - totalSpend,
    cogs: revenue * 0.25, netProfit: revenue - totalSpend - revenue * 0.25,
    hasCogs: true, grossRevenue: null, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null, ...over,
  };
}
const range: DateRange = { from: '2026-06-01', to: '2026-06-30' };

describe('aggregate — salaries subtract in trueNetProfit only', () => {
  it('omitting salaries reproduces the prior trueNetProfit (default 0)', () => {
    const a = aggregate([row({})], range);
    const b = aggregate([row({})], range, undefined, undefined, 0);
    expect(b.trueNetProfit).toBeCloseTo(a.trueNetProfit, 6);
  });

  it('a positive salaries arg lowers trueNetProfit by exactly that amount', () => {
    const base = aggregate([row({})], range);
    const withSal = aggregate([row({})], range, undefined, undefined, 1400);
    expect(withSal.trueNetProfit).toBeCloseTo(base.trueNetProfit - 1400, 6);
  });

  it('does NOT change operating-profit inputs: revenue, spend, cogs, netProfit (legacy) are untouched', () => {
    const base = aggregate([row({})], range);
    const withSal = aggregate([row({})], range, undefined, undefined, 1400);
    expect(withSal.revenue).toBe(base.revenue);
    expect(withSal.spend).toBe(base.spend);
    expect(withSal.cogs).toBeCloseTo(base.cogs, 6);
    expect(withSal.netProfit).toBeCloseTo(base.netProfit, 6); // legacy net (rev−spend−cogs) is the operating-profit proxy
    expect(withSal.grossProfit).toBeCloseTo(base.grossProfit, 6);
  });

  it('trueMargin reflects the salaries deduction', () => {
    const withSal = aggregate([row({ revenue: 10000 })], range, undefined, undefined, 700);
    expect(withSal.trueMargin).toBeCloseTo(withSal.trueNetProfit / 10000, 6);
  });
});
