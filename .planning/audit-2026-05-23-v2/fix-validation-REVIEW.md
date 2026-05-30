---
audit: fix-validation pass over 22 commits (a3f38eb..48a377e)
reviewed: 2026-05-23
scope: validate each fix actually addresses its stated audit finding and check for regressions
verdict: MOSTLY SOLID — 17 of 22 commits landed clean; 1 BLOCKER (per-store COGS defeated by cron-live); 4 partial / needs-follow-up
findings:
  blocker: 1
  warning: 6
  info: 5
  total: 12
---

# Fix-validation Review — 2026-05-23 (v2 pass)

## Summary

Overall the 22-commit batch is high quality. The hardest fixes (the CRITICAL-01/02 + HIGH-01 multi-mapping suite, the cron-live 3-day refresh, the refund-only negative-remainder allocator) are correctly implemented with tests that exercise the audit's exact scenarios. Display-fidelity fixes (FIND-01, FIND-02, FIND-04, FIND-05, FIND-07) all match the audit findings and have either direct tests or are simple enough that the code review confirms the fix.

**One BLOCKER** was introduced (or rather, not addressed) by the per-store COGS fix (commit `dc7a5f0`): the cron-live function still uses the hardcoded `COGS_RATE = 0.25` and writes `cogs_cad` to `data_daily` on every 10-min tick across the rolling 3-day window. So even after the operator sets `ZOLPLUS_COGS_RATE=0.30`, the correct value lasts ~10 minutes before the next cron-live tick overwrites it. The per-store COGS fix is effectively zero-impact in production until cron-live also reads the same env var.

**Partial/regression-risk findings:**
1. WhatsApp HR-04 fix only throws when **all** recipients fail — partial failure (1 of 2) still surfaces no Inngest signal (acknowledged trade-off but doesn't match the audit's stated recommendation).
2. cron-daily soft-fail (commit `11161e8`) has **no regression tests** for the new platform-failure branches — the test harness has a `throwIn` hook for `shopify/merge/upsert` but no `throwIn = 'meta'/'google'/'tiktok'` test.
3. cron-live's pre-existing `.catch(() => 1)` FX failure substitution (MD-06 from data-pipeline audit, intentionally out of v2 scope) is now amplified by the 3-day refresh — a brief Frankfurter blip can clobber 3 days × 3 stores × 6 ticks of Meta ILS spend with rate=1 (3.6× under-conversion) instead of just today.
4. AI Report HR-08 (storeName vs storeId comparison) was NOT in v2 scope but the new multi-mapping section in `aiReport.ts:1781` inherits the same `c.storeName === storeFilterId` filter — bug persists.

## Per-commit verdict

