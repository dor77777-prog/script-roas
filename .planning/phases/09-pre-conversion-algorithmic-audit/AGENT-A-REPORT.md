# Agent A — Math + Edge Cases Verdict
Date: 2026-05-24 · Reviewer: gsd-code-reviewer (Opus 4.7)
Baseline: 6f71f7543026d1bc18e705ef41c2010b9c1e18ec (HEAD)

Note: surface 1 is actually `attributionAnalysis.ts` (the spec's path
`analyzeAttribution.ts` is wrong — see Cross-surface observation 1).

## Verdicts

### 1. attributionAnalysis.ts (≈1156 LOC)
**Status:** ⚠️ Uncertain (mostly ✅, two specific concerns)

**Evidence / Reasoning:**
- Tunable constants are hoisted (lines 33–60). Bessel correction (N–1) is
  applied in both code paths (`attributionAnalysis.ts:356` and `:861`).
- `computeCoverage` (line 143) handles all three input regimes: `metaClaim > 0`
  (clamp to [−∞, 2]), `metaClaim < 0` (return 0), `metaClaim == 0` (legacy
  fallback). Negative `deterministicRevenue` propagates through clamp, which is
  what TEST-03 requires.
- WR-03 clamp on visible trust score (`safePct = Math.max(0, pct)`,
  `:488` and `:937`) prevents negative scores from leaking to UI.
- `computeWindowStability` uses POPULATION variance (`/coverages.length` at
  `:622`) — not Bessel-corrected. This is INCONSISTENT with the AOV CI math
  in `analyzeAttribution` (which uses `/(n-1)`) but defensible: the windows
  are not random samples from a distribution; they are exhaustive coverage of
  the range. Calling out as a documentation gap, not a bug.
- `detectOutlierDays` uses a non-causal trailing window: `sorted.slice(Math.max(0, i - OUTLIER_LOOKBACK_DAYS), i)` (`:645`) is the prior `i` days excluding day `i`. Correct.

**Issues found (⚠️):**

1. **σ presented as fraction × 100 in tooltips is fine, but `windowStability.verdict='mixed'` is NEVER surfaced to the operator** — `:511–525` only emits messages for `'stable'` and `'volatile'`; the silent `'mixed'` swallow is a UX gap, not a math bug. Flag as design.
2. **Coverage clamp at `COVERAGE_UPPER_CLAMP = 2`** (`:60`, `:617`) is consistent BUT means halo > 2x is silently capped, masking truly anomalous halo orders. Documented by line 70 ("upper clamp prevents one freak day from blowing the trust ladder"); operator-tunable in a follow-up.
3. **Per-window stability filters out windows where `b.meta > 0`** (`:616`), so a window where Shopify saw $500 of matched orders BUT Meta claimed zero is dropped — that's actually the most extreme "Meta missing reality" case. The mathematical justification ("no signal to compute from") is correct ONLY if you treat Meta claim as denominator; if you ever want to detect "Meta dropped to zero while Shopify spiked" that path is missing. Future enhancement.

### 2. campaignHealthScore.ts (562 LOC)
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- Weights enforced at module load (`:103–107`); sum gate prevents drift.
- HR-03 renormalization (`:432–441`) correctly scales the 3 remaining
  components when trajectory has no data — the math `scaleFactor = 1 / (W_p + W_v + W_a)` gives the right reweighting.
- Insufficient gate (`:370–376`) matches operator spec ($30 floor, $100 + 0 conv).
- Per-platform pivots (`PLATFORM_ROAS_PIVOT`, `:136`) + per-platform fallback
  trust (`PLATFORM_FALLBACK_TRUST`, `:161`) are applied at the right places
  (`:247` and `:238`). Math: `((roas - 1) / (pivot - 1)) × 100` linearly
  interpolates [1.0, pivot] → [0, 100]; verified.
