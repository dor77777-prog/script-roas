# Billing Percent-of-Revenue Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two production-affecting correctness bugs in the Phase 12.5.x percent-of-revenue billing feature so that per-store True-Net-Profit cards sum correctly and `forecastMonthEnd.projectedFixedCosts` includes the contribution of every active percent-of-revenue recurring row.

**Architecture:** Thread the existing `revenueByStore` parameter of `billingForRange` from `aggregateByStore` → `aggregate` → `billingForRange`. Pass `revenue: projectedRev` to the `billingForRange` call inside `forecastMonthEnd`. No changes to `billingForRange` itself — only to its callers. Two implementation deltas (~16 LOC of production code), three test additions (~110 LOC). Single commit on a dedicated worktree branch.

**Tech Stack:** TypeScript 5, Next.js 15, Vitest 2.1 (jsdom for components, node for lib). Test commands run from `dashboard-web/` cwd.

**Spec:** `docs/superpowers/specs/2026-05-24-billing-hotfix-design.md`

**Prerequisite:** Execute on a worktree branch `phase-13.1-billing-hotfix` created via `superpowers:using-git-worktrees`. All commands assume cwd is the worktree root unless otherwise noted.

---

## File Structure

| File | Action | Responsibility after change |
|------|--------|-----------------------------|
| `dashboard-web/src/lib/analytics.ts` | Modify | `aggregate` accepts optional `revenueByStore` (4th positional arg). When present, threads global revenue + per-store split into `billingForRange`. `aggregateByStore` precomputes the map once and passes it down. |
| `dashboard-web/src/lib/insights.ts` | Modify | `forecastMonthEnd`'s `projectedFixedCosts` call passes `revenue: projectedRev` so percent-of-revenue recurring rows contribute. |
| `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts` | Extend | + 2 tests: percent-of-revenue All-row invariant + mixed fixed-CAD + percent invariant. |
| `dashboard-web/src/lib/__tests__/billing.test.ts` | Extend | + 2 unit tests: `billingForRange` with `revenueByStore` direct, and the even-split fallback. |
| `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts` | Extend | + window stub helper + 1 test: percent-of-revenue contributes to `projectedFixedCosts`. |

Total: 5 files. ~16 LOC production + ~110 LOC tests.

---

## Task 1: Write failing test — P0-A invariant for percent-of-revenue All row

**Files:**
- Modify: `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts` (append inside the existing `describe('aggregateByStore pre-splits All-scoped billing (CRIT-1 / O3-CR-01)', ...)` block — same file already imports `aggregate, aggregateByStore`, `DailyRow`, `DateRange`, `RecurringCost`, `OneTimeCost`, has `installWindow` + `seedRecurring` + `seedOneTime` + `row` helpers + `beforeEach`/`afterEach`).

- [ ] **Step 1: Write the failing test**

Open `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts`. Locate the closing brace `});` of the final `it('global aggregate path is UNCHANGED ...', () => { ... });` at line ~259 (which sits inside the outer describe). BEFORE that outer describe's closing `});` at line ~260, insert this new `it()` block:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts -t "Phase 13.1 P0-A"
```

Expected output: 1 test fails. The failure should be on `expect(sumPerStore).toBeCloseTo(global.fixedCosts, 6)` — `global.fixedCosts` is approximately `15000`, and `sumPerStore` is approximately `5000` (off by factor of 3). Vitest output includes:
```
 FAIL  src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts
   AssertionError: expected 5000 to be close to 15000
