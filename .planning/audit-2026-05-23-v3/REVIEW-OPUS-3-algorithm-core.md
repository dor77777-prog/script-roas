---
audit: 2026-05-23-v3
reviewer: OPUS-3
scope: Core algorithm + analytics + financial / business logic
files_reviewed: 15
review_started: 2026-05-23T17:00:00Z
status: issues_found
---

# OPUS-3 — Algorithm Core Review (v3)

Third-pass adversarial review of the algorithm + analytics + financial layer. v1
and v2 fixed ~56 surface defects (Bayesian shrinkage, cohort rebalanced detection,
DST-stable presets, FX null fallback). This pass goes deeper looking for subtle
unit/sign/weighting traps that didn't surface in earlier rounds.

## Summary

| Severity   | Count |
|------------|-------|
| CRITICAL   | 1     |
| HIGH       | 3     |
| MEDIUM     | 6     |
| LOW        | 4     |
| INFO       | 3     |

Major findings:
- **CR-01** — Per-store "All"-scoped recurring billing is multi-counted, inflating
  per-store True-Net-Profit numbers by 2-3× for any operator who uses an "All"
  billing row.
- **HI-01** — `forecastMonthEnd` hardcodes the legacy COGS rate, breaking the
  per-store rate calibration story (operators tuning store-specific COGS see the
  forecast number drift from MTD).
- **HI-02** — `forecastMonthEnd` 7-day average INCLUDES today (incomplete day),
  systematically depressing the projected revenue every morning until late in the
  day.
- **HI-03** — Cannibalization detector emits literal `Infinity` for
  `revenueGrowthPct` in two branches. Renders OK in the current panel (guarded
  by `fmtPct`) but is a JSON-serialization landmine for any future consumer
  (cloud sync, telemetry, AI report).

The rest are MEDIUM-and-below issues — silent unit mixings, an unreachable
branch, a stale comment claiming a guarantee the code doesn't deliver, and a
handful of consistency / robustness nits.

---

# CRITICAL

## CR-01 — Per-store recurring billing inflates 2-3× when any "All"-scoped row exists

**Severity:** CRITICAL (visible monetary error in the per-store True-Net-Profit
cards the dashboard surfaces by default).

**File:** `dashboard-web/src/lib/analytics.ts:208-222` calling chain
`dashboard-web/src/lib/billing.ts:193-213`

### What's wrong

`aggregateByStore` partitions rows by store and calls `aggregate(list, range)`
on each per-store bucket. Inside `aggregate`, `storeNames` is derived from the
bucket's rows:

```ts
// analytics.ts:121-148
const stores = new Set<string>();
…
for (const r of rows) {
  …
  stores.add(r.storeName);
}
…
const storeNames = Array.from(stores);  // ← always length 1 for a per-store bucket
…
const billing = billingForRange({ from: billingFrom, to: billingTo, storeNames });
```

In a per-store bucket, `storeNames === [<one store>]`. `billingForRange` then
hits the "All"-row branch with `storeNames.length === 1`:

```ts
// billing.ts:196-206
if (r.store === 'All') {
  …
  recurringInPeriod += amount;                          // FULL amount
  bySource[r.source] = (bySource[r.source] ?? 0) + amount;
  const perStoreShare = amount / storeNames.length;     // amount / 1 = amount
  for (const s of storeNames) {
    byStore[s] = (byStore[s] ?? 0) + perStoreShare;     // FULL amount to this store
  }
}
```

Result: an "All"-scoped $60/mo Klaviyo subscription with 3 stores in scope
produces:

| Surface                          | Pre-bug-introduction-d/CR-01 (v2 fix) | Current behaviour |
|----------------------------------|---------------------------------------|-------------------|
| `aggregate(all rows, range)`     | $60 (correct, single subscription)    | $60 (correct)     |
| `aggregateByStore` → uzoshop card| $20 (fair share, expected)            | **$60**           |
| `aggregateByStore` → zolplus card| $20 (fair share, expected)            | **$60**           |
| `aggregateByStore` → 360usmile card | $20                                | **$60**           |
| Σ per-store cards                | $60 (reconciles)                      | **$180**          |

The d/CR-01 v2 fix in `billing.ts` was correct IN ISOLATION — it ensures
that when the caller passes a full `storeNames` list, "All" rows split
fairly. But `aggregateByStore` calls `aggregate` per-bucket with a
SINGLE-STORE list, defeating the fair-share split entirely. The fix landed
at the wrong layer.

