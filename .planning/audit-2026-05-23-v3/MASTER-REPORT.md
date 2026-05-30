---
audit_round: v3
date: 2026-05-23
reviewers: Opus 4.7 (4 parallel agents) + Codex CLI cross-verifier (GPT-5)
codebase_state: post-v2 (HEAD 274ba3b, 56 v1+v2 commits shipped, 741 tests pass, tsc clean)
---

# v3 Master Report — Consolidated + Cross-Verified

This is the consolidated remediation backlog after v3's comprehensive code audit.
Opus 4.7 produced 4 parallel reviews (REVIEW-OPUS-1..4-*.md). Codex independently
cross-verified all 19 CRIT+HIGH findings (REVIEW-CODEX-VERIFICATION.md) and added 5
that Opus missed. Operator reported one TikTok-status bug during the audit window.

## Cross-AI agreement matrix

| Category | Opus count | Codex verdict | Net validated |
|---|---|---|---|
| CRITICAL | 5 | 5 VERIFY (2 with caveat) | **5** |
| HIGH | 14 | 13 VERIFY (2 with caveat), 1 REJECT | **13** |
| Codex-only NEW | — | 5 NEW (2 HIGH, 3 MEDIUM) | **5** |
| Operator-reported | 1 (TikTok status) | — (post-audit; not in Codex scope) | **1** |
| MEDIUM (Opus) | 28 | not cross-verified | 28 (lower confidence) |
| LOW / INFO (Opus) | 37 | not cross-verified | 37 (style/notes) |

**Net validated CRITICAL or HIGH backlog: 5 + 13 + 2 + 1 = 21 findings**

The one REJECT (HIGH-1 / TodayLive midnight): Opus claimed `const today = todayInIsrael()` was pinned at mount, but `today` is render-local and the existing 30s `setNow` interval forces a re-render → SWR key rolls over at the next 30s tick after midnight. Worst case = 30s lag, not "stale all morning". Removed from backlog.

---

# CRITICAL (5) — fix first

## CRIT-1 / O3-CR-01 — `aggregateByStore` defeats v2 d/CR-01 "All"-row fair-share split
**Files:** `lib/analytics.ts:212-220` (aggregateByStore), `lib/billing.ts:196-206` (billingForRange)
**Codex:** VERIFY. "In a singleton per-store aggregate, each store gets the full `All` amount because `storeNames.length === 1`; the global aggregate gets the amount once split across all stores."
**Symptom:** Sum of per-store True-Net-Profit cards no longer reconciles to the global card; inflates 2-3× when "All"-scoped recurring rows exist.
**Fix:** Pre-split All-scoped fixed costs across the in-scope store list BEFORE the per-store loop in `aggregateByStore`. OR thread the full store list into `aggregate(list, range, storeNames)` so `billingForRange` can split correctly.

## CRIT-2 / O2-CR-01 — ProductChannelBreakdown double-counts cross-tagged orders; loses email/affiliate residual
**Files:** `components/ProductChannelBreakdown.tsx:41-49, 96-100`, `lib/attributionAnalysis.ts:1102-1109`
**Codex:** VERIFY-WITH-CAVEAT. "Option B is directionally right for the bar, but the recommendation chips still use `breakdown.facebookShare` (line 50, 104-118), which is based on the broad OR count. Fix BOTH display counts AND share/chip logic."
**Symptom:** "פייסבוק 50%" bar segment but only 40% of orders are purely Facebook. Email/affiliate orders with stale `fbclidPresent=true` are LOST entirely from "other".
**Fix:** Renderer subtracts bySource buckets directly (no OR-with-fbclid). Plus rewrite `facebookShare` consumers to use the mutually-exclusive count.

## CRIT-3 / O2-CR-02 — RoasChart categorical X-axis aliases gap days as 1-day adjacency
**Files:** `components/RoasChart.tsx:50-54, 87-94`, `lib/analytics.ts:232-257` (dailySeries)
**Codex:** VERIFY. "dailySeries only creates entries when a row exists for that date; categorical XAxis evenly spaces the remaining points."
**Symptom:** A 5-day mid-range data outage renders 25 points evenly spread → slope between gap-spanning points indistinguishable from 1-day slope. v2 fixed this for HeroOverview RoasTrendChart (c/CR-03) but MISSED the primary RoasChart.
**Fix:** Thread `range` into `dailySeries`, fill missing days with `null` per-store, use `connectNulls={false}` on chart Lines.