```

Do NOT proceed to Task 2 if the test passes — that means the bug is already fixed or the test is wrong.

---

## Task 2: Make P0-A test green — wire `revenueByStore` through `aggregate` + `aggregateByStore`

**Files:**
- Modify: `dashboard-web/src/lib/analytics.ts:112-231` (signature of `aggregate` + the `billingForRange` call inside) and `dashboard-web/src/lib/analytics.ts:259-282` (`aggregateByStore` precomputes the map).

- [ ] **Step 3: Add the 4th optional parameter to `aggregate`**

Open `dashboard-web/src/lib/analytics.ts`. Locate the `aggregate` function signature at line 112:

Replace this block (lines 112-131):
```ts
export function aggregate(
  rows: DailyRow[],
  range?: DateRange,
  /**
   * Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): optional in-scope store list.
   * When provided, `billingForRange` is called with this list rather than the
   * row-derived set — so the per-store call path (`aggregateByStore`) can
   * give the FULL store universe to billingForRange even though each
   * bucket's rows belong to just one store. Without it, an "All"-scoped
   * billing row would be charged in full to each per-store bucket
   * (because singleton `storeNames.length === 1` defeats the fair-share
   * split inside billingForRange). Sum of per-store True-Net-Profit cards
   * then inflated 2-3× over the global card.
   *
   * When `scopedStoreNames` is omitted, behavior is unchanged: billing
   * proration uses the set derived from the rows themselves (matches the
   * historical global-aggregate semantics).
   */
  scopedStoreNames?: string[],
): Aggregate {
```

With:
```ts
export function aggregate(
  rows: DailyRow[],
  range?: DateRange,
  /**
   * Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): optional in-scope store list.
   * When provided, `billingForRange` is called with this list rather than the
   * row-derived set — so the per-store call path (`aggregateByStore`) can
   * give the FULL store universe to billingForRange even though each
   * bucket's rows belong to just one store. Without it, an "All"-scoped
   * billing row would be charged in full to each per-store bucket
   * (because singleton `storeNames.length === 1` defeats the fair-share
   * split inside billingForRange). Sum of per-store True-Net-Profit cards
   * then inflated 2-3× over the global card.
   *
   * When `scopedStoreNames` is omitted, behavior is unchanged: billing
   * proration uses the set derived from the rows themselves (matches the
   * historical global-aggregate semantics).
   */
  scopedStoreNames?: string[],
  /**
   * Phase 13.1 (2026-05-24) — per-store revenue split, supplied by
   * `aggregateByStore` so the per-store path can hand `billingForRange`
   * the FULL period revenue (sum of map values) for percent-of-revenue
   * "All" rows, AND the per-store breakdown for store-specific percent
   * rows. Without this, each bucket's `aggregate` call used the bucket's
   * own revenue as the "global", and the All-row percent contribution
   * collapsed to global / storeCount (Σ per-store = global / N instead
   * of global). When omitted (global aggregate path), the call uses the
   * row-derived `revenue` exactly as before.
   */
  revenueByStore?: Record<string, number>,
): Aggregate {
```

- [ ] **Step 4: Wire the new param into the `billingForRange` call**

Still in `dashboard-web/src/lib/analytics.ts`. Locate the `billingForRange` call inside `aggregate` (lines 185-196 in the current file):

Replace this block:
```ts
  // Phase 12.5.x (2026-05-24) — pass `revenue` so percent-of-revenue
  // recurring rows can compute their contribution to fixedCosts. Without
  // this thread, a recurring row marked as "5% of revenue" silently
  // contributed 0 to the P&L, breaking the True Net Profit math.
  const billing = billingFrom && billingTo
    ? billingForRange({
        from: billingFrom,
        to: billingTo,
        storeNames: billingStoreNames,
        revenue,
      })
    : { total: 0, byStore: {} as Record<string, number> };
```

With:
```ts
  // Phase 12.5.x (2026-05-24) — pass `revenue` so percent-of-revenue
  // recurring rows can compute their contribution to fixedCosts. Without
  // this thread, a recurring row marked as "5% of revenue" silently
  // contributed 0 to the P&L, breaking the True Net Profit math.
  //
  // Phase 13.1 (2026-05-24) — when `revenueByStore` is supplied (per-store
  // path from `aggregateByStore`), derive the GLOBAL revenue from its
  // values rather than from the bucket's own rows. Otherwise the All-row
  // percent calc would use storeA_rev instead of totalRev, collapsing
  // Σ per-store to global / N. Also forward `revenueByStore` itself so
  // store-specific percent rows charge against THEIR store's revenue.
  const billing = billingFrom && billingTo
    ? billingForRange({
        from: billingFrom,
        to: billingTo,
        storeNames: billingStoreNames,
        ...(revenueByStore
          ? {
              revenue: Object.values(revenueByStore).reduce(
                (a, b) => a + b,
                0,
              ),
              revenueByStore,
            }
          : { revenue }),
      })
    : { total: 0, byStore: {} as Record<string, number> };
```

- [ ] **Step 5: Precompute `revenueByStore` in `aggregateByStore` and pass it to each bucket**

Still in `dashboard-web/src/lib/analytics.ts`. Locate `aggregateByStore` (lines 259-282 in the current file):

Replace this block:
```ts
export function aggregateByStore(
  rows: DailyRow[],
  range?: DateRange,
): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
  }
  // Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): pass the FULL in-scope store
  // universe to each per-store `aggregate` call. Without it each call's
  // billingForRange sees `storeNames.length === 1` (the singleton bucket)
  // and the "All"-row fair-share split degrades to "the whole amount per
  // store" — inflating every per-store True-Net-Profit card. The new
  // third arg lets `aggregate` itself ask billingForRange to split across
  // the same universe the global aggregate would, then attribute only
  // this bucket's share to the StoreAgg.
  const scopedStoreNames = Array.from(map.keys());
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list, range, scopedStoreNames) });
  }
  return out.sort((a, b) => b.roas - a.roas);
}
```

With:
```ts
export function aggregateByStore(
  rows: DailyRow[],
  range?: DateRange,
): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  // Phase 13.1 (2026-05-24) — precompute per-store revenue once in the same
  // pass that buckets rows. Threaded into each per-store `aggregate` call so
  // its `billingForRange` invocation can compute the GLOBAL revenue (sum of
  // values) for All-scoped percent rows AND the per-store slice for store-
  // specific percent rows. Without this, Σ per-store fixedCosts collapsed
  // to global / storeCount for percent-of-revenue rows (Phase 13.1 P0-A).
  const revenueByStore: Record<string, number> = {};
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
    revenueByStore[r.storeName] = (revenueByStore[r.storeName] ?? 0) + r.revenue;
  }
  // Audit fix 2026-05-23 (CRIT-1 / O3-CR-01): pass the FULL in-scope store
  // universe to each per-store `aggregate` call. Without it each call's
  // billingForRange sees `storeNames.length === 1` (the singleton bucket)
  // and the "All"-row fair-share split degrades to "the whole amount per
  // store" — inflating every per-store True-Net-Profit card. The new
  // third arg lets `aggregate` itself ask billingForRange to split across
  // the same universe the global aggregate would, then attribute only
  // this bucket's share to the StoreAgg.
  const scopedStoreNames = Array.from(map.keys());
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({
      store,
      ...aggregate(list, range, scopedStoreNames, revenueByStore),
    });
  }
  return out.sort((a, b) => b.roas - a.roas);
}
```

- [ ] **Step 6: Run the P0-A test to verify it passes**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts -t "Phase 13.1 P0-A"
```

