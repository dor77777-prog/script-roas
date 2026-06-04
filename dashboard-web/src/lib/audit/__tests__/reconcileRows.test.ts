import { describe, it, expect } from 'vitest';
import type { Violation } from '../reconcile';
import { reconcileRows, type ReconcileRowsInput } from '../reconcileRows';

// A self-consistent (date, store) window: every cross-source figure agrees.
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

const clean: ReconcileRowsInput = { dataRows, productRows, campaignRows, ordersRows };

describe('reconcileRows — clean / all-agree case', () => {
  it('returns no violations for a self-consistent window', () => {
    expect(reconcileRows(clean)).toEqual([]);
  });
});

describe('reconcileRows — INV-7/9/10 breaches each produce a violation', () => {
  it('flags Σcampaigns Meta spend off by >1% and >$1 vs data_daily (INV-7)', () => {
    const badCamp = [{ date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 3000 }, campaignRows[1]];
    const v: Violation[] = reconcileRows({ ...clean, campaignRows: badCamp });
    expect(v.some(x => x.label.includes('INV-7 Meta spend'))).toBe(true);
  });

  it('flags Σproducts NET revenue that disagrees with data revenue (INV-9)', () => {
    const badProd = [{ date: '2026-05-02', storeName: 'uzoshop', revenue: 9000, netRevenue: 9000, orders: 12 }];
    const v = reconcileRows({ ...clean, productRows: badProd });
    expect(v.some(x => x.label.includes('INV-9'))).toBe(true);
  });

  it('flags Σorders_attribution total that disagrees with data revenue (INV-10)', () => {
    const badOrders = [{ date: '2026-05-02', storeName: 'uzoshop', totalCad: 9000 }];
    const v = reconcileRows({ ...clean, ordersRows: badOrders });
    expect(v.some(x => x.label.includes('INV-10'))).toBe(true);
  });
});

describe('reconcileRows — TikTok account-vs-Σcampaigns gap stays tolerated', () => {
  it('does NOT flag TikTok when Σcampaigns is BELOW data_daily account total (incomplete breakdown)', () => {
    // data_daily.tt = account-level 23.46; Σcampaigns = per-campaign 11.10 (TikTok under-reports). Expected, no flag.
    const d = [{ date: '2026-05-21', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 23.46, totalSpend: 23.46, revenue: 100, roas: 100 / 23.46 }];
    const c = [{ date: '2026-05-21', storeName: 'uzoshop', platform: 'TikTok', spend: 11.1 }];
    const v = reconcileRows({ dataRows: d, productRows: [], campaignRows: c, ordersRows: [] });
    expect(v.some(x => x.label.includes('INV-7 TikTok'))).toBe(false);
  });

  it('DOES flag TikTok only when Σcampaigns EXCEEDS data_daily (over-report / double-count)', () => {
    const d = [{ date: '2026-05-21', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 11.1, totalSpend: 11.1, revenue: 100, roas: 100 / 11.1 }];
    const c = [{ date: '2026-05-21', storeName: 'uzoshop', platform: 'TikTok', spend: 23.46 }];
    const v = reconcileRows({ dataRows: d, productRows: [], campaignRows: c, ordersRows: [] });
    expect(v.some(x => x.label.includes('INV-7 TikTok'))).toBe(true);
  });
});