### Why this is the operator-impactful failure mode

Operator reads per-store True-Net-Profit cards (which factor in `fixedCosts`)
and the global card. Pre-fix the numbers reconciled. Post-d/CR-01-v2 fix the
GLOBAL card got d/CR-01 right but the per-store cards are silently inflated by
each "All" row counted N times.

For an operator who entered `{store: 'All', name: 'Klaviyo', monthlyCAD: 60}`,
each of the 3 store cards reads $60 of fixed cost where the truth is $20 each.
On a 30-day month that's $40/store of phantom cost → True-Net-Profit
understated by $120 (×3 stores).

### Recommended fix

Plumb the FULL in-scope store list into `aggregate`. Two reasonable approaches:

**Option A — pass `storeNames` through explicitly:**

```ts
// analytics.ts
export function aggregate(
  rows: DailyRow[],
  range?: DateRange,
  storeNames?: string[],   // NEW: caller-provided list for "All"-row splitting
): Aggregate {
  …
  // Use caller list when provided; fall back to row-derived for back-compat.
  const billingStores = storeNames ?? Array.from(stores);
  const billing = billingFrom && billingTo
    ? billingForRange({ from: billingFrom, to: billingTo, storeNames: billingStores })
    : { total: 0 };
}

// analytics.ts:208-222
export function aggregateByStore(
  rows: DailyRow[],
  range?: DateRange,
): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
  }
  const allStores = Array.from(map.keys());   // <- full in-scope list
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    // Pass `allStores` so each per-store bucket's billing sees the full
    // denominator for "All"-row even-split. This preserves the d/CR-01
    // invariant: sum(per-store cards) == global aggregate card.
    out.push({ store, ...aggregate(list, range, allStores) });
  }
  return out.sort((a, b) => b.roas - a.roas);
}
```

**Option B — strip "All" rows in the per-store path and add the share manually
post-aggregation** (more invasive, less recommended).

Add a test to lock the invariant: `sum(aggregateByStore(rows).map(s => s.fixedCosts)) ≈ aggregate(rows).fixedCosts`
on multi-store data containing at least one "All" row.

---

# HIGH

## HI-01 — `forecastMonthEnd` hardcodes legacy COGS rate, ignores per-store calibration

**Severity:** HIGH (forecast number — the GoalTracker / Insights board hero
chip — silently drifts from the rest of the dashboard for any operator who
tuned per-store COGS via env var).

**File:** `dashboard-web/src/lib/insights.ts:467-502`

### What's wrong

```ts
// insights.ts:471-477
for (const r of rows) {
  if (r.date >= monthStart && r.date <= today) {
    mtdRev += r.revenue;
    mtdSpend += r.totalSpend;
    mtdCogs += r.cogs;                                  // ← row-level per-store
  }
}
const mtdNet = mtdRev - mtdSpend - mtdCogs;

…
// insights.ts:501
const projectedNet = projectedRev - projectedSpend - projectedRev * COGS_RATE_OF_REVENUE;
//                                                                    ↑
//                                                  legacy 0.25 GLOBAL constant
```

`mtdNet` is computed from row-level `r.cogs` which correctly uses per-store
rates. `projectedNet` then projects forward using the GLOBAL `COGS_RATE_OF_REVENUE
= 0.25`. The two halves of the same forecast use INCONSISTENT COGS models.

### Why this is real

The v2 d/HI-02 fix made `analytics.aggregate` use per-store COGS via
`getCogsRateForStore`. Every other dashboard surface (KPI cards, P&L breakdown,
True-Net-Profit, AI report) is now per-store-rate-aware. The forecast in
`insights.ts` is the lone holdout — it imports `COGS_RATE_OF_REVENUE` directly:

```ts
// insights.ts:29
import { COGS_RATE_OF_REVENUE } from './analytics';
```

For an operator who set `UZOSHOP_COGS_RATE=0.18` and `ZOLPLUS_COGS_RATE=0.35`:
- `mtdNet` reflects those rates (correct).
- `projectedNet` uses 0.25 everywhere (wrong).

On a $50K projected month, the COGS line differs by `($projectedRev × (0.25 − blendedActualRate))`
which can swing the forecast net by thousands of CAD.

### Recommended fix