Expected output:
```
 ✓ src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts (1)
   ✓ Σ per-store ≈ global fixedCosts when an All row uses percentOfRevenue (Phase 13.1 P0-A)

Test Files  1 passed (1)
     Tests  1 passed (1)
```

- [ ] **Step 7: Run the full `aggregateByStoreAllRowSplit` suite to confirm no regression**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts
```

Expected: all 5 existing tests + the 1 new test pass (6 total green). If any existing test breaks, the wiring change has a bug — diagnose before continuing.

---

## Task 3: Add MIXED fixed-CAD + percent regression guard (green-by-construction)

**Files:**
- Modify: `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts` (append next to the Task 1 test).

- [ ] **Step 8: Write the second invariant test**

In `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts`, immediately AFTER the Task 1 `it(...)` block (still inside the outer describe), append:

```ts
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

    // Global: fixed 60 × (30/30) + percent 5% × 300k = 60 + 15000 = 15060.
    expect(global.fixedCosts).toBeCloseTo(15_060, 6);

    const sumPerStore = perStore.reduce((s, x) => s + x.fixedCosts, 0);
    expect(sumPerStore).toBeCloseTo(global.fixedCosts, 6);
    // Each bucket: (60 + 15000) / 3 = 5020.
    for (const s of perStore) {
      expect(s.fixedCosts).toBeCloseTo(5_020, 6);
    }
  });
