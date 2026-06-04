/**
 * Wave 2 — pure customer-value compute (retention / LTV curve / repeat /
 * payback) over CohortMonthlyRow[] (one cell per store × first_order_month ×
 * month_since).
 *
 * Conventions (mirrors newCustomerMetrics.ts):
 *  - Pooled/weighted across cohorts: per month_since, Σ net (or active) over
 *    cohorts ÷ Σ M0 active — i.e. an M0-weighted average, NOT a naive mean.
 *  - cumulativeNet[m]   = running Σ pooled net per customer (M0..M11).
 *  - profit[m]          = net[m] × (1 − cogsPct − feesRate) at RENDER.
 *  - ltv12              = cumulative at M11, restricted to MATURE cohorts
 *                         (first_order_month ≥ 12mo before todayMonth).
 *  - per-cohort nCAC    = spendByMonth[fom] ÷ cohort-M0, only when spend exists
 *                         (May+); headline payback/ltvToNcac use blendedNcac.
 *  - Spend is NEVER recomputed from raw totals — spendByMonth + blendedNcac are
 *    passed in (mapping-aware upstream).
 */
import { describe, it, expect } from 'vitest';
import { computeCustomerValue } from '@/lib/home/customerValue';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';

function cell(over: Partial<CohortMonthlyRow>): CohortMonthlyRow {
  return {
    storeId: 'uzoshop',
    firstOrderMonth: '2025-01',
    monthSince: 0,
    activeCustomers: 0,
    orders: 0,
    grossCad: 0,
    netCad: 0,
    ...over,
  };
}

// ── Fixture A: two MATURE cohorts (both ≥12mo before todayMonth) ──────────────
// 2025-01: M0 10 cust / net 1000 · M1 4 / 400 · M2 2 / 200
// 2025-02: M0 10 cust / net 800  · M1 5 / 300
const fixtureA: CohortMonthlyRow[] = [
  cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000, grossCad: 1100 }),
  cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 4, orders: 4, netCad: 400, grossCad: 440 }),
  cell({ firstOrderMonth: '2025-01', monthSince: 2, activeCustomers: 2, orders: 2, netCad: 200, grossCad: 220 }),
  cell({ firstOrderMonth: '2025-02', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 800, grossCad: 880 }),
  cell({ firstOrderMonth: '2025-02', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 300, grossCad: 330 }),
];

describe('computeCustomerValue — retention + cumulative net (pooled, M0-weighted)', () => {
  const r = computeCustomerValue(fixtureA, {
    basis: 'net',
    feesRate: 0,
    blendedNcac: null,
    todayMonth: '2026-06',
  });

  it('retention[m] = Σ active at m ÷ Σ M0, indexed 0..11', () => {
    expect(r.retention).toHaveLength(12);
    expect(r.retention[0]).toBeCloseTo(1, 5); // 20/20
    expect(r.retention[1]).toBeCloseTo(0.45, 5); // (4+5)/20
    expect(r.retention[2]).toBeCloseTo(0.1, 5); // (2)/20
    expect(r.retention[3]).toBeCloseTo(0, 5); // no cells past M2
  });

  it('cumulativeNet[m] = running Σ pooled net ÷ Σ M0 (per-customer LTV curve)', () => {
    expect(r.cumulativeNet).toHaveLength(12);
    expect(r.cumulativeNet[0]).toBeCloseTo(90, 5); // 1800/20
    expect(r.cumulativeNet[1]).toBeCloseTo(125, 5); // 2500/20
    expect(r.cumulativeNet[2]).toBeCloseTo(135, 5); // 2700/20
    expect(r.cumulativeNet[11]).toBeCloseTo(135, 5); // flat after M2
  });

  it('ltv12Net = cumulativeNet at M11 over mature cohorts', () => {
    expect(r.ltv12Net).toBeCloseTo(135, 5);
  });

  it('repeatRate = Σ active(m≥1) ÷ Σ M0, capped at 1', () => {
    // m≥1 active = (4+2) + 5 = 11 ; 11/20 = 0.55
    expect(r.repeatRate).toBeCloseTo(0.55, 5);
  });
});