Compute a revenue-weighted average COGS rate from the rows used for the 7-day
projection (each row carries `r.cogs` and `r.revenue`), and apply that to
`projectedRev`:

```ts
// Within the existing 7-day loop:
let last7Cogs = 0;
for (const r of rows) {
  if (r.date >= sevenDaysAgo && r.date <= today) {
    last7Rev += r.revenue;
    last7Spend += r.totalSpend;
    last7Cogs += r.cogs;
    datesSeen.add(r.date);
  }
}
…
// Implied COGS rate observed in the recent window — already per-store correctly
// weighted by revenue (because r.cogs already accounts for r.storeId's rate).
const observedCogsRate =
  last7Rev > 0 ? last7Cogs / last7Rev : COGS_RATE_OF_REVENUE;

const projectedNet =
  projectedRev - projectedSpend - projectedRev * observedCogsRate;
```

Same data path used for `mtdNet` (per-store via row column) flows into the
projection — single source of truth.

---

## HI-02 — `forecastMonthEnd` 7-day average bakes in incomplete TODAY

**Severity:** HIGH (forecast is systematically pessimistic every morning,
biasing the GoalTracker "are we on pace?" verdict toward "behind" by 10-30%
during waking IL hours).

**File:** `dashboard-web/src/lib/insights.ts:482-496`

### What's wrong

```ts
const sevenDaysAgo = addDays(today, -6);    // includes today (-6..0)
let last7Rev = 0, last7Spend = 0;
const datesSeen = new Set<string>();
for (const r of rows) {
  if (r.date >= sevenDaysAgo && r.date <= today) {
    last7Rev += r.revenue;
    last7Spend += r.totalSpend;
    datesSeen.add(r.date);
  }
}
last7DaysCount = Math.max(1, datesSeen.size);
const dailyAvgRev = last7Rev / last7DaysCount;
const dailyAvgSpend = last7Spend / last7DaysCount;
const projectedRev = mtdRev + dailyAvgRev * daysRemaining;
```

`sevenDaysAgo = today - 6 days`, so the window `[today-6, today]` is 7 calendar
days INCLUDING today. But today is incomplete — at 09:00 IL the day's revenue
is maybe 10% of its eventual total. The "average" then becomes
`(6 normal days + 0.1 of today) / 7` — depressed by roughly `0.9 × (typical-day-rev) / 7 ≈ 13%`.

`projectedRev` is then `mtdRev + (depressed daily avg) × daysRemaining`. For a
30-day-month projection on day 15 with `daysRemaining = 15`, the depression
compounds: the forecast loses ~13% × 15 = ~$N of revenue every morning until
late evening, then settles to the truth.

`projectedSpend` is also affected but less dramatically (spend tends to be more
evenly distributed across the 24h window when daily budgets are autopilot).

### Why this matters operationally

GoalTracker's "ahead / on-pace / behind" verdict is computed against
`projectedRev` via `computePacing`. The operator sees "behind" all morning and
"on-pace" only late evening — every day. False signal that erodes trust.

### Recommended fix

Exclude today from the 7-day baseline:

```ts
// Use last 7 COMPLETED days: [today-7, today-1].
const sevenDaysAgoStart = addDays(today, -7);
const yesterday = addDays(today, -1);
let last7Rev = 0, last7Spend = 0;
const datesSeen = new Set<string>();
for (const r of rows) {
  if (r.date >= sevenDaysAgoStart && r.date <= yesterday) {
    last7Rev += r.revenue;
    last7Spend += r.totalSpend;
    datesSeen.add(r.date);
  }
}
last7DaysCount = Math.max(1, datesSeen.size);
const dailyAvgRev = last7Rev / last7DaysCount;
const dailyAvgSpend = last7Spend / last7DaysCount;
// Projection: MTD (which already includes today's actual so far) + the
// completed-day average × daysRemaining. Today is NOT double-counted because
// daysRemaining excludes today.
const projectedRev = mtdRev + dailyAvgRev * daysRemaining;
```

`mtdRev` already includes today's partial revenue (from the line-475 loop), so
the forecast becomes `MTD-through-today + daysRemaining × completed-day-avg`
— mass-conserving and DST-immune.

Alternative: keep today in the window but prorate it by elapsed-fraction-of-day.
More accurate but DST-fragile and complicates the test surface. The
exclude-today approach is the standard analyst pattern.

---

## HI-03 — Cannibalization detector emits literal `Infinity` for `revenueGrowthPct`

