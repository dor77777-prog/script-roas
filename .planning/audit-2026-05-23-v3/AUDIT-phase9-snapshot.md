---
audit: Pre-Conversion Algorithmic Audit
phase: 9
date: 2026-05-24
baseline: 6f71f754 (HEAD at audit time)
method: 2 parallel agents — gsd-code-reviewer (math + edges) + Plan subagent (test-suite gaps)
deliverable_type: report-only (no code changes)
sources:
  - .planning/phases/09-pre-conversion-algorithmic-audit/AGENT-A-REPORT.md
  - .planning/phases/09-pre-conversion-algorithmic-audit/AGENT-B-REPORT.md
  - .planning/phases/09-pre-conversion-algorithmic-audit/AUDIT-SPEC.md
---

# Pre-Conversion Algorithmic Audit

## Why this exists

Before the dashboard moves into conversion-funnel work, every algorithmic
surface that already drives operator decisions gets one honest, ground-truth
verdict: **math correctness + test coverage**, merged.

Two agents ran in parallel, read-only:

- **Agent A — `gsd-code-reviewer` (Opus 4.7)**: traced math on each surface, quoted
  file:line evidence, found 1 concrete bug and 3 design ⚠️.
- **Agent B — Plan subagent (Opus 4.7)**: mapped every test file to its
  algorithm, characterised depth (NO_TESTS / HAPPY_ONLY / EDGE_RICH / FULL),
  surfaced 5 coverage holes that should block any "verified" claim.

This document MERGES both: a surface gets ✅ only when math is sound AND
tests cover the edges that matter. ⚠️ flags either a design concern OR a
coverage hole big enough that "we trust the math" is not yet defensible.

## Spec drift note

`AUDIT-SPEC.md` named surface 1 as `analyzeAttribution.ts`. The actual
file is `attributionAnalysis.ts` (~1156 LOC). Both agents independently
caught this and audited the real module. Future audits should fix the
spec or auditors will chase a dead path.

---

## Summary table

| # | Surface | Status | One-line verdict |
|---|---|---|---|
| 1 | `lib/attributionAnalysis.ts` | ⚠️ | Math sound (Bayesian CI + window stability + outliers); 3 design concerns + no n-sweep on Bayesian CI vs Student-t oracle |
| 2 | `lib/campaignHealthScore.ts` | ✅ | Weights enforced; HR-03 renorm correct; insufficient gates correct; 62 FULL tests |
| 3 | `lib/cpmRoasAnalysis.ts` | ⚠️ | Math + thresholds correct; silent mis-categorisation when `prev=0` "no baseline" → "stable" |
| 4 | `lib/campaignProductMap.ts` (`allocateProductRevenue`) | ✅ | Refund-heavy + cross-platform cap correctly gated; 17 EDGE_RICH tests |
| 5 | `lib/fetchers/shopify.ts` (refunds, window, price field) | ✅ | DST + month-indexing fix intact; Window A/B dedup correct; 28 FULL tests |
| 6 | `inngest/functions/cronLive.ts` (`effective_status`) | 🔴 | One concrete bug: return value drops `tt` from `todaySpendCad` |
| 7 | `lib/fetchers/{meta,googleAds,tiktok,fx}.ts` | ⚠️ | meta/google/fx solid; **TikTok thin** (5 tests, no `code!==0` envelope coverage); `algorithm-parity.test.ts` permanently skipped |
| 8 | Order attribution classifier (`shopify.ts:classifyOrderAttribution`) | ✅ | Ladder correctly extended past spec; `source_name` divergence intentional + documented |
| 9 | `lib/aiReport.ts` (z-score, CV, momentum) | ⚠️ | Math sound; **ZERO unit tests** for ~700 LOC of statistical computation |
| 10 | `lib/postgresReaders.ts` (newest-row, `effective_status`) | ⚠️ | Writer↔reader asymmetry on TikTok active-status set; newest-row dedup unguarded |

**Counts:** 4 ✅ Verified · 5 ⚠️ Uncertain · 1 🔴 Bug

