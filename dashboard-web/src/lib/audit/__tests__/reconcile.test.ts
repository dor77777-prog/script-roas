import { describe, it, expect } from 'vitest';
import { withinTolerance, agree, type Violation, reconcileWindow } from '../reconcile';

describe('withinTolerance (cross-source L2: ≤1% OR ≤$1)', () => {
  it('passes when absolute diff ≤ $1 even if pct large', () => {
    expect(withinTolerance(0.5, 1.4)).toBe(true); // diff 0.9 ≤ $1
  });
  it('passes when pct diff ≤ 1% even if absolute large', () => {
    expect(withinTolerance(10000, 10090)).toBe(true); // 0.9% ≤ 1%
  });
  it('fails when both pct > 1% and abs > $1', () => {
    expect(withinTolerance(100, 110)).toBe(false); // 10% and $10
  });
  it('treats two zeros as equal', () => {
    expect(withinTolerance(0, 0)).toBe(true);
  });
});

describe('agree (same-source L1: exact within epsilon)', () => {
  it('passes for floats within epsilon', () => {
    expect(agree([6736.19, 6736.1900001, 6736.19]).length).toBe(0);
  });
  it('returns a violation when one source diverges', () => {
    const v: Violation[] = agree([100, 100, 137], { label: 'revenue' });
    expect(v.length).toBe(1);
    expect(v[0].label).toBe('revenue');
  });
});

describe('boundary cases', () => {
  it('withinTolerance passes at the $1 floor and fails just past both thresholds', () => {
    expect(withinTolerance(100, 101)).toBe(true);   // exactly $1 → within abs floor
    expect(withinTolerance(100, 102)).toBe(false);  // $2 and 2% → fails both
  });
  it('withinTolerance handles one-side-zero via the non-zero denominator', () => {
    expect(withinTolerance(0, 0.99)).toBe(true);    // ≤ $1
    expect(withinTolerance(0, 1.01)).toBe(false);   // > $1 and 100%
  });
  it('agree returns [] for a single-element array', () => {
    expect(agree([42])).toEqual([]);
  });
  it('agree detects an outlier regardless of position', () => {
    expect(agree([100, 137, 100], { label: 'mid' }).length).toBe(1);
  });
  it('agree tolerates a tiny spread on all-negative values', () => {
    expect(agree([-1000.00, -1000.005]).length).toBe(0); // spread 0.005 ≤ 1¢ floor
  });
});

const dataRows = [
  { date: '2026-05-02', storeName: 'uzoshop', fbSpend: 1972, gaSpend: 150, ttSpend: 0, totalSpend: 2122, revenue: 6736.19, roas: 6736.19 / 2122 },
];
const productRows = [
  { date: '2026-05-02', storeName: 'uzoshop', revenue: 6736.19, netRevenue: 6736.19, orders: 12 },
];
const campaignRows = [
  { date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 1972 },
  { date: '2026-05-02', storeName: 'uzoshop', platform: 'Google', spend: 150 },
];
const ordersRows = [{ date: '2026-05-02', storeName: 'uzoshop', totalCad: 6736.19 }];

describe('reconcileWindow', () => {
  it('reports no violations for a self-consistent window', () => {
    expect(reconcileWindow({ dataRows, productRows, campaignRows, ordersRows })).toEqual([]);
  });
  it('flags ROAS that disagrees with revenue/spend (INV-3)', () => {
    const bad = [{ ...dataRows[0], roas: 99 }];
    const v = reconcileWindow({ dataRows: bad, productRows, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('INV-3 ROAS'))).toBe(true);
  });
  it('flags totalSpend that disagrees with platform sum (INV-6)', () => {
    const bad = [{ ...dataRows[0], totalSpend: 9999 }];
    const v = reconcileWindow({ dataRows: bad, productRows, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('INV-6 platform-sum'))).toBe(true);
  });
  it('flags campaigns_daily Meta spend off by >1% and >$1 vs data_daily (INV-7)', () => {
    const badCamp = [{ date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 3000 }, campaignRows[1]];
    const v = reconcileWindow({ dataRows, productRows, campaignRows: badCamp, ordersRows });
    expect(v.some(x => x.label.includes('INV-7 Meta spend'))).toBe(true);
  });
  it('uses products NET revenue for INV-9 — a gross>net refund gap on net match does not falsely fire', () => {
    // gross 8000 but net 6736.19 matches data → no INV-9 violation
    const refundProducts = [{ date: '2026-05-02', storeName: 'uzoshop', revenue: 8000, netRevenue: 6736.19, orders: 12 }];
    const v = reconcileWindow({ dataRows, productRows: refundProducts, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('INV-9'))).toBe(false);
  });
  it('flags products NET revenue that disagrees with data revenue (INV-9)', () => {
    const badProd = [{ date: '2026-05-02', storeName: 'uzoshop', revenue: 9000, netRevenue: 9000, orders: 12 }];
    const v = reconcileWindow({ dataRows, productRows: badProd, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('INV-9'))).toBe(true);
  });
  it('flags orders_attribution total that disagrees with data revenue (INV-10)', () => {
    const badOrders = [{ date: '2026-05-02', storeName: 'uzoshop', totalCad: 9000 }];
    const v = reconcileWindow({ dataRows, productRows, campaignRows, ordersRows: badOrders });
    expect(v.some(x => x.label.includes('INV-10'))).toBe(true);
  });
  it('flags a non-finite value in any source row (INV-14)', () => {
    const badData = [{ ...dataRows[0], roas: Infinity }];
    const v = reconcileWindow({ dataRows: badData, productRows, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('INV-14'))).toBe(true);
  });
  it('does NOT let per-store discrepancies cancel across stores (INV-7 per-cell)', () => {
    // store A over-reports Meta by 1000, store B under-reports by 1000; window totals cancel.
    const d = [
      { date: '2026-05-02', storeName: 'A', fbSpend: 1000, gaSpend: 0, ttSpend: 0, totalSpend: 1000, revenue: 2000, roas: 2 },
      { date: '2026-05-02', storeName: 'B', fbSpend: 1000, gaSpend: 0, ttSpend: 0, totalSpend: 1000, revenue: 2000, roas: 2 },
    ];
    const c = [
      { date: '2026-05-02', storeName: 'A', platform: 'Meta', spend: 2000 },
      { date: '2026-05-02', storeName: 'B', platform: 'Meta', spend: 0 },
    ];
    const p = [
      { date: '2026-05-02', storeName: 'A', revenue: 2000, netRevenue: 2000, orders: 1 },
      { date: '2026-05-02', storeName: 'B', revenue: 2000, netRevenue: 2000, orders: 1 },
    ];
    const o = [
      { date: '2026-05-02', storeName: 'A', totalCad: 2000 },
      { date: '2026-05-02', storeName: 'B', totalCad: 2000 },
    ];
    const v = reconcileWindow({ dataRows: d, productRows: p, campaignRows: c, ordersRows: o });
    expect(v.filter(x => x.label.includes('INV-7 Meta spend')).length).toBe(2); // both A and B fire
  });
});
