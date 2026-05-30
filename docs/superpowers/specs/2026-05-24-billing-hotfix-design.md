# Billing Percent-of-Revenue Hotfix — Design Spec

**Date:** 2026-05-24
**Phase ID:** 13.1 (per the MT audit punch list in `.planning/audit-2026-05-24/MASTER-REPORT.md`)
**Severity:** P0 — production-affecting correctness
**Scope:** Tight hotfix only. Two root-cause bugs introduced by the Phase 12.5.x percent-of-revenue billing feature (2026-05-24).

## Background

Phase 12.5.x added a `percentOfRevenue?: number` field to `RecurringCost` so operators can express costs that scale with revenue (e.g. Shopify Markets Pro at 5%, affiliate commissions). The data layer (`billingForRange` in `dashboard-web/src/lib/billing.ts`) was implemented correctly — it accepts both a period-total `revenue` and an optional `revenueByStore` map, and uses the right one for each row scope.

The bug is purely at the call sites: two callers of `billingForRange` either don't pass `revenue` at all, or pass the wrong scope of `revenue`. Both produce silently-wrong P&L numbers in production.

## Goal

Fix the two bugs so that:
- **G1.** Per-store True-Net-Profit cards sum to the global True-Net-Profit card within floating-point tolerance, for any combination of fixed-CAD and percent-of-revenue recurring rows.
- **G2.** `forecastMonthEnd.projectedFixedCosts` includes the contribution of every active percent-of-revenue recurring row, derived from `projectedRev`.

## Non-goals

This is a hotfix. Out of scope:

- P1-1 (`deltaPct` NaN propagation in `analytics.ts:393-409`) — unrelated.
- P1-2 (`computeWindowStability` asymmetric clamp) — unrelated.
- P1-3 (`cannibalizationDetection.revenueGrowthPct` abs denominator) — unrelated.
- P2-1 (deletion of dead `costs.buildPnLBreakdown` with per-store-rate landmine) — separate cleanup phase.
- UI chip label fix at `components/PnLBreakdown.tsx:250` (display "6.5%" while computed value reflects per-store override) — separate UI phase.
- `projectedRevByStore` per-store accuracy in the forecast (P1 follow-up — see Known Limitation below).
- Converting `aggregate()` to an options-object signature (~10+ callers; breaking change inappropriate for a hotfix).

## Root cause analysis

### Bug 1 — `Σ per-store fixedCosts ≠ global fixedCosts` for percent-of-revenue All rows

**Files:** `dashboard-web/src/lib/analytics.ts:189-211, 259-282`
**Trigger:** Active recurring row with `store: 'All'` and `percentOfRevenue > 0`.

Flow today:

1. Global path: `aggregate(allRows, range)` computes `revenue = totalRev` from all rows. Calls `billingForRange({ ..., revenue: totalRev })`. `billingForRange`'s "All" branch computes `amount = totalRev × pct / 100`. Correct.
2. Per-store path: `aggregateByStore(allRows, range)` splits rows into 3 buckets, then calls `aggregate(bucketRows, range, scopedStoreNames)` for each bucket. Inside `aggregate`, `revenue` is computed from `bucketRows` — so it's `storeA_rev`, NOT `totalRev`. Calls `billingForRange({ ..., revenue: storeA_rev })`. `billingForRange`'s "All" branch computes `amount = storeA_rev × pct / 100`, then splits across `storeNames.length === 3` buckets as `perStoreShare = amount / 3 = storeA_rev × pct / 300`. The bucket extracts `byStore[bucketStore]`.
3. Summing across all 3 buckets: each contributes its own slice → `Σ = (storeA + storeB + storeC) × pct / 300 = totalRev × pct / 300 = global / 3`.

**Symptom:** at pct=5%, 3 stores, $100k month → per-store cards collectively understate fixedCosts by ~$3,333 (≈ $1,111 per card). Off in the opposite direction from the v3 CRIT-1 invariant breach (which was about fixed-CAD All rows being triple-counted).

### Bug 2 — `forecastMonthEnd.projectedFixedCosts` silently drops percent-of-revenue rows

**File:** `dashboard-web/src/lib/insights.ts:586-593`

```ts
const projectedFixedCosts =
  storesForBilling.length > 0
    ? billingForRange({
        from: monthStart,
        to: monthEnd,
        storeNames: storesForBilling,
      }).total                    // ← no `revenue` arg
    : 0;
```

`billingForRange` defaults `revenue = 0` when omitted. Every active percent-of-revenue recurring row computes `amount = 0 × pct / 100 = 0` and contributes nothing.

**Symptom:** `projectedNet` overstates take-home by `projectedRev × pct / 100` for every percent row. For a 5% affiliate commission on a $100k projected month → forecast over-states by $5,000.

Note: the MTD portion is correct because `mtdAgg` is built via `aggregate(mtdRows, range)` which DOES thread `revenue` into `billingForRange`. Only the forward-projected portion is broken.

