/**
 * Phase 3 — pure NC-ROAS / nCAC adapter over OrderAttributionRow[] + mapping-
 * aware MER spend (agg.spend passed in; NEVER recomputed from raw totals).
 *
 *   ncRevenue   = Σ totalCad where isFirstOrder === true
 *   ncOrders    = count where isFirstOrder === true
 *   ncRoas      = ncRevenue / merSpend          (null when merSpend <= 0)
 *   nCac        = merSpend / ncOrders           (null when ncOrders === 0)
 *   unclassifiableShare = (#isFirstOrder==null) / total   (0 when total 0)
 */
import { describe, it, expect } from 'vitest';
import {
  computeNewCustomerMetrics,
  type FirstOrderInput,
} from '@/lib/home/newCustomerMetrics';

function row(over: Partial<FirstOrderInput>): FirstOrderInput {
  return { storeName: 'uzoshop', totalCad: 0, isFirstOrder: null, ...over };
}

describe('computeNewCustomerMetrics', () => {
  it('computes ncRoas / nCac / unclassifiableShare from first-order rows', () => {
    const rows: FirstOrderInput[] = [
      row({ totalCad: 100, isFirstOrder: true }),
      row({ totalCad: 60, isFirstOrder: true }),
      row({ totalCad: 200, isFirstOrder: false }), // returning
      row({ totalCad: 40, isFirstOrder: null }),   // guest / unclassifiable
    ];
    const m = computeNewCustomerMetrics(rows, 80); // merSpend = 80

    expect(m.ncRevenue).toBe(160);
    expect(m.ncOrders).toBe(2);
    expect(m.ncRoas).toBeCloseTo(2.0, 5);   // 160 / 80
    expect(m.nCac).toBeCloseTo(40, 5);      // 80 / 2
    expect(m.unclassifiableShare).toBeCloseTo(0.25, 5); // 1 of 4
  });

  it('null merSpend / 0 spend → ncRoas null; 0 new orders → nCac null', () => {
    const rows: FirstOrderInput[] = [row({ totalCad: 50, isFirstOrder: false })];
    const m = computeNewCustomerMetrics(rows, 0);
    expect(m.ncRoas).toBeNull();
    expect(m.nCac).toBeNull();
    expect(m.ncOrders).toBe(0);
  });

  it('empty rows → zero revenue/orders, null ratios, 0 unclassifiable share', () => {
    const m = computeNewCustomerMetrics([], 100);
    expect(m.ncRevenue).toBe(0);
    expect(m.ncOrders).toBe(0);
    expect(m.ncRoas).toBeNull(); // 0 / 100 is a meaningless ratio here → null
    expect(m.nCac).toBeNull();
    expect(m.unclassifiableShare).toBe(0);
  });

  it('storeName filter scopes the computation when provided', () => {
    const rows: FirstOrderInput[] = [
      row({ storeName: 'uzoshop', totalCad: 100, isFirstOrder: true }),
      row({ storeName: 'zolplus', totalCad: 999, isFirstOrder: true }),
    ];
    const m = computeNewCustomerMetrics(rows, 50, 'uzoshop');
    expect(m.ncRevenue).toBe(100);
    expect(m.ncOrders).toBe(1);
  });
});

const newRow = (totalCad: number, isFirstOrder: boolean | null) => ({ storeName: 'uzoshop', totalCad, isFirstOrder });

describe('computeNewCustomerMetrics — net-adj + confidence', () => {
  it('applies the net-adjust factor to ncRevenue (and thus ncRoas)', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(50, false)];
    // gross new revenue = 200; factor 0.9 -> net new revenue 180; spend 60 -> ncRoas 3.0
    const m = computeNewCustomerMetrics(rows, 60, 'uzoshop', 0.9);
    expect(m.ncRevenue).toBeCloseTo(180);
    expect(m.ncRoas).toBeCloseTo(3.0);
    expect(m.nCac).toBeCloseTo(30); // 60 / 2 new orders — count-based, unaffected by factor
  });
  it('factor defaults to 1 when omitted (back-compat)', () => {
    const m = computeNewCustomerMetrics([newRow(100, true)], 50, 'uzoshop');
    expect(m.ncRevenue).toBe(100);
  });
  it('confidence: ok when unclassifiable <= 20%', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(100, true), newRow(100, true), newRow(100, null)]; // 20%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('ok');
  });
  it('confidence: low when 20% < share <= 40%', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(100, null)]; // 33%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('low');
  });
  it('confidence: suppressed when share > 40%', () => {
    const rows = [newRow(100, true), newRow(100, null)]; // 50%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('suppressed');
  });
});