- Cohort adjustment (`:512–562`) gates `isWeakest` at `cohortSize >= 3`
  (`:528`) — asymmetric vs `isLeader` (no floor), but the JSDoc at `:478–479`
  explains the choice (someone always has to be last in a 2-cohort; the
  leader boost is for "dominant" regardless). Consistent with multi-mapping
  ranking semantics.
- `'composition_changed'` and `'insufficient'` cannibalization risks
  correctly fall through to `default` → zero delta (`:545–546`),
  matching the v2 a/WARN-6 fix referenced in the JSDoc.

**One nit (not a bug):** `cohortAdjustment` overwrites — does NOT add to —
`base.components.cohortAdjustment` (`:558`). Since `computeCampaignHealth`
always returns `cohortAdjustment: 0` (`:395`, `:455`), `applyCohortHealthAdjustment`
being idempotent (`applyCohort(applyCohort(base, x), x) === applyCohort(base, x)` only
if `x.delta === 0` after the first apply) is broken — calling it twice
double-adjusts the score AND replaces the prior delta. No caller does this today;
no test pins it. Suggest renaming to `applyCohortAdjustmentOnce` or
asserting `base.components.cohortAdjustment === 0` to fail loud. **Code smell, not bug.**

### 3. cpmRoasAnalysis.ts (323 LOC)
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- `indexPrevByDateOffset` (`:59`) correctly aligns prev-period by calendar
  offset, not array index — the c/CR-01 fix is intact.
- `pearsonForCpmRoas` (`:115`) explicit small-N (n<3) and zero-variance guards return null. Categorize maps null→'flat' (`:247`). Sound.
- Half-over-half delta (`:146`) handles `length < 4` and zero-baseline → null.
- Prev-period gate at `PREV_PERIOD_MIN_DAYS = 3` (`:33`) and prev mean computed via `meanOrNull_` (which returns null when sum is 0, `:181`); divide-by-zero guarded via the chained `prevCpmMean !== 0` check at `:233`. Both NaN paths covered.
- FIX-25 fix (`:200`): valid rows now require only `cpm > 0` (impressions and spend produced a CPM), NOT `roas > 0` — correct per the comment, since a no-conversion day is still a meaningful data point.

**One concern (⚠️ Uncertain):** `categorize(delta=null) → 'flat'` (`:247`) — when prev-period data is INSUFFICIENT (fewer than 3 days) BUT the current series has 5+ days, `havePrev=false` → falls back to half-over-half. Good. But when prev IS sufficient and `prevCpmMean === 0` (prev was an all-zero period, e.g. a launch week), `cpmDelta=null` → 'flat'. That's silently mis-categorizing "we just launched, prev was zero spend" as "stable CPM." Hard to call a bug since there's no good answer, but the tooltip will say "יציבות מלאה" which is wrong. **Recommend** surfacing a "no comparison baseline" verdict when both deltas are null AND prev was queried.

### 4. campaignProductMap.ts (`allocateProductRevenue`, 486 LOC)
**Status:** ✅ Verified correct (with two documented edge cases)

**Evidence / Reasoning:**
- Refund-heavy product handling (`:319` keeps rows where `netRevenue < 0` AND
  units > 0; previous filter dropped them) is correct.
- HI-03/CR-01 refund fix at `:357–365` only applies the revenue cap when
  `p.netRevenueCad >= 0`, preventing the negative-clamp pathology described
  in the comment. Verified by manual trace: a product with net=-$100,
  Meta deterministic=$80 → cap-skipped path keeps the $80 deterministic;
  Step 3 distributes remainder remRev=-100-80=-180 to all mapped
  campaigns by spend share (mass-conserving). ✅.
- Cross-platform sum cap (`:378–389`) also gated on `p.netRevenueCad >= 0`.
- Step 3 dropped the `Math.max(0, …)` clamp on remainder revenue (`:463`)
  — correct, as documented in CR-01 fix comment.