---

## Per-surface verdicts

### 1. `attributionAnalysis.ts` (≈1156 LOC) — ⚠️ Uncertain

**Math:** Sound. Tunable constants hoisted (lines 33–60). Bessel correction applied for AOV CI (`:356`, `:861`). WR-03 clamp on visible trust score (`:488`, `:937`) prevents negative scores leaking to UI. MAD outlier detection uses non-causal trailing-7-day window (`:645`) — correct. `computeCoverage` handles all 3 input regimes (positive / negative / zero metaClaim) per TEST-03.

**Test coverage (Agent B):** EDGE_RICH — 71 tests across 6 files (`analyzeAttribution.test.ts` 23, `attributionAnalysis.test.ts` 5, `computeWindowStability.test.ts` 11, `detectOutlierDays.test.ts` 9, `analyzeAttributionForAd.test.ts` 12, `analyzeAttributionForAdSet.test.ts` 11). Strongest coverage in the audit set.

**Why ⚠️:** Three design/coverage concerns:
1. `windowStability.verdict='mixed'` is NEVER surfaced to the operator (`:511–525` only emits messages for `'stable'` and `'volatile'`) — UX gap, not math bug.
2. `COVERAGE_UPPER_CLAMP = 2` silently caps extreme halo > 2× — masks anomalies the operator might want to see.
3. **Test gap:** Bayesian CI assertion is `low/high ≈ 2.1535/2.8465` on ONE fixture (`:135–136`) — no n-sweep, no comparison to Student-t reference. A t-critical-table drift would not be caught.

---

### 2. `campaignHealthScore.ts` (562 LOC) — ✅ Verified correct

**Math:** Weights `.4/.15/.25/.2` enforced at module load (`:103–107`). HR-03 renormalization correctly scales 3 remaining components when trajectory has no data: `scaleFactor = 1 / (W_p + W_v + W_a)`. Insufficient gate ($30 floor, $100 + 0 conv) matches operator spec. Per-platform ROAS pivots (Meta 3.0 / Google 3.5 / TikTok 2.0) interpolate `((roas − 1) / (pivot − 1)) × 100` correctly. Cohort adjustments (`:512–562`) gate `isWeakest` at `cohortSize >= 3` with JSDoc justification (someone always has to be last in a 2-cohort).

**Test coverage (Agent B):** FULL — 62 tests in `campaignHealthScore.test.ts`. Covers grade derivation, insufficient gate boundaries, profitability source priority, per-platform pivots, trajectory tone mapping (4 buckets), trajectory renorm with `hasData=false`, attribution clarity fallbacks, operator adjustments (±15/−30 with clamp), cohort adjustments with stacking and 2-member floor.

**Why ✅:** Math derived and matches code; tests cover the contracts. One **code smell** (not bug): `applyCohortHealthAdjustment` overwrites `base.components.cohortAdjustment` (`:558`) — calling it twice would double-adjust + replace prior delta. No caller does this today; no test pins it. Suggest renaming to `applyCohortAdjustmentOnce` or assert `base.components.cohortAdjustment === 0` to fail loud.

---

### 3. `cpmRoasAnalysis.ts` (323 LOC) — ⚠️ Uncertain

**Math:** Sound. `indexPrevByDateOffset` (`:59`) correctly aligns prev-period by calendar offset (v3 c/CR-01 fix intact). `pearsonForCpmRoas` (`:115`) has explicit small-N (n<3) and zero-variance guards returning null. Half-over-half delta (`:146`) handles `length < 4` and zero-baseline → null. FIX-25 fix (`:200`): valid rows require only `cpm > 0` (impressions × spend produced a CPM), NOT `roas > 0`.

**Test coverage (Agent B):** EDGE_RICH — 30 tests across `cpmRoasAnalysis.test.ts` (21) + `cpmPrevAlignment.test.ts` (9). Covers 9 verdict combinations, 5-day threshold, CPM=0 day filter, prev-period delta math, calendar-offset pairing.

