# Agent B — Test-Suite Gap Analysis
Date: 2026-05-24 · Reviewer: Plan subagent (Opus 4.7)
Baseline: 6f71f7543026d1bc18e705ef41c2010b9c1e18ec

NOTE ON DELIVERY MODE: The task requested writing this file. Read-only planning mode prohibits file creation, so the full report is returned inline to the orchestrator, which writes it here.

NOTE ON SURFACE 1 NAMING: AUDIT-SPEC references `dashboard-web/src/lib/analyzeAttribution.ts` — that file does not exist. The real module is `/Users/dorperetz/script-roas/dashboard-web/src/lib/attributionAnalysis.ts` (1155 LOC). All tests target the existing module. Worth flagging in the synthesis step.

## Per-surface test coverage matrix

| # | Surface | Test files (N tests) | Depth | Critical gaps |
|---|---|---|---|---|
| 1 | `attributionAnalysis.ts` (Bayesian CI, trust, stability, outliers) | `lib/__tests__/analyzeAttribution.test.ts` (23), `attributionAnalysis.test.ts` (5), `computeWindowStability.test.ts` (11), `detectOutlierDays.test.ts` (9), `analyzeAttributionForAd.test.ts` (12), `analyzeAttributionForAdSet.test.ts` (11) | EDGE_RICH | Bayesian CI: no direct numerical agreement check against an authoritative t-distribution baseline (`low/high≈mid±1.386σ` is asserted on ONE fixture only at lines 135–136 — no n=2/3/4/5 sweep, no comparison with Student-t critical values, no df correction near n=2). Trust score: no parity check that `trust.score` mapping matches the documented bands. Stability: no IN-09 cross-window with imbalanced day counts (one full bucket vs partial bucket coverage = NaN guard untested). Outlier detection: no test that MAD multiplier matches operator-stated threshold value (just "MAD" string). |
| 2 | `campaignHealthScore.ts` (4 components + adjustments) | `lib/__tests__/campaignHealthScore.test.ts` (62) | FULL | Operator adjustment stacking: no test where +15 optimised crosses the 100-cap and the -30 isOff produces a different clamp ordering than expected (only single-flag clamp asserted). Cross-component normalisation: only `hasData=false` trajectory renormalisation tested — no test for what happens when `attributionClarity=50` (no info) AND `cpmRoasAnalysis=undefined` simultaneously (two missing components vs documented weight redistribution). No test for the per-platform pivot when platform is empty string / unknown. |
| 3 | `cpmRoasAnalysis.ts` (half-over-half, prev-period, neutral fallback) | `lib/__tests__/cpmRoasAnalysis.test.ts` (21), `cpmPrevAlignment.test.ts` (9) | EDGE_RICH | No assertion that `pearsonForCpmRoas` returns null vs a finite number on input with identical x values (zero variance edge — only `flat/flat` series tested via the analyzer wrapper). No test that the previous-period delta is symmetric over prev/cur swap (sign hygiene). No test for the half-over-half boundary at exactly 5 days (the threshold value). |
| 4 | `campaignProductMap.ts` `allocateProductRevenue` | `lib/__tests__/campaignProductMap.test.ts` (17 — incl. 8 dedicated `allocateProductRevenue` cases) | EDGE_RICH | No test for the `campaignSpend` map being empty/zero while orders exist (division-by-zero in spend share). No test for mass-conservation invariant when ALL orders are signaled but cross-platform (e.g. gclid+fbclid both true on same order — current branch picks one — no test pins which). No test for `productRevenue` row with `units=0 && netRevenueCad>0` (positive-without-units edge). |
| 5 | `fetchers/shopify.ts` refund handling + `buildWindowUrl` + price field selection | `lib/fetchers/__tests__/shopify.test.ts` (19), `lib/__tests__/shopifyRevenueRefunds.test.ts` (9) | FULL | Cross-day refund algorithm tested against probe fixtures + a synthetic future-day fixture and a failed-transaction fixture. Missing: refund whose `processed_at` is missing or has timezone embedded as `Z` (UTC) — does the TZ shift line up? Currency-converted refund partial (refund in store currency vs CAD) — algorithm tests don't include FX. Multi-currency refund within one order. Pagination "exactly 50 pages" boundary (only `>50` tested at line 180). |
| 6 | `cronLive.ts` `effective_status` UPDATE logic | `inngest/functions/__tests__/cronLive.test.ts` (7), `cronLiveStatusRefresh.test.ts` (3), `cronLiveIsActiveForPlatform.test.ts` (24) | EDGE_RICH | `isActiveForPlatform` matrix is exhaustive. `cronLiveStatusRefresh` covers the rejection / `{error}` resilience well. Missing: no test that the past-row lookback window (lines ~1060–1103) correctly bounds dates (off-by-one risk). No test that `effective_status` UPDATE preserves rows when the campaign vanishes from `fetchMetaBudgets` (enrollment idempotency on drop). No test that two cron-live ticks within 10 minutes do not double-enroll a campaign for today. |
| 7 | `fetchers/{meta,googleAds,tiktok,fx}.ts` extraction + currency | `meta.test.ts` (26), `googleAds.test.ts` (9), `tiktok.test.ts` (5), `fx.test.ts` (5), `algorithm-parity.test.ts` (skipped) | meta=EDGE_RICH; google=HAPPY_ONLY+; tiktok=HAPPY_ONLY; fx=EDGE_RICH | TikTok: only 5 tests in `tiktok.test.ts` — no test for TikTok's `code !== 0` error envelope path, no test for empty `data.list`, no test for currency propagation through `fetchTikTokSpendForDay` when advertiser_info cache is cold vs warm (cache test is the `_resetAdvertiserInfoCacheForTesting` reset only). GoogleAds: 9 tests — no test for non-zero `customer.descriptiveCurrencyCode` mismatch with login customer. Cross-fetcher: no test that all 3 ad-platform fetchers handle missing currency field consistently (one falls back to USD, another to CAD?). `algorithm-parity.test.ts` is skipped by design — but means no automated drift detection against Sheets baseline. |
| 8 | Order attribution classifier (`shopify.ts:classifyOrderAttribution`) | `lib/fetchers/__tests__/shopify.test.ts` (within "fetchShopifyOrdersAttribution" — 6 cases), `lib/__tests__/orderSourceContract.test.ts` (4 — contract round-trip only) | EDGE_RICH | The ladder fbclid → gclid → utm → referring_site is partially covered (`tt-clickid`, `fbclid_present`, source-name priority, utm fallback). Missing: tie-break test when BOTH `fbclid` AND `gclid` are in the URL — which wins? (no explicit test). No test for malformed `landing_site` (missing `?`, invalid URL string, leading whitespace, percent-encoded UTMs). No test for `note_attributes` `_fbc` AND `_ga` both present. No test for case-sensitivity of `referring_site` (`Facebook.com` vs `facebook.com`). |
| 9 | `aiReport.ts` z-score / CV / momentum | `lib/__tests__/aiReportStoreId.test.ts` (3 — storeId filter ONLY) | NO_TESTS for statistics | Zero tests for the statistical computations inside `aiReport.ts` (2282 LOC; `medianMad`, mean/variance/stddev/CV at lines 373–377, momentum logic). The only test file targeting `aiReport.ts` (`aiReportStoreId.test.ts`) verifies storeId vs storeName filter regex matches on revenue strings — nothing about correctness of CV math, the platform-volatility table, momentum scoring, or the date-bucketing logic that decides which days enter each statistic. |
| 10 | `postgresReaders.ts` newest-row + `effective_status` triggers | `lib/__tests__/postgresReaders.test.ts` (11) | HAPPY_ONLY (for read semantics); newest-row + effective_status NO_TESTS | All 11 tests assert shape parity with sheets.ts (snake → camelCase). Missing entirely: no test for newest-row dedup logic (line 445 comment says "keep the row with the newest updatedAt" but no fixture pushes two rows for the same `(storeId, key)` pair and asserts the newer one wins). No test for the `effective_status` column read path at lines 599–644 (normalisation: trim, uppercase, null/undefined handling). No test for what happens when `effective_status` value is non-string (number or boolean from a misconfigured row). |