- Orphan products (no mapped campaigns) skipped (`:321`); `if (!o.lineItems)`
  guard at `:1095` prevents NPE.
- `classifyOrderToPlatform` priority chain: source_name first
  (tiktok-paid > meta-paid > google-paid), then fbclid > gclid (`:208–215`).
  `ttclid` is folded into `source='tiktok-paid'` upstream in `shopify.ts`;
  the comment at `:213–214` explicitly notes no ttclid check needed here.
  Consistent with the Apps Script priority chain (after the v3 source_name addition).

**Documented edge cases (not bugs):**
- If multiple platform IDs co-occur on a single order (rare — would require
  both fbclid AND gclid in landing URL), `classifyOrderToPlatform` picks Meta first. Acceptable convention.
- `mappedKeys` parses platform from `k.split('::')[1]` at `:401`; unknown
  platforms (anything not Meta/Google/TikTok) are silently dropped from
  `keysByPlatform` (`:403`). A future 4th platform would silently disappear
  from allocation. Minor.

### 5. fetchers/shopify.ts (refunds + buildWindowUrl + total_price, 1094 LOC)
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- `isoLocalMidnight` (`:247`) properly iterates DST (`for (let i = 0; i < 3; i++)`), and the 2026-05-22 month-indexing bug is fixed (`:299` correctly subtracts 1 from `offsetMatch[2]`). Both regression locations now pass `Number(match[2]) - 1` for Date.UTC's 0-indexed month.
- Window A (`created_at=D`) tight `[D, D+1)`, Window B (`updated_at=D`)
  open upper bound to `today+1` (`:423–426`) — the documented 2026-05-21
  refund-window fix. Pagination cap 50 with warn-not-throw.
- Two windows merge dedup by `id` (`:543–549`). Window A wins on overlap.
  Numerical correctness of the algorithm itself is owned by
  `shopifyRevenueRefunds.ts` (out of scope here; we trust the load-bearing
  invariants header).
- `total_price` correctly used in the fields=…; `current_total_price` is
  used ONLY in `fetchShopifyOrdersAttribution` (`:1058`), which is correct
  per the JSDoc — that table is order-level, not revenue, and the
  same-day-refund-already-deducted property of `current_total_price` is
  desired there.
- `computeLineItemsCad` (`:962`) handles `subtotal === 0` (free-gift /
  100% discount) via `useFlatSpread`, skips null `product_id`, rounds to
  2 decimals. The `useFlatSpread ? items.length > 0 ? totalCad/items.length : 0`
  ternary (`:984–987`) is slightly awkward but correct (the outer
  `items.length === 0 return []` at `:967` already prevents division by zero).

### 6. inngest/functions/cronLive.ts (effective_status, 1232 LOC)
**Status:** 🔴 Has bug (one concrete data-correctness defect)

**Evidence / Reasoning of the good parts:**
- `isActiveForPlatform` exported with platform-specific sets (TIKTOK_ACTIVE_ENOUGH at `:243`); covers DELIVERY_OK + BUDGET_EXCEED + AUDIT + REVIEWING + NOT_START. Matches operator spec.
- HIGH-12 fix: sequential `for...of await` (`:1099`) instead of `Promise.all`, with per-iteration `try/catch` AND explicit `result.error` check (`:1101–1129`). Both rejection-path and `{error:{...}}`-resolve-path properly logged + continued.
- CR-02 per-date spend lookup (`:791`): no longer gates on `isToday`, all 3 dates of the rolling window now refresh.
- a/WARN-3 FX null fallback (`:646–652`): on FX failure, returns null → per-platform preserve in the persister. Correct.
- BL-COGS per-store rate (`:182–194`) with bounds check on parsed rate (0..1 valid range).
- TikTok placeholder enrollment only when `isActiveForPlatform` — paused/archived ad-sets don't get placeholder rows, matches operator spec "Active campaigns appear immediately. Paused campaigns only appear if they had spend in the range."