## Architecture — chosen approach

**Approach A (selected): thread `revenueByStore` from `aggregateByStore` → `aggregate` → `billingForRange`.**

Minimal API change; no breaking changes to existing callers; uses parameters that `billingForRange` already exposes (`revenue` and `revenueByStore?`). The function `billingForRange` itself is unchanged.

### Alternatives considered (and why rejected)

- **B. Convert `aggregate` to options-object signature.** ~10+ callers; breaking change inappropriate for a hotfix. Defer to a separate phase if API cleanup is desired.
- **C. Add a new function `aggregateForBucket(...)` separate from `aggregate`.** Duplicates the body of `aggregate`. Two nearly-identical functions is a maintenance smell.

## Change set

### Change 1 — `dashboard-web/src/lib/analytics.ts`

**1a.** Add optional 4th positional parameter to `aggregate`:

```ts
export function aggregate(
  rows: DailyRow[],
  range?: DateRange,
  scopedStoreNames?: string[],
  revenueByStore?: Record<string, number>,  // NEW (Phase 13.1)
): Aggregate
```

**1b.** Inside `aggregate`, when `revenueByStore` is provided, derive `globalRevenue` from it and pass both to `billingForRange`. When omitted, the call stays exactly as it is today.

```ts
const billing = billingFrom && billingTo
  ? billingForRange({
      from: billingFrom,
      to: billingTo,
      storeNames: billingStoreNames,
      ...(revenueByStore
        ? {
            revenue: Object.values(revenueByStore).reduce((a, b) => a + b, 0),
            revenueByStore,
          }
        : { revenue }),
    })
  : { total: 0, byStore: {} as Record<string, number> };
```

Rationale for `Object.values(...).reduce(...)` over a separate `globalRevenue` arg: simpler API (one new param vs two), and the sum is trivially derivable. The cost is a single O(N_stores) reduce per `aggregate` call, where N_stores is 3 today — negligible.

**1c.** In `aggregateByStore`, precompute `revenueByStore` once from all input rows and pass to each bucket's `aggregate`:

```ts
export function aggregateByStore(
  rows: DailyRow[],
  range?: DateRange,
): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  const revenueByStore: Record<string, number> = {};                    // NEW
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
    revenueByStore[r.storeName] = (revenueByStore[r.storeName] ?? 0) + r.revenue;  // NEW
  }
  const scopedStoreNames = Array.from(map.keys());
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list, range, scopedStoreNames, revenueByStore) });  // pass 4th arg
  }
  return out.sort((a, b) => b.roas - a.roas);
}
```

Existing callers of `aggregate` that pass 1, 2, or 3 args continue to work unchanged.

### Change 2 — `dashboard-web/src/lib/insights.ts:586-593`

Add `revenue: projectedRev` to the existing `billingForRange` call:

```ts
const projectedFixedCosts =
  storesForBilling.length > 0
    ? billingForRange({
        from: monthStart,
        to: monthEnd,
        storeNames: storesForBilling,
        revenue: projectedRev,        // NEW (Phase 13.1)
      }).total
    : 0;
```

Add a one-line code comment referencing this design and explaining the limitation.

## Known limitation (deferred)

Store-specific percent-of-revenue rows in the FORECAST will still use the even-split fallback because we don't compute `projectedRevByStore`. Concretely: a row like `{ store: 'uzoshop', percentOfRevenue: 3 }` in a 3-store dashboard with $90k projected revenue will attribute `90000 × 3% / 3 = $900` evenly to each store's slot rather than `$2,700` to uzoshop alone.

This affects the breakdown's `byStore` granularity but NOT the `total` (the projection-total stays correct because the row's contribution is `projectedRev × pct / 100` regardless of split). And the dominant operator setup is "All"-scoped percent rows (Shopify Markets Pro, blanket affiliate commissions), which are unaffected.

If per-store forecast accuracy becomes important, a follow-up phase would extend `forecastMonthEnd` to compute `projectedRevByStore` from baseline `revenueByStore` (already available from `aggregateByStore(baselineRows, ...)`) and pass through.

## Test plan (TDD red-first)

Three test additions. All must be written and observed RED before the implementation lands.

### Test 1 — invariant: `Σ per-store ≈ global` for percent-of-revenue All rows

**File:** `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts` (extend)

```ts
it('preserves Σ per-store ≈ global fixedCosts for percent-of-revenue All rows', () => {
  // Arrange: 1 recurring row { store: 'All', percentOfRevenue: 5, monthlyCAD: 0, active: true }
  // Arrange: 3 stores × $100k revenue each, total $300k
  // Act: const global = aggregate(allRows, range)
  // Act: const perStore = aggregateByStore(allRows, range)
  // Assert: global.fixedCosts is within 0.01 of 15000 (5% of 300k)
  // Assert: perStore.reduce((s, b) => s + b.fixedCosts, 0) is within 0.01 of global.fixedCosts
});

it('preserves Σ per-store ≈ global fixedCosts for MIXED fixed-CAD + percent-of-revenue rows', () => {
  // Arrange: 2 recurring rows — one fixed $60/mo All, one 5% All
  // Same invariant assertion
});
```