```

- [ ] **Step 9: Run the mixed test to verify it passes**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts -t "MIXED fixed-CAD"
```

Expected: 1 test passes. (No new implementation needed — Task 2's fix already covers this case.)

If it fails, the fix in Task 2 has an edge-case bug; diagnose before continuing.

---

## Task 4: Add direct unit tests on `billingForRange` with `revenueByStore`

**Files:**
- Modify: `dashboard-web/src/lib/__tests__/billing.test.ts` (append a new describe block at end of file).

- [ ] **Step 10: Append the new describe block**

Open `dashboard-web/src/lib/__tests__/billing.test.ts`. Scroll to the end of the file (after the closing `});` of the final `describe('parseShopifyBillsCsv (d/HI-06 — no per-row USD→CAD rounding)', ...)`). Append:

```ts

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
```

- [ ] **Step 11: Run the new billing tests to verify they pass**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/billing.test.ts -t "Phase 13.1"
```

Expected: 2 tests pass. (No implementation change needed — `billingForRange` already implements this contract; these tests pin the API.)

---

## Task 5: Write failing test — P0-B forecast includes percent-of-revenue rows

**Files:**
- Modify: `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts` (add window-stub helpers + new describe block at end of file).

- [ ] **Step 12: Add the window-stub helpers (the file currently does not stub window)**

Open `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts`. Locate the imports at the top (lines 35-37):
```ts
import { describe, it, expect } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';
```

Replace those three lines with:
```ts
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';
import type { RecurringCost } from '@/lib/billing';

// ---------------------------------------------------------------------------
// Phase 13.1 (2026-05-24) — window stub for the percent-of-revenue test.
// The existing tests don't need this because forecastMonthEnd's billing
// path returns 0 when window is undefined (safeReadArray short-circuits).
// The Phase 13.1 P0-B test below needs to seed an active recurring row.
// Lifted from billing.test.ts's pattern.
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
  return { teardown: () => { g.window = prior; }, mem };
}
function seedRecurring(mem: Map<string, string>, items: RecurringCost[]) {
  mem.set('roas-dashboard:billing-recurring', JSON.stringify(items));
}
```

- [ ] **Step 13: Append the P0-B test describe block at the end of the file**

Scroll to the bottom of `insightsProjectedNetMtd.test.ts`. After the closing `});` of the existing `describe('forecastMonthEnd projectedNet preserves MTD COGS (insights ALG-01)', ...)`, append:

```ts