describe('computeCustomerValue — profit basis at render', () => {
  it('profit[m] = net[m] × (1 − cogsPct − feesRate); curve + ltv12 follow', () => {
    // cogs 25% + fees 5% → keep 70% of net
    const r = computeCustomerValue(fixtureA, {
      basis: 'profit',
      feesRate: 0.05,
      cogsPctByMonth: { '2025-01': 0.25, '2025-02': 0.25 },
      blendedNcac: null,
      todayMonth: '2026-06',
    });
    // pooled net per cust [0]=90 [1]=125 [2]=135 → ×0.70
    expect(r.cumulativeProfit[0]).toBeCloseTo(63, 5);
    expect(r.cumulativeProfit[1]).toBeCloseTo(87.5, 5);
    expect(r.cumulativeProfit[2]).toBeCloseTo(94.5, 5);
    expect(r.ltv12Profit).toBeCloseTo(94.5, 5);
  });

  it('per-cohort cogsPct: missing month falls back to default keep-rate', () => {
    // No cogsPctByMonth at all → default 0.25 cogs assumed via opts.defaultCogsPct
    const r = computeCustomerValue(fixtureA, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0.25,
      blendedNcac: null,
      todayMonth: '2026-06',
    });
    expect(r.cumulativeProfit[0]).toBeCloseTo(67.5, 5); // 90 × 0.75
  });
});

describe('computeCustomerValue — maturity gate on ltv12', () => {
  it('excludes cohorts younger than 12 months from ltv12 (but keeps them on the curve)', () => {
    const rows: CohortMonthlyRow[] = [
      // mature: 2025-01 (17mo before 2026-06)
      cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000 }),
      cell({ firstOrderMonth: '2025-01', monthSince: 11, activeCustomers: 1, orders: 1, netCad: 110 }),
      // immature: 2026-05 (1mo before 2026-06) — has only M0, must NOT define M11 ltv
      cell({ firstOrderMonth: '2026-05', monthSince: 0, activeCustomers: 5, orders: 5, netCad: 250 }),
    ];
    const r = computeCustomerValue(rows, { basis: 'net', feesRate: 0, blendedNcac: null, todayMonth: '2026-06' });
    // ltv12 mature-only: cohort 2025-01 cumNet at M11 = (1000+110)/10 = 111
    expect(r.ltv12Net).toBeCloseTo(111, 5);
    // the curve still pools all cohorts (M0): (1000+250)/(10+5)=83.33…
    expect(r.cumulativeNet[0]).toBeCloseTo(1250 / 15, 5);
  });

  it('null ltv12 when there are NO mature cohorts', () => {
    const rows: CohortMonthlyRow[] = [
      cell({ firstOrderMonth: '2026-05', monthSince: 0, activeCustomers: 5, orders: 5, netCad: 250 }),
    ];
    const r = computeCustomerValue(rows, { basis: 'net', feesRate: 0, blendedNcac: null, todayMonth: '2026-06' });
    expect(r.ltv12Net).toBeNull();
    expect(r.ltv12Profit).toBeNull();
  });
});