## CRIT-4 / O2-CR-03 — KpiCards Net Profit sparkline math ≠ displayed `trueNetProfit`
**File:** `components/KpiCards.tsx:109-113, 179-189`
**Codex:** VERIFY-WITH-CAVEAT. "The recommended fix is correct only if daily fees and fixed costs are allocated consistently. If that allocation is not available, removing the net-profit sparkline is safer than showing a different metric."
**Symptom:** Sparkline shape disagrees with the big "רווח נטו" number above and with `METRIC_HELP.netProfit` description. Sparkline = `revenue - spend - cogs`. Big number = `revenue - spend - cogs - fees - fixed`.
**Fix:** Either compute `dailyTrueNet` via consistent fees+fixed allocation, OR remove the sparkline (Codex's safer alternative). Recommend the latter unless daily allocation is cheap.

## CRIT-5 / O4-CR-01 — cronDaily `cadFor()` throws on FX failure → partial-state DB writes
**Files:** `inngest/functions/cronDaily.ts:441-451 (cadFor), :396-409 (inline TikTok FX), called :583, :587, :594-600, :690, :695, :731, :735, :816, :820`; `lib/fetchers/fx.ts:45-72`
**Codex:** VERIFY. "Inside persist-batch, inline TikTok spend conversion calls getFxRate() directly, and cadFor() also calls getFxRate() without catch. The same step writes data_daily first and products_daily next before building campaign/ad payloads that await cadFor()."
**Symptom:** v2 a/WARN-3 fixed cron-LIVE FX but not cron-DAILY. One Frankfurter outage → `data_daily` + `products_daily` land, then campaigns/ads/orders silently never persist for that day. Inngest dead-letters after 4 retries → permanent partial state.
**Fix:** Wrap cadFor in try/catch; on FX failure throw a sentinel that the upsert builder OMITS `spend_cad` from the payload → ON CONFLICT preserves prior value (mirror cron-live a/WARN-3 pattern). Apply same to inline TikTok exchange at :396-409 BEFORE any DB write.

---

# HIGH (15 — 13 Opus-verified + 2 Codex-NEW)

## HIGH-2 / O1-H-2 — ProductPickerModal search icon `right-2.5` in RTL doc — overlaps cursor
**File:** `components/ProductPickerModal.tsx:279-289` · **Codex:** VERIFY
Replace `right-2.5` with `end-2.5` (logical). One-line fix.

## HIGH-3 / O1-H-3 — Filters custom-range inputs no validation, no `max=today`, no swap-on-invert
**File:** `components/Filters.tsx:148-165` · **Codex:** VERIFY
Lift `clampRangeFrom/clampRangeTo` from `CampaignsTable.tsx:1083-1130` into shared helper; reuse here.

## HIGH-4 / O2-HI-01 — `toggleCampaignsColumnHidden` + `restoreAllCampaignsColumns` silently DROP saved `order`
**File:** `lib/campaignsColumnPrefs.ts:223-241` · **Codex:** VERIFY
One careless checkbox click wipes minutes of column-reorder work; cloud-syncs the wipe across devices. Fix: spread `...cur` into both functions.

## HIGH-5 / O2-HI-02 — MetricHelp popover snaps closed during cursor transit; unreadable on hover
**File:** `components/MetricHelp.tsx:45-77` · **Codex:** VERIFY
Apply RefundIndicator's 200ms grace-timer pattern (same root cause as v2 d/CR-08) OR remove the `mt-2` gap.

## HIGH-6 / O2-HI-03 — CohortComparisonPanel composite sort key flips primary rank for micro-spend
**File:** `components/CohortComparisonPanel.tsx:261-265` · **Codex:** VERIFY
Replace `roasShopify * 1e6 + roasShopifyPlatform * 1e3 + spend` with explicit chained `if (a !== b) return ...` lexicographic compare.

## HIGH-7 / O2-HI-04 — KpiCards COGS sparkline ignores per-store env, uses fixed 0.25
**File:** `components/KpiCards.tsx:112` · **Codex:** VERIFY
Use `r.cogs` (per-store-aware via cron writers), not `r.revenue * COGS_RATE_OF_REVENUE`.

## HIGH-8 / O2-HI-05 — RoasChart renders "no data on day N" as ROAS=0 (looks like crash)
**Files:** `components/RoasChart.tsx:95-101, 153-164`, `lib/analytics.ts:252-254` · **Codex:** VERIFY
Same fix path as CRIT-3 — `null` instead of 0; remove `connectNulls` from chart Lines.

## HIGH-9 / O3-HI-01 — `forecastMonthEnd` MTD uses per-store COGS but projection uses global 0.25
**File:** `lib/insights.ts:497-501` · **Codex:** VERIFY
Two halves of same forecast use inconsistent COGS models. Fix: derive projection rate from `last7Cogs / last7Rev`.

## HIGH-10 / O3-HI-02 — `forecastMonthEnd` 7-day baseline INCLUDES today (incomplete day)
**File:** `lib/insights.ts:481-491` · **Codex:** VERIFY
GoalTracker "on-pace" reads "behind" every morning because today's partial-day depresses the average. Fix: window `[today-7, today-1]`.

## HIGH-11 / O3-HI-03 — Cannibalization emits literal `Infinity` for `revenueGrowthPct`
**File:** `lib/cannibalizationDetection.ts:428-431, 439-444, 488-497` · **Codex:** VERIFY
UI's `fmtPct` guards display but `JSON.stringify(Infinity) === 'null'` — silent landmine for cloudSync/AI report. Clamp with `Number.isFinite`; emit `null` sentinel.

## HIGH-12 / O4-HI-01 — cron-live `refresh-effective-status` Promise.all fails whole batch on one error
**File:** `inngest/functions/cronLive.ts:1017-1031` · **Codex:** VERIFY-WITH-CAVEAT (see HIGH-NEW-4)
Replace `Promise.all` with `for...of await` + per-iteration try/catch. Codex's caveat: ALSO check `result.error` (Supabase often resolves errors without rejecting) — see Codex-NEW-4 below.

## HIGH-13 / O4-HI-02 — whatsapp-eod at 00:10 IL leaves only 5min for cronDaily's 7.5min retry budget
**Files:** `inngest/functions/cronWhatsapp.ts:89-99`, `cronDaily.ts:960-966`, `lib/notifications/summary.ts:131-132` · **Codex:** VERIFY
Move EOD trigger to `30 0 * * *` (one-line config fix) OR have whatsapp-eod `step.invoke` cronDaily for yesterday first.

## HIGH-14 / O4-HI-03 — backfill `isDate` accepts `2026-99-99`; Date.UTC normalizes silently
**Files:** `app/api/operator/backfill/route.ts:77-78`, `inngest/functions/eventBackfill.ts:140-146`, AND `app/api/operator/manual-overrides/route.ts:54-70` · **Codex:** VERIFY
Add UTC round-trip in `isDate`. Codex extended scope: also apply to manual-overrides (which has the same regex-only validator) — see Codex-NEW-5 below.

## HIGH-NEW-2 (Codex) — `forecastMonthEnd` "net" omits fees AND fixed costs entirely
**File:** `lib/insights.ts:479, 497-501` · **Severity:** HIGH
`mtdNet = mtdRev - mtdSpend - mtdCogs` — dashboard's true-net everywhere else also subtracts fees + fixed. Goal/forecast surfaces overstate take-home profit even after HIGH-9 (COGS-rate inconsistency) is fixed.
Fix: include transaction-fees + fixed-cost proration via same `aggregate()` helpers, OR rename as `mtdNetBeforeFees`.

## HIGH-NEW-4 (Codex) — cron-live status refresh silently ignores Supabase `{error}` results
**File:** `inngest/functions/cronLive.ts:1017-1031` · **Severity:** HIGH
Each `.update(...)` result is discarded; Supabase often returns `{error}` without rejecting. Fix this in the same commit as HIGH-12 (different surface, same code path).

## OPERATOR-1 — TikTok `isCampaignOff` + `isActiveForPlatform` treat any non-`DELIVERY_OK` as off
**Files:** `components/CampaignsTableRow.tsx:178`, `inngest/functions/cronLive.ts:955-967` · **Severity:** HIGH (operator reported 2026-05-23)
Operator reported a TikTok campaign showing as כבוי in dashboard but Active in TikTok Ads Manager. Root cause: dashboard treats AUDIT, REVIEWING, BUDGET_EXCEED, NOT_START as "off" — too strict. TikTok has 8+ statuses where the campaign is actually delivering or about to deliver.
Fix:
- `isCampaignOff` → set of true-off statuses (DISABLE, TIMEDOUT, FROZEN, ARCHIVED, DELETE) instead of `!== DELIVERY_OK`
- `isActiveForPlatform` → set of "active-enough" statuses (DELIVERY_OK, BUDGET_EXCEED, AUDIT, REVIEWING, NOT_START) instead of `=== DELIVERY_OK`

---

# MEDIUM (28 from Opus + 2 from Codex-NEW)

## Codex-NEW-1 (MEDIUM) — KpiCards COGS card labels itself as fixed 25%
**File:** `components/KpiCards.tsx:168` · `labelSuffix="(25%)"` rendered alongside per-store-aware value. Fix: dynamic label "לפי חנות" / "mixed rates" when aggregate spans stores, OR remove suffix.

## Codex-NEW-3 (MEDIUM) — cronDaily stale comment around Meta CAD writes
**File:** `inngest/functions/cronDaily.ts:515-522` · Comment says Meta `spend_cad` is null/deferred but code at :583-587 writes the CAD value. High-risk maintenance trap in the same fragile FX/write path. Delete or rewrite the paragraph.

## Opus MEDIUMs (summarized — see individual REVIEW-OPUS-*.md for details)
Full per-finding details in:
- REVIEW-OPUS-1-components-ui-surface.md (9 MEDIUMs — TZ default drift, range-not-keyed SWR, pattern-consistency gaps)
- REVIEW-OPUS-2-visualizations.md (7 MEDIUMs — RollingNumber NaN, PnL "X days" hardcoded for >30, hybrid-device touch detect, hydration flash)
- REVIEW-OPUS-3-algorithm-core.md (6 MEDIUMs — various)
- REVIEW-OPUS-4-pipeline-crons-api.md (6 MEDIUMs — migration push, sleep abort, dashboardState UTF-16 bytes, EOD skip-path)

---

# LOW + INFO (26 LOW + 11 INFO from Opus)

Style / dead-code / a11y / observations. Listed inline in individual REVIEW-OPUS-*.md files. Defer to a polish pass after CRIT+HIGH ships.

---

# Recommended fix sequence (Wave 3)

The 5 CRITICAL + 15 HIGH + 1 operator-reported = **21 findings** are the in-scope backlog for Wave 3. Suggested batching to avoid conflict rotations:

### Wave 3.A — Algorithm + financial correctness (highest blast radius)
- CRIT-1 (aggregateByStore + billing All-row split)
- CRIT-4 (KpiCards net profit sparkline)
- HIGH-7 (KpiCards COGS sparkline)
- HIGH-9, HIGH-10 (forecastMonthEnd COGS + today-in-baseline)
- HIGH-NEW-2 (forecastMonthEnd fees+fixed)
- Codex-NEW-1 (COGS label suffix)
- HIGH-11 (cannibalization Infinity sentinel)

### Wave 3.B — Charts honesty
- CRIT-3 + HIGH-8 (RoasChart gap aliasing + ROAS=0 vs null — same dailySeries fix)
- CRIT-2 (ProductChannelBreakdown double-count + chip logic)

### Wave 3.C — Pipeline + crons
- CRIT-5 (cronDaily FX try/catch)
- HIGH-12 + HIGH-NEW-4 (cron-live UPDATE batch + Supabase error checks)
- HIGH-13 (whatsapp-eod timing)
- HIGH-14 + Codex-NEW-5 (date validation in backfill + manual-overrides)
- Codex-NEW-3 (stale Meta comment)

### Wave 3.D — UI + state
- OPERATOR-1 (TikTok status maps)
- HIGH-2 (ProductPickerModal RTL icon)
- HIGH-3 (Filters validation)
- HIGH-4 (column prefs order preservation)
- HIGH-5 (MetricHelp hover grace)
- HIGH-6 (Cohort sort)

Each wave can ship as 3-5 parallel agents per the v2 ownership-matrix pattern. Conflict-prevention rules from `audit-2026-05-23-v2/FIX-PLAN.md` still apply.

---

# Artifact pointers

- REVIEW-OPUS-1-components-ui-surface.md (38 files reviewed)
- REVIEW-OPUS-2-visualizations.md (16 files)
- REVIEW-OPUS-3-algorithm-core.md (15 files)
- REVIEW-OPUS-4-pipeline-crons-api.md (~30 files)
- REVIEW-CODEX-VERIFICATION.md (Codex GPT-5 cross-verify)
- CODEX-VERIFY-INPUT.md (input prompt to Codex)
- MASTER-REPORT.md (this file)