describe('forecastMonthEnd includes percent-of-revenue billing in projectedFixedCosts (Phase 13.1 P0-B)', () => {
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

  it('5% All-row contributes 5% × projectedRev to projectedFixedCosts; projectedNet lower by that amount', () => {
    // The bug: forecastMonthEnd's `projectedFixedCosts` call to billingForRange
    // omitted `revenue`, so every active percent-of-revenue row contributed 0
    // (`Math.max(0, 0) × pct / 100 === 0`). projectedNet over-stated take-home
    // by `projectedRev × pct / 100` for any operator with a percent row.
    //
    // Strategy: monthDay-independent comparison. Run forecastMonthEnd twice
    // with identical rows but different billing seeds — once WITH the percent
    // row, once WITHOUT. The delta in projectedNet isolates the bug's effect.
    // Pre-fix: delta = 0 (both runs see projectedFixedCosts = 0 because the
    // revenue arg is missing). Post-fix: delta ≈ 5% × projectedRev.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 100,
          cogs: 250,
          hasCogs: true,
        }),
      );
    }

    // Run 1: with the 5% All-scoped recurring row.
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
    const fWithPercent = forecastMonthEnd(rows);

    // Run 2: same rows, no recurring billing.
    seedRecurring(mem, []);
    const fWithoutPercent = forecastMonthEnd(rows);

    // Sanity: the revenue projections are identical between runs (only the
    // billing seed differs). If this fails, something other than billing is
    // mixing into projectedRevenue.
    expect(fWithPercent.projectedRevenue).toBeCloseTo(
      fWithoutPercent.projectedRevenue,
      6,
    );

    // Core assertion: the only mathematical difference is projectedFixedCosts.
    // Post-fix: fWithPercent.projectedFixedCosts = 5% × projectedRev.
    //           fWithoutPercent.projectedFixedCosts = 0.
    // → fWithoutPercent.projectedNet − fWithPercent.projectedNet
    //   = (proj.. − 0) − (proj.. − 5%×rev) = 5% × projectedRev.
    const projectedRev = fWithPercent.projectedRevenue;
    const expectedDiff = 0.05 * projectedRev;
    const actualDiff =
      fWithoutPercent.projectedNet - fWithPercent.projectedNet;
    expect(actualDiff).toBeCloseTo(expectedDiff, 4);

    // Pre-fix pin: actualDiff would have been 0 (both runs identical because
    // billingForRange got no revenue arg → percent row contributed 0 in both).
    // Requiring >$10 guards against the test silently passing pre-fix even on
    // tiny projections (e.g. a 1-day month).
    expect(actualDiff).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 14: Run the P0-B test to verify it fails**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/insightsProjectedNetMtd.test.ts -t "Phase 13.1 P0-B"
```

Expected output: 1 test fails. The failure should be on `expect(actualDiff).toBeCloseTo(expectedDiff, 4)` — pre-fix `actualDiff` is 0 (both runs see `projectedFixedCosts = 0` because the revenue arg is missing for the percent row), while `expectedDiff` is approximately `0.05 × projectedRevenue` (≈ $700 for a mid-May execution). Vitest output includes:
```
 FAIL  src/lib/__tests__/insightsProjectedNetMtd.test.ts
   AssertionError: expected 0 to be close to <expectedDiff>
```

If the test passes, the P0-B bug is already fixed or the test is wrong. (The test is monthDay-independent — it works any day of the month because it compares two runs of the function with the same `today`.)

---

## Task 6: Make P0-B test green — pass `revenue: projectedRev` to `billingForRange`

**Files:**
- Modify: `dashboard-web/src/lib/insights.ts:586-593`.

- [ ] **Step 15: Wire `revenue: projectedRev` into the `projectedFixedCosts` call**

Open `dashboard-web/src/lib/insights.ts`. Locate the `projectedFixedCosts` calculation (around line 586):

Replace this block:
```ts
  const projectedFixedCosts =
    storesForBilling.length > 0
      ? billingForRange({
          from: monthStart,
          to: monthEnd,
          storeNames: storesForBilling,
        }).total
      : 0;