**Why ⚠️:** When prev IS sufficient (≥3 days) AND `prevCpmMean === 0` (prev was an all-zero period, e.g. launch week), `cpmDelta=null` → `categorize` maps null → `'flat'` (`:247`). The tooltip then says **"יציבות מלאה"** for what is actually "no comparison baseline available". Hard to call this a bug (no good default), but operator-misleading. Recommended: add a `'no-baseline'` verdict when both deltas are null AND prev was queried.

**Test gaps (Agent B):** No coverage of `prev` series with all `roas=NaN` / all `cpm=NaN`. No test for the FLAT/UP verdict (table covers flat/flat, flat/down).

---

### 4. `campaignProductMap.ts` `allocateProductRevenue` (486 LOC) — ✅ Verified correct

**Math:** Refund-heavy product handling (`:319`) keeps rows where `netRevenue < 0` AND `units > 0` (previous filter dropped them). HI-03/CR-01 refund fix at `:357–365` only applies the revenue cap when `p.netRevenueCad >= 0`, preventing negative-clamp pathology. Step 3 dropped the `Math.max(0, …)` clamp on remainder revenue (`:463`). Mass-conservation verified by manual trace through the negative-net-with-deterministic-positive scenario.

`classifyOrderToPlatform` priority chain: source_name first (tiktok > meta > google), then fbclid > gclid (`:208–215`). `ttclid` folded into `source='tiktok-paid'` upstream in `shopify.ts`.

**Test coverage (Agent B):** EDGE_RICH — 8 dedicated `allocateProductRevenue` cases + 6 migration helpers + 3 classifier paths (17 total). Covers refund-only product (CR-01), negative-remainder distribution, asymmetric cap skip when net<0 (CR-03), idempotent migration.

**Why ✅:** Math + tests both consistent. Two documented edges (not bugs): multi-platform deterministic signal on same order picks Meta first; unknown 4th platform would silently drop from `keysByPlatform`.

**Test gaps (Agent B):** Empty `campaignSpend` map + non-empty orders → divide-by-zero in spend share — untested. No floating-point sum-to-target rounding assertion (allocation sums must equal `productRevenue.netRevenueCad` within ε).

---

### 5. `fetchers/shopify.ts` (refunds + buildWindowUrl + price field, 1094 LOC) — ✅ Verified correct

**Math:** `isoLocalMidnight` (`:247`) properly iterates DST (`for (let i = 0; i < 3; i++)`), and the 2026-05-22 month-indexing bug is fixed (`:299` correctly subtracts 1 from `offsetMatch[2]`). Window A (`created_at=D`) tight `[D, D+1)`, Window B (`updated_at=D`) open upper bound to `today+1` (`:423–426`) — the 2026-05-21 refund-window fix. Window A wins on overlap (dedup by `id` at `:543–549`). `total_price` used in fields; `current_total_price` used ONLY in `fetchShopifyOrdersAttribution` (`:1058`) where same-day-refund-already-deducted is the desired property.

**Test coverage (Agent B):** FULL — 28 tests across `shopify.test.ts` (19) + `shopifyRevenueRefunds.test.ts` (9). TZ offset regression, 50-page pagination cap, Window A+B dedup, Window B open-ended, spy-asserts algorithm called exactly once. 9 refund tests cover 6 D-C3 invariants + same-day-future-refund (CR-02) + failed-transaction filtering.

**Why ✅:** Math + tests both consistent across the load-bearing refund/fetcher boundary.

**Test gaps (Agent B):** No isolation of the EXACT 50-page boundary; no mid-pagination HTTP 429/5xx test (resilience is in the cron-live wrapper, not the fetcher); no missing-`total_price` parse-error path.

---

### 6. `inngest/functions/cronLive.ts` (`effective_status`, 1232 LOC) — 🔴 Has bug

**Math:** Most paths sound. `isActiveForPlatform` with `TIKTOK_ACTIVE_ENOUGH` (DELIVERY_OK + BUDGET_EXCEED + AUDIT + REVIEWING + NOT_START) matches operator spec. HIGH-12 + HIGH-NEW-4 fixes intact (sequential `for...of await` + `result.error` check). a/WARN-3 FX null fallback at `:646–652` correct. BL-COGS per-store rate with bounds check (0..1) correct.

