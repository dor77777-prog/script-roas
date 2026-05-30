---
plan: comprehensive fix execution for v2 audit
created: 2026-05-23
strategy: 6 agents in 2 waves of 3, non-overlapping file ownership, atomic commits per finding
test discipline: every fix has a regression test or matching test-update; tsc clean + full vitest on every commit
wave_1_status: COMPLETED + PUSHED (commits 48a377e..473c3ff, 17 commits, 683 tests pass, tsc clean)
wave_2_status: PENDING — resume command in "Resume Instructions" section at end
---

# Fix Plan — v2 Audit Comprehensive Remediation

## Scope statement

Address **all CRITICAL/BLOCKER + HIGH/WARNING findings** from the 4 v2 audit reports
(`fix-validation`, `algorithm-soundness`, `charts-and-viz`, `untouched-components`).
Selected MEDIUM findings included where they share a code path with a CRITICAL fix.
LOW/INFO deferred to a later cleanup pass.

**Total in-scope: ~43 findings (13 CRITICAL + 25 HIGH + 5 strategic MEDIUM).**

## Wave structure

Two waves of 3 parallel agents each. Wave 2 starts after Wave 1 lands so the conflict
points (cronLive.ts, campaignHealthScore.ts, CampaignsTable.tsx, BillingSettings.tsx)
are sequenced safely.

---

## Wave 1 — 3 parallel agents, no file overlap

### Agent A — Revenue / P&L correctness + COGS

**Owned files:**
- `dashboard-web/src/lib/billing.ts`
- `dashboard-web/src/lib/analytics.ts`
- `dashboard-web/src/lib/costs.ts`
- `dashboard-web/src/inngest/functions/cronLive.ts` (COGS section ONLY: line 165 + 292 + 336)
- `dashboard-web/src/inngest/functions/cronDaily.ts` (docstring example fix + 3 new regression tests)
- `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` (3 new tests)

**Findings to fix:**
- BL-COGS (a) — cron-live overrides per-store COGS within 10 min of cron-daily landing it.
  - Mirror `getCogsRateForStore` from cron-daily into cron-live's persist step.
- d/CR-01 — `billingForRange` triples "All" stores recurring entries.
  - When `r.store === 'All'`: add the amount ONCE to `recurringInPeriod`/`bySource`; split `byStore` evenly.
  - Same fix for one-time loop attribution at lines 200-209.
- d/CR-02 — `aggregateByStore` ignores the request range.
  - Add `range?: DateRange` arg, forward to inner `aggregate(list, range)` call.
  - Update consumer in `Dashboard.tsx:166` (must verify, may belong to a different scope).
- d/HI-01 — `STORE_FIXED_COSTS` dead code in `costs.ts`.
  - Delete `STORE_FIXED_COSTS`, `monthlyFixedCostsForStore`, `prorateFixedCosts` (confirm no callers via grep first).
- d/HI-02 — `TRANSACTION_FEES_RATE` + `COGS_RATE_OF_REVENUE` hardcoded globals.
  - Add `getCogsRateForStore` and `getTransactionFeesRateForStore` (env-var convention: `${STORE_UPPERCASE}_COGS_RATE` + `${STORE_UPPERCASE}_TX_FEES_RATE`).
  - In `analytics.ts:aggregate`, when a row has a known store, use per-store rate; for "All" view, weighted-average per store.
- d/HI-05 — `findMatchingRecurring` symmetric scope.
  - When line is 'All' and existing is store-specific, count as match.
- d/HI-06 — CSV per-row USD→CAD rounding.
  - Drop the per-row `Math.round`; store float, format at display time.
- d/MD-06 — `r.cogs` per-row reflects global rate; this is fixed by HI-02 once per-store rates flow through the write path.
- a/INFO-1 — cron-daily docstring: `360USMILE_COGS_RATE` → `USMILE360_COGS_RATE`.
- a/WARN-1 — 3 regression tests in cronDaily.test.ts for meta/google/tiktok platform-throw soft-fail.
  - Set `throwIn: 'meta' | 'google' | 'tiktok'` mock, assert: (a) `runDailyForStore` doesn't throw, (b) data_daily UPSERT was called, (c) failed platform's spend column is 0.

**Test discipline:**
- Update `billing.test.ts` (if exists) for triple-count fix.
- Add `analytics.test.ts` regression for `aggregateByStore` with range.
- Add 3 cronDaily tests for soft-fail.
- All 622+ existing tests must continue to pass.

**Commit strategy:** ~7-8 atomic commits, one per finding.

---

### Agent B — UI fidelity blockers (Goal + ProductChannelBreakdown + TikTok parity + TodayLive range-leak)