**🔴 BUG — cronLive.ts:1146-1149 (CR-02-RESIDUAL):**

The handler's RETURN VALUE silently drops TikTok spend:

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

The persister correctly writes `tt_spend_cad` to data_daily; that part is fine.
But the SUMMARY RETURNED to the orchestrator / operator console only
exposes `fb` and `ga`. Any downstream consumer that reads
`runLiveForStore(...).todaySpendCad` to surface today's total spend in the
operator console will under-report by the TikTok amount for uzoshop.

**Impact:** Low–Medium (depends on whether the operator-console jobs table
or any caller actually reads this field; the on-disk data is correct).

**Suggested fix:** Add `tt: todaySpendEntry.ttSpendCad ?? 0` to the returned
object literal at cronLive.ts:1148. Also update the function's return-type
annotation at line 537 (`todaySpendCad: { fb: number; ga: number; tt?: number }`).

**Open question (⚠️):**
- `cadConvert` at `:639` returns 0 (not null) when `value.spend === 0`. That's
  semantically right ("zero CAD when zero source") but it's then truthily
  treated as "fetcher succeeded" downstream (`dateSpend.fbSpendCad === 0`
  is `!== null`). So a date that had genuine zero ad spend will mark
  `haveAnySpend=true` (`:792`) and trigger the per-platform preserve path.
  In that path: `fbSpendCad: dateSpend.fbSpendCad ?? priorFb` → `0 ?? priorFb` → `0`.
  Correct outcome (overwrites stale prior with 0) — verified. ✅

### 7. fetchers/{meta,googleAds,tiktok,fx}.ts
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- **fx.ts** is throw-on-failure (`:55`, `:67`) — caller (cronLive at `:646`)
  is responsible for `.catch(() => null)` and the null-fallback ladder. The
  v3 fix lives at the call site, not in fx.ts. Confirmed both cron-LIVE
  (line 646) and cron-DAILY are wrapped. Correct.
- **meta.ts**: `extractMetaPurchases` priority chain at `:285` is single-line
  (`omni_purchase → purchase → offsite_conversion.fb_pixel_purchase`),
  matching the threat-T-S4 grep gate. `parseFloat(r.spend ?? '0') || 0`
  handles all null/empty/non-numeric paths. Empty-row filter `spend===0 && impressions===0 && conv.count===0` correctly KEEPS late-attributed-conversion rows (`:360`).
- **meta.ts** budgets: ILS-fallback warning loud (`:683–693`); soft-fail on page errors
  (`:716–722`) preserves partial map; pagination cap at 50.
- **googleAds.ts**: `runGaqlQuery` paginates `nextPageToken` (the v3 CR-01 fix is intact, `:309–339`); the previous "single-POST silent drop" bug is fixed. Short-circuit for non-uzoshop stores at `:361`, `:404`, `:587` is the right place to gate without hitting the API. `costMicros / 1_000_000` conversion correct. No clamping (`:381–384`).
- **tiktok.ts**: `tiktokGet` (`:166`) checks the envelope's `code !== 0`
  explicitly — the documented `code=40002` "missing data" pattern surfaces as an Error, not silent zero. The Phase 05.7.8 advertiser_ids JSON-string fix is intact (`:237`). `parseNum` (`:178`) handles number/string with non-finite fallback to 0. `conversionValue = purchases × value_per_complete_payment` (`:532`) is the documented TikTok synthesis (no direct `conversion_value` metric exists).

**One nit (not a bug):** `value_per_complete_payment` is the AVERAGE; multiplying back by the count round-trips correctly only because TikTok exposes a per-row aggregation, not a per-event one. If TikTok ever rounds the AVG (they do — to 2 decimals in their UI), `purchases × avgPurchase` can off-by-pennies from the true sum. Documented behavior, not a bug.