## Per-surface narrative

### 1. attributionAnalysis.ts (surface 1)
**Existing tests:** 6 files, 71 total `it(...)` cases — by far the densest coverage in the audit set. `analyzeAttribution.test.ts` is exemplary: tests WR-03/WR-04/IN-04 refund signedness regressions, Bayesian CI null cases (n<2, variance=0, spend=0), MAD outlier detection with NaN skipping, window stability downgrade. `computeWindowStability.test.ts` covers tail-bucket rules (IN5-03), σ verdict thresholds. `detectOutlierDays.test.ts` covers 7-day lookback semantics and MAD=0 fallback.
**Depth:** EDGE_RICH (closest to FULL of any audit surface).
**Critical gaps:**
- No numerical-agreement check that the Bayesian CI matches a Student-t reference for n in {2,3,5,10}. The single `low/high ≈ 2.1535/2.8465` assertion (lines 135–136) is a regression pin, not a math-correctness oracle. If the t-critical lookup table drifts by 1 row, the test still passes for n=5.
- Outlier reasons assert that the string contains `"MAD"` (b/HI-01 honesty pin) but do not assert the documented MAD multiplier (3× MAD) actually fires at that boundary — easy to bump the constant without breaking the test.
- No test for `analyzeAttribution` when `dailyMetaSeries` has duplicate dates (two entries for the same calendar day).