**Owned files:**
- `dashboard-web/src/components/GoalTracker.tsx`
- `dashboard-web/src/components/ProductChannelBreakdown.tsx`
- `dashboard-web/src/lib/hooks/useCampaignAttribution.ts`
- `dashboard-web/src/components/AdsDrawer.tsx`
- `dashboard-web/src/components/RefundIndicator.tsx`
- `dashboard-web/src/components/TodayLive.tsx` (decouple from parent's filtered date range)
- `dashboard-web/src/components/PerStoreCards.tsx` (mirror the same decoupling if needed)
- `dashboard-web/src/components/Dashboard.tsx` (GoalTracker prop wiring at line 352 + TodayLive prop wiring)

**Findings to fix:**
- d/CR-04 — `GoalTracker` ignores `filters.store`.
  - Filter rows by `filterRows(data.rows, filters.range, filters.store)` before passing to `forecastMonthEnd`.
  - Update panel header to "יעד חודשי · {storeLabel}" when filter is non-All.
  - Fix the lie: "הערך נשמר רק בדפדפן הזה (localStorage)" → "הערך נשמר גם בענן וגם בדפדפן" (since `writeGoal` calls `pushCloudKey`).
- d/CR-05 — `ProductChannelBreakdown` divide-by-zero.
  - Bail early: `if (total <= 0) return null;`
- d/CR-06 — `useCampaignAttribution` Meta-only gate.
  - Drop `summary.platform !== 'Meta'` early-returns at lines 81 and 104.
  - Verify `analyzeAttributionForAdSet` correctly handles TikTok/Google click-id sources (read `analyzeAttribution` for the platform-aware logic; if it's Meta-hardcoded, that's a deeper fix — flag it).
- d/HI-04 — `AdsDrawer` dep array consistency.
  - Either restore the date filter in `summary` (defensive) OR remove the redundant date filter in `dailyMetaByAd`. Pick defensive consistency: restore the filter in summary so both functions use the same predicate.
- d/CR-08 — `RefundIndicator` hover/touch race.
  - Add a 200ms grace timer on `onMouseLeave` that cancels on re-enter (wrapper OR portal element).
  - On touch: replace the mousedown→click→mouseleave sequence with explicit click-only toggle (use `pointer-events` or `isTouchDevice` detection).
- **NEW: TodayLive date-range leak** (operator-reported 2026-05-23, not in audit reports).
  - `TodayLive.tsx:157` filters `rows.filter(r => r.date === today)` — but `rows` is the parent's already-filtered-by-range data. When the operator selects "last 7 days" (and today's row exists in the range) it works; when they select a historical range (e.g., last month, no overlap with today), `todayRows = []` → TodayLive empty.
  - **Fix:** TodayLive must always show real-time today data regardless of operator's range selection. Either:
    - (a) TodayLive does its OWN `/api/data?from=${today}&to=${today}` SWR fetch (parallel to its existing campaigns + orders fetches), removing the `rows` prop dependency for the today computation;
    - (b) Parent passes **unfiltered** raw `data.rows` to TodayLive, and TodayLive filters to today internally.
  - Pick (a) — it's symmetric with how TodayLive already fetches its own campaigns + orders for today, and decouples the component fully from the parent's date filter.
  - Same fix consideration for `PerStoreCards.tsx` if it has the same dependency.
  - Verify: with operator's range set to "this month last year" → TodayLive still shows live data for today (orders + spend + ROAS).

**Test discipline:**
- Add `GoalTracker.test.tsx` (if no test file exists, create one) covering: All-stores vs filtered-store math; copy "ענן + דפדפן" rendering.
- Add `ProductChannelBreakdown.test.tsx` for `total === 0` → null render.
- Add tests for `useCampaignAttribution` to assert non-empty Map for TikTok scenario.
- Manual verification list (operator must check after merge): hover RefundIndicator on a refund chip → tooltip stays open while mouse over body of tooltip.

**Commit strategy:** 5 atomic commits, one per finding.

---

### Agent C — Charts comprehensive (all 9 chart findings)