### 8. Order attribution classifier (`shopify.ts:classifyOrderAttribution`)
**Status:** ✅ Verified correct (priority chain CORRECTLY EXTENDED past the spec)

**Evidence / Reasoning:**

The audit spec says the priority ladder is `fbclid → gclid → utm → referring_site`. The TS port PREPENDS two extra tiers (lines 881–927):

```
1. source_name === 'fb' / 'facebook'  → meta-paid     (NEW)
2. source_name === 'google'           → google-paid   (NEW)
3. source_name === 'tiktok'           → tiktok-paid   (NEW)
4. fbclid                             → meta-paid     (matches spec)
5. gclid                              → google-paid   (matches spec)
6. ttclid                             → tiktok-paid   (NEW)
7. utm_medium ∈ {cpc,paid,…}          → meta/google/tiktok/other-paid (matches spec utm tier)
8. utm_source = email/newsletter      → email
9. utm_source === 'tiktok'            → tiktok-paid (paid-only convention, see comment)
10. utm_source present                → other-paid
11. ref matches facebook/google/tiktok → *-organic / other-referral
12. ref present                       → other-referral
13. fallthrough                       → direct
```

The JSDoc at `:872–880` justifies adding source_name BEFORE click-IDs:
"Shopify's checkout SDK writes source_name when the order arrives via the
platform's channel app. More reliable than landing_site UTMs (which can be
stripped by a redirect chain)." Sound reasoning, and the operator-facing
note explicitly acknowledges divergence from the Apps Script source
(`Shopify.gs:910` does NOT have the source_name override prefix).

**Priority correctness — verified by manual trace on 12 representative orders:**
- Order with `source_name='fb'` AND `gclid` present: classified `meta-paid` (correct; source_name signal stronger).
- Order with `fbclid` AND `gclid` (rare bot-traffic edge): classified `meta-paid` (priority correct).
- Order with `utm_source='tiktok'`, `utm_medium=''`: classified `tiktok-paid` (the special tier 9, which is INTENTIONAL per the comment at `:901–906`).
- Order with `referring_site` only (organic): classified by domain pattern.

**One inconsistency worth noting (⚠️, not a bug):**
The Apps Script (`Shopify.gs:910–984`) does NOT branch on `source_name`. The
TS port intentionally diverges. The load-bearing-parity invariant in
`shopifyRevenueRefunds.ts:8–48` does NOT cover classifier parity (only the
algorithm). So this is documented divergence. The dashboard runs READ_FROM=postgres
permanent (Phase 05.7.0), so Apps Script classifier is dormant. ✅.

### 9. aiReport.ts (statistical computations: z-score, CV, momentum)
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- **CV (`:374–377`)**: `variance = Σ(x−μ)² / N` (POPULATION, not Bessel-corrected), then
  `stddev = √variance`, then `cv = stddev / mean` (guarded `mean > 0`).
  Categorization at `cv<0.15 → 'יציב'`, `<0.35 → 'בינוני'`, else 'תנודתי' (`:397–402`). Math sound; population variance is the right choice here (CPM
  series isn't a sample of an infinite population — it's exhaustive over
  the visible days). Inconsistent with attributionAnalysis (which uses
  population variance too for windowStability but Bessel for AOV CI — see
  Cross-surface observation 2).
- **Robust z-score (`:484–491`)**: `(value - median) / (1.4826 × MAD)`. The
  1.4826 constant is the consistency factor for normal-distributed data
  (1 / Φ⁻¹(0.75)) — correct. Threshold `|z| >= 2.0` for outlier classification.
- **Edge cases handled:**
  - `mad === 0` short-circuits to z = 0 (`:485`, `:489`). Prevents Infinity from a constant series.
  - `daily.length >= 5` gate (`:443`) prevents medianMad on degenerate samples.
  - Even-length median uses `(sorted[mid-1] + sorted[mid]) / 2` (`:460`); odd uses `sorted[mid]`. Standard.
