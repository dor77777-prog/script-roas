// dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts
//
// CRIT-1 / O3-CR-01 regression: per-store aggregate must pre-split
// "All"-scoped recurring + one-time billing costs across the full in-scope
// store universe BEFORE the per-store loop. Otherwise each per-store
// `aggregate()` invocation sees `storeNames.length === 1` (the singleton
// bucket) and `billingForRange` charges the whole "All" amount to every
// store — inflating every per-store True-Net-Profit card 2-3× over the
// global card.
//
// Strategy (mirrors billing.test.ts):
//   1. Stub `window.localStorage` so `readRecurring` / `readOneTime`
//      pick up the test-seeded billing rows. vitest runs node, so we
//      synthesize a minimal `MinimalWindow` and assign it to globalThis.
//   2. Build production-shaped DailyRow fixtures for 3 stores.
//   3. Compute the global aggregate (current) and the per-store list
//      (aggregateByStore). Assert the to-the-cent invariant:
//        sum(perStore[i].fixedCosts) ≈ global.fixedCosts
//        sum(perStore[i].trueNetProfit) ≈ global.trueNetProfit
//   4. Cover edge cases: single-store + only an All-row (no double-count);
//      zero All-rows (regression-safe).
//
// Pinning the pre-fix failure as `not.toBe(WRONG_VALUE)` makes a silent
// regression visible: the moment the singleton path returns each store's
// share = full amount again, both invariant assertions break AND the
// "not equal to triple" guards trip.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import { aggregate, aggregateByStore } from '../analytics';
import type { RecurringCost, OneTimeCost } from '../billing';

// ---------------------------------------------------------------------------
// Minimal window stub (lifted from billing.test.ts pattern)
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