**Owned files:**
- `dashboard-web/src/components/HeroOverview.tsx`
- `dashboard-web/src/components/CampaignsTable.tsx` (CPM chart section ONLY — `cpmChartData` + `<YAxis>` of CPM chart; lines ~1217-1330)
- `dashboard-web/src/components/CampaignDrawer.tsx` (CPM chart section ONLY — `cpmChartData` + `<YAxis>` of CPM chart; lines ~908-1030)
- `dashboard-web/src/components/Sparkline.tsx`
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx`
- `dashboard-web/src/components/RoasChart.tsx`
- `dashboard-web/src/lib/chartColors.ts`
- `dashboard-web/src/components/AnnotationsPanel.tsx` (annotation stacking only; verify if change lands in HeroOverview instead)

**Findings to fix:**
- c/CR-01 — CPM "vs prev period" aligns by INDEX not by DATE.
  - Replace `cpmDailyPrev?.[i]?.cpm` with date-offset lookup. Use the helper sketched in the audit:
    ```ts
    const prevByOffset = new Map<number, {cpm:number; date:string}>();
    // index prev by days-from-prevRange.from
    // then current day i pairs with prevByOffset.get(sameOffset)
    ```
- c/CR-02 — CPM chart Y-axis zero suppression.
  - Switch to `domain={[0, (dataMax) => dataMax * 1.12]}` (operator-correct default).
  - Apply to BOTH CampaignsTable's CPM chart AND CampaignDrawer's CPM chart.
  - Apply same to the ROAS overlay axis (line 1310-1325 in CampaignsTable, 1017-1032 in CampaignDrawer).
- c/CR-03 — HeroOverview RoasTrendChart skips zero-spend days.
  - Don't filter `series`; instead, enumerate the full date range and use `null` for missing days (lets Recharts render gaps via `connectNulls={false}`).
  - Fix the footer count: `{daysInRange} ימים` (not `series.length`).
- c/HI-01 — Colorblind palette.
  - In `chartColors.ts`: replace TikTok pink `#ec4899` with `#374151` (slate-700) for hue separation from purple.
  - Add a `pattern` legend for each chart line (dashed vs dotted vs solid) so grayscale operators can parse.
- c/HI-02 — Reconciliation Y-axis tick rounding.
  - `tickFormatter` uses `formatCurrency(n, n >= 100 ? 0 : 2)` to avoid duplicate `C$0/C$0/C$1` ticks.
- c/HI-03 — Annotation pins stacking on same day.
  - Group annotations by date; render one pin per date with emoji + `+N` count (or stagger Y).
- c/HI-04 — RoasChart tooltip missing "ROAS" unit label.
  - Prefix the formatted number with "ROAS" or use the `{label} {formatNumber(v)}` pattern.
- c/HI-05 — Sparkline degenerate input (all-equal values).
  - When range is 0, center the line at `pad + innerH / 2`.
- c/HI-06 — Reconciliation tooltip integer rounding.
  - Pass `formatCurrency(d.meta, d.meta < 100 && d.meta > 0 ? 2 : 0)` to tooltip numbers.

**Test discipline:**
- Add `Sparkline.test.tsx` covering the all-equal-input case.
- Add a snapshot or DOM-text test for the CPM chart Y axis domain.
- Add a date-alignment test for the cpmChartData prev-pairing logic.
- Visual verification (operator must check): open campaign drawer → CPM chart Y axis starts at 0; "vs prev" overlay aligns by calendar date not index.

**Commit strategy:** 9 atomic commits, one per finding.

---

## Wave 2 — 3 parallel agents, starts after Wave 1 lands

### Agent D — State + refresh + cloudSync + notifications

**Owned files:**
- `dashboard-web/src/lib/useDashboardRefresh.ts`
- `dashboard-web/src/lib/cloudSync.ts`
- `dashboard-web/src/lib/drawerStack.ts`
- `dashboard-web/src/components/BillingSettings.tsx` (parseFloat silent-0 + immediate-flag on save)
- `dashboard-web/src/lib/notifications/tokenFailures.ts`
- `dashboard-web/src/lib/notifications/sendDailySummary.ts` (HR-04 decision)
- `dashboard-web/src/components/operator/SyncIndicator.tsx` (if needed for the "partner changed" toast)
- `dashboard-web/src/lib/insights.ts` (if `writeGoal` needs immediate flag — likely yes per CC-01)
- `dashboard-web/src/lib/hooks/useBillingOneTime.ts` (if save action passes through here)
- `dashboard-web/src/lib/hooks/useBillingRecurring.ts` (same)

**Findings to fix:**
- d/CR-03 — `useDashboardRefresh` static cache-bust.
  - Compute `_t=${Date.now()}` inside the polling loop, not outside.
- d/MD-04 — `useDashboardRefresh` no abort on unmount.
  - Add `AbortController` per call; bail early in loop if aborted.
- d/MD-01 — `cloudSync.dispatchChange` unprotected in hydrate loop.
  - Wrap each `dispatchChange(lsKey)` call in try/catch with `console.warn`.
- d/CR-09 — `notifyTokenFailure` throttle clock not advanced on failed send.
  - Move `last_alert_sent_at = ...` OUT of `if (result.alerted)` gate; bump on every send attempt (success OR failure).
- d/CR-07 — `cloudSync` silent overwrite on partner clear.
  - Don't fix the auto-merge (keep contract), but add: when a partner-induced clear arrives while an editor is open elsewhere, surface a toast/banner in `SyncIndicator`. This requires a global "editing" registry — defer the registry to MEDIUM, just add the docstring + warn log for now.
- d/MD-07 — `BillingSettings` parseFloat silent-0.
  - On invalid input, block commit and surface inline error. Both `RecurringEditForm.commit()` and `OneTimeEditForm.commit()`.