- **Funnel rates** at `:277–289` correctly guard division: `totalImpressions > 0 ? clicks/impressions : 0`, etc.
- `storeId` filter audit fix (a/WARN-4, `:127–130`) correctly prefers
  storeId when provided, falls back to storeName for legacy callers.

**One minor concern (⚠️):**
The CV verdict thresholds (0.15 / 0.35) are operator-tuned constants but
inlined as magic numbers at `:398`, `:400`. The attribution analyzer hoists
similar thresholds (`STABLE_THRESHOLD = 0.15`, `VOLATILE_THRESHOLD = 0.35`)
at the top of the file — aiReport could pull them in OR re-hoist locally
for discoverability. Code smell, not bug.

### 10. postgresReaders.ts (newest-row + effective_status, 902 LOC)
**Status:** ✅ Verified correct

**Evidence / Reasoning:**
- **Newest-row selection**: applied in `fetchDashboardStateFromPostgres` (`:445–453`) — `prevAt !== undefined && updatedAt < prevAt` correctly keeps the newest row when duplicates appear. The JSDoc notes that PRIMARY KEY (key) prevents duplicates in practice; the comparison is forward-compatible. Lexicographic ISO-8601 comparison works for the date format.
- **`fetchTableLastWriteAt`** (`:215`) correctly uses `.order('updated_at', desc).limit(1)` — single-row read, cheap, semantically correct.
- **`effective_status` reader gate (`:586–611`)**: Correctly OR's hasActivity (spend/impressions/conversions > 0) with isCurrentlyActive (platform-specific status match). For TikTok the active status is `ADGROUP_STATUS_DELIVERY_OK` only (`:608`) — which is NARROWER than cron-live's `TIKTOK_ACTIVE_ENOUGH` (which includes BUDGET_EXCEED, AUDIT, REVIEWING, NOT_START). See ⚠️ below.
- **toNumber** (`:126`) handles null / undefined / '' / non-finite, returning 0. parseFloat fallback for STRING NUMERIC columns from supabase-js.
- **`paginate` helper** (`:96`) correctly loops until `data.length < chunkSize` OR MAX_CHUNKS=50 reached. Guards runaway loops.
- **`titleCasePlatform`** (`:138`) handles meta/google/tiktok; passes through unknowns matching sheets.ts permissive behavior.

**⚠️ Subtle asymmetry between writer and reader (NOT a bug today, but a near-bug):**

The cron-live ENROLLMENT step (cronLive.ts:1025–1027) only UPSERTs placeholder rows for ad-sets that pass `isActiveForPlatform`, which includes ALL 5 TikTok delivery/preparing statuses (DELIVERY_OK + BUDGET_EXCEED + AUDIT + REVIEWING + NOT_START). But the dashboard reader gate (postgresReaders.ts:608) ONLY treats DELIVERY_OK as "is currently active":

```ts
(platformNorm === 'tiktok' && statusNorm === 'ADGROUP_STATUS_DELIVERY_OK');
```

**Today this is harmless:** the writer ENROLLED any of the 5 statuses → row exists → reader sees row, but the reader also has `hasActivity` as the OR predicate, so any enrolled row with non-zero spend/impressions/conversions still surfaces. The only path where this matters: a brand-new ad-set in BUDGET_EXCEED (paused-today, will resume tomorrow) with ZERO spend/impressions today → writer enrolls placeholder, reader DROPS it because `hasActivity=false && isCurrentlyActive=false` (since BUDGET_EXCEED ≠ DELIVERY_OK). So the operator sees nothing for that ad-set on today's row, even though cron-live enrolled it.

**Suggested fix:** widen the reader's TikTok `isCurrentlyActive` check to the same `TIKTOK_ACTIVE_ENOUGH` set used by cron-live. Either import the set from cronLive.ts (one source of truth) or duplicate it with a comment cross-linking. Severity: **Minor** (BUDGET_EXCEED is uncommon; cron-daily picks up the row tomorrow anyway).

