# A10 — Projection / Pacing / Attribution / AI-Report Math

Audit agent A10, 2026-05-28. Domain: Level-6 projection/attribution/AI numeric math.
Method: extracted each contract, built known-answer + edge + property matrices, ran scratch
probes (vitest, node), and recomputed against LIVE prod `/api/data?from=2026-05-01&to=2026-05-28`.
REPORT ONLY — no code changed.

Live anchors used (all-store May MTD, fetched 2026-05-28):
- MTD revenue (NET) = **100,875.86 CAD**; MTD spend = 42,732.81; by store uzoshop 87,200.87 / Zol Plus 8,280.65 / 360usmile 5,394.34.
- `forecastMonthEnd(liveRows)` → daysElapsed 28, daysRem 3, mtdRev 100,875.86, mtdNet 26,367.15, dailyAvgRev 2,806.00, projRev 109,293.85, projNet 28,405.03, projRoas 2.352.

---

## Algorithm 1 — Forecast / month-end projection (`lib/insights.ts` forecastMonthEnd)

**Contract:** straight-line projection to month-end; MTD totals via `aggregate()` (true-net
definition); remaining days extrapolated from the trailing-7 COMPLETED-day daily average;
COGS/fees preserve realized MTD and extrapolate only remaining days; fixed costs computed
whole-month via `billingForRange` with projected revenue.

**Verified properties (all PASS):**
- projection ≥ MTD when days remain & run-rate ≥ 0 — PASS (probe + live: 109,293.85 ≥ 100,875.86).
- last day of month (daysRemaining = 0) → projection == MTD — PASS (extrapolation term × 0).
- run-rate denominator: `daysElapsed = todayDay` (always ≥ 1, no day-1 ÷0); baseline denom
  `Math.max(1, datesSeen.size)` — both guarded — PASS.
- 7-day baseline EXCLUDES today `[today-7, today-1]` (HIGH-10) — PASS.
- MTD COGS/fees preserved, only remaining days extrapolated (insights ALG-01) — PASS, locked
  by `insightsProjectedNetMtd.test.ts` + `forecastMonthEndProjectionCogs.test.ts`.
- **percent-of-revenue fixed rows in projection (2026-05-24 P0-B) — RE-VERIFIED FIXED.**
  `billingForRange({…, revenue: projectedRev})` is passed (insights.ts:599-606); regression
  locked by `insightsProjectedNetMtd.test.ts` "5% All-row" case. No regression.
- GLOBAL scope (ignores store/range filters) — PASS, locked by `goalTrackerScope.test.ts`.

| ID | sev | algorithm | file:line | claimed contract | violating input | why wrong | suggested fix |
|----|-----|-----------|-----------|------------------|-----------------|-----------|---------------|
| A10-01 | P2 | forecastMonthEnd projectedFixedCosts store-specific percent rows | insights.ts:586-607 | projection's fixed-cost line correct per store | operator with a STORE-SPECIFIC `percentOfRevenue` recurring row (not `store:'All'`) | `billingForRange` is called WITHOUT `revenueByStore`, so a store-specific percent row charges against the even-split fallback `projectedRev / storeCount` instead of that store's projected revenue. With live mix (uzoshop 86% of revenue) a uzoshop-scoped 5% row would be charged on 33% of revenue → projection mis-states total fixed costs by up to (storeShare − 1/N)×rev×pct. ACKNOWLEDGED as a deferred limitation in the code comment (insights.ts:592-598); total is correct ONLY when percent rows are All-scoped. | thread per-store projected revenue: `revenueByStore = {store: mtdRevByStore + dailyAvgRevByStore×daysRem}` into the billingForRange call, mirroring `aggregateByStore`. Dominant operator setup is All-scoped so P2. |

---

## Algorithm 2 — GoalTracker pacing (`components/GoalTracker.tsx` + `computePacing`)

**Contract:** pacing marker = target×(daysElapsed/daysInMonth); status ahead ≥1.05×expected,
on-pace ≥0.92×expected, else behind; projected month-end == forecast; GLOBAL scope; no ÷0 on day 1.