**🔴 Concrete bug — cronLive.ts:1146–1149 (CR-02-RESIDUAL):**

The handler's RETURN value silently drops TikTok spend:

```ts
return {
  storeId,
  rollingDates: dates,
  perDayRevenue,
  todaySpendCad: {
    fb: todaySpendEntry.fbSpendCad ?? 0,
    ga: todaySpendEntry.gaSpendCad ?? 0,
    // ← MISSING: tt: todaySpendEntry.ttSpendCad ?? 0
  },
};
```

The persister correctly writes `tt_spend_cad` to data_daily. But the SUMMARY RETURNED to the orchestrator only exposes `fb` and `ga`. Any consumer reading `runLiveForStore(...).todaySpendCad` underreports the TikTok amount for uzoshop.

**Impact:** Low–Medium. On-disk data correct (dashboard reads from data_daily). Only the in-memory return value to the operator console / job-completion surface is affected.

**Fix:** Add `tt: todaySpendEntry.ttSpendCad ?? 0` to the returned literal at cronLive.ts:1148. Update return-type annotation at `:537` (`todaySpendCad: { fb: number; ga: number; tt?: number }`).

**Test coverage (Agent B):** EDGE_RICH — 34 tests across `cronLive.test.ts` (7), `cronLiveStatusRefresh.test.ts` (3), `cronLiveIsActiveForPlatform.test.ts` (24). `isActiveForPlatform` matrix exhaustive. `cronLiveStatusRefresh` covers rejection / `{error}` resilience.

**Test gaps (Agent B):** Past-row backfill loop (lines ~1060–1103, `UPDATE effective_status` on past rows in lookback window) has NO direct date-boundary test — off-by-one would silently corrupt the off-chip truth source. No idempotency test for two cron-live ticks within 10 minutes double-enrolling a campaign for today.

---

### 7. `fetchers/{meta,googleAds,tiktok,fx}.ts` — ⚠️ Uncertain

**Math (Agent A):** All four sound. **fx.ts** is throw-on-failure (caller responsible for `.catch(() => null)`; v3 cron-LIVE + cron-DAILY both wrapped). **meta.ts** priority chain (`omni_purchase → purchase → offsite_conversion.fb_pixel_purchase`) at `:285` matches the threat-T-S4 grep gate. **googleAds.ts** `runGaqlQuery` paginates `nextPageToken` (v3 CR-01 fix intact at `:309–339`). **tiktok.ts** `tiktokGet` checks the envelope's `code !== 0` (`:166`); Phase 05.7.8 advertiser_ids JSON-string fix intact (`:237`).

**Test coverage (Agent B):**
- meta.ts → 26 tests (EDGE_RICH)
- googleAds.ts → 9 tests (HAPPY_ONLY+)
- tiktok.ts → **5 tests (HAPPY_ONLY)**
- fx.ts → 5 tests (EDGE_RICH)
- algorithm-parity.test.ts → **permanently `it.skip`**

**Why ⚠️:** TikTok is the most operator-volatile platform (BUDGET_EXCEED daily, AUDIT on creative changes) yet has the thinnest tests. The `code !== 0` error envelope path is uncovered — the entire `{code, message}` failure surface has no test. Cache eviction is untested (only the test-reset helper is invoked). No cross-fetcher contract test enforcing a common `{ storeId, date, spend, currency }` shape — easy for one fetcher to drift in shape without anyone noticing.

`algorithm-parity.test.ts` skipped by design means **no automated drift detection** vs the frozen Sheets baseline. A TS fetcher could silently diverge by >5% and CI would never know.

---

### 8. Order attribution classifier (`shopify.ts:classifyOrderAttribution`) — ✅ Verified correct