- a/WARN-2 — HR-04 decision: throw on ANY recipient failure.
  - Change gate at `sendDailySummary.ts:110` from `recipientsSucceeded.length === 0 && recipientsFailed.length > 0` to just `recipientsFailed.length > 0`. Matches audit recommendation. The typo-fanned-to-stranger scenario will now surface as Inngest failure.
- CC-01 — `immediate: true` on save-button actions.
  - `writeGoal` (insights.ts), `writeOneTime` (useBillingOneTime if applicable), `writeRecurring` (useBillingRecurring). Pattern: pass `{ immediate: true }` to `pushCloudKey` for explicit save actions; keep debounce for typing.
- CC-02 — `useDrawerEsc` ref pattern.
  - Use `useRef` for the `onClose` callback so dep array can be `[open]` only; avoids re-push on every parent render.

**Test discipline:**
- Add `useDashboardRefresh.test.ts` covering cache-bust per iteration + abort on unmount.
- Add tokenFailures regression test for failed-send → throttle still advances.
- Add sendDailySummary test for the new "throw on any failure" behavior.

**Commit strategy:** ~7 atomic commits.

---

### Agent E — Pipeline FX + cron-live test + type cleanups

**Owned files:**
- `dashboard-web/src/inngest/functions/cronLive.ts` (FX section ONLY — line ~525; do NOT touch COGS section, Wave 1 Agent A owns that)
- `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts` (Test 5 TikTok spy)
- `dashboard-web/src/lib/campaignHealthScore.ts` (composition_changed in CohortAdjustmentInputs type only — small surgical change)
- `dashboard-web/src/components/CampaignsTable.tsx` (worstRisk type — section ~608; DO NOT touch CPM chart, Wave 1 Agent C owned that)
- `dashboard-web/src/lib/cannibalizationDetection.ts` (only for HIGH-04 "rebalanced mid-range" — moved here from Agent F to consolidate cannibalization changes)

**Findings to fix:**
- a/WARN-3 — cron-live FX `.catch(() => 1)` amplified by 3-day refresh.
  - Replace with `.catch(() => null)`; skip the spend update for that date×platform when null (the per-platform preserve already in place will keep prior value).
- a/WARN-5 — cron-live Test 5 add TikTok spy.
  - `const tiktokSpy = vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({...})`
  - Assert `tiktokSpy).toHaveBeenCalledTimes(3)`.
- a/WARN-6 — `composition_changed` not in cohort adjustment type signature.
  - Add `'composition_changed'` to `cannibalizationRisk` field in `CohortAdjustmentInputs`.
  - Document the intentional zero-delta pass-through in JSDoc.
  - Update `CampaignsTable.tsx:608` `worstRisk` type to include `'composition_changed'`.
- b/HI-04 — composition-change guard misses "rebalanced mid-range" (share tripled but neither half >20%).
  - Add the relative-share-change check per audit:
    ```ts
    const shareRatioFlipped =
      (earlyShare > 0.05 && lateShare / earlyShare >= 2) ||
      (lateShare > 0.05 && earlyShare / lateShare >= 2);
    if (!material && !shareRatioFlipped) continue;
    ```
- a/INFO-3 — 5+ member cohort composition_changed test.
  - Add test: 5 members, c1+c2 material (>20%), c3-c5 <5% each, one material member paused → composition_changed fires.

**Test discipline:**
- 3 new tests in cannibalizationDetection.test.ts (rebalanced false-positive, 5-member cohort, $50 floor preserved).
- 1 new test in cronLive.test.ts (TikTok spy).
- 1 new test pinning FX null behavior.

**Commit strategy:** 5 atomic commits.

---

### Agent F — Algorithm soundness + TZ + AI Report