function seedOneTime(mem: Map<string, string>, items: OneTimeCost[]) {
  mem.set('roas-dashboard:billing-onetime', JSON.stringify(items));
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
// Production-shaped DailyRow builder
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

// ---------------------------------------------------------------------------
// CRIT-1 / O3-CR-01 — All-row split invariants
// ---------------------------------------------------------------------------

describe('aggregateByStore pre-splits All-scoped billing (CRIT-1 / O3-CR-01)', () => {
  // P1-31a (2026-06-10, D3): billing now prorates by TRUE calendar months
  // (full month = exactly monthlyCAD), so the fixture window is the FULL May
  // (31 days) — the old May-1..30 window relied on the retired ×days/30
  // convention to hit round numbers.
  const RANGE: DateRange = { from: '2026-05-01', to: '2026-05-31' };

  it('sum of per-store fixedCosts == global fixedCosts when an All row is present (to the cent)', () => {
    // Production-shape: 3 store-specific recurring rows + 1 All-scoped row.
    // Full-May window → calendar proration = exactly the monthly amounts (D3).
    seedRecurring(mem, [
      { id: 'r1', store: 'uzoshop',   name: 'Shopify Plan A', source: 'shopify-plan',  monthlyCAD: 105, active: true },
      { id: 'r2', store: 'Zol Plus',  name: 'Shopify Plan B', source: 'shopify-plan',  monthlyCAD: 105, active: true },
      { id: 'r3', store: '360usmile', name: 'Shopify Plan C', source: 'shopify-plan',  monthlyCAD: 105, active: true },
      // All-scoped Klaviyo: in the GLOBAL aggregate this should contribute
      // $60 (split evenly: $20 per store). In each per-store aggregate the
      // bucket gets just its $20 share.
      { id: 'r4', store: 'All',       name: 'Klaviyo',        source: 'email',         monthlyCAD: 60,  active: true },
    ]);
    // One-time All-scoped charge: same split rule.
    seedOneTime(mem, [
      { id: 'o1', date: '2026-05-15', store: 'All', description: 'Migration setup', source: 'one-off', amountCAD: 300 },
    ]);

    // 3 stores, 1 day each — enough to make the per-store path build 3 buckets.
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop',   storeId: 'uzoshop',   revenue: 1000, totalSpend: 200 }),
      row({ storeName: 'Zol Plus',  storeId: 'zolplus',   revenue: 2000, totalSpend: 400 }),
      row({ storeName: '360usmile', storeId: 'usmile360', revenue: 3000, totalSpend: 600 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global expected: 3 store-specific @ 105 + All Klaviyo 60 + All one-time 300 = 675.
    // (Full calendar month = exactly the monthly amounts under D3 proration.)
    expect(global.fixedCosts).toBeCloseTo(675, 6);

    // Sum-of-per-store invariant — the hammer that pins the fix:
    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 6);

    // Pre-fix behavior: each per-store bucket got the FULL All amount.
    // Pre-fix sumPerStore would be: 105*3 + (60+300)*3 = 315 + 1080 = 1395
    // (each bucket "saw" storeNames.length === 1 in billingForRange so the
    // singleton's fair-share split collapsed to the whole amount.)
    expect(sumPerStore).not.toBeCloseTo(1395, 0);

    // Same invariant on trueNetProfit (downstream of fixedCosts):
    const sumPerStoreTrueNet = perStore.reduce(
      (s, x) => s + x.trueNetProfit,
      0,
    );
    expect(sumPerStoreTrueNet).toBeCloseTo(global.trueNetProfit, 6);

    // And on transactionFees + cogs (orthogonal to the fix, but cross-check
    // the invariant doesn't accidentally break the other cost lines).
    const sumPerStoreCogs = perStore.reduce((s, x) => s + x.cogs, 0);
    expect(sumPerStoreCogs).toBeCloseTo(global.cogs, 6);
    const sumPerStoreFees = perStore.reduce(
      (s, x) => s + x.transactionFees,
      0,
    );
    expect(sumPerStoreFees).toBeCloseTo(global.transactionFees, 6);

    // Each per-store bucket's All-row share is the same ($20 from Klaviyo
    // + $100 from the migration one-time) on top of $105 Shopify-plan-each:
    //   uzoshop / Zol Plus / 360usmile: 105 + 20 + 100 = 225.
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(225, 6);
    }
  });

  it('single-store window + only an All-scoped row — full amount once, no double-count', () => {
    // Edge case: only one store actually has rows in the window. The
    // All-scoped row's "in-scope universe" then degenerates to that one
    // store, so it gets the full amount (correct — there's nothing to split
    // between). Both global and per-store should agree.
    seedRecurring(mem, [
      { id: 'r1', store: 'All', name: 'Klaviyo', source: 'email', monthlyCAD: 60, active: true },
    ]);
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 1000, totalSpend: 200 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    expect(global.fixedCosts).toBeCloseTo(60, 6);
    expect(perStore).toHaveLength(1);
    expect(perStore[0].fixedCosts).toBeCloseTo(60, 6);
    // No double-count: the global got 60 and the per-store also got 60 —
    // exactly the same source row, not summed twice.
    expect(perStore[0].fixedCosts).toBeCloseTo(global.fixedCosts, 6);
  });

  it('zero All-scoped rows — store-specific only — unchanged behavior', () => {
    // Regression-safety: when there are no All-scoped billing rows the
    // per-store path should behave identically to the pre-fix code. Each
    // store-specific recurring is charged exactly once to its store; sum
    // equals the global.
    seedRecurring(mem, [
      { id: 'r1', store: 'uzoshop',  name: 'Shopify', source: 'shopify-plan', monthlyCAD: 105, active: true },
      { id: 'r2', store: 'Zol Plus', name: 'Shopify', source: 'shopify-plan', monthlyCAD: 105, active: true },
    ]);
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop',  storeId: 'uzoshop',  revenue: 1000 }),
      row({ storeName: 'Zol Plus', storeId: 'zolplus',  revenue: 2000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    expect(global.fixedCosts).toBeCloseTo(210, 6);
    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(210, 6);

    // Each bucket sees ITS own store's recurring row only.
    const uzo = perStore.find(s => s.store === 'uzoshop');
    const zol = perStore.find(s => s.store === 'Zol Plus');
    expect(uzo?.fixedCosts).toBeCloseTo(105, 6);
    expect(zol?.fixedCosts).toBeCloseTo(105, 6);
  });

  it('empty rows — both global and per-store collapse to zero', () => {
    seedRecurring(mem, [
      { id: 'r1', store: 'All', name: 'Klaviyo', source: 'email', monthlyCAD: 60, active: true },
    ]);
    const global = aggregate([], RANGE);
    const perStore = aggregateByStore([], RANGE);
    expect(global.fixedCosts).toBe(0);
    expect(perStore).toHaveLength(0);
  });

  it('STORE-SCOPED aggregate with EMPTY rows charges ZERO fixed costs (2026-06-11 review — empty-bucket fallback)', () => {
    // 2026-06-11 adversarial review (confirmed, empirically reproduced):
    // the D4 threading passes scopedStoreNames = FULL store universe for any
    // single-store filter. With ZERO rows in range (store filter + a window
    // predating that store's data), rowStoreNames.length === 0 used to fall
    // through to `fixedCosts = billing.total` — charging the ENTIRE
    // business's All-scoped fixed costs to one empty single-store view
    // (trueNetProfit = −fullFixedCosts on the hero, P&L, and AI report).
    // Pre-D4 the same state passed scopedStoreNames=undefined →
    // billingStoreNames=[] → $0. Decision: empty bucket charges NOTHING —
    // consistent with fair-share-by-revenue → 0 revenue → 0 share.
    seedRecurring(mem, [
      { id: 'r1', store: 'All', name: 'Klaviyo', source: 'email', monthlyCAD: 60, active: true },
    ]);
    const scoped = aggregate(
      [],
      RANGE,
      ['uzoshop', 'Zol Plus', '360usmile'],
      { uzoshop: 100, 'Zol Plus': 200, '360usmile': 300 },
    );
    expect(scoped.fixedCosts).toBe(0);
    // trueNetProfit = 0 − salaries(0) = 0 — never −(business fixed costs).
    expect(scoped.trueNetProfit).toBe(0);
    // Pre-fix pin: the fallthrough returned billing.total = 60 → trueNet −60.
    expect(scoped.trueNetProfit).not.toBeCloseTo(-60, 6);

    // The billing.total fallback for length > 1 (global/multi-store path)
    // stays UNCHANGED — pin it so the new branch can't over-reach.
    const multi = aggregate(
      [
        row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 1000 }),
        row({ storeName: 'Zol Plus', storeId: 'zolplus', revenue: 2000 }),
      ],
      RANGE,
      ['uzoshop', 'Zol Plus', '360usmile'],
      { uzoshop: 1000, 'Zol Plus': 2000, '360usmile': 0 },
    );
    expect(multi.fixedCosts).toBeCloseTo(60, 6);
  });

  it('global aggregate path is UNCHANGED — no scopedStoreNames arg means row-derived store set', () => {
    // Pin that the new third arg is opt-in: a call with no third arg uses
    // the row-derived set (same as pre-fix). The global aggregate path
    // continues to call `aggregate(rows, range)` only — never the singleton
    // path that the per-store loop uses.
    seedRecurring(mem, [
      { id: 'r1', store: 'All', name: 'Klaviyo', source: 'email', monthlyCAD: 60, active: true },
    ]);
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop', storeId: 'uzoshop', revenue: 1000 }),
      row({ storeName: 'Zol Plus', storeId: 'zolplus', revenue: 2000 }),
    ];
    // Two-arg signature (matches Dashboard.tsx call site).
    const noScopeArg = aggregate(rows, RANGE);
    // Three-arg same value matches the implicit row-derived behavior.
    const withScopeArg = aggregate(rows, RANGE, ['uzoshop', 'Zol Plus']);
    expect(noScopeArg.fixedCosts).toBeCloseTo(withScopeArg.fixedCosts, 10);
    expect(noScopeArg.trueNetProfit).toBeCloseTo(withScopeArg.trueNetProfit, 10);
  });

  // -------------------------------------------------------------------------
  // Phase 13.1 P0-A — percent-of-revenue All rows preserve the invariant
  // -------------------------------------------------------------------------
  it('Σ per-store ≈ global fixedCosts when an All row uses percentOfRevenue (Phase 13.1 P0-A)', () => {
    // 1 All-scoped recurring row at 5% of revenue (no fixed CAD amount).
    // Phase 12.5.x added the percent path; pre-13.1 the per-store call to
    // aggregate computed `revenue` from each bucket's own rows ONLY, so the
    // percent calc used storeA_rev instead of totalRev — Σ per-store landed
    // at global / N. This test pins the post-13.1 behavior.
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

    // 3 stores × $100k revenue each → totalRev = $300k.
    // Expected global percent contribution: 5% × $300k = $15,000.
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop',   storeId: 'uzoshop',   revenue: 100_000, totalSpend: 200 }),
      row({ storeName: 'Zol Plus',  storeId: 'zolplus',   revenue: 100_000, totalSpend: 400 }),
      row({ storeName: '360usmile', storeId: 'usmile360', revenue: 100_000, totalSpend: 600 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global side: 5% × 300k = 15000.
    expect(global.fixedCosts).toBeCloseTo(15_000, 6);

    // The hammer: Σ per-store must reconcile to the global within fp eps.
    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 6);

    // Pre-13.1 behavior pin: Σ per-store collapsed to global / 3 = 5000.
    // If a future refactor regresses the wiring, this guard trips.
    expect(sumPerStore).not.toBeCloseTo(5_000, 0);

    // trueNetProfit is downstream of fixedCosts — confirm same invariant
    // holds end-to-end on the P&L number actually shown on the cards.
    const sumPerStoreTrueNet = perStore.reduce(
      (s, x) => s + x.trueNetProfit,
      0,
    );
    expect(sumPerStoreTrueNet).toBeCloseTo(global.trueNetProfit, 6);

    // Each bucket's share of the All-percent row: 15000 / 3 = 5000.
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(5_000, 6);
    }
  });

  it('Σ per-store ≈ global fixedCosts for MIXED fixed-CAD + percent-of-revenue All rows (Phase 13.1 P0-A)', () => {
    // Two All-scoped recurring rows: one fixed $60/mo + one 5% of revenue.
    // The fix must compose: fixed-CAD path already worked (d/CR-01); the
    // new percent-of-revenue path must add on top with the same invariant.
    seedRecurring(mem, [
      { id: 'r1', store: 'All', name: 'Klaviyo',    source: 'email',        monthlyCAD: 60, active: true },
      { id: 'r2', store: 'All', name: 'Markets Pro', source: 'external-app', monthlyCAD: 0,  percentOfRevenue: 5, active: true },
    ]);
    const rows: DailyRow[] = [
      row({ storeName: 'uzoshop',   storeId: 'uzoshop',   revenue: 100_000 }),
      row({ storeName: 'Zol Plus',  storeId: 'zolplus',   revenue: 100_000 }),
      row({ storeName: '360usmile', storeId: 'usmile360', revenue: 100_000 }),
    ];

    const global = aggregate(rows, RANGE);
    const perStore = aggregateByStore(rows, RANGE);

    // Global: fixed 60 (full May = exactly monthlyCAD, D3) + percent 5%% × 300k = 15060.
    expect(global.fixedCosts).toBeCloseTo(15_060, 6);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 6);
    // Each bucket: (60 + 15000) / 3 = 5020.
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(5_020, 6);
    }
  });
});