**Math:** The spec ladder `fbclid → gclid → utm → referring_site` is CORRECTLY EXTENDED past the spec. The TS port (lines 881–927) prepends `source_name` checks (fb/google/tiktok), then ttclid, then the spec ladder. JSDoc at `:872–880` justifies: "Shopify's checkout SDK writes source_name when the order arrives via the platform's channel app. More reliable than landing_site UTMs (which can be stripped by a redirect chain)." Apps Script intentionally diverges and READ_FROM=postgres permanent (Phase 05.7.0) means the Apps Script classifier is dormant.

Manual trace on 12 representative orders verified (source_name vs gclid: source_name wins; fbclid + gclid both: meta-paid; utm_source=tiktok + medium=='': tiktok-paid per the intentional tier 9).

**Test coverage (Agent B):** EDGE_RICH for the priority ladder. 6 cases inside `shopify.test.ts` (fbclid, source_name, utm fallback, tiktok 3 paths, referring_site, voided/test filter, line-item allocation) + 4 cases in `orderSourceContract.test.ts` (round-trip).

**Why ✅:** Math sound, tests cover the operative ladder.

**Test gaps (Agent B):** No tie-break test for both fbclid AND gclid in same URL. No malformed `landing_site` (percent-encoded UTMs, multibyte). No case-insensitivity test for `referring_site` host (`Facebook.com` vs `facebook.com`). No `note_attributes` with both `_fbc` AND `_gcl_aw`.

---

### 9. `aiReport.ts` (statistical computations: z-score, CV, momentum) — ⚠️ Uncertain

**Math (Agent A):** Sound. CV uses population variance (correct — CPM series isn't a sample of an infinite population; it's exhaustive over visible days). Robust z-score formula `(value − median) / (1.4826 × MAD)` correct (1.4826 = 1/Φ⁻¹(0.75) consistency factor for normal data). `mad === 0` short-circuits to z=0 (prevents Infinity). Median formula correct for even/odd-length series. Funnel rates correctly guard division by zero. v2 a/WARN-4 storeId filter intact.

**Test coverage (Agent B):** **NO_TESTS for statistics.** Only 3 tests exist in `aiReportStoreId.test.ts` — ALL three exercise the storeId vs storeName filter via regex on rendered markdown strings. Zero coverage of `medianMad`, mean/variance/stddev/CV at lines 373–377, CV-threshold buckets, momentum scoring, or date-bucketing logic. **This is the single largest coverage gap in the audit set** — ~700 LOC of operator-facing report math has no test oracle.

**Why ⚠️:** Math is correct TODAY. A future change that bumps CV thresholds (0.15/0.35), flips the 1.4826 constant, or rebins the momentum windows would ship undetected — and the report is read by the operator weekly. Math without tests is not "verified" — it's "verified-once, future-fragile".

**Cosmetic nit (Agent A):** CV thresholds 0.15 and 0.35 are inlined magic numbers (`:398`, `:400`). The attribution analyzer hoists similar thresholds as `STABLE_THRESHOLD` / `VOLATILE_THRESHOLD`. Suggest re-using or re-hoisting locally for discoverability.

---

### 10. `postgresReaders.ts` (newest-row + `effective_status`, 902 LOC) — ⚠️ Uncertain

**Math (Agent A):** Newest-row selection applied in `fetchDashboardStateFromPostgres` (`:445–453`) — `prevAt !== undefined && updatedAt < prevAt` correctly keeps the newest row. `fetchTableLastWriteAt` (`:215`) uses `.order('updated_at', desc).limit(1)`. `effective_status` reader gate (`:586–611`) OR's hasActivity (spend/impressions/conversions > 0) with isCurrentlyActive (platform-specific status match). `toNumber` (`:126`) handles all null/undefined/'' edges. `paginate` (`:96`) guards runaway loops at MAX_CHUNKS=50.

**Why ⚠️ — Writer↔reader asymmetry on TikTok active-status set (subtle, NOT a bug today):**