describe('computeCustomerValue — new vs old cohorts (early LTV)', () => {
  // newVsOld carries BOTH bases (net AND profit) so the tab's new-vs-veteran
  // card matches the ACTIVE basis (profit by default) — same basis as the
  // headline LTV + the curve. profit = net × keep-rate, so profit ≤ net.
  it('splits cohorts into recent/old halves and exposes net cumNet[0..2] per half', () => {
    const rows: CohortMonthlyRow[] = [
      // OLD half: 2025-01, 2025-02 — strong early LTV (per-cust M0 100)
      cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000 }),
      cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 500 }),
      cell({ firstOrderMonth: '2025-02', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000 }),
      // RECENT half: 2025-11, 2025-12 — weaker early LTV (per-cust M0 50)
      cell({ firstOrderMonth: '2025-11', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
      cell({ firstOrderMonth: '2025-12', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
      cell({ firstOrderMonth: '2025-12', monthSince: 1, activeCustomers: 4, orders: 4, netCad: 200 }),
    ];
    const r = computeCustomerValue(rows, { basis: 'net', feesRate: 0, blendedNcac: null, todayMonth: '2026-06' });
    expect(r.newVsOld.recent.net).toHaveLength(3);
    expect(r.newVsOld.old.net).toHaveLength(3);
    // OLD: pooled M0 net (1000+1000)/(10+10)=100 ; M1 (500)/(20)=25 → cum [0]=100 [1]=125 [2]=125
    expect(r.newVsOld.old.net[0]).toBeCloseTo(100, 5);
    expect(r.newVsOld.old.net[1]).toBeCloseTo(125, 5);
    expect(r.newVsOld.old.net[2]).toBeCloseTo(125, 5);
    // RECENT: pooled M0 (500+500)/(10+10)=50 ; M1 (200)/(20)=10 → cum [0]=50 [1]=60 [2]=60
    expect(r.newVsOld.recent.net[0]).toBeCloseTo(50, 5);
    expect(r.newVsOld.recent.net[1]).toBeCloseTo(60, 5);
    expect(r.newVsOld.recent.net[2]).toBeCloseTo(60, 5);
  });

  it('exposes a PROFIT cumulative curve per half = net × keep-rate (profit ≤ net)', () => {
    const rows: CohortMonthlyRow[] = [
      // OLD half
      cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000 }),
      cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 500 }),
      cell({ firstOrderMonth: '2025-02', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 1000 }),
      // RECENT half
      cell({ firstOrderMonth: '2025-11', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
      cell({ firstOrderMonth: '2025-12', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
      cell({ firstOrderMonth: '2025-12', monthSince: 1, activeCustomers: 4, orders: 4, netCad: 200 }),
    ];
    // keep 70% of net (cogs 25% + fees 5%) for every cohort month.
    const r = computeCustomerValue(rows, {
      basis: 'profit',
      feesRate: 0.05,
      defaultCogsPct: 0.25,
      blendedNcac: null,
      todayMonth: '2026-06',
    });
    expect(r.newVsOld.recent.profit).toHaveLength(3);
    expect(r.newVsOld.old.profit).toHaveLength(3);
    // OLD net cum [0]=100 [1]=125 [2]=125 → ×0.70
    expect(r.newVsOld.old.profit[0]).toBeCloseTo(70, 5);
    expect(r.newVsOld.old.profit[1]).toBeCloseTo(87.5, 5);
    expect(r.newVsOld.old.profit[2]).toBeCloseTo(87.5, 5);
    // RECENT net cum [0]=50 [1]=60 [2]=60 → ×0.70
    expect(r.newVsOld.recent.profit[0]).toBeCloseTo(35, 5);
    expect(r.newVsOld.recent.profit[1]).toBeCloseTo(42, 5);
    expect(r.newVsOld.recent.profit[2]).toBeCloseTo(42, 5);
    // Invariant: profit ≤ net at every point, both halves.
    for (let i = 0; i < 3; i++) {
      expect(r.newVsOld.recent.profit[i]).toBeLessThanOrEqual(r.newVsOld.recent.net[i] + 1e-9);
      expect(r.newVsOld.old.profit[i]).toBeLessThanOrEqual(r.newVsOld.old.net[i] + 1e-9);
    }
  });
});

