import { describe, it, expect } from 'vitest';
import type { Violation } from '../reconcile';
import { reconcileRows, bannerViolations, type ReconcileRowsInput } from '../reconcileRows';

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

describe('reconcileRows — store names containing a space ("Zol Plus") are NOT skipped', () => {
  it('reconciles a space-named store and flags its INV-10 breach (regression: split(" ") dropped "Plus" → store never matched)', () => {
    const d = [{ date: '2026-06-01', storeName: 'Zol Plus', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 1000, roas: 0 }];
    const o = [{ date: '2026-06-01', storeName: 'Zol Plus', totalCad: 5000 }]; // 5× off → INV-10 must fire
    const v = reconcileRows({ dataRows: d, productRows: [], campaignRows: [], ordersRows: o });
    const inv10 = v.find((x) => x.label.includes('INV-10'));
    expect(inv10).toBeDefined();
    expect(inv10!.label).toContain('Zol Plus'); // full store name preserved (not truncated to "Zol")
  });

  it('INV-9 carries soft + relGap so the banner can de-noise it', () => {
    const d = [{ date: '2026-06-01', storeName: 'Zol Plus', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 1000, roas: 0 }];
    const p = [{ date: '2026-06-01', storeName: 'Zol Plus', revenue: 1100, netRevenue: 1100, orders: 5 }];
    const inv9 = reconcileRows({ dataRows: d, productRows: p, campaignRows: [], ordersRows: [] }).find((x) => x.label.includes('INV-9'));
    expect(inv9?.soft).toBe(true);
    expect(inv9?.relGap).toBeCloseTo(0.1, 5); // |1100-1000|/1000
  });
});

describe('bannerViolations — only material/hard discrepancies reach the Home banner', () => {
  const soft: Violation = { label: 'INV-9 product vs data revenue 2026-06-01/uzoshop', detail: '…', soft: true, relGap: 0.08 };
  const smallHard: Violation = { label: 'INV-10 orders vs data revenue 2026-05-31/uzoshop', detail: '…', relGap: 0.067 };
  const bigHard: Violation = { label: 'INV-10 orders vs data revenue 2026-05-31/uzoshop', detail: '…', relGap: 0.5 };
  const noGapHard: Violation = { label: 'INV-7 Meta spend 2026-05-31/uzoshop', detail: '…' };

  it('excludes soft (INV-9 known custom-item gap)', () => {
    expect(bannerViolations([soft])).toHaveLength(0);
  });
  it('excludes a sub-threshold hard gap (<10%)', () => {
    expect(bannerViolations([smallHard])).toHaveLength(0);
  });
  it('includes a material hard gap (≥10%)', () => {
    expect(bannerViolations([bigHard])).toHaveLength(1);
  });
  it('includes a hard violation with no relGap (INV-7/3/14 are always material)', () => {
    expect(bannerViolations([noGapHard])).toHaveLength(1);
  });
  it('a clean-but-soft window yields an empty banner', () => {
    expect(bannerViolations([soft, smallHard])).toHaveLength(0);
  });
});