```

With:
```ts
  // Phase 13.1 P0-B (2026-05-24) — pass `revenue: projectedRev` so that
  // active percent-of-revenue recurring rows contribute to the projection.
  // Pre-fix this call omitted `revenue` → billingForRange defaulted to 0 →
  // every percent row's `amount = 0 × pct / 100 = 0` → projectedNet
  // over-stated take-home by `projectedRev × pct / 100` for any operator
  // with a percent-of-revenue cost line (e.g. Shopify Markets Pro 5%).
  //
  // Known limitation: we don't pass `revenueByStore` here — store-specific
  // percent rows in the FORECAST still use the even-split fallback inside
  // billingForRange. Affects the `byStore` granularity but NOT the total.
  // Deferred to a P1 follow-up because the dominant operator setup is
  // "All"-scoped percent rows. See docs/superpowers/specs/2026-05-24-billing-hotfix-design.md
  // "Known limitation" section.
  const projectedFixedCosts =
    storesForBilling.length > 0
      ? billingForRange({
          from: monthStart,
          to: monthEnd,
          storeNames: storesForBilling,
          revenue: projectedRev,
        }).total
      : 0;
```

- [ ] **Step 16: Run the P0-B test to verify it passes**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/insightsProjectedNetMtd.test.ts -t "Phase 13.1 P0-B"
```

Expected:
```
 ✓ src/lib/__tests__/insightsProjectedNetMtd.test.ts (1)
   ✓ 5% All-row contributes 5% × projectedRev to projectedFixedCosts ...

Test Files  1 passed (1)
     Tests  1 passed (1)
```

- [ ] **Step 17: Run the full `insightsProjectedNetMtd` suite to confirm no regression**

Run:
```
cd dashboard-web && npx vitest run src/lib/__tests__/insightsProjectedNetMtd.test.ts
```

Expected: 4 tests pass (3 existing + 1 new). If any existing test breaks, the insights.ts change has a side-effect — diagnose before continuing.

---

## Task 7: Full regression run + type check

- [ ] **Step 18: Run the entire vitest suite**

Run:
```
cd dashboard-web && npm test
```

Expected: 1059 tests pass (1054 prior + 5 new across 3 files). The output should end with a green summary like:
```
Test Files  113 passed (113)
     Tests  1059 passed (1059)
```

If any unrelated test fails, do NOT proceed. Diagnose: it is almost certainly a side-effect of the analytics.ts signature change (most likely a caller that passed something positional in slot 4). Grep for additional callers:
```
cd dashboard-web && grep -rn "aggregate(" src/ --include='*.ts' --include='*.tsx' | grep -v __tests__
```

Confirm every caller passes 1, 2, or 3 args. (If any caller passes 4, it was passing `revenueByStore` — extremely unlikely; the field is new.)

- [ ] **Step 19: Run the type checker via build**

Run:
```
cd dashboard-web && npm run build
```

Expected: `next build` completes with no TypeScript errors. The final output includes a route summary table. If type errors appear, they should reference the changes from Task 2 or Task 6. Most likely cause: a caller of `aggregate` that passes a 3rd arg of a non-`string[]` type that happens to coerce — but `scopedStoreNames` is unchanged, so this is highly unlikely.

---

## Task 8: Commit

- [ ] **Step 20: Stage the changed files explicitly (do NOT use `git add -A`)**

Run:
```
cd /Users/dorperetz/script-roas && git status
```

Confirm the only changes are in:
- `dashboard-web/src/lib/analytics.ts`
- `dashboard-web/src/lib/insights.ts`
- `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts`
- `dashboard-web/src/lib/__tests__/billing.test.ts`
- `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts`

