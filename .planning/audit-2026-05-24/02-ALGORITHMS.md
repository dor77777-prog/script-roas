# Algorithmic Correctness Audit

**Track 2 — pure-function correctness in `dashboard-web/src/lib/`.**

Method: read each module end-to-end, read its `__tests__/*.test.ts`, look for divide-by-zero, NaN/Infinity propagation, off-by-one in date ranges, timezone bugs, silent coercion, currency mixing, refund double-counting, attribution leakage. Cross-checked against `.planning/audit-2026-05-23-v3/` to avoid re-finding known issues.

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| P0 (production-affecting correctness) | 2 | new |
| P1 (real edge cases / weak tests) | 8 | mix new + stale-unfixed |
| P2 (refactor / clarity) | 5 | minor |

Net headline:

- **GoalTracker IS global** — confirmed at `components/GoalTracker.tsx:42` (no `filters` prop; feeds `data.rows` unfiltered into `forecastMonthEnd`). Project-memory invariant holds. Locked by `lib/__tests__/goalTrackerScope.test.ts`.
- The big v3-CRIT-1 invariant (`Σ per-store fixedCosts == global fixedCosts`) **breaks again** for the new `percentOfRevenue` recurring rows (Phase 12.5.x, 2026-05-24) — *P0-1 below*.
- `forecastMonthEnd`'s `projectedFixedCosts` silently drops percent-of-revenue rows (`revenue` param not threaded into `billingForRange`) — *P0-2 below*.
- v3 MED-06 (`deltaPct` NaN-propagates) is **still unfixed** — confirmed at `lib/analytics.ts:393-409`.
- `analyzeAttribution.computeWindowStability` caps coverage on the upper side only — refund-heavy weeks ($matched < 0$) flow through unbounded into the σ.

## P0 findings (correctness bugs — wrong numbers in production)

### P0-1 — `billingForRange` % -of-revenue path breaks `Σ per-store == global` invariant (NEW, Phase 12.5.x)

**Files:** `dashboard-web/src/lib/analytics.ts:189-211`, `dashboard-web/src/lib/billing.ts:241-254`

**Expected:** v3 CRIT-1 invariant `sum(aggregateByStore.fixedCosts) ≈ aggregate.fixedCosts` holds for any cost type.

**Actual:** For an "All"-store recurring row with `percentOfRevenue = X` and 3 in-scope stores:
- **Global path:** `revenue = totalRev` (sum across stores) → `amount = totalRev * X / 100` → `byStore[s] += amount / 3` → `billing.total = totalRev * X / 100`. ✓
- **Per-store path** (each bucket A/B/C calls `aggregate(bucketRows, range, scopedStoreNames)`): `revenue = storeA_rev` only → `amount = storeA_rev * X / 100` → `byStore[s] += amount / 3 = storeA_rev * X / 300` → bucket A's `fixedCosts = byStore['uzo'] = storeA_rev * X / 300`. Sum across 3 buckets = `(storeA + storeB + storeC) * X / 300 = totalRev * X / 300`. ✗

So `Σ per-store = global / 3` (off by factor of `storeNames.length`) for percent-of-revenue rows.

**Symptom:** sum of per-store True-Net-Profit cards under-states by `totalRev × pct × (storeCount−1) / (100 × storeCount)`. For pct=5%, 3 stores, totalRev=$100k → per-store cards understate fixedCosts by $3,333 collectively / $1,111 per store. Reverses the v3 CRIT-1 inflation in the opposite direction for percent rows only.

**Fix:** In `analytics.aggregate`, when `scopedStoreNames` is present and `rowStoreNames.length === 1` (per-store path), thread the FULL in-scope revenue into `billingForRange` via a new `revenueByStore` map (or a `globalRevenue` arg). `billingForRange` already accepts `revenueByStore?: Record<string, number>` (line 184) — wire `aggregateByStore` to compute `{[store]: storeRev}` once and pass it through.