describe('computeCustomerValue — nCAC, payback, ltv:nCAC', () => {
  it('payback = first m where cumulative profit ≥ blendedNcac', () => {
    // keep 70% of net → cumProfit [0]=63 [1]=87.5 [2]=94.5 ; nCAC 80 → payback at M1
    const r = computeCustomerValue(fixtureA, {
      basis: 'profit',
      feesRate: 0.05,
      cogsPctByMonth: { '2025-01': 0.25, '2025-02': 0.25 },
      blendedNcac: 80,
      todayMonth: '2026-06',
    });
    expect(r.blendedNcac).toBeCloseTo(80, 5);
    expect(r.paybackMonths).toBe(1); // 63 < 80 ≤ 87.5
    expect(r.ltvToNcac).toBeCloseTo(94.5 / 80, 5); // ltv12Profit ÷ nCAC
  });

  it('payback null when cumulative profit never reaches nCAC', () => {
    const r = computeCustomerValue(fixtureA, {
      basis: 'profit',
      feesRate: 0.05,
      cogsPctByMonth: { '2025-01': 0.25, '2025-02': 0.25 },
      blendedNcac: 1000, // unreachable
      todayMonth: '2026-06',
    });
    expect(r.paybackMonths).toBeNull();
  });

  it('payback & ltvToNcac null when blendedNcac is null (no spend history)', () => {
    const r = computeCustomerValue(fixtureA, {
      basis: 'profit',
      feesRate: 0.05,
      blendedNcac: null,
      todayMonth: '2026-06',
    });
    expect(r.paybackMonths).toBeNull();
    expect(r.ltvToNcac).toBeNull();
  });

  it('per-cohort nCAC only when spendByMonth has the cohort month (May+ gate)', () => {
    const r = computeCustomerValue(fixtureA, {
      basis: 'net',
      feesRate: 0,
      blendedNcac: null,
      spendByMonth: { '2025-01': 400 }, // only Jan has spend
      todayMonth: '2026-06',
    });
    const jan = r.cohortNcac.find((c) => c.firstOrderMonth === '2025-01');
    const feb = r.cohortNcac.find((c) => c.firstOrderMonth === '2025-02');
    expect(jan?.nCac).toBeCloseTo(40, 5); // 400 ÷ 10 M0
    expect(feb?.nCac).toBeNull(); // no spend for Feb → muted "אין נתוני הוצאה"
  });
});