**Verified properties:**
- pacing marker `expected = (daysElapsed/daysInMonth)×goal`, `expectedPct = daysElapsed/daysInMonth` — matches contract — PASS.
- status thresholds consistent with marker (1.05 / 0.92 bands) — PASS.
- projected month-end uses `forecast.projectedRevenue` (same forecastMonthEnd) — PASS.
- GLOBAL: feeds `data.rows` unfiltered, no `filters` prop — PASS (`goalTrackerScope.test.ts`).
- **Live MTD reconciliation:** GoalTracker "נצבר עד כה" renders `forecast.monthToDateRevenue`
  = 100,875.86 → matches independent recompute of live `/api/data` rows for 2026-05-01..28. PASS.
- daysInMonth in the component = `daysElapsed + daysRemaining` from forecastMonthEnd = real
  month length (31 for May) → never 0 → the GoalTracker call site cannot hit ÷0.

| ID | sev | algorithm | file:line | claimed contract | violating input | why wrong | suggested fix |
|----|-----|-----------|-----------|------------------|-----------------|-----------|---------------|
| A10-02 | P2 | computePacing divide-by-zero | insights.ts:693-695 | "no divide-by-zero on day 1" | `computePacing(goal, mtd, 0, 0)` (daysInMonth=0) | `expected = (0/0)×goal = NaN`, `expectedPct = NaN`; status falls through to `'behind'` (since `mtd >= NaN` is false). Confirmed via probe. NOT reachable through the GoalTracker caller (forecast always supplies real month length), so latent only — hence P2 not P1. | guard: `const ratio = daysInMonth > 0 ? daysElapsed/daysInMonth : 0;` before computing `expected`. Defensive — the function is exported and reusable. |

Note (no finding): expected-pace marker is hidden when `expectedPct >= 1` (last day) — UI choice, correct. Negative MTD (refund-heavy) yields negative progress and `behind` — correct, no NaN.

---

## Algorithm 3 — Cohort attribution math (`productCentricView`, `multiMappingCohort`, `attributionAnalysis`)

**Contract:** member allocated revenue sums to the product's actual net revenue (no
double-count / no exceed — ties to INV-16); pixel-vs-Shopify delta sign labeled correctly;
division guards present.

**Verified properties:**
- **Sum-conservation (INV-16):** `Σ member.allocatedRevenueEstimate == row.totalNetRevenue`
  (exact, ≤1e-9) in simplified-split branch; per-platform sums == per-member sums in allocator
  branch — PASS, locked by `productCentricViewSumConservation.test.ts` (5 cases incl. zero-spend,
  multi-member, cross-product). Attribution never EXCEEDS product revenue in these branches.
- **Coverage = det/metaClaim sign:** `computeCoverage` (attributionAnalysis.ts:163-168) guards
  metaClaim>0 / <0 / ==0 correctly; negative-claim → 0 (no false "perfect coverage"); locked by
  TEST-03 signed-revenue. PASS.
- **Pixel-vs-Shopify campaign gap sign** (aiReport.ts:901-911, attributionAnalysis): `gap =
  (det − value)/value`; positive → "Shopify sees more / platform under-reports", negative →
  "platform over-reports" — sign and verdict text aligned — PASS.
- Division guards: pearson (vx/vy==0 → null), roas (spend>0), coverage — all guarded — PASS.

| ID | sev | algorithm | file:line | claimed contract | violating input | why wrong | suggested fix |
|----|-----|-----------|-----------|------------------|-----------------|-----------|---------------|
| A10-03 | P2 (doc-only) | computeCoverage clamp contract | attributionAnalysis.ts:139-168 | docstring: "ratio clamped to [-∞, 2]" / "Upper clamp prevents halo blowing the trust ladder" | metaClaim>0 with det >> claim (pixel outage / halo) | `computeCoverage` does NOT clamp — returns raw `det/claim` (e.g. 10.0). The clamp/`coverageExceedsClamp` flag lives at the call site (COVERAGE_WARNING_THRESHOLD), so the helper docstring is misleading but the DISPLAYED trust ladder is correct (caller clamps). No wrong number reaches the user — purely a contract-comment drift. Confirm caller clamps before any raw-coverage render. | fix the docstring to say "callers clamp at COVERAGE_WARNING_THRESHOLD; the helper returns the raw ratio", OR move the clamp into the helper if any caller renders the raw value. |

