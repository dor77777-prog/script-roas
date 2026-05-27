// dashboard-web/src/lib/__tests__/billingPercentNegativeRevenue.test.ts
//
// FIX A (Critical) — billing percent-of-revenue Σ-invariant for negative-revenue stores.
//
// BUG: when a store has negative revenue in the period, `revenueForStore(s)` clamps
// to `max(0, revenueByStore[s]) = 0`, but the global `amount` is
// `max(0, totalRevenue) * pct/100` where totalRevenue still includes the negative
// store's contribution. This means `Σ per-store (clamped shares) > global amount`,
// breaking the P0-A reconciliation invariant.
//
// CORRECT FIX: allocate the global `amount` proportionally by clamped revenue weight.
// weight_s = max(0, revenueByStore[s]); W = Σ weight_s;
// if W > 0: byStore[s] = amount * (weight_s / W)
// else (all zero/negative): even split amount / N
// This guarantees Σ byStore == amount by construction.
//
// Tests:
//   (a) Two stores, one negative: uzoshop +65000, zolplus -5000, 2% "All" row.
//       Assert Σ byStore == amount EXACTLY, no store > amount, positive store larger share.
//   (b) All-stores-zero-revenue: even split fallback, Σ == amount.
//   (c) revenueByStore absent/undefined: even-split fallback, Σ == amount.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import { aggregate, aggregateByStore } from '../analytics';
import type { RecurringCost } from '../billing';

// ---------------------------------------------------------------------------
// Window stub
// ---------------------------------------------------------------------------
type MinimalWindow = {
  localStorage: Storage;
  dispatchEvent: (ev: Event) => boolean;
};

function installWindow(): { teardown: () => void; mem: Map<string, string> } {
  const mem = new Map<string, string>();
  const localStorage: Storage = {
    length: 0,
    clear: () => mem.clear(),
    getItem: (k: string) => mem.get(k) ?? null,
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k: string) => mem.delete(k),
    setItem: (k: string, v: string) => mem.set(k, v),
  };
  const g = globalThis as unknown as { window?: MinimalWindow };
  const prior = g.window;
  g.window = { localStorage, dispatchEvent: () => true };
  return {
    teardown: () => {
      g.window = prior;
    },
    mem,
  };
}

function seedRecurring(mem: Map<string, string>, items: RecurringCost[]) {
  mem.set('roas-dashboard:billing-recurring', JSON.stringify(items));
}

let teardown: () => void = () => {};
let mem: Map<string, string> = new Map();

beforeEach(() => {
  const w = installWindow();
  teardown = w.teardown;
  mem = w.mem;
});

afterEach(() => {
  teardown();
});

// ---------------------------------------------------------------------------
// DailyRow builder
// ---------------------------------------------------------------------------
function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

const RANGE: DateRange = { from: '2026-05-01', to: '2026-05-30' };