### 2. campaignHealthScore.ts (surface 2)
**Existing tests:** 62 tests in one file — covers grade derivation, insufficient gate at $30 + $100 boundaries, profitability source-of-truth priority (deterministic → combined → platform-claimed), per-platform pivots (Meta 3.0 / Google 3.5 / TikTok 2.0), trajectory tone mapping (4 buckets), trajectory renormalisation when `hasData=false`, attribution clarity fallbacks (unknown → 30, missing → 50), operator adjustments (+15/-30 with clamp), cohort adjustments (leader/weakest/cannibalisation × low/medium/high/composition_changed/insufficient with stacking and 2-member floor).
**Depth:** FULL.
**Critical gaps:**
- Trajectory renormalisation is tested with ONE missing component. No test asserts the renormalisation behaviour when 2+ optional components are missing simultaneously (trajectory missing AND no attribution).
- No test for `applyCohortHealthAdjustment` interaction with `operatorAdjustment` — base health and cohort delta clamp independently, but the order of operations is implicit.

### 3. cpmRoasAnalysis.ts (surface 3)
**Existing tests:** 30 tests across 2 files — covers 9 verdict combinations (UP/UP, UP/DOWN, etc.), 5-day threshold (incl. FIX-24/25 placeholder), CPM=0 day filter, mode reporting (`half-over-half` vs `previous-period`), prev-period delta math, calendar-offset pairing for the previous-period overlay (c/CR-01).
**Depth:** EDGE_RICH.
**Critical gaps:**
- No coverage of when `prev` series has all `roas=NaN` or all `cpm=NaN`.
- No assertion that the half-over-half delta is computed exactly per docs (no oracle, only direction).
- No test for the FLAT/UP verdict (the table covers flat/flat, flat/down, but not flat/up).

### 4. campaignProductMap.ts `allocateProductRevenue` (surface 4)
**Existing tests:** 8 dedicated `allocateProductRevenue` cases + 6 migration-helper cases. Covers deterministic + spend-fallback, fbclid/source/ttclid signals, no-orders fallback, refund-only product (CR-01), negative-remainder distribution, asymmetric cap skip when net<0 (CR-03), idempotent migration.
**Depth:** EDGE_RICH.
**Critical gaps:**
- Empty `campaignSpend` map with non-empty orders → spend-share computation. No test pins behaviour.
- Multi-platform deterministic signal on same order (fbclid AND gclid both present): no test asserts the deterministic precedence.
- No test for floating-point sum-to-target rounding (allocation sums must equal `productRevenue.netRevenueCad` within ε) across multiple campaigns.