(Plus possibly `docs/superpowers/specs/2026-05-24-billing-hotfix-design.md` and `docs/superpowers/plans/2026-05-24-billing-hotfix.md` if they weren't already committed.)

Run:
```
git add dashboard-web/src/lib/analytics.ts dashboard-web/src/lib/insights.ts dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts dashboard-web/src/lib/__tests__/billing.test.ts dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts
```

If the spec + plan files are also new, add them too (separately, for clarity):
```
git add docs/superpowers/specs/2026-05-24-billing-hotfix-design.md docs/superpowers/plans/2026-05-24-billing-hotfix.md
```

- [ ] **Step 21: Create the commit**

Run:
```
git commit -m "$(cat <<'EOF'
fix(billing): thread revenue to billingForRange in per-store + forecast paths (Phase 13.1)

Two production-affecting correctness bugs introduced by the Phase 12.5.x
percent-of-revenue billing feature are fixed by wiring the existing
`revenue` and `revenueByStore` parameters of `billingForRange` at two
call sites that were silently dropping them.

P0-A (analytics.ts): aggregateByStore now precomputes a per-store revenue
map and passes it to each bucket's aggregate() call. aggregate() forwards
it to billingForRange so the per-store path can compute the GLOBAL revenue
(sum of map values) for All-scoped percent rows instead of mis-using the
single bucket's revenue. Restores the invariant Σ per-store fixedCosts ≈
global fixedCosts for percent-of-revenue rows (was off by factor 1/N).

P0-B (insights.ts): forecastMonthEnd.projectedFixedCosts now passes
revenue: projectedRev to billingForRange so percent-of-revenue rows
contribute to the projection. Pre-fix projectedNet over-stated take-home
by projectedRev × pct / 100 for any operator with a percent cost line.

Tests added (5 total across 3 files):
- aggregateByStoreAllRowSplit: 2 new invariant tests
  (pure % All row + mixed fixed-CAD + %)
- billing: 2 new direct unit tests on billingForRange's revenueByStore
  handling and the even-split fallback
- insightsProjectedNetMtd: 1 new test asserting projectedFixedCosts
  reflects the percent contribution to projectedNet

Spec: docs/superpowers/specs/2026-05-24-billing-hotfix-design.md
Plan: docs/superpowers/plans/2026-05-24-billing-hotfix.md
Audit: .planning/audit-2026-05-24/MASTER-REPORT.md (Phase 13.1)

Known limitation: store-specific percent rows in the FORECAST still use
the even-split fallback because we don't compute projectedRevByStore.
Affects byStore granularity but NOT the total. Deferred to a P1 follow-up
since the dominant operator setup is All-scoped percent rows.
EOF
)"
```

Expected output: a `[branch-name <hash>]` confirmation line followed by `5 files changed, ...` (or 7 if the spec/plan are also new).

If the commit hook fails (the project memory notes pre-push gates are NOT enforced today, but a local `pre-commit` could exist), do NOT use `--no-verify`. Diagnose the hook failure and fix the underlying issue.

- [ ] **Step 22: Confirm the commit landed**

Run:
```
git log -1 --stat
```

Expected: the new commit appears at HEAD with the 5 (or 7) files listed.

---

## Done definition

All of the following must be true:

1. `cd dashboard-web && npm test` reports `1059 passed (1059)` (or higher if other contributors landed tests in parallel — at minimum the 1054 prior count + 5 new tests).
2. `cd dashboard-web && npm run build` exits 0 with no type errors.
3. `git log -1` shows the commit on the worktree branch.
4. The two new tests that were initially RED (Task 1 + Task 5) are now GREEN.
5. The three "characterization" tests (Task 3 + Task 4's two tests) are GREEN and pin the new contract.

---

## Post-completion (out of scope for this plan)

After this plan is executed and the worktree branch is ready:

1. **Request code review** via `superpowers:requesting-code-review`.
2. **Finish branch** via `superpowers:finishing-a-development-branch` — merge to main (auto-deploys via Vercel) OR open a PR.
3. **Post-deploy manual verification** (per project memory: no localhost): operator opens the prod dashboard and confirms (a) Σ per-store True-Net-Profit cards ≈ global card on the main page and (b) GoalTracker's projected net no longer overstates if any percent-of-revenue row is configured.
4. **Update audit master report** at `.planning/audit-2026-05-24/MASTER-REPORT.md` — change P0-A + P0-B status from "open" to "shipped 2026-05-24, commit `<sha>`".