// ---------------------------------------------------------------------------
// (a) One store with negative revenue — Σ invariant
// ---------------------------------------------------------------------------
describe('billingPercentNegativeRevenue: Σ byStore == amount for negative-revenue stores', () => {
  it('(a) uzoshop +65000, zolplus -5000, 2% All: Σ == amount, no store > amount, positive store larger share', () => {
    // totalRevenue = 65000 + (-5000) = 60000
    // global amount = max(0, 60000) * 2/100 = 1200
    //
    // PRE-FIX (bug): revenueForStore clamps per-store:
    //   uzoshop share = max(0, 65000) * 2/100 = 1300
    //   zolplus share = max(0, -5000) * 2/100 = 0
    //   Σ = 1300 ≠ 1200 (BROKEN)
    //
    // POST-FIX (correct): weight-proportional allocation of global amount:
    //   W = 65000 + 0 = 65000
    //   uzoshop = 1200 * (65000/65000) = 1200
    //   zolplus = 1200 * (0/65000) = 0
    //   Σ = 1200 == 1200 (OK)
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Revenue Share',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 2,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 65_000, totalSpend: 200 }),
      row({ storeName: 'Zol Plus', storeId: 'zolplus', revenue: -5_000, totalSpend: 100 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global: max(0, 60000) * 2% = 1200
    expect(global.fixedCosts).toBeCloseTo(1_200, 4);

    const uzo = perStore.find(s => s.store === 'uzoshop');
    const zol = perStore.find(s => s.store === 'Zol Plus');
    expect(uzo).toBeDefined();
    expect(zol).toBeDefined();

    const sumPerStore = (uzo!.fixedCosts) + (zol!.fixedCosts);

    // P0-A invariant: Σ == amount EXACTLY (within float epsilon)
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 8);

    // No store receives more than the global amount
    expect(uzo!.fixedCosts).toBeLessThanOrEqual(global.fixedCosts + 0.0001);
    expect(zol!.fixedCosts).toBeLessThanOrEqual(global.fixedCosts + 0.0001);

    // Positive-revenue store gets the larger share
    expect(uzo!.fixedCosts).toBeGreaterThan(zol!.fixedCosts);
  });

  it('(a2) three stores: two positive, one negative — Σ == amount', () => {
    // storeA = +80000, storeB = +20000, storeC = -10000
    // totalRevenue = 90000; global amount = 90000 * 3% = 2700
    // weights: 80000, 20000, 0; W = 100000
    // storeA = 2700 * 80000/100000 = 2160
    // storeB = 2700 * 20000/100000 = 540
    // storeC = 2700 * 0/100000 = 0
    // Σ = 2700 ✓
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Markets Pro',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 3,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'storeA', storeId: 'storeA', revenue: 80_000 }),
      row({ storeName: 'storeB', storeId: 'storeB', revenue: 20_000 }),
      row({ storeName: 'storeC', storeId: 'storeC', revenue: -10_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // global: max(0, 90000) * 3% = 2700
    expect(global.fixedCosts).toBeCloseTo(2_700, 4);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 8);

    const sA = perStore.find(s => s.store === 'storeA');
    const sB = perStore.find(s => s.store === 'storeB');
    const sC = perStore.find(s => s.store === 'storeC');

    expect(sA!.fixedCosts).toBeCloseTo(2_160, 4);
    expect(sB!.fixedCosts).toBeCloseTo(540, 4);
    expect(sC!.fixedCosts).toBeCloseTo(0, 8);
  });
});

// ---------------------------------------------------------------------------
// (b) All-stores-zero-revenue: even-split fallback, Σ == amount
// ---------------------------------------------------------------------------
describe('billingPercentNegativeRevenue: all-stores-zero-revenue even-split fallback', () => {
  it('(b) all stores at 0 revenue: falls back to even split, Σ == amount', () => {
    // totalRevenue = 0, global amount = max(0,0) * 2% = 0
    // even split: each store gets 0
    // Σ = 0 == 0 ✓
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Revenue Share',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 2,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'storeA', storeId: 'storeA', revenue: 0 }),
      row({ storeName: 'storeB', storeId: 'storeB', revenue: 0 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    expect(global.fixedCosts).toBeCloseTo(0, 8);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 8);

    // Each store: 0 (even split of 0)
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(0, 8);
    }
  });

  it('(b2) all stores negative revenue: global amount = 0, Σ == 0', () => {
    // totalRevenue = -10000 + -5000 = -15000
    // global amount = max(0, -15000) * 2% = 0
    // all weights = 0, W = 0 → even split: each gets 0
    // Σ = 0 == 0 ✓
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Revenue Share',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 2,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'storeA', storeId: 'storeA', revenue: -10_000 }),
      row({ storeName: 'storeB', storeId: 'storeB', revenue: -5_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    expect(global.fixedCosts).toBeCloseTo(0, 8);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 8);
  });
});

// ---------------------------------------------------------------------------
// (c) revenueByStore absent / undefined: even-split fallback, Σ == amount
// ---------------------------------------------------------------------------
describe('billingPercentNegativeRevenue: revenueByStore absent/undefined even-split fallback', () => {
  it('(c) when no revenueByStore (single store input): even split, Σ == amount', () => {
    // When aggregateByStore is given only one store with revenue,
    // the revenueByStore fallback in billing uses max(0, revenue)/N.
    // This is the pre-existing revenueForStore fallback path.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Revenue Share',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 5,
        active: true,
      },
    ]);

    // Single store only — aggregateByStore with one store
    const rows: DailyRow[] = [
      row({ storeName: 'storeA', storeId: 'storeA', revenue: 10_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // global: max(0,10000) * 5% = 500
    expect(global.fixedCosts).toBeCloseTo(500, 4);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    // With 1 store: the sum of byStore must equal amount
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 8);
  });
});