### 5. fetchers/shopify.ts refund + `buildWindowUrl` + price-field selection (surface 5)
**Existing tests:** `shopify.test.ts` (19) covers full fetcher contract: TZ offset (`+03:00` regression Phase 05.7.6), 50-page pagination cap, Window A + Window B dedup, Window B open-ended to today (bug 2026-05-21), spy-asserts `computeRevenueWithCrossDayRefunds` called exactly once. `shopifyRevenueRefunds.test.ts` (9) covers 6 D-C3 invariants with real probe data + same-day-future-refund (Gap 2 / CR-02) + failed-transaction status filtering.
**Depth:** FULL (refund algorithm + fetcher wrapper).
**Critical gaps:**
- The 50-page cap is tested with 110 responses; the EXACT 50-page boundary is not isolated.
- No test for Shopify returning HTTP 429 / 5xx mid-pagination (resilience is asserted in cron-live's wrapper, not in the fetcher itself).
- No test asserts what happens when `total_price` is missing from the JSON payload (parse error path).

### 6. cronLive.ts `effective_status` UPDATE logic (surface 6)
**Existing tests:** 34 tests across 3 files — factory shape, rolling 3-day window, Shopify-only on light path, FX-failure don't-corrupt-CAD (a/WARN-3), per-ad-set sequential try/catch (HIGH-12 + HIGH-NEW-4), full TikTok status matrix (OPERATOR-1).
**Depth:** EDGE_RICH (single test surface across 3 files is consistently strong).
**Critical gaps:**
- The past-row backfill loop (lines 1060–1103 — `UPDATE effective_status` on past rows in lookback window) has NO direct test for the date boundaries. Off-by-one bug here would set `effective_status` on rows outside the lookback silently.
- Concurrency: two cron-live ticks 10 minutes apart could both try to enroll TODAY's placeholder row. No test pins idempotency (Supabase UPSERT semantics carry the load but aren't asserted).
- No test for what `refresh-effective-status` does when `fetchMetaBudgets` returns an empty `adSets` object (no current-day ad-sets) — does it correctly delete/null prior-day placeholders?

### 7. fetchers/{meta,googleAds,tiktok,fx}.ts (surface 7)
**Existing tests:** Meta=26, GoogleAds=9, TikTok=5, FX=5. Meta covers field mapping, conversion-priority chain, pagination, env-var error, budgets. GoogleAds covers store short-circuit, OAuth-then-GAQL sequence, cost_micros conversion, token cache. TikTok has the thinnest coverage of the four fetchers.
**Depth:** Meta=EDGE_RICH; Google=HAPPY_ONLY+; TikTok=HAPPY_ONLY; FX=EDGE_RICH.
**Critical gaps:**
- TikTok: no test for `code !== 0` error envelope (the entire `{code, message}` failure surface is uncovered). No test for the advertiser-info cache eviction (only the test reset helper is invoked). No test for currency normalisation when TikTok returns lowercase currency string.
- Cross-fetcher: no contract test that all 4 fetchers return a common `{ storeId, date, spend, currency }` shape — easy for one fetcher to drift in shape without anyone noticing.
- `algorithm-parity.test.ts` is `it.skip` by default. No automated baseline drift detection — the comment explicitly says manual-only.

### 8. Order attribution classifier (surface 8)
**Existing tests:** 6 cases inside `shopify.test.ts` cover fbclid via landing_site, `source_name=fb`/`google`, unknown utm_source → `other-paid`, tiktok 3 paths, `referring_site facebook.com → meta-organic`, voided/test order filter, line-item subtotal allocation, `note_attributes._fbc → meta-paid`. `orderSourceContract.test.ts` 4 cases assert writer↔reader round-trip via `parseSource` only.
**Depth:** EDGE_RICH for the priority ladder; HAPPY_ONLY for input variation.
**Critical gaps:**
- No test for tie-break when both fbclid AND gclid present in the same URL.
- No test for `landing_site` percent-encoded UTMs (`%2C` separators, multibyte chars).
- No test for case-insensitivity of `referring_site` host comparison (`Facebook.com` vs `facebook.com` vs `m.facebook.com` vs `l.facebook.com`).
- No test for `note_attributes` with both `_fbc` AND `_gcl_aw` set.