describe('computeCustomerValue — verdict coherence (mature basis: payback vs ratio)', () => {
  // BUG: payback used the ALL-cohort pooled curve while ltv12/ratio used the
  // MATURE-only curve. With a recent high-value cohort inflating the all-cohort
  // curve, payback could "cross" nCAC even when the (honest) mature 12-month LTV
  // is BELOW nCAC — saying "losing" AND "recovers in N months" at once.
  //
  // Fixture: one MATURE cohort (2025-01) whose 12-month cumulative profit stays
  // BELOW the nCAC, plus a recent (immature) cohort (2026-05) with a huge M0 that
  // would inflate the pooled all-cohort curve above nCAC. The mature-coherent
  // payback must be null.
  const matureBelow: CohortMonthlyRow[] = [
    // MATURE: 2025-01 — per-customer net 50 at M0, never grows (no repeats).
    cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
    // IMMATURE recent: 2026-05 — huge per-customer M0 net (200) inflates the
    // pooled all-cohort M0 well above nCAC.
    cell({ firstOrderMonth: '2026-05', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 2000 }),
  ];

  it('mature-LTV < nCAC ⇒ paybackMonths === null (no false "recovers in N months")', () => {
    // keep 100% of net (no cogs/fees) → mature ltv12Profit = 50 < nCAC 80.
    const r = computeCustomerValue(matureBelow, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0,
      blendedNcac: 80,
      todayMonth: '2026-06',
    });
    // Honest mature 12-month profit is 50, below the 80 nCAC.
    expect(r.ltv12Profit).toBeCloseTo(50, 5);
    // Ratio < 1 → losing on acquisition.
    expect(r.ltvToNcac).toBeCloseTo(50 / 80, 5);
    expect(r.ltvToNcac! < 1).toBe(true);
    // The mature curve never reaches nCAC within 12 months → payback null.
    expect(r.paybackMonths).toBeNull();
  });

  it('exposes MATURE cumulative curves (net + profit) over the 12-month horizon', () => {
    const r = computeCustomerValue(matureBelow, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0,
      blendedNcac: 80,
      todayMonth: '2026-06',
    });
    expect(r.cumulativeNetMature).toHaveLength(12);
    expect(r.cumulativeProfitMature).toHaveLength(12);
    // Mature-only: cohort 2025-01 per-customer net 50, flat across the horizon.
    expect(r.cumulativeNetMature[0]).toBeCloseTo(50, 5);
    expect(r.cumulativeNetMature[11]).toBeCloseTo(50, 5);
    expect(r.cumulativeProfitMature[11]).toBeCloseTo(50, 5);
    // The all-cohort pooled curve is inflated by the recent cohort — it must
    // differ from the mature curve (proving the two bases are distinct).
    expect(r.cumulativeNet[0]).toBeCloseTo(2500 / 20, 5); // (500+2000)/20 = 125
    expect(r.cumulativeNet[0]).not.toBeCloseTo(r.cumulativeNetMature[0], 1);
  });

  it('mature-LTV ≥ nCAC ⇒ a finite payback consistent with the ratio (≥1)', () => {
    // MATURE cohort that grows past nCAC by M2 on the profit (mature) basis.
    //  2025-01: M0 10 cust / net 500 (per-cust 50) · M1 5 / 300 (cum 80) · M2 4 / 200 (cum 100)
    const matureAbove: CohortMonthlyRow[] = [
      cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
      cell({ firstOrderMonth: '2025-01', monthSince: 1, activeCustomers: 5, orders: 5, netCad: 300 }),
      cell({ firstOrderMonth: '2025-01', monthSince: 2, activeCustomers: 4, orders: 4, netCad: 200 }),
    ];
    const r = computeCustomerValue(matureAbove, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0,
      blendedNcac: 80,
      todayMonth: '2026-06',
    });
    // mature cumProfit: [0]=50 [1]=80 [2]=100 → reaches 80 at M1.
    expect(r.ltv12Profit).toBeCloseTo(100, 5);
    expect(r.ltvToNcac).toBeCloseTo(100 / 80, 5);
    expect(r.ltvToNcac! >= 1).toBe(true);
    expect(r.paybackMonths).toBe(1);
  });

  it('payback uses the mature curve even when blendedNcac uses an extreme value', () => {
    // Reaches nCAC at M0 (mature per-customer M0 profit 50 ≥ nCAC 40).
    const matureM0: CohortMonthlyRow[] = [
      cell({ firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 500 }),
    ];
    const r = computeCustomerValue(matureM0, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0,
      blendedNcac: 40,
      todayMonth: '2026-06',
    });
    expect(r.paybackMonths).toBe(0);
  });

  it('no mature cohorts ⇒ paybackMonths null + mature curves are all-zero', () => {
    const onlyRecent: CohortMonthlyRow[] = [
      cell({ firstOrderMonth: '2026-05', monthSince: 0, activeCustomers: 10, orders: 10, netCad: 2000 }),
    ];
    const r = computeCustomerValue(onlyRecent, {
      basis: 'profit',
      feesRate: 0,
      defaultCogsPct: 0,
      blendedNcac: 80,
      todayMonth: '2026-06',
    });
    expect(r.ltv12Profit).toBeNull();
    expect(r.paybackMonths).toBeNull();
    expect(r.cumulativeProfitMature.every((x) => x === 0)).toBe(true);
  });
});

describe('computeCustomerValue — store scope + empty', () => {
  it('storeName filter scopes the computation', () => {
    const rows: CohortMonthlyRow[] = [
      cell({ storeId: 'uzoshop', firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 10, netCad: 1000, orders: 10 }),
      cell({ storeId: 'zolplus', firstOrderMonth: '2025-01', monthSince: 0, activeCustomers: 99, netCad: 99999, orders: 99 }),
    ];
    const r = computeCustomerValue(rows, { basis: 'net', feesRate: 0, blendedNcac: null, storeName: 'uzoshop', todayMonth: '2026-06' });
    expect(r.cumulativeNet[0]).toBeCloseTo(100, 5); // 1000/10 — zolplus excluded
  });

  it('empty rows → zero curves, null ltv, 0 retention', () => {
    const r = computeCustomerValue([], { basis: 'net', feesRate: 0, blendedNcac: null, todayMonth: '2026-06' });
    expect(r.retention).toHaveLength(12);
    expect(r.retention.every((x) => x === 0)).toBe(true);
    expect(r.cumulativeNet.every((x) => x === 0)).toBe(true);
    expect(r.ltv12Net).toBeNull();
    expect(r.repeatRate).toBe(0);
    expect(r.paybackMonths).toBeNull();
  });
});