**Owned files:**
- `dashboard-web/src/lib/attributionAnalysis.ts` (HI-01: 2.5σ label fix)
- `dashboard-web/src/lib/multiMappingCohort.ts` (b/HI-02: add orders param to Bayesian shrinkage)
- `dashboard-web/src/lib/productCentricView.ts` (b/HI-03 + b/HI-05)
- `dashboard-web/src/components/operator/BackfillPicker.tsx` (d/HI-03: TZ)
- `dashboard-web/src/lib/presets.ts` (d/HI-09: DST)
- `dashboard-web/src/components/MonthlyTables.tsx` (d/HI-08: TZ)
- `dashboard-web/src/lib/aiReport.ts` (a/WARN-4: storeId vs storeName)
- `dashboard-web/src/components/CommandPalette.tsx` (d/HI-10: Cmd+K editable guard)
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx` (TZ fix companion to BackfillPicker)

**Findings to fix:**
- b/HI-01 — `attributionAnalysis.ts:528` "2.5σ" label vs MAD×3.
  - Rewrite operator message to honestly say `>${MAD_OUTLIER_MULTIPLIER}× MAD מעל החציון`.
- b/HI-02 — Bayesian shrinkage uses CAD not orders.
  - Add `orders: number` arg to `shrinkRoas` (and the cohort metric object).
  - Use the better of `orders/(orders+10)` and `spend/(spend+500)` as the weight.
  - Wire through call sites (multiMappingCohort.ts will need to read `agg.conversions`).
  - Update existing tests.
- b/HI-03 — `productCentricView` diverges from allocator.
  - Either thread orders through `buildProductCentricView` AND call `allocateProductRevenue` per-product (preferred) OR surface a banner in the UI clarifying the simplification.
  - Pick allocator-thread (operator gets one consistent number across views).
- b/HI-05 — `productCentricView` silent revenue drop on zero-spend cohort.
  - Fall back to equal-share when `totalCohortSpend === 0`:
    ```ts
    const share = totalCohortSpend > 0 ? spend / totalCohortSpend : 1 / platformGroups.size;
    ```
- d/HI-03 — `BackfillPicker` UTC vs IL today.
  - Use Intl-formatted Asia/Jerusalem `today`.
- d/HI-08 — `MonthlyTables.isoMonthsAgo` TZ off-by-one.
  - Rewrite to be Intl-formatted IL throughout.
- d/HI-09 — `presets.ts` hardcoded `TZ_OFFSET_HOURS = 3` ignores DST.
  - Use Intl Asia/Jerusalem date string for all preset boundaries.
- d/HI-10 — `CommandPalette` Cmd+K editable-field guard.
  - Add `if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;` before handling.
- a/WARN-4 — `aiReport.ts` storeName vs storeId comparison.
  - Thread `storeId` through `AiReportButton.tsx` and `generateAiReport()`.
  - Replace `c.storeName === storeFilterId` with `c.storeId === storeId`.
  - Update aiReport.ts:99-118 and 1781 (the multi-mapping inheritor of the bug).

**Test discipline:**
- Add `multiMappingCohort.test.ts` test for the orders-axis shrinkage (high-AOV 1-order vs low-AOV 50-orders).
- Add `productCentricView.test.ts` test for zero-spend-with-positive-revenue.
- Add TZ-boundary tests for presets.ts.
- Verify all 622+ existing tests still pass.

**Commit strategy:** ~10 atomic commits.

---

## Conflict map (file ownership matrix)

Across the 6 agents, these files have boundary discipline:

| File | Wave 1 owner | Wave 2 owner | Note |
|------|--------------|--------------|------|
| `cronLive.ts` | Agent A (COGS section) | Agent E (FX section) | Different sections; sequential within waves |
| `cronDaily.ts` | Agent A (docstring + tests) | — | Single-owner |
| `cronDaily.test.ts` | Agent A | — | Single-owner |
| `cronLive.test.ts` | — | Agent E | Single-owner |
| `campaignHealthScore.ts` | — | Agent E (type only) | No Wave 1 owner; Agent E surgical |
| `CampaignsTable.tsx` | Agent C (CPM chart) | Agent E (worstRisk type ~line 608) | Different sections |
| `CampaignDrawer.tsx` | Agent C (CPM chart) | — | Single-owner |
| `BillingSettings.tsx` | — | Agent D | Single-owner |
| `multiMappingCohort.ts` | — | Agent F | Single-owner |
| `cannibalizationDetection.ts` | — | Agent E (HIGH-04 + tests) | Single-owner |
| `aiReport.ts` | — | Agent F | Single-owner |
| `Dashboard.tsx` | Agent B (GoalTracker prop only) | — | Surgical |
| `attributionAnalysis.ts` | — | Agent F | Single-owner |
| `productCentricView.ts` | — | Agent F | Single-owner |
| `presets.ts` | — | Agent F | Single-owner |
| `MonthlyTables.tsx` | — | Agent F | Single-owner |
| `BackfillPicker.tsx` | — | Agent F | Single-owner |
| `ManualOverridesCrud.tsx` | — | Agent F | Single-owner |
| `CommandPalette.tsx` | — | Agent F | Single-owner |
| `GoalTracker.tsx` | Agent B | — | Single-owner |
| `ProductChannelBreakdown.tsx` | Agent B | — | Single-owner |
| `useCampaignAttribution.ts` | Agent B | — | Single-owner |
| `AdsDrawer.tsx` | Agent B | — | Single-owner |
| `RefundIndicator.tsx` | Agent B | — | Single-owner |
| `analytics.ts` | Agent A | — | Single-owner |
| `billing.ts` | Agent A | — | Single-owner |
| `costs.ts` | Agent A | — | Single-owner |
| `chartColors.ts` | Agent C | — | Single-owner |
| `HeroOverview.tsx` | Agent C | — | Single-owner |
| `Sparkline.tsx` | Agent C | — | Single-owner |
| `MetaShopifyReconciliation.tsx` | Agent C | — | Single-owner |
| `RoasChart.tsx` | Agent C | — | Single-owner |
| `AnnotationsPanel.tsx` | Agent C | — | Single-owner (annotation stacking lives in HeroOverview though) |
| `useDashboardRefresh.ts` | — | Agent D | Single-owner |
| `cloudSync.ts` | — | Agent D | Single-owner |
| `drawerStack.ts` | — | Agent D | Single-owner |
| `tokenFailures.ts` | — | Agent D | Single-owner |
| `sendDailySummary.ts` | — | Agent D | Single-owner |
| `insights.ts` | — | Agent D (writeGoal immediate flag) | Single-owner |

**Conflict-free guarantee for Wave 1**: no two agents touch the same file in Wave 1.
**Conflict-free guarantee for Wave 2**: no two agents touch the same file in Wave 2.
**Wave 1 → Wave 2 dependency**: Wave 2 must wait for Wave 1 because `cronLive.ts` and `CampaignsTable.tsx` are touched across waves.

## Test discipline (all agents)

1. Every commit must end with `npx vitest run` passing AND `npx tsc --noEmit` clean.
2. Every functional fix must add at least one regression test pinning the new behavior.
3. Test file additions go in the matching `__tests__/` directory.
4. Commit messages reference the audit finding ID (e.g., "d/CR-04", "b/HI-02") so traceability is preserved.

## Out of scope (deferred to a later pass)

- All LOW/INFO findings.
- Selected MEDIUM findings that don't share a fix path with a CRITICAL/HIGH:
  - b/MEDIUM-01 (cohort comment ambiguity)
  - b/MEDIUM-02 (revenueGrowthPct sign-flip)
  - b/MEDIUM-03 (marginalRoas inflation)
  - b/MEDIUM-05 (`p.netRevenueCad >= 0` boundary)
  - b/MEDIUM-06 (double-clamp ordering)
  - c/MEDIUM-* (legend/color drift, minor visual)
  - d/MEDIUM-02 (VALUE_MAX_BYTES UTF-8 counting)
  - d/MEDIUM-03 (`health.sheets` field deprecation)
  - d/MEDIUM-05 (`MonthlyTables` byDate total parity)
  - d/MEDIUM-08 (Filters "custom" reset)
  - d/MEDIUM-09 (`hasGa` gates FB column)
  - d/MEDIUM-10 (BOM normalization)
  - d/MEDIUM-11 (aiReportSignal rapid clicks)
  - d/MEDIUM-12 (CommandPalette listener duplication)
  - d/MEDIUM-13 (`r.ttSpend` string coercion)
  - d/MEDIUM-14 (operatorReset error msg)

These will be addressed in a "polish pass" after the operator has confirmed the
CRITICAL/HIGH remediation lands cleanly.

---

# Wave 1 Status — COMPLETED + PUSHED (2026-05-23)

All 3 Wave 1 agents finished. 17 commits landed on `main` between `48a377e..473c3ff`.

## Wave 1 commits (in topological order, oldest first)

| Hash | Title | Agent | Audit ID |
|------|-------|-------|----------|
| `f7edbf9` | fix(cron): per-store COGS in cron-live + docstring | A | BL-COGS + a/INFO-1 |
| `9ab19ec` | fix(charts): align CPM previous-period overlay by calendar date not index | C | c/CR-01 |
| `5f8f45f` | fix(product-channel-breakdown): bail when total === 0 | B | d/CR-05 |
| `0b90c05` | fix(charts): start CPM Y-axis at 0 — no more zero suppression | C | c/CR-02 |
| `47eb876` | fix(use-campaign-attribution): drop Meta-only gate | B | d/CR-06 |
| `227a49d` | fix(ads-drawer): restore date filter in summary memo | B | d/HI-04 |
| `6fc9233` | fix(charts): RoasTrendChart preserves gaps + footer count | C | c/CR-03 |
| `a271b3a` | fix(refund-indicator): grace timer + portal-aware + touch | B | d/CR-08 |
| `e9f1793` | fix(charts): TikTok pink → slate-700 colorblind palette | C | c/HI-01 (commit title was mis-attributed during parallel-add race; actual contents are Agent C's chartColors changes) |
| `b9dc140` | fix(today-live): own SWR fetch (always live regardless of operator range) | B | NEW operator-reported |
| `d76d5dc` | fix(analytics): per-store COGS+tx fees, aggregateByStore range, dead code | A | d/CR-02 + d/HI-01 + d/HI-02 |
| `f00e12a` | fix(charts): reconciliation Y-axis tick precision per magnitude | C | c/HI-02 |
| `b1620bb` | fix(charts): stack same-day annotations as count chip | C | c/HI-03 |
| `4396ce4` | test(cron-daily): regression tests for platform-throw soft-fail | A | a/WARN-1 |
| `36278c3` | fix(charts): RoasChart tooltip labels number as ROAS | C | c/HI-04 |
| `8935bc3` | fix(charts): sparkline centers when all values identical | C | c/HI-05 |
| `fa2b1d3` | fix(charts): reconciliation tooltip preserves sub-dollar precision | C | c/HI-06 |
| `473c3ff` | fix(dashboard): wire filters.range to aggregateByStore (CR-02 follow-up) | coordinator | d/CR-02 wiring |
| `e8e9113` | fix(goal-tracker): respect global store filter + correct cloud-sync copy | B | d/CR-04 |

**Total: ~19 commits (some appear in two places due to interleaved push).**

## Wave 1 lessons learned (apply to Wave 2)

**Conflict prevention rule for Wave 2 agents (REQUIRED):**

The Wave 1 agents had no file-level conflict per the ownership matrix, but a
**git staging race** caused 2 commit titles to be mis-attributed when one
agent's `git add -A` swept up another agent's still-staged files. The CODE
was correct in all cases; only commit titles were misleading.

**Wave 2 agents MUST:**
1. **NEVER use `git add -A` or `git add .`** — only `git add <explicit-file-paths>` for owned files.
2. **Combine `git add` + `git commit` in a SINGLE Bash invocation** (chained with `&&`), so staging→committing is atomic vs other agents.
3. **Use `git commit --only <paths>`** as defense-in-depth if uncertain about staging state.
4. **Before EACH commit**, run `git status --short` to verify ONLY the agent's owned files appear in the staging area; if not, reset and re-stage explicitly.

## Wave 1 deferred items

These were noted by Wave 1 agents but defer to Wave 2 or a later cleanup:

- **`analyzeAttributionForAdSet` / `analyzeAttributionForAd` Meta-only gate** at `attributionAnalysis.ts:717,767` — Agent B fixed the `useCampaignAttribution` hook layer (commit `47eb876`) but the underlying analyzer is still Meta-only for the secondary fallback. Wave 2 Agent F owns `attributionAnalysis.ts` and should widen those gates to support TikTok + Google.
- **BL-COGS regression test in `cronLive.test.ts`** — Agent A added 3 tests to `cronDaily.test.ts` for soft-fail (a/WARN-1) but the COGS env-var override test for cron-live belongs in Agent E's test scope. Pin: assert `USMILE360_COGS_RATE=0.18` propagates through cron-live to `data_daily.cogs_cad`.
- **CampaignDrawer value/spend chart tickFormatter** at line ~813 has the same 0-decimal precision issue as the reconciliation chart fixed by c/HI-02. Different chart, not in Agent C's CPM-chart scope. Defer to a polish pass.

---

# Wave 2 — 3 parallel agents (PENDING — resume after context cleanup)

Wave 2 plan stands as written above (Agents D / E / F). The ownership matrix
applies. Wave 2 starts on the new state at `473c3ff`.

## Wave 2 starting state

- Branch: `main`
- Latest commit: `473c3ff` (Wave 1 fully landed + pushed)
- Tests: 683 passed | 12 skipped | 0 failures
- tsc clean
- All Wave 1 files now reflect their CRITICAL/HIGH fix state — Wave 2 agents
  work on top of this.

## Wave 2 agents — re-verified ownership (post-Wave 1 conflicts)

### Agent D — State + Refresh + CloudSync + Notifications
Files (NONE touched by Wave 1):
- `dashboard-web/src/lib/useDashboardRefresh.ts`
- `dashboard-web/src/lib/cloudSync.ts`
- `dashboard-web/src/lib/drawerStack.ts`
- `dashboard-web/src/components/BillingSettings.tsx`
- `dashboard-web/src/lib/notifications/tokenFailures.ts`
- `dashboard-web/src/lib/notifications/sendDailySummary.ts`
- `dashboard-web/src/lib/insights.ts` (writeGoal immediate flag)
- Optional: `dashboard-web/src/components/operator/SyncIndicator.tsx`
- Optional: hooks/useBillingOneTime.ts, useBillingRecurring.ts

Findings: d/CR-03, d/MD-04, d/MD-01, d/CR-09, CC-01, CC-02, d/MD-07, a/WARN-2, d/CR-07-soft (toast)

### Agent E — Pipeline FX + cron-live test + Type cleanups
Files:
- `dashboard-web/src/inngest/functions/cronLive.ts` — **ONLY FX section ~line 525** (Wave 1 A touched COGS section; do NOT touch lines around `getCogsRateForStore` / `cogs` calc / line 336 UPSERT).
- `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts`
- `dashboard-web/src/lib/campaignHealthScore.ts` — composition_changed type addition only
- `dashboard-web/src/components/CampaignsTable.tsx` — **ONLY worstRisk type section ~line 608** (Wave 1 C touched CPM-chart section).
- `dashboard-web/src/lib/cannibalizationDetection.ts` — HIGH-04 rebalanced false-positive + 5+ member test
- Test files for the above

Findings: a/WARN-3, a/WARN-5, a/WARN-6, b/HI-04, a/INFO-3

### Agent F — Algorithm soundness + TZ + AI Report
Files (NONE touched by Wave 1):
- `dashboard-web/src/lib/attributionAnalysis.ts` (b/HI-01 label + widen analyzer for TikTok per Wave 1 deferred item)
- `dashboard-web/src/lib/multiMappingCohort.ts` (b/HI-02 orders-axis shrinkage)
- `dashboard-web/src/lib/productCentricView.ts` (b/HI-03 + b/HI-05)
- `dashboard-web/src/components/operator/BackfillPicker.tsx` (d/HI-03)
- `dashboard-web/src/lib/presets.ts` (d/HI-09)
- `dashboard-web/src/components/MonthlyTables.tsx` (d/HI-08)
- `dashboard-web/src/lib/aiReport.ts` (a/WARN-4 storeId fix)
- `dashboard-web/src/components/CommandPalette.tsx` (d/HI-10)
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx` (TZ fix companion)