### 9. aiReport.ts statistical computations (surface 9)
**Existing tests:** 3 tests in `aiReportStoreId.test.ts` — ALL three exercise the storeId vs storeName filter via regex on rendered markdown strings. The `it.skip` algorithm-parity test does not cover aiReport.
**Depth:** NO_TESTS for statistics (statistical surface is 2282 LOC with `medianMad`, mean/variance/stddev/CV calculations, momentum sections — none directly asserted).
**Critical gaps:**
- Zero coverage of `medianMad`, mean/variance/stddev/CV math at lines 373–377.
- Zero coverage of the CV-threshold buckets that drive the "noisy / steady / mixed" labels in the platform-volatility table.
- Zero coverage of momentum scoring or how the AI report selects which days enter each statistic (date-bucketing logic).
- The only existing test asserts presence of revenue strings in rendered markdown; it cannot detect a numerical regression in the statistics section.
- This is the single largest coverage gap in the audit set. ~700 LOC of report-shaping logic depends on these unguarded statistics.

### 10. postgresReaders.ts newest-row + `effective_status` triggers (surface 10)
**Existing tests:** 11 tests in `postgresReaders.test.ts` — all about snake_case → camelCase shape parity for 8 readers. Mocks `getSupabase().from()` chain.
**Depth:** HAPPY_ONLY (shape parity); NO_TESTS for newest-row semantics or `effective_status` normalisation triggers.
**Critical gaps:**
- Comment at line 445 ("Match sheets.ts dedup: keep the row with the newest updatedAt") is UNGUARDED. No fixture feeds two rows for the same key and asserts the newer wins.
- `effective_status` normalisation at lines 599–644 (trim + uppercase + null/undefined → null) is untested.
- No test for what happens when Supabase returns `data: null, error: null` (empty result set with no error) — does the reader return `[]` or throw?

## Cross-surface observations
- **Test-file ownership is good for most surfaces.** Surfaces 1, 2, 3, 5, 6 each have dedicated test files matching the source. Cross-coverage is minimal (e.g. `campaignHealthScore.test.ts` references `CpmRoasAnalysis` only via type — does not re-test surface 3's math).
- **One surface (9 — `aiReport.ts`) is effectively untested** beyond a 3-test storeId filter assertion. That is the single largest hole in the audit set.
- **One surface (10) is HAPPY_ONLY** for its own concerns — newest-row dedup + effective_status normalisation triggers have no test coverage.
- **Tooling gaps:**
  - `algorithm-parity.test.ts` is `it.skip` by design — no automated drift detection against the frozen Sheets baseline, so a TS fetcher could silently diverge by >5% and CI would never know.
  - No contract test enforcing common `{ storeId, date, spend, currency }` shape across all 4 ad-platform fetchers.
  - No integration test for cron-live × Supabase (mocks only). The full pipeline cron-live → Supabase upsert → postgresReaders read is exercised piecewise but never end-to-end.
  - Inngest test files (`src/inngest/functions/__tests__/`) are NOT picked up by the default vitest glob (`src/lib/**/__tests__`). Documented at `cronLive.test.ts:27` — must be run with explicit path. Easy to forget on a casual `npm test`.

## Top 5 gaps that should block "verification" of any surface
1. **aiReport.ts statistics are completely untested** — surface 9 has zero coverage of medianMad / stddev / CV / momentum. ~700 LOC of operator-facing report math has no test oracle.
2. **postgresReaders.ts newest-row dedup is unguarded** — the load-bearing claim that the reader keeps the row with newest `updatedAt` has no fixture-driven assertion.
3. **`effective_status` past-row backfill loop in cronLive.ts** (lines 1060–1103) has no direct date-boundary test — off-by-one would silently corrupt the `off-chip` truth source.
4. **TikTok fetcher coverage is thin** (5 tests, no error-envelope path) — the most operator-volatile platform is the least-tested fetcher.
5. **`algorithm-parity.test.ts` is `it.skip` by default** — no automated drift detection against Sheets baseline. The very gate that should fire when a fetcher drifts from the Apps Script port is permanently off.