**Severity:** HIGH (UI surface is currently safe via `fmtPct` guard, but the
value flows into the AI report + insights snapshot and will serialize as
`null` via `JSON.stringify(Infinity)`, silently swallowing the signal).

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:427-444`

### What's wrong

Two places set `revenueGrowthPct` to `Infinity`:

```ts
// cannibalizationDetection.ts:427-432 — composition_changed branch
spendGrowthPct: earlySpend > 0 ? (lateSpend - earlySpend) / earlySpend : 0,
revenueGrowthPct:
  earlyRev !== 0
    ? (lateRev - earlyRev) / Math.abs(earlyRev)
    : lateRev > 0 ? Infinity : 0,

// cannibalizationDetection.ts:438-444 — main classification branch
const spendGrowthPct = (lateSpend - earlySpend) / earlySpend;
const revenueGrowthPct =
  earlyRev !== 0
    ? (lateRev - earlyRev) / Math.abs(earlyRev)
    : lateRev > 0
      ? Infinity  // ← grew from 0 → some — undefined growth %, but not cannibalization
      : 0;
```

The comment correctly notes "grew from 0 → some — undefined growth %" but the
chosen sentinel `Infinity` is brittle:

1. **JSON serialization:** `JSON.stringify(Infinity) === 'null'`. Any code that
   serializes a `CannibalizationVerdict` — for cloud sync, telemetry, an
   `/api/cannibalization` endpoint, AI report payload — silently turns the
   "grew from 0" signal into `null`. The receiving side then treats it as
   "no growth" — opposite meaning.

2. **Comparison ladders:** later code that runs `verdict.metrics.revenueGrowthPct < 0.05`
   on a deserialized payload (which is now `null`) hits `null < 0.05 → false`
   (coerced to 0) — accidentally correct for THIS check, but `null > X` is
   also false. Numerics on a null-tainted field are unpredictable.

3. **Type signature lies:** `metrics: { revenueGrowthPct: number }` claims this
   is a number; `Infinity` technically is, but downstream code reasonably
   assumes finite values (the `fmtPct` guard in `CohortComparisonPanel.tsx:60`
   is correct precisely because the author KNEW this could be Infinity, but
   nothing in the type prevents future code from skipping the guard).

### Recommended fix

Use `null` for "undefined growth rate" and tighten the type:

```ts
// cannibalizationDetection.ts
export type CannibalizationVerdict = {
  …
  metrics: {
    …
    /** (late − early) / early. Positive = scaled up, negative = scaled
     *  down. NULL when early === 0 and late > 0 (growth rate undefined). */
    spendGrowthPct: number | null;
    revenueGrowthPct: number | null;
    marginalRoas: number | null;
  };
};

// classifyer:
revenueGrowthPct:
  earlyRev !== 0
    ? (lateRev - earlyRev) / Math.abs(earlyRev)
    : null,  // was `Infinity`