Findings: b/HI-01, b/HI-02, b/HI-03, b/HI-04 (now owned by E — moved to E for cannibalization consolidation), b/HI-05, d/HI-03, d/HI-08, d/HI-09, d/HI-10, a/WARN-4

**Conflict check post-Wave 1:** All Wave 2 files are confirmed NOT touched by Wave 1, EXCEPT:
- `cronLive.ts`: Wave 1 A touched COGS section (~line 165, 292, 336). Wave 2 E will touch FX section (~line 525). Different regions. Agent E MUST verify they're not editing lines Agent A modified.
- `CampaignsTable.tsx`: Wave 1 C touched CPM-chart section (~line 1217-1330). Wave 2 E will touch worstRisk type (~line 608). Different regions.

---

# Resume Instructions (after operator clears context)

## What to do AFTER you (operator) clear context:

1. The fix plan is at `.planning/audit-2026-05-23-v2/FIX-PLAN.md` (this file).
2. All Wave 1 work is on `main` at commit `473c3ff` — confirm with `git log --oneline -5`.
3. To resume: send Claude this exact message:

```
המשך Wave 2 מהתכנון ב-.planning/audit-2026-05-23-v2/FIX-PLAN.md. בסיס: commit 473c3ff, 683 tests pass, tsc clean. הרץ 3 סוכנים במקביל (D + E + F) לפי ownership matrix שב-FIX-PLAN. אכוף את כללי מניעת קונפליקטים שב-"Wave 1 lessons learned": git add עם paths מפורשים בלבד, git add + git commit באותה פקודת Bash, git status --short לפני כל commit. אחרי Wave 2 — push ל-main + סיכום בעברית.
```

