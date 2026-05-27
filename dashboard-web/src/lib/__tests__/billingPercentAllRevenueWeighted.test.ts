// dashboard-web/src/lib/__tests__/billingPercentAllRevenueWeighted.test.ts
//
// P1-6 regression: a percent-of-revenue recurring row scoped to "All" stores
// was split EVENLY (amount/N) in the per-store view, while the single-store
// filter path charged each store its actual % of ITS OWN revenue.
//
// This test:
//   1. Builds a 2% All-row with two stores having different revenue
//      (uzoshop $50k, zolplus $10k).
//   2. Asserts each store is charged 2% of ITS OWN revenue ($1000 / $200),
//      not even-split ($600 / $600).
//   3. Asserts Σ per-store ≈ global (P0-A invariant preserved).
//   4. Confirms the existing all-equal test case ($100k/$100k/$100k) still
//      holds — the even-split and revenue-weighted results are identical
//      when all stores have equal revenue (no regression).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import { aggregate, aggregateByStore } from '../analytics';
import type { RecurringCost } from '../billing';

// ---------------------------------------------------------------------------
// Window stub (same pattern as aggregateByStoreAllRowSplit.test.ts)
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
// P1-6: percent-of-revenue All row — revenue-weighted per-store split
// ---------------------------------------------------------------------------

describe('percent-of-revenue All row splits per store by revenue, not evenly (P1-6)', () => {
  it('each store charged 2% of ITS OWN revenue, not equal share of total', () => {
    // uzoshop: $50,000 revenue → 2% = $1,000
    // zolplus: $10,000 revenue → 2% = $200
    // Total: $60,000 → 2% = $1,200
    //
    // Pre-fix even-split: $1,200 / 2 = $600 each (wrong)
    // Post-fix revenue-weighted: uzoshop $1,000, zolplus $200 (correct)
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Markets Pro',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 2,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 50_000, totalSpend: 200 }),
      row({ storeName: 'Zol Plus', storeId: 'zolplus', revenue: 10_000, totalSpend: 100 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global: 2% × $60,000 = $1,200.
    expect(global.fixedCosts).toBeCloseTo(1_200, 4);

    // Σ per-store == global (P0-A invariant).
    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 4);

    // Revenue-weighted: each store pays 2% of its own revenue.
    const uzo = perStore.find(s => s.store === 'uzoshop');
    const zol = perStore.find(s => s.store === 'Zol Plus');

    expect(uzo).toBeDefined();
    expect(zol).toBeDefined();

    // Post-fix: revenue-weighted
    expect(uzo!.fixedCosts).toBeCloseTo(1_000, 2); // 2% × 50k
    expect(zol!.fixedCosts).toBeCloseTo(200, 2);   // 2% × 10k

    // Explicitly confirm NOT even-split (pre-fix value was 600 each).
    expect(uzo!.fixedCosts).not.toBeCloseTo(600, 0);
    expect(zol!.fixedCosts).not.toBeCloseTo(600, 0);
  });

  it('P0-A invariant: Σ per-store fixedCosts ≈ global fixedCosts (revenue-weighted)', () => {
    // 3 stores with different revenues. Σ must equal global.
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
      row({ storeName: 'uzoshop',   storeId: 'uzoshop',   revenue: 87_000 }),
      row({ storeName: 'Zol Plus',  storeId: 'zolplus',   revenue: 8_000 }),
      row({ storeName: '360usmile', storeId: 'usmile360', revenue: 5_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global: 3% × 100k = 3,000.
    expect(global.fixedCosts).toBeCloseTo(3_000, 2);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 4);

    // Each store: 3% of their own revenue.
    const uzo = perStore.find(s => s.store === 'uzoshop');
    const zol = perStore.find(s => s.store === 'Zol Plus');
    const usm = perStore.find(s => s.store === '360usmile');

    expect(uzo!.fixedCosts).toBeCloseTo(87_000 * 0.03, 2);
    expect(zol!.fixedCosts).toBeCloseTo(8_000 * 0.03, 2);
    expect(usm!.fixedCosts).toBeCloseTo(5_000 * 0.03, 2);
  });

  it('equal-revenue stores: revenue-weighted == even-split (no regression)', () => {
    // When all stores have the same revenue the two methods produce identical
    // results, so this is a regression-safety check.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Markets Pro',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 5,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop',   storeId: 'uzoshop',   revenue: 100_000 }),
      row({ storeName: 'Zol Plus',  storeId: 'zolplus',   revenue: 100_000 }),
      row({ storeName: '360usmile', storeId: 'usmile360', revenue: 100_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    expect(global.fixedCosts).toBeCloseTo(15_000, 4);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 4);

    // Each bucket: 5% × 100k = 5,000.
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(5_000, 4);
    }
  });

  it('trueNetProfit invariant: Σ per-store ≈ global (P0-A downstream)', () => {
    // The percent row affects trueNetProfit — verify the downstream invariant.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Markets Pro',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 2,
        active: true,
      },
    ]);

    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 50_000 }),
      row({ storeName: 'Zol Plus', storeId: 'zolplus', revenue: 10_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    const sumPerStoreTrueNet = perStore.reduce((s, x) => s + x.trueNetProfit, 0);
    expect(sumPerStoreTrueNet).toBeCloseTo(global.trueNetProfit, 4);
  });
});
