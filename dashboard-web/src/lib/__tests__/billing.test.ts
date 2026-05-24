// dashboard-web/src/lib/__tests__/billing.test.ts
//
// Regression tests for billing aggregation defects fixed in the audit
// 2026-05-23-v2 pass:
//
//   d/CR-01 — billingForRange triples "All"-stores recurring entries.
//     A $60/mo Klaviyo row scoped to "All" with 3 stores in scope was
//     summing $180 into the period total; one-time charges scoped to "All"
//     were also broken — the whole amount went to storeNames[0] instead of
//     splitting evenly.
//
//   d/HI-05 — findMatchingRecurring asymmetric scope.
//     When the imported line had store='All' but an existing recurring
//     row was store-specific (or vice-versa), the match was missed and
//     the user got a duplicate entry on every re-import.
//
//   d/HI-06 — CSV per-row USD→CAD rounding.
//     The importer was Math.round-ing each line during conversion, so a
//     $39.50 USD bill became C$53 instead of C$53.325 — a loss of accuracy
//     that compounded on totals. Float is stored; display layer formats.
//
// Strategy: vitest runs under `environment: 'node'` (see vitest.config.ts)
// so `window` is undefined by default. billingForRange short-circuits when
// window is missing — for these tests we stub a minimal window.localStorage
// + window.dispatchEvent before each test and tear it down after.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  billingForRange,
  findMatchingRecurring,
  parseShopifyBillsCsv,
  type RecurringCost,
} from '../billing';
import { FROZEN_USD_TO_CAD } from '../constants';

// ---------------------------------------------------------------------------
// Tiny in-memory localStorage stub. We attach a minimal-shape object to
// globalThis.window so safeReadArray/safeWrite in billing.ts (which only
// touch window.localStorage + window.dispatchEvent) find what they need.
// We deliberately cast through `unknown` to bypass the full DOM Window
// type — vitest runs under `environment: 'node'` so the real lib.dom
// shape isn't available anyway. Pre-fix this assignment was forced
// through a Partial<Window> assertion that lost type-safety silently.
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
// d/CR-01 — billingForRange "All"-stores recurring entries
// ---------------------------------------------------------------------------

describe('billingForRange (d/CR-01 — All-stores recurring split)', () => {
  it('counts an "All"-stores recurring row exactly ONCE in recurringInPeriod', () => {
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Klaviyo',
        source: 'email',
        monthlyCAD: 60,
        active: true,
      },
    ]);

    // 30-day window so the proration math is 60 × (30/30) = 60 exactly.
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus', '360usmile'],
    });

    expect(result.recurringInPeriod).toBe(60);
    // The pre-fix bug summed 60 × 3 = 180; pin the new behavior so a future
    // refactor cannot silently regress.
    expect(result.recurringInPeriod).not.toBe(180);
    expect(result.bySource.email).toBe(60);
    // Per-store attribution splits evenly: 60 / 3 = 20 per store.
    expect(result.byStore.uzoshop).toBeCloseTo(20, 10);
    expect(result.byStore['Zol Plus']).toBeCloseTo(20, 10);
    expect(result.byStore['360usmile']).toBeCloseTo(20, 10);
    // Invariant: sum(byStore) == recurringInPeriod (within fp eps).
    const sum =
      result.byStore.uzoshop +
      result.byStore['Zol Plus'] +
      result.byStore['360usmile'];
    expect(sum).toBeCloseTo(result.recurringInPeriod, 10);
  });

  it('store-specific recurring rows are charged once to their store only', () => {
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'uzoshop',
        name: 'Shopify Plan',
        source: 'shopify-plan',
        monthlyCAD: 105,
        active: true,
      },
    ]);
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus', '360usmile'],
    });
    expect(result.recurringInPeriod).toBe(105);
    expect(result.byStore.uzoshop).toBe(105);
    expect(result.byStore['Zol Plus']).toBe(0);
    expect(result.byStore['360usmile']).toBe(0);
  });

  it('inactive recurring rows are excluded from the total', () => {
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Old Sub',
        source: 'other',
        monthlyCAD: 999,
        active: false,
      },
    ]);
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus'],
    });
    expect(result.recurringInPeriod).toBe(0);
    expect(result.total).toBe(0);
  });

  it('splits an "All"-stores one-time charge evenly across in-scope stores', () => {
    mem.set(
      'roas-dashboard:billing-onetime',
      JSON.stringify([
        {
          id: 'o1',
          date: '2026-05-15',
          store: 'All',
          description: 'Migration setup',
          source: 'one-off',
          amountCAD: 300,
        },
      ]),
    );
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus', '360usmile'],
    });
    expect(result.oneTimeInPeriod).toBe(300);
    expect(result.byStore.uzoshop).toBeCloseTo(100, 10);
    expect(result.byStore['Zol Plus']).toBeCloseTo(100, 10);
    expect(result.byStore['360usmile']).toBeCloseTo(100, 10);
  });
});