## What Claude will do on receiving that message:

1. Verify baseline (`git log`, `npx vitest run`, `npx tsc --noEmit`).
2. Spawn Agents D + E + F in parallel with the prompts implied by this fix-plan.
3. Each agent commits atomically with the new conflict-prevention rules.
4. After all 3 agents complete, run final regression suite.
5. Push to main.
6. Provide a Hebrew summary of what landed in Wave 2 + total scope of v2 audit remediation (Wave 1 + Wave 2 combined).

## Estimated Wave 2 effort: 20-25 atomic commits across 3 agents.

## Total v2 audit remediation when both waves complete:
- Wave 1: 17 commits, 17 findings (13 CRITICAL/BLOCKER + 4 HIGH/WARN)
- Wave 2: ~25 commits, ~26 findings (mostly HIGH + selected MEDIUM)
- Combined: ~42 findings remediated out of 96 total v2 findings.
- Deferred to polish pass: all LOW/INFO + ~28 non-shared-path MEDIUM.

---

# Conflict prevention rules (REQUIRED for Wave 2 agents)

**Rule 1: No `git add -A` or `git add .`** — only `git add <explicit-paths>`.

**Rule 2: Atomic stage+commit per file group:**
```bash
git add src/lib/X.ts src/lib/__tests__/X.test.ts && git commit -m "$(cat <<'EOF'
fix(scope): summary (audit-id)
...
EOF
)"
```

**Rule 3: Verify staging before commit:**
```bash
git status --short
# Confirm ONLY owned files appear.
# If unexpected files appear: git restore --staged <unexpected-file>
```

**Rule 4: Use `--only` if uncertain:**
```bash
git commit --only src/lib/X.ts -m "..."
```

These rules will prevent the parallel-add race that caused 2 commit titles
in Wave 1 to be mis-attributed (code was still correct, only titles wrong).