## Cross-surface observations

1. **Spec drift in surface #1 path.** The spec names `analyzeAttribution.ts`
   but the file is `attributionAnalysis.ts`. Same module, different filename
   — a `grep -rn` for "analyzeAttribution" finds 3 test files but no
   matching source file. Worth fixing in the spec or the synthesis output
   so future auditors don't waste cycles on dead links.

2. **Variance convention inconsistency.** Two different conventions live
   in the codebase: `attributionAnalysis.ts` uses Bessel-corrected sample
   variance for AOV CI (correct — AOVs are a sample of the population of
   "what this campaign WILL sell"), but POPULATION variance for window
   stability AND aiReport CV. Defensible per-callsite, but no doc justifies
   the inconsistency. Suggest a one-paragraph comment in each callsite
   citing the other (or a `lib/stats.ts` shared module exposing
   `sampleVariance` and `populationVariance` clearly named).

3. **TZ handling is consistent** — every callsite that needs a calendar day
   in Asia/Jerusalem uses `Intl.DateTimeFormat('en-CA', { timeZone:
   'Asia/Jerusalem', … })`, and the documented "month-must-be-0-indexed"
   fix in `shopify.ts:299` is internalized in `isoLocalMidnight` (the only
   helper that needs offset arithmetic). `cronLive.ts:dayInJerusalem`
   shares the same convention. No DST landmines found.

4. **Negative-value handling is now consistent across the financial pipeline.**
   computeCoverage allows negative deterministic revenue (refund-heavy);
   allocateProductRevenue skips the `Math.max(0, …)` clamp on revenue
   remainder; cronLive does NOT clamp spend; trust score is clamped to
   [0, 100] only at the UI surface (WR-03). Mass-conservation of revenue
   across the allocation pipeline is preserved.

5. **Per-platform constants live in 3 files** — `PLATFORM_ROAS_PIVOT` and
   `PLATFORM_FALLBACK_TRUST` in campaignHealthScore.ts; `TIKTOK_ACTIVE_ENOUGH`
   in cronLive.ts (with sibling in CampaignsTableRow as the comment notes);
   `STORES_WITH_TIKTOK` and `STORES_WITH_GOOGLE_ADS` in cronLive.ts and
   googleAds.ts respectively. None drift today; suggest a future
   `platformConfig.ts` module to centralize. Code smell, not bug.

## Summary line for orchestrator

| Surface | Status | Notes |
|---|---|---|
| 1. attributionAnalysis | ⚠️ | windowStability 'mixed' not surfaced; coverage upper-clamp at 2 hides extreme halo |
| 2. campaignHealthScore | ✅ | weights validated; HR-03 renormalization correct |
| 3. cpmRoasAnalysis | ✅ | one ⚠️ on `prev=0` edge |
| 4. campaignProductMap | ✅ | refund-heavy + cross-platform cap correctly gated |
| 5. shopify.ts | ✅ | DST + month-indexing intact |
| 6. cronLive | 🔴 | summary return drops TikTok spend (cronLive.ts:1148) — Minor |
| 7. fetchers/meta/google/tiktok/fx | ✅ | v3 fixes intact, FX null-fallback correct |
| 8. classifyOrderAttribution | ✅ | spec ladder correctly extended; source_name divergence intentional |
| 9. aiReport (CV / z-score) | ✅ | math sound, magic numbers nit |
| 10. postgresReaders | ✅ | ⚠️ writer↔reader asymmetry on TikTok active-status set (Minor) |

**Bug count:** 1 🔴 Minor (cronLive.ts:1148 missing `tt` in todaySpendCad return).
**Suggested-fix count:** 3 ⚠️ (Minor): postgresReaders TikTok status widening, cpmRoasAnalysis "no comparison baseline" verdict, aiReport CV-threshold hoisting.