`cronLive.ts:isActiveForPlatform` includes 5 TikTok statuses (DELIVERY_OK + BUDGET_EXCEED + AUDIT + REVIEWING + NOT_START — operator's OPERATOR-1 fix). But the dashboard reader gate (`postgresReaders.ts:608`) treats ONLY `ADGROUP_STATUS_DELIVERY_OK` as "is currently active":

```ts
(platformNorm === 'tiktok' && statusNorm === 'ADGROUP_STATUS_DELIVERY_OK');
```

Today this is harmless: writer enrolls placeholder rows for any of the 5; reader has `hasActivity` as the OR predicate, so any enrolled row with non-zero spend/impressions still surfaces. The narrow path where it matters: a brand-new BUDGET_EXCEED ad-set (paused-today, will resume tomorrow) with ZERO spend/impressions today → writer enrolls placeholder, reader DROPS it because `hasActivity=false && isCurrentlyActive=false`. Operator sees nothing for that ad-set on today's row, even though cron-live enrolled it.

**Suggested fix:** widen the reader's TikTok `isCurrentlyActive` check to the same `TIKTOK_ACTIVE_ENOUGH` set used by cron-live. Either import the set (one source of truth) or duplicate it with a comment cross-linking. **Severity: Minor.**

**Test coverage (Agent B):** HAPPY_ONLY — 11 tests in `postgresReaders.test.ts`, all about snake_case → camelCase shape parity. **Newest-row dedup logic is UNGUARDED** — the load-bearing comment at line 445 says "keep the row with the newest updatedAt" but no fixture pushes two rows for the same `(storeId, key)` pair to assert the newer one wins. `effective_status` normalisation at lines 599–644 (trim + uppercase + null handling) is untested.

---

## Test-suite gap analysis (Agent B's matrix)

| # | Surface | Test file(s) | Depth | Critical gaps |
|---|---|---|---|---|
| 1 | attributionAnalysis.ts | 6 files, 71 tests | EDGE_RICH | No n-sweep on Bayesian CI vs Student-t oracle; MAD multiplier untested at boundary |
| 2 | campaignHealthScore.ts | 1 file, 62 tests | **FULL** | Only single-flag clamp tested for adjustment stacking; no test for 2+ missing components renorm |
| 3 | cpmRoasAnalysis.ts | 2 files, 30 tests | EDGE_RICH | `prev=all-NaN` untested; FLAT/UP verdict untested; 5-day boundary untested |
| 4 | campaignProductMap.ts | 1 file, 17 tests | EDGE_RICH | Empty campaignSpend + orders untested; sum-to-target rounding untested |
| 5 | fetchers/shopify.ts | 2 files, 28 tests | **FULL** | Exact 50-page boundary; mid-pagination HTTP errors; missing total_price |
| 6 | cronLive.ts | 3 files, 34 tests | EDGE_RICH | Past-row backfill date boundaries untested; double-enrollment idempotency untested |
| 7 | fetchers/{meta,google,tiktok,fx} | 4 files, 45 tests | meta=ER; google=HO+; **tiktok=HO**; fx=ER | TikTok `code!==0` envelope; algorithm-parity permanently skipped |
| 8 | classifyOrderAttribution | 2 files, 10 tests | EDGE_RICH | Tie-break fbclid+gclid; malformed landing_site; case-insensitivity ref host |
| 9 | aiReport.ts (statistics) | 1 file, 3 tests | **NO_TESTS for statistics** | All 3 tests exercise the storeId filter only. Zero coverage of medianMad / CV / momentum (~700 LOC) |
| 10 | postgresReaders.ts | 1 file, 11 tests | HAPPY_ONLY | Newest-row dedup unguarded; effective_status normalisation untested |

### Top 5 verification-blocking coverage gaps (Agent B's ranking)

1. **aiReport.ts statistics are completely untested** — ~700 LOC of operator-facing math. Math is correct today (Agent A confirmed); a future change would ship undetected.
2. **postgresReaders.ts newest-row dedup is unguarded** — load-bearing claim with no fixture-driven assertion.
3. **cronLive.ts past-row backfill loop (lines ~1060–1103) has no date-boundary test** — off-by-one would silently corrupt the off-chip truth source.
4. **TikTok fetcher coverage is thin** (5 tests, no `code!==0` path) — most operator-volatile platform is the least-tested fetcher.
5. **`algorithm-parity.test.ts` is `it.skip` by default** — no automated drift detection against Sheets baseline. The very gate that should fire when a fetcher drifts is permanently off.

### Tooling gaps

- Inngest test files (`src/inngest/functions/__tests__/`) are NOT picked up by the default vitest glob (`src/lib/**/__tests__`). Documented at `cronLive.test.ts:27` — must be run with explicit path. Easy to forget on a casual `npm test`.
- No contract test enforcing common `{ storeId, date, spend, currency }` shape across all 4 ad-platform fetchers.
- No integration test for cron-live × Supabase (mocks only). Full pipeline cron-live → Supabase upsert → postgresReaders read is exercised piecewise but never end-to-end.

---

## Cross-surface observations (merged)

1. **Spec drift in surface 1 path.** Both agents caught: AUDIT-SPEC named `analyzeAttribution.ts`; the real file is `attributionAnalysis.ts`. Fix the spec or future auditors waste cycles.

2. **Variance convention inconsistency.** `attributionAnalysis.ts` uses Bessel-corrected sample variance for AOV CI (correct — AOVs are a sample), but POPULATION variance for window stability AND aiReport CV. Defensible per-callsite, no doc justifies the inconsistency. Suggested: a `lib/stats.ts` shared module exposing `sampleVariance` and `populationVariance` with clear names.

3. **TZ handling is consistent across the codebase.** Every callsite that needs an IL calendar day uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', … })`. No DST landmines found.

4. **Negative-value handling is consistent across the financial pipeline.** `computeCoverage` allows negative deterministic revenue; `allocateProductRevenue` skips `Math.max(0, …)` clamp on revenue remainder; cronLive doesn't clamp spend; trust score clamped to [0, 100] only at UI (WR-03). Mass-conservation preserved.

5. **Per-platform constants live in 3 files** (`campaignHealthScore.ts` — `PLATFORM_ROAS_PIVOT`, `PLATFORM_FALLBACK_TRUST`; `cronLive.ts` — `TIKTOK_ACTIVE_ENOUGH`; `googleAds.ts` — `STORES_WITH_GOOGLE_ADS`). None drift today; suggest future `platformConfig.ts` for centralisation.

6. **Writer↔reader asymmetry on TikTok active-status set** (item #5 cross-surface + finding #10). Writer (cron-live) uses 5-status set; reader (postgresReaders) uses 1-status set. Today harmless because of `hasActivity` OR; future-fragile if a no-spend BUDGET_EXCEED ad-set is ever the only signal. Same root-cause concern: `TIKTOK_ACTIVE_ENOUGH` should live in one module.

---

## 🔴 Bug triage table

| # | Bug | File:line | Severity | Fix in phase |
|---|---|---|---|---|
| B-01 | `runLiveForStore` return value drops `tt` from `todaySpendCad` summary — consumer underreports TikTok | `cronLive.ts:1146-1149` (+ type at `:537`) | **Minor** (on-disk data correct; only in-memory return) | Inline 1-line follow-up — no dedicated phase needed |

## ⚠️ Triage table (Uncertain — operator decision or near-bug)

| # | Concern | File:line | Severity | Fix in phase |
|---|---|---|---|---|
| U-01 | TikTok writer↔reader asymmetry on active-status set: reader at `postgresReaders.ts:608` allows only DELIVERY_OK while writer's `TIKTOK_ACTIVE_ENOUGH` includes 5 statuses. New BUDGET_EXCEED ad-set with zero spend → invisible. | `postgresReaders.ts:608` | **Minor** (BUDGET_EXCEED is uncommon; cron-daily resurfaces tomorrow) | Phase 10 (Reader Symmetry) or merge with `platformConfig.ts` extraction |
| U-02 | `cpmRoasAnalysis.ts` silently mis-categorises "no comparison baseline" (prev_mean=0) as `'flat'` → tooltip says "יציבות מלאה" for launch-week scenarios | `cpmRoasAnalysis.ts:247` | Minor (operator-misleading copy) | Phase 10 (`'no-baseline'` verdict) |
| U-03 | `aiReport.ts` CV thresholds 0.15 / 0.35 inlined as magic numbers; sibling values hoisted in `attributionAnalysis.ts` | `aiReport.ts:398, 400` | Cosmetic | Polish pass |
| U-04 | `attributionAnalysis.ts` `windowStability.verdict='mixed'` never surfaced to operator (silent swallow) | `attributionAnalysis.ts:511-525` | Minor (UX gap) | Phase 10 (mixed verdict UI) |
| U-05 | `attributionAnalysis.ts` `COVERAGE_UPPER_CLAMP = 2` silently caps extreme halo > 2× — masks truly anomalous orders | `attributionAnalysis.ts:60, 617` | Cosmetic / operator-tunable | Polish pass |
| U-06 | `campaignHealthScore.ts` `applyCohortHealthAdjustment` overwrites `cohortAdjustment` instead of adding — calling twice double-adjusts; no test pins | `campaignHealthScore.ts:558` | Code smell | Phase 10 (rename + assert) |

## Critical coverage holes (verification-blocking — even if math is correct today)

| # | Hole | Severity | Suggested phase |
|---|---|---|---|
| C-01 | `aiReport.ts` statistics: **ZERO tests** for ~700 LOC of medianMad / stddev / CV / momentum | **Critical (verification-blocking)** | Phase 10 — add medianMad oracle, CV-bucket boundary tests, momentum test suite |
| C-02 | `postgresReaders.ts` newest-row dedup logic unguarded — fixture-driven assertion missing | **Major** | Phase 10 |
| C-03 | `cronLive.ts` past-row backfill date-boundary untested (off-by-one risk on `effective_status` UPDATE window) | **Major** | Phase 10 |
| C-04 | `tiktok.ts` `code !== 0` error envelope path uncovered | Major | Phase 10 — add envelope error tests |
| C-05 | `algorithm-parity.test.ts` permanently `it.skip` — no drift detection vs Sheets baseline | Major | Polish pass — operator decision: re-enable or remove |

---

## Recommended next phase

**Phase 10 — Pre-Conversion Algorithmic Fixes** should ship in three small commit groups:

### Group A — Single concrete bug
- **B-01** (one-line): add `tt: todaySpendEntry.ttSpendCad ?? 0` to `cronLive.ts:1148` + type annotation at `:537`.

### Group B — Uncertain → resolved (small surface, no math change)
- **U-01** (TikTok reader symmetry): extract `TIKTOK_ACTIVE_ENOUGH` to a shared `platformConfig.ts` consumed by both cron-live writer + postgresReaders reader.
- **U-02** ('no-baseline' verdict in cpmRoasAnalysis).
- **U-04** ('mixed' window-stability verdict surfaced to operator copy).
- **U-06** (`applyCohortHealthAdjustment` rename + assert).

### Group C — Coverage backfill (highest-leverage tests)
- **C-01** — aiReport.ts statistics oracle: medianMad, CV bucket boundaries (0.15 / 0.35), momentum.
- **C-02** — postgresReaders newest-row dedup fixture.
- **C-03** — cronLive past-row backfill date-boundary fixture.
- **C-04** — TikTok `code !== 0` envelope test.

### Out of Phase 10 scope (defer to polish pass)
- **U-03** (CV thresholds magic numbers — cosmetic)
- **U-05** (coverage upper clamp — operator-tunable)
- **C-05** (`algorithm-parity.test.ts` — operator decision)
- Tooling: vitest glob covering `inngest/__tests__/`; cross-fetcher contract test; cron-live × Supabase integration test.

---

## Audit complete

- ✅ All 10 surfaces have a verdict
- ✅ Every 🔴 Bug has file:line + suggested fix + severity + target-fix-phase
- ✅ Every ⚠️ Uncertain has a clear "what would settle this" path
- ✅ No source files modified during this phase