| # | Commit | Audit finding | Verdict | Evidence |
|---|--------|---------------|---------|----------|
| 1 | `980d6fa` | FIND-01 (summary totals + multi-mapped) + FIND-14 | landed correctly | `CampaignsTable.tsx:660` iterates `aggregatedFiltered`; `:681` deps updated; `:886-887` `attributionGap` correctly hidden when `showOnlyMultiMapped` (good defensive add); `:1145` toolbar count switches |
| 2 | `693b571` | FIND-02 (reconciliation TikTok exclusion) | landed correctly | `MetaShopifyReconciliation.tsx:364` `sumChannels` now `+ s.tiktok`; `:794` `channelTotal` same; new `<th>`/`<td>` for TikTok added at `:783, :807` |
| 3 | `97c7cee` | HIGH-02 (`isWeakest` gate cohortSize≥3) | landed correctly | `multiMappingCohort.ts:285` `totalMembers >= 3 && currentRank === totalMembers`; UI at `CohortComparisonPanel.tsx:307, 314` gates red tone on `intraCount >= 3`; tests at `multiMappingCohort.test.ts:558+` |
| 4 | `e4312dc` | CR-02 health (WhatsApp store ordering) | landed correctly | `templateParams.ts:142-146` sorts by `storeName.localeCompare`; 5 new tests in `templateParams.test.ts:48-110` pin determinism + padding |
| 5 | `a7c72dc` | FIND-04 (Infinity pill) + FIND-07 (-0) | landed correctly | `utils.ts:21-23` normalizes -0 by rounding-then-checking; `HeroOverview.tsx:396-398` IIFE returns "—" when positive list is empty; tests at `utils.test.ts:112-118` |
| 6 | `1e3acae` | FIND-05 (loading indicator) | landed correctly | `TodayLive.tsx:313, 402` use `'…'`; `PerStoreCards.tsx:162` same; small but operator-facing fix |
| 7 | `b00a23b` | CRITICAL-02 (ranking floor) | landed correctly | `multiMappingCohort.ts:138-146` Bayesian shrinkage at $500 anchor; test at `multiMappingCohort.test.ts:257-287` pins audit's exact scenario ($40/ROAS-12 vs $20K/ROAS-4); mature now wins |
| 8 | `d17cf4c` | CRITICAL-01 (drawer cohort real ROAS) | landed correctly | `CampaignDrawer.tsx:503-571` runs full `allocateProductRevenue` over drawer-fetched data; primary uses `info.revenue/spend`, secondary uses `info.deterministicRevenue/spend` (real platform-only ROAS, now differs from primary as JSDoc promised) |
| 9 | `5a0bd92` | HIGH-01 (table tie-breaker wiring) | landed correctly | `CampaignsTable.tsx:563-566` builds real `roasShopifyPlatformByKey` from `info.deterministicRevenue/info.spend`; passed at `:600` |
| 10 | `ae02d41` | CR-01 health (AI Report multi-mapping) | landed correctly with caveat | `aiReport.ts:1822-1832` calls `allocateProductRevenue` per-(store,product); renders 2 columns ("דטרמיניסטית" + "סה"כ"). CAVEAT: line 1781 still uses pre-existing storeName comparison (HR-08 unaddressed; not in v2 scope) |
| 11 | `54450ee` | docs sync | landed correctly | User Manual updated with new deterministic-then-fallback explanation + worked example |
| 12 | `953a32e` | CR-01/CR-02/CR-03 revenue (refund-only) | landed correctly | `useCampaignTrueRevenue.ts:281` `=== 0 && === 0`; `campaignProductMap.ts:319` same; `:463-465` drops `Math.max(0, ...)` on remRev; cap gated on `p.netRevenueCad >= 0` at `:358, 378`; 4 new tests including the exact CR-01 scenario (det $50 + refund $200 → -$150) |
| 13 | `85d6c74` | HIGH-03 (composition_changed verdict) | landed correctly | `cannibalizationDetection.ts:349-401` adds the new verdict + materiality (20%) + active-days (3) guards; 4 new tests including the stable-composition HIGH regression guard |
| 14 | `7d8ae9a` | CR-01 pipeline (GAQL pagination) | landed correctly | `googleAds.ts:295-339` `runGaqlQuery` now iterates `nextPageToken` with 50-page cap + warn-on-cap-with-token |
| 15 | `df53aa1` | CR-02 pipeline (cron-live 3-day spend) | landed correctly | `cronLive.ts:516-583` fetches all 9 (or fewer per platform-gating) spend points per tick; `:692-698` correctly nullish-coalesces per-platform with prior values; test pinned at `cronLive.test.ts:318-327` |
| 16 | `11161e8` | HG-01 pipeline (cron-daily soft-fail) | landed correctly, weak tests | `cronDaily.ts:269-371` wraps Meta/Google/TikTok in try/catch with zero-spend sentinels. **Test gap: NO regression test for `throwIn='meta'`/`'google'`/`'tiktok'`** — only shopify/merge/upsert throws are tested. See WARNING-2. |
| 17 | `3a73e9d` | HR-04 (send-failure) + HR-05 (allowlist) | partially fixed | HR-05 allowlist correctly wired in `whatsapp.ts:93-130`; HR-04 only throws when **all** recipients fail (`sendDailySummary.ts:110-121`). The audit recommended throwing on any failure to surface partial-failure typos. Comment at :100-109 acknowledges the trade-off but the typo-fanned-to-stranger scenario (HR-05's motivating example) is still silently caught. See WARNING-3. |
| 18 | `75201c7` | HR-01 + HR-02 (per-platform pivots) | landed correctly | `campaignHealthScore.ts:136-141` `PLATFORM_ROAS_PIVOT` (Meta=3.0, Google=3.5, TikTok=2.0); `:161-165` `PLATFORM_FALLBACK_TRUST` (Meta=0.5, Google=0.7, TikTok=0.5); reads `aggregated.platform` at `:238, :247`; 4 new tests pin the exact scenarios |
| 19 | `7a1b18d` | HR-03 (trajectory renormalization) | landed correctly | `campaignHealthScore.ts:424-441` if `hasTrajectoryData=false`, renormalizes the other 3 weights via `scaleFactor = 1/0.75`; `:488` test asserts no-trajectory campaign with perfect other components scores 100 (not 90); component still reports the raw 60 for UI |
| 20 | `27113d4` | HIGH-04 (LOW threshold raise) | landed correctly | `cannibalizationDetection.ts:436-438` `spendGrowthPct >= 0.20 && ... && (lateSpend - earlySpend) >= 50`; cascade verified: 15%/8% scenario correctly falls to NONE; 2 new tests pin the new threshold + $50 floor |
| 21 | `dc7a5f0` | MR-01 (per-store COGS env var) | **PARTIALLY FIXED — BLOCKER** | `cronDaily.ts:109-121` `getCogsRateForStore` reads env var; used at `:417` for `cogsCad`. **BUT** `cronLive.ts:165` still hardcodes `const COGS_RATE = 0.25` and **always writes `cogs_cad` to data_daily on every 10-min tick** (`cronLive.ts:336`). Every 10 min, cron-live overwrites cron-daily's correct per-store COGS with the global 0.25 × revenue. See BLOCKER. |
| 22 | `48a377e` | CR-03 (AI Report Health Score disclaimer) | landed correctly | `aiReport.ts:1220-1227` disclaimer placed between header and score table; explicitly names the dashboard as source of truth |

## Findings — detailed

### BLOCKER-1 — Per-store COGS fix is defeated by cron-live within 10 minutes

**Files:** `dashboard-web/src/inngest/functions/cronLive.ts:165` + `:292` + `:336`
**Commit chain:** `dc7a5f0` (the supposed fix) only touched `cronDaily.ts`.
**Severity:** BLOCKER — the operator-visible "net profit" headline number stays wrong for non-default stores.

**Evidence:**
- `cronLive.ts:165` `const COGS_RATE = 0.25;` — hardcoded constant, no `getCogsRateForStore` call
- `cronLive.ts:292` `const cogs = revenueCad * COGS_RATE;` — uses the hardcoded constant
- `cronLive.ts:336` `cogs_cad: cogs,` — **always** in the UPSERT payload, regardless of `spendOverride` state

**Failure mode:**
1. Operator sets `ZOLPLUS_COGS_RATE=0.30` in Vercel env.
2. cron-daily runs at 00:05 IL, writes `cogs_cad = revenue × 0.30` correctly. ✓
3. cron-live runs at 00:15 IL, sees zolplus's `data_daily` row, computes `cogs = revenue × 0.25`, writes that value to `cogs_cad`. ✗
4. Dashboard's "Net Profit" cell now shows the wrong COGS until next cron-daily (24h later).
5. Every cron-live tick (every 10 min) re-clobbers the row for the full rolling 3-day window.

**Fix:** Mirror `getCogsRateForStore` into cronLive.ts (or extract to a shared module). Replace `COGS_RATE` constant with a `getCogsRateForStore(storeId)` call at line 292.

### WARNING-1 — cron-daily soft-fail has no regression tests for the platform-failure branches

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:269-371` + `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`
**Severity:** WARNING — silent regression risk; future refactor could re-introduce the all-or-nothing failure mode unnoticed.

**Evidence:** The commit (`11161e8`) wraps `fetch-meta` / `fetch-google` / `fetch-tiktok` in try/catch. The test harness has `mockState.throwIn` hook, but only `'shopify'`, `'merge'`, `'upsert'` are exercised in Test 6 (cronDaily.test.ts:745-757). **No test pins:**
- "When fetch-meta throws (token expiry), Shopify + Google + TikTok still persist to data_daily"
- "When fetch-tiktok throws on uzoshop, Meta + Google + Shopify still land"
- "Two simultaneous platform failures: zero-spend sentinels applied to both"

**Fix:** Add 3 tests to cronDaily.test.ts that set `throwIn = 'meta' | 'google' | 'tiktok'` and assert (a) `runDailyForStore` doesn't throw, (b) `data_daily` UPSERT was called, (c) the failed platform's spend column is 0.

### WARNING-2 — HR-04 fix does not match audit recommendation; partial-failure still silent

**File:** `dashboard-web/src/lib/notifications/sendDailySummary.ts:110-121`
**Severity:** WARNING — operator may still not notice a typo'd second phone number that's silently fanning out daily messages.

**Evidence:** The audit's stated fix (health-and-conclusions-REVIEW.md HR-04) recommends throwing when `result.recipientsFailed.length > 0`. The implementation throws only when `recipientsSucceeded.length === 0 && recipientsFailed.length > 0` (i.e., complete failure). The commit comment at :100-109 explicitly acknowledges this divergence ("don't want to mask the success in Inngest"), but the audit's stated motivating scenario was a typo'd `phone2` silently fanning to a stranger — that scenario produces `succeeded=[phone1], failed=[stranger]`, which won't throw.

**Mitigation:** The HR-05 allowlist (same commit) catches the typo case **if** the operator sets `NOTIFICATION_RECIPIENT_ALLOWLIST`. Without that env var (back-compat default), the partial-failure silence remains.

**Fix:** Either (a) change to throw on any failure (matches audit), or (b) document the intentional partial-success behavior more loudly in the operator-facing /operator UI ("partial-recipient failures are silently logged; check Inngest run output").

### WARNING-3 — Cron-live FX `.catch(() => 1)` regression amplified by 3-day refresh

**File:** `dashboard-web/src/inngest/functions/cronLive.ts:525-529`
**Severity:** WARNING — pre-existing bug (MD-06 from data-pipeline audit, intentionally out of v2 scope), but the v2 fix made the failure surface area 3× larger.

**Evidence:** `getFxRate(...).catch(() => 1)` means rate=1 substituted on Frankfurter failure → ILS spend treated as CAD (3.6× under-conversion). Pre-`df53aa1`, this only affected today. Post-`df53aa1`, a single Frankfurter blip can clobber 3 days × 3 stores × every 10-min tick with under-converted Meta values. Until cron-daily 00:05 IL fixes it (24h).

**Fix:** Replace `.catch(() => 1)` with `.catch(() => null)` and skip the spend update for that platform/date on FX failure. The persist step's existing nullish-coalesce will preserve the prior value (`priorFb`, etc.).

### WARNING-4 — AI Report HR-08 (storeName vs storeId) NOT addressed by ae02d41

**File:** `dashboard-web/src/lib/aiReport.ts:1781`
**Severity:** WARNING — pre-existing audit finding (HR-08) that the new multi-mapping section inherits.

**Evidence:** `storeMatches = campaigns.some(c => c.storeId === keyStoreId && c.storeName === storeFilterId)`. The storeFilter is a `storeName` (e.g., "Zol Plus"), so the filter requires both `storeId` AND `storeName` match. For uzoshop, storeName === storeId, so the filter works by coincidence. For zolplus (`storeName = "Zol Plus"`) and usmile360 (`storeName = "360usmile"`), the comparison may fail silently if the operator's filter value doesn't exactly match the DB's `storeName` string (whitespace, casing, etc.).

This was not in the v2 commit scope (HR-08 is HIGH but not in the consolidated 22-commit list), so the persistence is expected — but the new multi-mapping section uses the same comparison, so the fix carried the bug forward.

**Fix:** Thread `storeId` through to the AI Report (not `storeName`), then compare `c.storeId === storeId` directly.

### WARNING-5 — Cron-live test (Test 5) doesn't assert TikTok fetch count

**File:** `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts:318-327`
**Severity:** WARNING — code is correct (TikTok branch in `cronLive.ts:558-570` fetches 3 times for uzoshop), but test only validates 6 of the 9 fetches (Meta × 3 + Google × 3). TikTok's 3 calls aren't pinned.

**Evidence:** Test 5 uses `vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight')` and `vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay')`, asserts `.toHaveBeenCalledTimes(3)` for each. No `vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay')`. The stdout log during test run shows TikTok 401 errors (no env vars in test) for 3 dates × uzoshop, confirming the code path runs, but a future refactor could silently disable TikTok refresh without tripping the test.

**Fix:** Add `const tiktokSpy = vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue(...)` and `expect(tiktokSpy).toHaveBeenCalledTimes(3)`.

### WARNING-6 — Composition_changed verdict not handled by cohort health adjustment

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:496` + `dashboard-web/src/components/CampaignsTable.tsx:608`
**Severity:** WARNING — silent type-narrowing; cohort adjustments still happen but treat composition_changed as `'none'`.

**Evidence:** `applyCohortHealthAdjustment` type signature uses `cannibalizationRisk: 'none' | 'low' | 'medium' | 'high' | 'insufficient'` — explicitly does NOT include the new `'composition_changed'` verdict. The consumer in `CampaignsTable.tsx:608` declares `let worstRisk: 'none' | 'low' | 'medium' | 'high' | 'insufficient' = 'none'` and never assigns `'composition_changed'` (it only branches on high/medium/low). So a campaign that's flagged composition_changed gets cannibalizationRisk = 'none' for health-score purposes — defensible (we can't measure cannibalization without composition stability), but worth documenting.

**Fix:** Add `'composition_changed'` to the type signature and a comment in `applyCohortHealthAdjustment` clarifying the intentional pass-through (no points deducted; surface the verdict via UI banner only).

## INFO findings

### INFO-1 — Commit message example uses `360USMILE_COGS_RATE` but actual storeId is `usmile360`

**File:** `dashboard-web/src/inngest/functions/cronDaily.ts:103` (commit message + JSDoc)
**Severity:** INFO — code is correct (`getCogsRateForStore('usmile360')` produces `USMILE360_COGS_RATE`); only the docstring's example is misleading.

**Evidence:** Comment at `cronDaily.ts:103` shows `360USMILE_COGS_RATE=0.18` as an example. The actual storeId is `usmile360` (see `cronDaily.ts:77` `STORES = ['uzoshop', 'zolplus', 'usmile360']`), so the env var name would be `USMILE360_COGS_RATE`. An operator copying the example would set the wrong env var.

**Fix:** Update the docstring example to `USMILE360_COGS_RATE=0.18`.

### INFO-2 — Bayesian shrinkage formula produces -1 for refund-heavy negative-ROAS campaigns; ranking is unstable in this region

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:142-146`
**Severity:** INFO — edge case; refund-heavy negative-ROAS campaigns are rare but the ranking formula is mathematically defined.

**Evidence:** For a $1000 spend campaign with true ROAS = -2 (heavy refunds), `shrinkRoas(-2, 1000)` produces `-2 * 0.667 + 1 * 0.333 = -1`. A separate $1 spend campaign with ROAS=0 produces `0 * 0.002 + 1 * 0.998 = 0.998`. The tiny campaign ranks above the refund-heavy one. This is **arguably correct** (zero is closer to break-even than negative) but worth flagging — the existing tests don't cover negative-ROAS scenarios.

**Fix:** Add a test pinning negative-ROAS behavior; consider clamping at 0 to avoid the tiny-positive-beats-mature-negative inversion.

### INFO-3 — Audit's "5+ member cohort with 2 material members" edge case not tested

**File:** `dashboard-web/src/lib/__tests__/cannibalizationDetection.test.ts:569-665`
**Severity:** INFO — composition_changed tests cover 2-member cohorts only. The audit prompt explicitly asked: *"does the 20% materiality threshold work when cohort has 5+ members and only 2 are material?"*

**Evidence:** Tests at lines 569-665 use `c1 + c2` cohorts. No test with 5 cohort members where only 2 are material. The implementation should handle this correctly (the materiality check iterates each member independently, line 350-371 in `cannibalizationDetection.ts`), but no regression guard exists.

**Fix:** Add a 5-member cohort test where c1+c2 are material (>20% share) and c3-c5 are <5% share each, with one material member paused mid-range — assert composition_changed fires.

### INFO-4 — AI Report multi-mapping section drops products with zero sales in range silently

**File:** `dashboard-web/src/lib/aiReport.ts:1816`
**Severity:** INFO — `if (!productInfo) continue;` correctly drops products with no in-range Shopify sales, matching the dashboard's behavior. No bug, but worth surfacing: a product mapped to 2 campaigns but with 0 sales today won't appear in the AI report's multi-mapping section even though the operator may have asked the AI to analyze why.

**Fix:** Optional — add a "_(N additional multi-mapped products had no Shopify sales in range)_" footer when products are silently dropped.

### INFO-5 — Cron-live test (Test 5) test log shows TikTok creds errors during the run

**File:** `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts` runtime stderr
**Severity:** INFO — cosmetic; tests pass but stderr is noisy. The TikTok creds error fires 3 times per test (3 dates × uzoshop), polluting test output. Test framework correctly swallows the errors via `.catch()` in cron-live.

**Fix:** Add a `vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay')` mock to the existing test so the stderr is quiet AND the TikTok fetch is now pinned (addresses WARNING-5 too).

## Edge cases the audit prompt called out — verdicts

### Refund-only rows fix (T2.4 / `953a32e`)

- **All mapped campaigns have zero spend:** `share = 1/mappedKeys.length` correctly distributes negative remainder equally (line 470-473 of campaignProductMap.ts). ✓
- **mappedKeys has exactly 1 member:** `share = 1/1 = 1.0`, single campaign gets full negative remainder. Tested at `campaignProductMap.test.ts:296-313`. ✓
- **The cap also fires:** Cap is gated on `p.netRevenueCad >= 0` (line 358, 378), so for negative-net products the cap is skipped and remRev correctly absorbs the negative. For positive-net products where cap fires, totalDetRev = p.netRevenueCad, so remRev = 0 and distribution skipped. ✓

### Cron-live 3-day fix (T3.2 / `df53aa1`)

- **9 fetches actually trigger:** YES for uzoshop (`STORES_WITH_TIKTOK` includes it). For zolplus/usmile360, TikTok branch is skipped (3 Meta + 0 TikTok = 3 actual HTTP calls — Google is also short-circuited for non-Google stores). ✓ But test only verifies 6/9 (see WARNING-5).
- **Per-platform preserve when TWO platforms fail same date:** YES. Lines 692-698: each `dateSpend.X ?? priorX` reads from the same `data_daily` row fetched at line 683-688. Both nulls fall back to prior values; the persist still runs with the merged payload. ✓

### Bayesian shrinkage (T2.1 / `b00a23b`)

- **spend ≤ 0:** Returns 1.0 (break-even). ✓
- **Negative ROAS:** Mathematically defined (e.g., `shrinkRoas(-2, 1000) = -1`), correctly ranks below zero-ROAS, but the tertiary spend tiebreaker can produce inversions with tiny-spend zero-ROAS campaigns. See INFO-2.

### Cohort panel ROAS rewire (T2.2 / `d17cf4c`)

- **Allocator runs on every drawer open or just on mount?** The `cohort` useMemo (line 482) has deps `[summary, ...]` — it recomputes when the drawer's data changes (which is per drawer open). NOT once on mount; this is correct (data freshness wins over perf). Performance: pure CPU pass over in-memory data, negligible.

### AI Report multi-mapping (T2.3 / `ae02d41`)

- **Products in 2 stores:** Yes — `productCampaignsByStore` is keyed by storeId (line 1772-1796), so a product in 2 stores becomes 2 separate entries. ✓
- **Filter consistency with parent:** The `productsByStore` for ai report is built from `products` (which IS filtered to storeFilter at line 103). But `ordersByStore` is built from `ordersRows` (the unfiltered version at line 1753). Different sources but allocator only consumes the storeId-keyed bucket — no cross-store contamination. Asymmetric but not buggy. See WARNING-4 (HR-08 persists).

### composition_changed (T2.5 / `85d6c74`)

- **20% materiality with 5+ members and only 2 material:** Untested. Implementation should handle correctly (per-member check), but no regression guard. See INFO-3.

### per-platform pivots (T4.1 / `75201c7`)

- **Per-campaign vs per-cohort:** Per-campaign. `PLATFORM_ROAS_PIVOT[aggregated.platform]` reads from the campaign's own platform (`scoreProfitability` line 247). Cohort adjustment in `applyCohortHealthAdjustment` is platform-agnostic (fixed delta amounts). Correct.

### Trajectory renormalization (T4.3 / `7a1b18d`)

- **Interaction with cohort adjustment:** Cohort adjustment is applied AFTER weighted-subtotal computation (`applyCohortHealthAdjustment` is a separate function called by the table after `computeCampaignHealth`). Renormalization happens inside `computeCampaignHealth` only when `hasTrajectoryData=false`. They don't conflict; the cohort adjustment's ±delta applies to whatever weighted-subtotal was computed. ✓

### LOW threshold raise (T4.5 / `27113d4`)

- **15% spend / 8% rev cascade:** Falls through HIGH (false), MEDIUM (false: 0.08 >= spend/2 = 0.075), LOW (false: spend < 0.20), to NONE. ✓
- **15% spend / 6% rev:** MEDIUM fires (0.06 < 0.075). ✓ MEDIUM threshold preserved.
- **$50 absolute floor:** Tested at `cannibalizationDetection.test.ts:296-318` ✓

## Regressions found

1. **BLOCKER-1** (per-store COGS defeated by cron-live) is the only true regression introduced by the v2 batch — it makes a previously-fictional bug (the COGS rate was always wrong globally) into a "fixed in one place, broken in another" inconsistency that's harder to debug.

2. **WARNING-3** (FX 3.6× under-conversion amplified by 3-day refresh) is technically not a v2-introduced regression but the surface area is now 3× larger.

3. No other regressions found. All 622 existing tests pass; tsc clean.

## What's solid

- The CRITICAL-01 + CRITICAL-02 + HIGH-01 multi-mapping fix suite (commits `b00a23b`, `d17cf4c`, `5a0bd92`) is exemplary work: tests pin the audit's exact scenarios, the deterministic-only-ROAS now actually differs from the combined ROAS in production (the secondary tie-breaker is no longer a no-op), and the Bayesian shrinkage formula correctly handles the audit's worked example ($40 + ROAS-12 vs $20K + ROAS-4 → mature wins by `3.93 vs 1.86` shrunk scores).
- The refund-only fix suite (`953a32e`) is the cleanest implementation in the batch: 4 tests cover the audit's specific failure modes including the sign-flip cap bug; the gating on `p.netRevenueCad >= 0` correctly preserves positive deterministic during negative-net distribution; mass conservation invariant holds.
- The composition_changed verdict (`85d6c74`) adds a new risk category cleanly through the type system AND adds a separate UI banner (verified visually via grep), with proper test coverage for the audit's two false-NONE/false-HIGH scenarios.
- The AI Report multi-mapping fix (`ae02d41`) correctly threads `allocateProductRevenue` through per-(store, product), producing the same number the dashboard's per-row "ROAS Shopify" column shows. The user-manual sync (`54450ee`) keeps documentation aligned.
- The cron-live 3-day refresh (`df53aa1`) is well-tested for the Meta/Google fetch counts and per-platform-preserve semantics. The 9-fetch quota envelope is documented and well under each platform's rate limit.
- The display-fidelity fixes (FIND-01, FIND-02, FIND-04, FIND-05, FIND-07, FIND-14) are all small and operator-facing; each addresses its audit finding directly with appropriate tests where applicable.
- The Google Ads pagination fix (`7d8ae9a`) is the right shape (token loop with cap + warn) and addresses the audit's stated silent-data-loss landmine.
- The per-platform health-score calibration (`75201c7` + `7a1b18d`) is principled — it makes the score finally make sense across platforms (Google PMax no longer halved; TikTok prospecting no longer penalized vs Meta retargeting) and renormalizes weights when trajectory has no data (new-campaign A-grade inflation gone).

## Recommended follow-up order

1. **BLOCKER:** Fix cron-live COGS rate (mirror `getCogsRateForStore` from cron-daily). 5-line fix; without it, the per-store COGS env vars are write-only-to-Vercel.
2. **WARNING-1:** Add 3 regression tests to cronDaily.test.ts pinning the soft-fail behavior for meta/google/tiktok throws. Without them, the fix can silently regress.
3. **WARNING-3:** Replace `.catch(() => 1)` with `.catch(() => null)` + skip-on-null in cron-live FX path. Addresses MD-06 from data-pipeline audit AND closes the 3-day amplification window.
4. **WARNING-5:** Add TikTok spy to cron-live Test 5 to lock the 9-fetch promise (+ silences stderr noise — addresses INFO-5).
5. **WARNING-2 (HR-04):** Decide whether the audit's "throw on any failure" was the right call. If yes, change the gate in `sendDailySummary.ts:110` to `recipientsFailed.length > 0`. If no, document the trade-off in the operator-facing /operator UI.
6. **WARNING-4 (HR-08):** Address the storeName-vs-storeId comparison in `aiReport.ts:1781` (and the parent-scope filter at line 99-118).
7. **INFO-1:** Fix the commit's docstring example to use the real `USMILE360_COGS_RATE` env var name.
8. **INFO-3:** Add the 5-member cohort composition_changed test.
9. **INFO-2:** Decide if the Bayesian shrinkage should clamp at 0 (avoid tiny-zero-beats-mature-negative inversion).
10. **WARNING-6:** Add `'composition_changed'` to the cohort adjustment type and document the intentional pass-through.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (gsd-code-reviewer, adversarial fix-validation pass)_
_Depth: deep (read full source at HEAD for each fix; cross-referenced against original audit findings; verified tests actually exercise the new behavior; checked downstream consumers for regressions; ran full test suite + tsc)_
_Test status: 622 passed | 12 skipped | 0 failures; tsc clean_