Note: ALG-02 (stale-mapped revenue leak — attributed revenue from a dropped stale cohort member
could under/over-state vs totalNetRevenue) is explicitly DEFERRED to Phase 12.2 and is A4's
INV-16 territory; flagged here as cross-ref only, not double-reported.

---

## Algorithm 4 — AI executive-briefing math (`lib/aiReport.ts`, numeric assembly only)

**Contract:** the stats fed to the prompt / formatted into the report match the dashboard for
the same period; no stale/cross-store collision; rounding/sign correct.

**Verified properties:**
- Headline `revenue` sums `daily[].revenue` (= NET `data_daily.revenue`) — matches dashboard KPI — PASS.
- Blended `roas = revenue/totalSpend`, `totalSpend = fb+ga+tt` — matches dashboard — PASS.
- Rounding helpers (`fmtCad` rounds, `fmtNum` fixed-digits, `fmtPct`) sound — PASS.
- Anomaly z-scores (median/MAD ×1.4826) match insights.ts — locked by `aiReportStatistics.test.ts` — PASS.
- Cross-store collision guard — locked by `aiReportCrossStoreCollision.test.ts` / `aiReportStoreId.test.ts` — no gap found.
- Aggregate gapPct verdict (aiReport.ts:541-549) sign correct — PASS.

| ID | sev | algorithm | file:line | claimed contract | violating input | why wrong | suggested fix |
|----|-----|-----------|-----------|------------------|-----------------|-----------|---------------|
| A10-04 | **P1** | AI report "רווח נטו" (Net Profit) line | aiReport.ts:192,247 | the report's headline net profit should match the dashboard's net-profit number for the period | ANY period — structural | `netProfit = revenue − totalSpend − cogs`, labeled **"רווח נטו"** in bold. It OMITS transaction fees (~6.5%) AND fixed costs, both of which the dashboard's True Net Profit (`aggregate().trueNetProfit`, GoalTracker `monthToDateNet`) DOES subtract. **Live May: AI report shows 32,924.08 CAD vs dashboard True Net 26,367.15 CAD — overstated by 6,556.93 CAD (+24.9%), the exact omitted-fees amount.** The operator sees two contradicting "net profit" numbers across surfaces. No test locks this line. | compute net with the same `aggregate()` true-net definition (subtract transaction fees + prorated fixed costs), OR relabel the line as "רווח לפני עמלות וקבועות (Revenue − Spend − COGS)" so it no longer collides with the dashboard's "רווח נטו". Add an aiReport net-profit test. |
| A10-05 | P2 | AI report hardcoded COGS-rate copy | aiReport.ts:2271 | explanatory copy should reflect the COGS actually used | a store calibrated to a non-25% `${STORE}_COGS_RATE` | Static text asserts "COGS משוער: 25% מההכנסה. רווח נטו = הכנסות − פרסום − 25% מההכנסה." but the summed `cogs` uses per-store calibrated rates from the row writer, not a flat 25%. Today all three live stores happen to run 25% (verified: uzoshop/Zol Plus/360usmile all 25.0%), so currently harmless — but the copy will silently lie the moment any store's rate is recalibrated, and it mis-describes the formula (real cogs is per-row, not 25%×rev). | derive the displayed rate from `cogs/revenue` of the period, or drop the "25%" literal and say "per-store calibrated COGS". |

---

## Summary of findings

- A10-01 — P2 — forecast store-specific percent fixed rows use even-split (total OK; per-store off; acknowledged-deferred)
- A10-02 — P2 — computePacing NaN when daysInMonth=0 (latent; not reachable via GoalTracker)
- A10-03 — P2 — computeCoverage clamp docstring drift (no wrong number to user; doc-only)
- A10-04 — **P1** — AI report "רווח נטו" omits fees+fixed → +24.9% (+6,557 CAD live) vs dashboard True Net; surfaces a contradicting net-profit number
- A10-05 — P2 — AI report hardcoded "25% COGS" copy will lie if any store's rate is recalibrated

All projection/pacing math reconciles against live `/api/data` (MTD 100,875.86; projection
109,293.85). No P0. The only cross-surface NUMBER conflict is A10-04 (P1, net-profit definition).