// ---------------------------------------------------------------------------
// d/HI-05 — findMatchingRecurring symmetric scope
// ---------------------------------------------------------------------------

describe('findMatchingRecurring (d/HI-05 — symmetric All/store match)', () => {
  const klaviyo60All: RecurringCost = {
    id: 'r1',
    store: 'All',
    name: 'Klaviyo',
    source: 'email',
    monthlyCAD: 60,
    active: true,
  };
  const klaviyo60Uzo: RecurringCost = {
    id: 'r2',
    store: 'uzoshop',
    name: 'Klaviyo',
    source: 'email',
    monthlyCAD: 60,
    active: true,
  };

  it('finds an All-scoped existing row when the line is store-specific', () => {
    // Pre-fix: r.store ('All') !== store ('uzoshop') and the old `r.store !== 'All'`
    // bypass only fired the OTHER direction → match was returned correctly here
    // already. This test pins it as a regression guard.
    const match = findMatchingRecurring(
      {
        id: 'l1',
        date: '2026-05-15',
        description: 'Klaviyo',
        source: 'email',
        amountCAD: 60,
        suggestedType: 'recurring',
      },
      'uzoshop',
      [klaviyo60All],
    );
    expect(match?.id).toBe('r1');
  });

  it('finds a store-specific existing row when the line is "All" (NEW behavior)', () => {
    // Pre-fix: r.store ('uzoshop') !== 'All' (store arg) AND r.store !== 'All'
    // → loop continued → null returned → CSV re-import duplicated the row.
    // Post-fix: store === 'All' triggers the symmetric branch → match.
    const match = findMatchingRecurring(
      {
        id: 'l1',
        date: '2026-05-15',
        description: 'Klaviyo',
        source: 'email',
        amountCAD: 60,
        suggestedType: 'recurring',
      },
      'All',
      [klaviyo60Uzo],
    );
    expect(match?.id).toBe('r2');
  });

  it('does NOT match when the store is genuinely different (no scope overlap)', () => {
    const klaviyo60Zol: RecurringCost = {
      ...klaviyo60Uzo,
      id: 'r3',
      store: 'Zol Plus',
    };
    const match = findMatchingRecurring(
      {
        id: 'l1',
        date: '2026-05-15',
        description: 'Klaviyo',
        source: 'email',
        amountCAD: 60,
        suggestedType: 'recurring',
      },
      'uzoshop',
      [klaviyo60Zol],
    );
    expect(match).toBeNull();
  });

  it('does NOT match when descriptions differ', () => {
    const match = findMatchingRecurring(
      {
        id: 'l1',
        date: '2026-05-15',
        description: 'Other App',
        source: 'shopify-app',
        amountCAD: 60,
        suggestedType: 'recurring',
      },
      'uzoshop',
      [klaviyo60Uzo],
    );
    expect(match).toBeNull();
  });

  it('does NOT match when amount differs by more than $2', () => {
    const match = findMatchingRecurring(
      {
        id: 'l1',
        date: '2026-05-15',
        description: 'Klaviyo',
        source: 'email',
        amountCAD: 65, // $5 over → outside the ±$2 tolerance
        suggestedType: 'recurring',
      },
      'uzoshop',
      [klaviyo60Uzo],
    );
    expect(match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// d/HI-06 — CSV per-row USD→CAD rounding removed
// ---------------------------------------------------------------------------

describe('parseShopifyBillsCsv (d/HI-06 — no per-row USD→CAD rounding)', () => {
  it('stores the converted USD→CAD amount as a float (no Math.round)', () => {
    // 39.50 USD × FROZEN_USD_TO_CAD should NOT be Math.round'd into an int.
    const usd = 39.5;
    const csv = `Bill number,Issue date,Currency,Total,Line item description,Line item amount
b1,2026-05-15,USD,${usd},Klaviyo: Monthly app charge,${usd}`;
    const { parsed } = parseShopifyBillsCsv(csv, 'uzoshop');
    expect(parsed).toHaveLength(1);
    const expected = usd * FROZEN_USD_TO_CAD;
    // Float-equal within 1e-10 (subject to JS fp): no rounding has happened.
    expect(parsed[0].amountCAD).toBeCloseTo(expected, 10);
    // Sanity: the expected float-value is NOT an integer (so a covert
    // Math.round would actually change the answer).
    expect(Number.isInteger(expected)).toBe(false);
    // And the parsed value must NOT match the pre-fix rounded form.
    expect(parsed[0].amountCAD).not.toBe(Math.round(expected));
  });

  it('passes CAD amounts through unchanged', () => {
    const csv = `Bill number,Issue date,Currency,Total,Line item description,Line item amount
b1,2026-05-15,CAD,42.5,Some App,42.5`;
    const { parsed } = parseShopifyBillsCsv(csv, 'uzoshop');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].amountCAD).toBe(42.5);
  });
});

// ---------------------------------------------------------------------------
// Phase 13.1 (2026-05-24) — billingForRange `revenueByStore` plumbing
// ---------------------------------------------------------------------------

describe('billingForRange (Phase 13.1 — revenueByStore for percent-of-revenue rows)', () => {
  it('uses revenueByStore[s] for a store-specific percent row when provided', () => {
    // 3% commission against uzoshop's slice only. With revenueByStore the
    // store-specific row should bill against its own revenue ($70k), not
    // an even split.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'uzoshop',
        name: 'Affiliate',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 3,
        active: true,
      },
    ]);
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus'],
      revenue: 100_000,
      revenueByStore: { uzoshop: 70_000, 'Zol Plus': 30_000 },
    });
    // 3% × 70k = 2100, charged solely to uzoshop.
    expect(result.byStore.uzoshop).toBeCloseTo(2_100, 6);
    expect(result.byStore['Zol Plus']).toBeCloseTo(0, 6);
    expect(result.recurringInPeriod).toBeCloseTo(2_100, 6);
  });

  it('falls back to an even split of `revenue` when revenueByStore is omitted', () => {
    // Same store-specific row, but no revenueByStore — the helper falls
    // back to revenue / storeNames.length per the documented contract,
    // so uzoshop sees 3% × ($100k / 2) = $1500 instead of $2100.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'uzoshop',
        name: 'Affiliate',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 3,
        active: true,
      },
    ]);
    const result = billingForRange({
      from: '2026-05-01',
      to: '2026-05-30',
      storeNames: ['uzoshop', 'Zol Plus'],
      revenue: 100_000,
      // no revenueByStore
    });
    expect(result.byStore.uzoshop).toBeCloseTo(1_500, 6);
    expect(result.byStore['Zol Plus']).toBeCloseTo(0, 6);
  });
});