There is no regression test for the % rows in `aggregateByStoreAllRowSplit.test.ts` (it only covers fixed-CAD All-rows). Add a fixture with `percentOfRevenue: 5, store: 'All'` and assert `Σ per-store == global`.

### P0-2 — `forecastMonthEnd.projectedFixedCosts` drops percent-of-revenue rows silently

**File:** `dashboard-web/src/lib/insights.ts:586-593`

**Expected:** projection includes ALL recurring billing for the month, both fixed-CAD and percent-of-revenue.

**Actual:**
```ts
const projectedFixedCosts = billingForRange({
  from: monthStart,
  to: monthEnd,
  storeNames: storesForBilling,
}).total;
```

No `revenue` arg → `billingForRange` defaults `revenue = 0` → for every percent-of-revenue recurring row, `amount = 0 * pct / 100 = 0`. Those rows contribute zero to `projectedFixedCosts`.

**Symptom:** `projectedNet` overstates take-home for any operator who entered a percent-of-revenue cost line. For a 5%-of-revenue affiliate commission row on a projected $100k month, the projection over-states net by $5k.

**Fix:** Pass `revenue: projectedRev` (and `revenueByStore` if available) to the `billingForRange` call. Same shape as `mtdAgg.fixedCosts` computation that uses `aggregate()` which DOES thread revenue.

## P1 findings (edge cases, weak tests)

### P1-1 — `analytics.deltaPct` STILL NaN-propagates (v3 MED-06 unfixed)

**File:** `dashboard-web/src/lib/analytics.ts:393-409`

`cur === NaN || prev === NaN` flows through every branch:
- `NaN === NaN` is false → skip flat.
- `NaN > NaN` is false → `direction='down'`.
- `pct = NaN`. `Math.abs(NaN) < 0.001` is false.
- Returns `{value: NaN, direction: 'down'}`.

Caller renders "NaN%". v3 audit MED-06 flagged this; no fix landed. **Trivial 3-line fix at top:** `if (!Number.isFinite(cur) || !Number.isFinite(prev)) return {value:0, direction:'flat'};`.

### P1-2 — `computeWindowStability` caps coverage upper-side only; negative `matched` skews σ unboundedly

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:671-673`

```ts
const coverages = buckets
  .filter(b => b.meta > 0)
  .map(b => Math.min(COVERAGE_WARNING_THRESHOLD, b.matched / b.meta));
```

`matched` is the sum of signed `o.totalCad` (refunds subtract). One refund-heavy window with `matched = -1000, meta = 100` → coverage = -10. The `Math.min` only caps the UPPER side. σ then inflates → 'volatile' verdict → trust downgraded from 'high' to 'medium' on a single refund week.

**Fix:** Add a lower clamp symmetric to the warning threshold: `Math.max(-COVERAGE_WARNING_THRESHOLD, Math.min(COVERAGE_WARNING_THRESHOLD, b.matched / b.meta))`. Document that windowStability uses bounded coverage; the displayed coverage stays raw.

### P1-3 — `cannibalizationDetection.revenueGrowthPct` uses `Math.abs(earlyRev)` denominator — wrong sign on refund-heavy early half

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:464`

```ts
const revenueGrowthPct =
  earlyRev !== 0 ? (lateRev - earlyRev) / Math.abs(earlyRev) : ...;
```

When `earlyRev = -50` (refund-heavy early half) and `lateRev = 100`, formula yields `(100 - (-50)) / 50 = +3.0 = +300%`. The numerator `(late - early)` is signed correctly (recovery is positive); the absolute-value denominator inflates the percent. For an early half that is mildly negative (small refund excess) and a late half that's positive, the operator sees an enormous "+1500%" growth on the panel chip when the real story is "we went from slightly underwater to mildly profitable."