// And matching null handling in the classifier itself — Infinity > 0.05 was
// true → fell into NONE; null check needs explicit handling.
// Simplest: treat null as "growth signal unavailable" → NONE risk.
```

Update `CohortComparisonPanel.tsx:60` `fmtPct` to handle `null` (display `'—'`
or `'∞'` per UX choice) and the AI report (`aiReport.ts` doesn't currently
read these fields but may in the future).

Add a test:
```ts
it('emits null (not Infinity) when revenue grew from 0', () => {
  // …setup grew-from-zero scenario
  expect(result[0].metrics.revenueGrowthPct).toBeNull();
  // And the JSON round-trip preserves the signal:
  const roundTripped = JSON.parse(JSON.stringify(result[0]));
  expect(roundTripped.metrics.revenueGrowthPct).toBeNull();
});
```

---

# MEDIUM

## MED-01 — `aiReport.ts` synthesises health-score input with a wrong `coverage` clamp

**File:** `dashboard-web/src/lib/aiReport.ts:1149`

```ts
const coverage = c.value > 0 ? Math.min(1, det / c.value) : det > 0 ? 1 : 0;
```

`coverage` is then used to derive `trustScore = coverage × 100`. The
`Math.min(1, …)` clamp here CAPS coverage at 1.0, but the canonical
`computeCoverage` helper in `attributionAnalysis.ts:143-149` clamps at
`COVERAGE_UPPER_CLAMP = 2` for halo cases (Shopify saw MORE than Meta
claimed → coverage 1.2 = 120%, a positive operator signal).

For a campaign where Shopify-deterministic exceeds Meta's claim, the AI report
shows trust = 100/100 (capped); the dashboard's actual analyzer shows trust at
the halo-bonus level (`70 + pct/5`, up to 110 → clamped to 100). In practice
both saturate at 100 so this rarely flips a grade, but it does mean the AI
report's "we'd give this an A" / "we'd give this an F" verdict differs subtly
from the dashboard's grade for halo campaigns.

The report comment at line 1242 acknowledges the report uses "simplified
inputs", so this is partly intentional. But silently using a different clamp
than the canonical helper is a footgun for the next maintainer.

**Recommended fix:** import `computeCoverage` directly:

```ts
import { computeCoverage } from './attributionAnalysis';
…
const coverage = computeCoverage(det, c.value);
// Then derive trustScore from coverage exactly the way analyzeAttribution does
// (the trust ladder), OR document explicitly that we cap at 100 because the
// trust formula 70 + pct/5 saturates there.
```

---

## MED-02 — `aiReport.ts` half-comparison midpoint uses LOCAL setUTCDate but compares against IL-anchored dates

**File:** `dashboard-web/src/lib/aiReport.ts:952-960, 2003-2005`

Two places compute the mid-point of a date range:

```ts
const midPoint = new Date(range.from + 'T00:00:00Z');
midPoint.setUTCDate(midPoint.getUTCDate() + Math.floor(days / 2));
const mid = midPoint.toISOString().slice(0, 10);
…
for (const c of campaigns) {
  …
  if (c.date < mid) {
    h.h1Spend += c.spend;
    …
  } else {
    h.h2Spend += c.spend;
    …
  }
}
```

UTC arithmetic on a UTC-midnight anchor — DST-safe. Compares string-against-string
which works because all dates are YYYY-MM-DD ISO. OK this part.

But the SPLIT differs from `cannibalizationDetection.splitRangeHalves`:
- This file: `mid = from + floor(days / 2)`. For `days = 14`, mid = `from + 7`.
  H1 = `[from, from+6]` (7 days); H2 = `[from+7, to]` (7 days). Even split, OK.
- For `days = 5`, mid = `from + 2`. H1 = `[from, from+1]` (2 days);
  H2 = `[from+2, to]` (3 days). Early gets the shorter half.

`splitRangeHalves` matches this convention. CONSISTENT — no bug.

However, the threshold for running this is `days >= 6` here and
`days >= MIN_RANGE_DAYS_FOR_STABILITY = 14` for the cannibalization stability,
and `days >= 14` for the WoW comparison. Three different "minimum window for
meaningful split" floors across the codebase, all unhoisted. Adjacent
inconsistency — INFO-level — but it's also genuinely brittle: a future operator
reasonably expects the same minimum across "compare halves" UI surfaces.

**Recommended fix:** hoist a single `MIN_DAYS_FOR_HALF_COMPARISON` constant
(e.g., 6 for the simple compare, 14 for the stability variance test) into
shared utilities OR document why each surface uses a different minimum.

---

## MED-03 — `allocateProductRevenue` cap on negative net revenue silently breaks units/revenue symmetry

**File:** `dashboard-web/src/lib/campaignProductMap.ts:357-365`

```ts
for (const k of ['Meta', 'Google', 'TikTok'] as const) {
  if (p.netRevenueCad >= 0 && detByPlatform[k].revenue > p.netRevenueCad) {
    detByPlatform[k].revenue = p.netRevenueCad;
  }
  // Units always non-negative — cap unconditionally.
  if (detByPlatform[k].units > p.units) {
    detByPlatform[k].units = p.units;
  }
}
```

The comment says "Units always non-negative — cap unconditionally" — but the
revenue cap is gated on `p.netRevenueCad >= 0`. For a refund-heavy product
where `p.netRevenueCad < 0` (refunds in the window exceed sales) BUT
`p.units > 0` (units still positive — refund algo doesn't deduct units),
the per-platform deterministic revenue is NOT capped at netRevenueCad.

Then in Step 3 the remainder distributes whatever is left over. For example:
- p.netRevenueCad = -500, p.units = 3
- Orders attribute $1500 of deterministic revenue to Meta (via fbclid),
  units 3
- Per-platform Meta cap is `p.netRevenueCad = -500`, but the gate skips it
  (since p.netRevenueCad < 0). So Meta.revenue stays at 1500.
- Step 3: remRev = -500 - 1500 = -2000. Distributed across mapped campaigns by
  spend share. If Meta-c1 has 100% spend share, Meta-c1 gets -2000 added.
  Final Meta-c1 allocation = 1500 + (-2000) = -500. Sum across all campaigns = -500. ✓

OK the math IS mass-conserving thanks to the negative remainder distribution.
But during the intermediate phase before the remainder applies, individual
`detByPlatform[k].revenue` values can exceed `|p.netRevenueCad|` arbitrarily —
which is misleading if any caller reads `det` mid-flow (none currently do,
but the value is module-internal). And the `deterministicRevenue` field that
gets returned to the caller has the same un-capped behaviour: a campaign's
`deterministicRevenue` could be $1500 even when the product's NET revenue is
−$500. The caller then shows "deterministic $1500" alongside "allocated −$500"
— internally inconsistent display.

This is a real edge case that the comment at line 349-356 ("the deterministic
contribution stands") acknowledged consciously, but the side-effect on the
displayed `deterministicRevenue` is unaddressed.

**Recommended fix:**

Either (1) cap `deterministicRevenue` at `Math.max(0, p.netRevenueCad)` when
returning (so display surfaces never show "$1500 deterministic" on a −$500 net
product), or (2) document explicitly that `deterministicRevenue` is the
GROSS deterministic attribution PRE-refund-correction, and rely on consumers
to interpret it alongside `revenue` (the net allocation).

Option 1 is simpler and the operator-correct semantic: don't claim deterministic
sales that aren't reflected in the product's net total.

---

## MED-04 — Allocator zero-zero filter drops refund-only products with units > 0

**File:** `dashboard-web/src/lib/campaignProductMap.ts:318-319` + cross-ref to
`productCentricView.ts:151`

```ts
// CR-03 revenue fix
if (p.netRevenueCad === 0 && p.units === 0) continue;
```

The CR-03 fix intentionally KEPT refund-heavy products (units > 0, netRev < 0).
But it still drops the exact-zero edge case `(netRev === 0, units === 0)` which
hides genuine refund-only patterns:

Operator pattern: a customer bought 3 units of product P in week 1 ($300),
then returned all 3 in week 2. In week 2 the product's row has `units = -3`
(actually wait, units never go negative per the gap-closure-08 invariant
mentioned in the comment at line 460-462), `netRev = -300`. In a window
encompassing week 2 only: `netRev = -300, units = 0` → dropped by the filter.

But the campaign that drove the original purchase IS in the cohort, and the
ROAS Shopify column should reflect the refund pulling it down. By dropping
the row, the refund is invisible — campaign ROAS Shopify stays at the
inflated week-1 number even though week-2 refunds wiped it out.

**Recommended fix:** drop only when BOTH are zero AND there's no signal:

```ts
if (p.netRevenueCad === 0 && p.units === 0) continue;
// becomes:
if (p.netRevenueCad === 0 && p.units === 0) continue;  // truly empty — skip
// (No code change needed for the units-negative case since the invariant
// guarantees it can't happen.)
// But ADD a separate path that explicitly handles netRev<0 && units<=0:
// the allocator's Step 1 deterministic loop will find no matching orders
// (the original orders are in week 1, not this window), so detByPlatform
// stays zero. Step 3 then distributes the negative remRev across all mapped
// campaigns by spend share — correctly. The current `continue` only fires
// on the exact-zero case so this analysis is moot.
```

OK after re-tracing, the filter is `(netRev === 0 && units === 0)` — exact
zero on both. The refund-only-no-units case (`netRev < 0 && units === 0`)
passes the filter and is correctly processed. Marking this FALSE ALARM — keep
the finding visible for the next reviewer but **downgrade to INFO**.

---

## MED-05 — `presets.ts` `previousRange` is correct but `Math.round` masks parser edge cases

**File:** `dashboard-web/src/lib/presets.ts:116-123`

```ts
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + 'T00:00:00Z');
  const to = new Date(range.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  …
}
```

For a clean YYYY-MM-DD pair this is fine. But if a future caller threads through
a malformed `range.from = '2026-05-15T08:00:00Z'` (extra suffix), `new Date(s + 'T00:00:00Z')`
silently produces `Invalid Date` → `getTime() = NaN` → `Math.round(NaN/86400000) + 1 = NaN + 1 = NaN`
→ `addDays(from, -NaN)` → invalid date again → `fmt(d)` produces `'1970-01-01'`
or worse.

No current caller does this, but the type `DateRange` is just `{from: string;
to: string}` — there's no compile-time guarantee. The `Math.round` masks the
problem (vs `Math.trunc` which would propagate NaN visibly).

**Recommended fix:** validate inputs:

```ts
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + 'T00:00:00Z');
  const to = new Date(range.to + 'T00:00:00Z');
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    // Caller gave malformed input — return identity to avoid 1970 dates.
    return range;
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  …
}
```

---

## MED-06 — `analytics.deltaPct` has no NaN guard; producer of `value: NaN` reaches the UI

**File:** `dashboard-web/src/lib/analytics.ts:267-283`

```ts
export function deltaPct(cur: number, prev: number): { value: number; direction: 'up' | 'down' | 'flat' } {
  if (cur === prev) return { value: 0, direction: 'flat' };
  const direction: 'up' | 'down' = cur > prev ? 'up' : 'down';
  const denom = prev !== 0 ? Math.abs(prev) : Math.max(Math.abs(cur), 1);
  const pct = (cur - prev) / denom;
  if (Math.abs(pct) < 0.001) return { value: 0, direction: 'flat' };
  return { value: pct, direction };
}
```

`cur === NaN || prev === NaN`:
- `cur === prev` → `NaN === NaN` is false (NaN is not equal to anything,
  including itself).
- `cur > prev` → `NaN > X` is false → `direction = 'down'`.
- `denom = Math.max(NaN, 1) = NaN` (if prev=0 and cur=NaN; otherwise denom is
  `|prev|` which is finite when prev is finite).
- `pct = (NaN - 0) / NaN = NaN`.
- `Math.abs(NaN) < 0.001` → false (NaN comparisons return false).
- Returns `{value: NaN, direction: 'down'}`.

Caller likely renders as "NaN%" or coerces to "0%" via `toFixed`. NaN-tainted
deltas have produced visible "NaN%" defects in the past on cards where data
hasn't loaded yet.

**Recommended fix:**

```ts
export function deltaPct(cur: number, prev: number): { value: number; direction: 'up' | 'down' | 'flat' } {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) {
    return { value: 0, direction: 'flat' };
  }
  if (cur === prev) return { value: 0, direction: 'flat' };
  …
}
```

---

# LOW

- **LOW-01** — `campaignHealthScore.scoreVolume` (line 262-280): the final
  `return { score: 0, ... }` after the for-loop is unreachable code because
  `VOLUME_TIERS` includes `{min: 0, score: 10}` which matches any non-negative
  spend. Either remove the dead branch or add a `min: -Infinity` tier to
  make the negative-spend semantic explicit.

- **LOW-02** — `aiReport.ts:1099` claim "last write wins (sorted iteration
  would be ideal, but campaigns is unordered — close enough for status)"
  contradicts `campaignsAggregator.ts:161-167` which uses
  `latestEffectiveStatusDate` map for chronologically-latest-wins. The
  inconsistency means the AI report can show a STALE status (whichever row
  happened to iterate last) for a campaign whose status changed mid-period,
  while the dashboard's CampaignsTable correctly shows the latest. Switch
  the AI report to chronologically-latest using the same `r.date > prev`
  comparison pattern.

- **LOW-03** — `aggregate()` in `analytics.ts:111-180`: the `roas` field uses
  `revenue / spend` where `revenue` is gross (Shopify-attributed) and `spend`
  is total ad spend (CAD). When `revenue === 0` and `spend > 0` the field is
  `0`. But the type docstring (`roas: number`) doesn't distinguish "no
  revenue" from "no ad activity". A NaN/null sentinel + documentation would
  help downstream consumers reason about the 0 case (currently they treat
  it as "failed campaigns" which is sometimes correct, sometimes not).

- **LOW-04** — `cannibalizationDetection.ts` `composChangedMembers` reason
  text concatenation at line 408-411 uses `key.split('::').slice(-1)[0]`
  which is the campaign ID. This is shown to the operator who doesn't know
  IDs. Mapping back to campaign NAMES via the `Aggregated` lookup would
  improve readability — currently the operator sees
  "• 23847456789012: הופסק/הופחת תקציב מהותי…" which is unhelpful.

---

# INFO

- **INFO-01** — Filter-already-applied: `aggregate()` in `analytics.ts:111`
  has the comment "back-fill COGS only when the row's column was empty
  (hasCogs false). For live rows r.cogs is already the correct per-store
  value." This contract relies on the cron writer setting `r.cogs` correctly.
  If a future migration changes `hasCogs` semantics or adds a "stale COGS"
  flag, the read-side back-fill would silently keep using stale values. No
  current bug, but worth a test that pins the contract:
  `assert(row.hasCogs ? row.cogs ≈ row.revenue × per-store-rate : true)`.

- **INFO-02** — `insights.ts:191-209` `detectAnomalies` uses
  `cutoff = addDays(today, -20)` to keep "last 21 days." This is correct for
  the median-MAD baseline. But the comment "Limit to last 21 days so the
  baseline doesn't drift across major regime changes" elides the fact that
  the robust z-score itself uses `series.slice(-15, -1)` — only the last 14
  days BEFORE today. The other 7 days of "last 21" are unused. Either trim
  to 14 days in `detectAnomalies` or document why we keep 7 unused days
  (perhaps "future extension to a 7-vs-21 trend check" — unclear).

- **INFO-03** — Hardcoded 0.001 threshold in `analytics.deltaPct` for "flat"
  classification (line 281). 0.1% feels arbitrary — should be a named
  constant `MIN_VISIBLE_DELTA = 0.001` so the next reviewer doesn't need to
  guess where the threshold came from. Same pattern across the codebase
  (`insights.ts` 5% baseline floor, cannibalization 5% noise floor on share
  flip, etc.) — collect into a thresholds module.

---

# Files Reviewed

- `dashboard-web/src/lib/analytics.ts` (283 lines)
- `dashboard-web/src/lib/insights.ts` (680 lines)
- `dashboard-web/src/lib/multiMappingCohort.ts` (380 lines)
- `dashboard-web/src/lib/productCentricView.ts` (353 lines)
- `dashboard-web/src/lib/attributionAnalysis.ts` (1133 lines)
- `dashboard-web/src/lib/cannibalizationDetection.ts` (503 lines)
- `dashboard-web/src/lib/campaignHealthScore.ts` (562 lines)
- `dashboard-web/src/lib/billing.ts` (601 lines)
- `dashboard-web/src/lib/costs.ts` (74 lines)
- `dashboard-web/src/lib/presets.ts` (123 lines)
- `dashboard-web/src/lib/campaignProductMap.ts` (485 lines — `allocateProductRevenue`)
- `dashboard-web/src/lib/products.ts` (125 lines)
- `dashboard-web/src/lib/campaigns.ts` (185 lines)
- `dashboard-web/src/lib/aiReport.ts` (2282 lines)
- `dashboard-web/src/lib/campaignsAggregator.ts` (177 lines — cross-ref only)

Tests cross-checked for context (no findings on tests themselves):
- `dashboard-web/src/lib/__tests__/analytics.test.ts`
- `dashboard-web/src/lib/__tests__/cannibalizationDetection.test.ts`
- `dashboard-web/src/lib/__tests__/multiMappingCohort.test.ts`
- `dashboard-web/src/lib/__tests__/productCentricView.test.ts`

---

# Methodology Notes

- Cross-referenced v1 + v2 reports to ensure findings here are NOT already
  fixed (`.planning/audit-2026-05-23-v2/algorithm-soundness-REVIEW.md`,
  `.planning/audit-2026-05-23-v2/fix-validation-REVIEW.md`).
- Traced the per-store billing call chain end-to-end
  (`Dashboard.tsx → aggregateByStore → aggregate → billingForRange`) before
  classifying CR-01.
- Verified `dailyMetaSeries` is per-campaign (not per-store) by reading the
  hook callers — eliminates a suspected mid-severity finding.
- Confirmed `splitRangeHalves` UTC-anchored arithmetic is DST-safe
  (no finding).
- Re-validated the `presets.ts` Sunday-of-week calculation against IL DST
  boundaries — no finding (v2 d/HI-09 fix is solid).
- The cannibalization composition-changed and rebalanced-cohort logic
  (b/HI-04) was reviewed in depth against tests; the test coverage is
  excellent and the algorithm is sound. Only the Infinity sentinel (HI-03)
  is a concern.