Expected RED behaviour pre-fix: `perStore.sum < global` by factor `(N-1)/N` for the percent component.

### Test 2 — forecast includes percent rows

**File:** `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts` (extend)

```ts
it('includes percent-of-revenue recurring rows in projectedFixedCosts', () => {
  // Arrange: 1 recurring row { store: 'All', percentOfRevenue: 5, monthlyCAD: 0, active: true }
  // Arrange: rows that drive forecastMonthEnd to project $100k revenue
  // Act: const forecast = forecastMonthEnd(rows, today)
  // Assert: forecast.projectedNet is LOWER than (projectedRev - projectedSpend - projectedCogs - projectedFees) by at least 4500 (5% of 100k, allowing for proration)
});
```

Expected RED behaviour pre-fix: `projectedNet` overstated by ~5000 because the percent row contributes 0.

### Test 3 — direct unit on `billingForRange` with `revenueByStore`

**File:** `dashboard-web/src/lib/__tests__/billing.test.ts` (extend — file already exists)

```ts
it('uses revenueByStore when provided for per-store percent rows', () => {
  // Arrange: 1 store-specific row { store: 'uzoshop', percentOfRevenue: 3 }
  // Act: billingForRange({ from, to, storeNames: ['uzoshop','zolplus'], revenue: 100000, revenueByStore: { uzoshop: 70000, zolplus: 30000 } })
  // Assert: byStore.uzoshop ≈ 2100 (3% of 70000), zolplus ≈ 0
});

it('falls back to even split when revenueByStore is omitted', () => {
  // Arrange: same row, no revenueByStore
  // Act: billingForRange({ ..., revenue: 100000 })  // no revenueByStore
  // Assert: byStore.uzoshop ≈ 1500 (3% of 50000 fallback)
});
```

### Existing test suite (regression)

`cd dashboard-web && npm test` must run all 1054 existing specs green. The change is backwards-compatible at the API boundary (all existing callers pass ≤3 args).

## Files touched

| File | Type | Approx LOC change |
|------|------|-------------------|
| `dashboard-web/src/lib/analytics.ts` | modify | ~15 (signature + 2 call-site changes) |
| `dashboard-web/src/lib/insights.ts` | modify | ~3 (one new line + comment) |
| `dashboard-web/src/lib/__tests__/aggregateByStoreAllRowSplit.test.ts` | extend | ~50 (2 new tests) |
| `dashboard-web/src/lib/__tests__/insightsProjectedNetMtd.test.ts` | extend | ~30 (1 new test) |
| `dashboard-web/src/lib/__tests__/billing.test.ts` | extend | ~30 (2 new tests) |

Total: 5 files, ~130 LOC (most of it tests).

## Verification

1. **Unit tests.** `cd dashboard-web && npm test` — all existing 1054 green PLUS 5 new tests green.
2. **Type check.** `cd dashboard-web && npm run build` — no type errors. Existing callers of `aggregate` that pass 1/2/3 args must remain compiling.
3. **Manual verification in production** (per project memory: no localhost verification). After deploy, the operator loads the prod dashboard with their actual data and confirms:
   - Σ of per-store True-Net-Profit cards ≈ global True-Net-Profit card on the main dashboard.
   - GoalTracker's "projected net" no longer overstates take-home for the month if any percent-of-revenue row is configured.

## Rollout

- Single commit on the worktree branch `phase-13.1-billing-hotfix`.
- Conventional commit message: `fix(billing): thread revenue to billingForRange in per-store + forecast paths (Phase 13.1)`.
- Merge to `main` after code review.
- Deploys automatically via Vercel on push.
- Post-deploy: operator verifies manually as above.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing caller of `aggregate` that passes 4 positional args today breaks | Very low — grep confirms only `aggregateByStore` passes 3, all others pass ≤2 | TypeScript compile is the safety net. The new arg is optional. |
| `Object.values(revenueByStore).reduce(...)` causes perf regression | Negligible — runs once per `aggregate` call with N≤3 entries | None needed |
| Test fixtures for `aggregateByStore` accidentally seed the operator's localStorage | Tests already mock `readRecurring`/`readOneTime` via Vitest module mock per existing pattern in `aggregateByStoreAllRowSplit.test.ts` | Follow existing mock pattern |
| The forecast known-limitation (per-store percent in projection) creates confusion | Operator currently has no working percent forecast at all — any improvement is strict progress | Add an inline code comment + reference this design doc |

## Open questions

None. The design is fully constrained by the audit findings, the existing `billingForRange` API, and the existing test patterns.