**Fix:** Either use signed denominator `(lateRev - earlyRev) / earlyRev` and document that negative-early ratios mean "scaled past break-even" (negative percent on improvement), OR clamp absolute display: `if (earlyRev < 0) emit null` (treat as undefined ratio). Probably the latter — symmetric with the early-zero case already returning `null`.

### P1-4 — `aggregate()` ROAS uses `revenue / spend` returning 0 when spend=0; type docstring doesn't communicate it (v3 LOW-03 stale, still LOW)

**File:** `dashboard-web/src/lib/analytics.ts:163`

```ts
const roas = spend > 0 ? revenue / spend : 0;
```

When `revenue > 0` and `spend === 0` (operator-backfilled / attribution-only campaign), the returned ROAS is 0 — indistinguishable from "spent $1000 and earned $0". Multiple callers (`roasLabel`, `RoasChart`) treat 0 as a real disaster value rather than "no spend". v3 flagged this; still unaddressed. Consider a `null` sentinel + comment update.

### P1-5 — `cannibalizationDetection.splitRangeHalves` uses `Date(midMs - 86_400_000).toISOString().slice(0,10)` — DST-safe BUT undocumented

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:131-138`

Uses UTC ms arithmetic exclusively (`parseDate(s)` builds `${s}T00:00:00Z`), so DST is irrelevant. The function is correct, but no test pins behavior around an IL DST boundary (March 27-28, 2026 spring-forward). Add a `splitRangeHalves('2026-03-25', '2026-03-30')` test to lock that the DST window doesn't shift `early.to` / `late.from`.

### P1-6 — `presets.previousRange` masks malformed input via `Math.round(NaN) + 1 = NaN` cascade (v3 MED-05 unfixed)

**File:** `dashboard-web/src/lib/presets.ts:116-123`

No `Number.isFinite` validation on `from.getTime()`. If a future caller threads `range.from = '2026-05-15T08:00:00Z'`, parses to Invalid Date, math cascades to NaN, output is `{from: '1970-01-01', to: '1970-01-01'}` or worse. v3 MED-05 flagged; no fix. 3-line guard at top of function. (Today's callers are safe because `DateRange.from` is always YYYY-MM-DD — this is defense-in-depth.)

### P1-7 — `getCogsRateForStore` accepts rate > 1 as invalid but no warning logged

**File:** `dashboard-web/src/lib/analytics.ts:31-42`

If an operator sets `UZOSHOP_COGS_RATE=1.5` (typo for 0.15), `parseFloat(raw) = 1.5; parsed > 1` → falls back to default 0.25 silently. No `console.warn` or Sentry breadcrumb to surface the misconfiguration. Operator sees "default rate" forever and wonders why per-store calibration isn't working. Add `console.warn(\`${envKey}=${raw} out of range [0,1]; falling back to 0.25\`)`.

### P1-8 — `forecastMonthEnd` baseline window EXCLUDES today (HIGH-10 fix) but `dailyAvgRev` divisor is `Math.max(1, datesSeen.size)` — degenerates to 1 when baseline empty

**File:** `dashboard-web/src/lib/insights.ts:512-528`

When the operator has no data in the `[today-7, today-1]` window (brand-new install, mid-month start), `datesSeen.size = 0` → `last7DaysCount = 1` → `dailyAvgRev = 0/1 = 0`. Then `projectedRev = mtdRev + 0 * daysRemaining = mtdRev` — projects FLAT from today. Looks fine BUT the same `last7DaysCount = 1` also drives `dailyAvgCogs = last7Cogs / 1` which would be 0 → `dailyAvgCogs` then falls back via the `last7Rev > 0 ? ... : dailyAvgRev * COGS_RATE_OF_REVENUE` ternary at line 558. OK, that fallback fires correctly because `last7Rev === 0`. So this is benign — but the `Math.max(1, datesSeen.size)` could be made loud: when datesSeen is empty, log/emit a "baseline empty — projection collapses to MTD" hint so the operator understands why their forecast hasn't moved.

## P2 findings (refactors, clarity)

### P2-1 — `costs.buildPnLBreakdown` is dead code

**File:** `dashboard-web/src/lib/costs.ts:46-74`

Grep confirms no callers anywhere in `src/`. Only references are in `graphify-out/graph.json` (build artifact) and `.planning/` docs. The function uses the GLOBAL `TRANSACTION_FEES_RATE` constant — if it were ever wired up, it would silently use the legacy 6.5% instead of per-store rates. Either delete the function OR refactor it to accept `transactionFeesRate` as a parameter (matching the `analytics.aggregate` per-row sum approach).

### P2-2 — `attributionAnalysis.MIN_DAYS_FOR_HALF_COMPARISON` adjacency drift (v3 MED-02 stale)

Three "minimum window for meaningful split" floors: `aiReport` mid-point at `days >= 6`, `splitRangeHalves` at `days < 2`, `MIN_RANGE_DAYS_FOR_STABILITY = 14`. Hoist into a shared thresholds module. v3 flagged; still drifted.

### P2-3 — `multiMappingCohort.shrinkRoas` "better-of" weight pulls zero-ROAS large-spend campaigns toward 1.0

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:173-179`

For a $500-spend, 0-orders, raw ROAS=0 campaign: `wSpend = 500/1000 = 0.5`, `wOrders = 0` → `w = 0.5` → shrunk = `0 * 0.5 + 1.0 * 0.5 = 0.5`. The campaign is genuinely failing but its shrunk ROAS reads 0.5 (mid-range losing money). A reviewer might expect a much lower shrunk number for a failed campaign. Document the "anchor pulls toward break-even regardless of direction" semantic in the docstring (currently only positive ROAS examples are given).

### P2-4 — `analytics.dailySeries.totalRoas` per day uses `entry.totalSpend` summed across ALL stores — when called with `stores=['oneStore']`, totals still aggregate everything from `rows`

**File:** `dashboard-web/src/lib/analytics.ts:329-383`

`dailySeries` does NOT filter `rows` to the `stores` list before accumulating `entry.totalRevenue / entry.totalSpend`. So a caller passing `stores = ['uzoshop']` and unfiltered rows gets `totalRoas` summed across all 3 stores. This is fine when the caller pre-filters (which Dashboard.tsx does via `filterRows`), but the signature is misleading. Either accept `rows` already-filtered (current contract) and add a JSDoc note, or filter internally by `rows.filter(r => stores.includes(r.storeName))`.

### P2-5 — `cannibalizationDetection.composChangedMembers` reason text shows raw campaign ID, not name (v3 LOW-04 stale)

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:421-424`

Same as v3 LOW-04 — `key.split('::').slice(-1)[0]` shows the raw `campaignId`. Map back to `aggregated.find(a => a.key === k)?.campaignName` for readability. Currently the operator sees "• 23847456789012: הופסק/הופחת..." which is unhelpful.

## Per-module dive

### `lib/attributionAnalysis.ts` (1234 lines)

- `computeCoverage`: handles negative metaClaim (returns 0), metaClaim=0 (1 if det>0 else 0), normal ratio. Pure and well-tested. ✓
- `analyzeAttribution`: NaN guard on `o.totalCad` (line 343). ✓ Store-segregation guard. ✓ Signed-revenue path. ✓ Per-platform copy. ✓
- `computeWindowStability`: see P1-2 (asymmetric clamp). Otherwise solid.
- `detectOutlierDays`: keeps zero-baseline days. ✓ MAD fallback when stdDev=0. ✓ `OUTLIER_LOOKBACK_DAYS = 7` is reasonable. Tests cover spike + zero-baseline scenarios.
- `analyzeProductChannel`: empty-input short-circuits to zero-shaped struct. ✓ `fbclidPresent OR meta-source` predicate for `facebookOrders` (broad). ✓ `tiktokOrders` is narrower (tiktok-paid only). Documented.

**Tests:** `attributionAnalysis.test.ts` + 5 sibling specs cover happy paths well. **Missing branches:**
- No test for `computeWindowStability` with negative `matched` (P1-2).
- No test for `pearsonWithLag` with `lag = xs.length` (empty overlap, expected null).
- No test for `analyzeAttribution` when `dailyMetaSeries` contains NaN values (filter at line 657 should drop them).

### `lib/shopifyRevenueRefunds.ts` (408 lines)

- `dayInTz`: handles empty string ✓, invalid Date ✓, IL TZ. ✓
- `parseNum`: handles string/number/junk → 0. ✓
- `hasSuccessfulRefundTransaction`: conservative legacy fallback (empty `transactions[]` → assume success). ✓
- Algorithm matches Apps Script invariants 1-3 (immutable `total_price`, refund attribution to `processed_at`, intra-order map filtered to same-day). ✓
- D-D3 no clamping. ✓

**Tests:** 4 invariant tests + 3 transaction-status tests + period-reconciliation test. Excellent coverage. **Missing branches:**
- No test for an order with `current_total_price` provided but `total_price` undefined (the algorithm's `parseNum(o.total_price)` returns 0; could under-count gross silently). Add: `{total_price: undefined, refunds: [...]}` fixture.
- No DST-boundary test (refund processed at `2026-03-28T01:00:00+03:00` IL — DST spring-forward). The `dayInTz` is `Intl`-based so DST-safe in practice; pin it.

### `lib/campaignHealthScore.ts` (604 lines)

- `scoreProfitability`: per-platform pivot ✓, per-platform fallback trust ✓, divide-by-zero on spend=0 (returns 0 reason "אין הוצאה"). ✓ Caps at [0, 100]. ✓
- `scoreVolume`: tier ladder. Final unreachable return at line 284 still exists (v3 LOW-01) — `VOLUME_TIERS[3] = {min:0, score:10}` catches everything ≥ 0. Dead branch.
- `scoreTrajectory`: switch over 4 tones. No `default` case → TS would catch it at compile but at runtime an unknown tone falls through to return undefined → caller crashes on `.score`. Add `default: return {score: 60, reason: 'unknown tone'}`.
- `computeCampaignHealth`: insufficient-data gate ✓. Renormalization when trajectory has no data ✓. Final clamp ✓.
- `applyCohortAdjustmentOnce`: U-06 double-apply assert ✓. Composition_changed → no delta ✓.

**Tests:** Excellent. 50+ cases covering every grade transition, every adjustment combination, every threshold.

### `lib/multiMappingCohort.ts` (455 lines)

- `shrinkRoas`: see P2-3.
- `compareCohortMembers`: tuple-lex comparator ✓, NaN guard ✓, missing-metrics members sink ✓.
- `safeFinite`: sinks NaN/Infinity to 0. ✓
- `currentRank`, `isLeader`, `isWeakest` (with `totalMembers >= 3` floor): ✓
- `MMC-WARN-04`: result.current shares reference with rankedAll[currentRank-1]. ✓

**Tests:** Excellent. 25+ tests including the blocker regression, ranking pathologies, share-flip scenarios.

### `lib/cannibalizationDetection.ts` (547 lines)

- `splitRangeHalves`: DST-safe UTC math. ✓
- `MATERIAL_MEMBER_SPEND_SHARE = 0.2`: composition-change guard. ✓
- `shareRatioFlipped`: rebalanced-mid-range guard with 5% noise floor. ✓
- `revenueGrowthPct: null` sentinel on `earlyRev === 0 && lateRev > 0`. ✓ JSON-round-trip safe.
- See P1-3: `Math.abs(earlyRev)` denominator distorts negative-early scenarios.
- See P2-5: composChangedMembers reason shows raw IDs.

**Tests:** 30+ tests including 5-member cohort, composition-changed branches, rebalanced branches.

### `lib/productCentricView.ts` (478 lines)

- `buildProductCentricView`: dormant-member emission ✓ (ALG-03 fix), allocator branch sum-conservation ✓, simplified-split + 1/N fallback ✓.
- Allocator delegated to `allocateProductRevenue` for parity with campaign-centric drawer.
- See test coverage gap: no test for productMap with key shape `${storeId}::${platform}::${campaignId}::extra` (4 segments) → `parts[2]` would only be the third, `slice(2).join('::')` recovers the rest. Defensive but worth a fixture.

**Tests:** 20+ tests in 3 files. Good.

### `lib/costs.ts` (74 lines)

See P2-1: `buildPnLBreakdown` is dead code with a per-store-rate landmine.

### `lib/billing.ts` (654 lines)

- See P0-1 (percent-of-revenue × per-store path breaks invariant).
- `billingForRange`: NaN guard on dates ✓, "All"-store split ✓, store-specific match ✓, percent-of-revenue branch (added 2026-05-24).
- `findMatchingRecurring`: symmetric scope ✓ (d/HI-05 fix).
- `parseShopifyBillsCsv`: CSV escape ✓, DMY/MDY locale ✓, no per-row Math.round (d/HI-06 fix).

**Tests:** Solid for the original fixes. **Critical gap:** no test for `billingForRange` with `percentOfRevenue > 0` rows — direct cause of P0-1 going unnoticed.

### `lib/analytics.ts` (409 lines)

- See P0-1, P1-1, P1-4, P2-4.
- `getCogsRateForStore`, `getTransactionFeesRateForStore`: per-store env-var override, invalid-value fallback. ✓
- `aggregate`: signed-revenue, COGS back-fill, per-store fees accumulator, billing thread, scoped store path. ✓
- `aggregateByStore`: range plumbing + scoped store names. ✓
- `dailySeries`: range-fill ✓ (CRIT-3), null per-store cells (HIGH-8). ✓

**Tests:** Adequate for the v3 fixes. Missing tests for `deltaPct` NaN inputs (P1-1) and `aggregate` with percent-of-revenue billing rows (P0-1).

### `lib/insights.ts` (781 lines)

- `forecastMonthEnd`: MTD via `aggregate()` ✓, baseline excludes today (HIGH-10) ✓, projected COGS preserves MTD (ALG-01) ✓, projected fees preserves MTD ✓.
- See P0-2 (projectedFixedCosts drops percent-of-revenue).
- `computePacing`: thresholds 105% (ahead), 92% (on-pace). ✓
- `detectAnomalies`: median+MAD robust z-score, 14-day baseline, 2.5σ threshold. ✓
- `generateRecommendations`: scale/pause/dead/platform-rebalance/star-product/store-underperformance rules. All thresholds hoisted; no divide-by-zero issues found.

**Tests:** `insightsProjectedNetMtd.test.ts`, `goalTrackerScope.test.ts`. **Critical gap:** no test for `forecastMonthEnd` with percent-of-revenue billing → P0-2 invisible.

### `lib/rangeClamp.ts` + `lib/dateRange.ts` + `lib/presets.ts`

- `clampDateToToday`, `applyFromCandidate`, `applyToCandidate`: empty/malformed → null, swap-on-invert. ✓ Tested.
- `parseRangeParams`: ISO regex + real-date round-trip ✓.
- `enumerateDateRange`: UTC tick iteration → DST-safe. ✓
- `getPreviousPeriod`: NaN guard ✓, inverted-range guard ✓.
- `_computePresetRangeForIlToday`: IL-anchored, DST-stable. ✓ Tested for DST boundaries.
- See P1-6 (`presets.previousRange` masks NaN cascade).

### `lib/campaignsAggregator.ts` (332 lines)

- `aggregate`: chronologically-latest budget + budgetType + effectiveStatus tracking. ✓
- `isParentDisabled`: Meta/TikTok parent-disabled markers. ✓
- `activeMarkerForPlatform`: platform-canonical active status. ✓
- Round 2 freshest-updated_at rollup for campaign mode. ✓

**Tests:** `campaignsAggregator.test.ts`. Coverage adequate.

## Delta vs audit-2026-05-23-v3

| v3 finding | Status |
|------------|--------|
| CRIT-1 (per-store All-row split) | ✅ FIXED + tested. |
| CRIT-2 (ProductChannelBreakdown double-count) | UI layer — out of Track 2 scope. |
| CRIT-3 + HIGH-8 (RoasChart gap aliasing) | ✅ FIXED via `dailySeries(rows, stores, range)` + null cells. |
| CRIT-4 (KpiCards net profit sparkline) | UI layer — out of scope. |
| CRIT-5 (cronDaily FX try/catch) | Pipeline — out of Track 2 scope. |
| HIGH-9 / HR-01 / HR-02 (per-platform pivot + trust) | ✅ FIXED + tested. |
| HIGH-10 (forecast 7-day excludes today) | ✅ FIXED + tested. |
| HIGH-11 (cannibalization Infinity sentinel) | ✅ FIXED + tested via `null`. |
| HIGH-NEW-2 (forecast omits fees + fixed) | ✅ FIXED via `aggregate()` MTD + per-store fees. |
| MED-01 (`aiReport` coverage clamp) | Untouched — outside Track 2's strict scope but still a deviation. |
| MED-05 (presets NaN cascade) | ❌ STILL UNFIXED → P1-6. |
| MED-06 (deltaPct NaN propagation) | ❌ STILL UNFIXED → P1-1. |
| LOW-01 (scoreVolume unreachable branch) | ❌ STILL UNFIXED — dead branch at `campaignHealthScore.ts:284`. |
| LOW-03 (ROAS=0 ambiguity) | ❌ STILL UNFIXED → P1-4. |
| LOW-04 (composChangedMembers raw IDs) | ❌ STILL UNFIXED → P2-5. |

**NEW since v3 (Phase 12.5.x 2026-05-24 changes):**

- P0-1: percent-of-revenue × per-store path breaks invariant.
- P0-2: `forecastMonthEnd.projectedFixedCosts` drops percent-of-revenue.
- P1-2: `computeWindowStability` asymmetric clamp (was always there but worth surfacing).
- P1-3: cannibalization `Math.abs(earlyRev)` denominator (was always there).

## Notes for other tracks

- **Track 1 (Security):** the per-store env-var `${STORE}_COGS_RATE` and `${STORE}_TX_FEES_RATE` are read via `process.env` server-side only — no client exposure. ✓
- **Track 3 (Pipeline):** `getCogsRateForStore` lives in TWO places — `lib/analytics.ts:31` (read side) and `inngest/functions/cronDaily.ts:116` (write side). The convention is shared via env-var name but the function body is duplicated. Refactor to a single helper imported by both, OR add a regression test that both files produce identical results.
- **Track 5 (Maturity):** the test gaps flagged in P0-1 and P0-2 are the highest-priority additions to the suite. The percent-of-revenue feature shipped without invariant coverage.
- **Track 6 (Frontend):** `componentes/PnLBreakdown.tsx:250` imports `TRANSACTION_FEES_RATE` from `lib/costs` to display the rate as a chip label. After per-store rates were added (`getTransactionFeesRateForStore`), this static label is wrong for any operator who overrode a store's rate — the chip says "6.5%" while the actual computed `transactionFees` reflects per-store. Cross-store views show "6.5%" but compute a revenue-weighted blend. Display drift.
- **Track 7 (Docs):** `COGS_SETUP.md` should be cross-referenced from `ARCHITECTURE.md` so the per-store-COGS contract is discoverable. Also worth documenting the `revenueByStore` plumbing once P0-1 is fixed.
- **Track 8 (Perf):** no concerns. All audited functions are O(N) or O(N log N); no unbounded loops; no quadratic patterns spotted in the dives.
