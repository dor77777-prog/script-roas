# AUDIT.md — Codebase Baseline

**Phase:** 12 (Codebase Audit Baseline)
**Date:** 2026-05-24
**Commit baseline:** `b846ae7d` (HEAD at audit start; halo-warning chip U-05)
**Scope:** every algorithm file, every component with business logic, every orchestrator (cron/event handler), every API route, plus inter-component communication patterns.
**Method:** D-01 one `gsd-code-reviewer` subagent per file across 7 parallel waves (A–G) + D-12 cross-cutting try/catch sweep + D-14/D-15 cross-AI Codex critique on 5 statistical algorithm files + D-16 single Plan-agent test-coverage gap survey + DP-02 mid-execution operator-checkpoint for ⚠️ triage.

---

## TL;DR

| Verdict | Count |
| --- | ---: |
| ✅ Verified | 123 |
| 🔴 Has bug | 16 |
| ⚠️ Uncertain | **0** (per DP-02 + D-08 — all 17 originally ⚠️ resolved by operator checkpoint) |
| **Total files** | **139** |

- **27 distinct bugs** across the 16 🔴 files (2 CRITICAL, 25 MAJOR; minor + cosmetic logged to `12-tests-needed.md` backlog).
- **0 BLOCKER for this audit** — operator's WhatsApp SVC-02 (deployment env-var) caveat is explicitly a **runbook concern, not a code bug**, per operator directive.
- **STA-05 postgresReaders MAX_CHUNKS silent truncation:** filed as **priority test/backlog item** in `12-tests-needed.md` (TG-03), **not** an audit bug (no proof of materialization on current prod data).
- **Cross-cutting:** 1 SUSPICIOUS try/catch site (INN-16, cross-validates) + 10 channel-driven findings (`12-CHANNELS.md` §8) + 5 verification-blocking test gaps (`12-tests-needed.md` TG-01..05).

**Next:** Phase 12.1 fixes (P0 — see Recommended Phase 12.1 Scope below). Optional Phase 12.2 (P1) + Phase 12.3 (P2) and backlog as the operator chooses.

---

## Methodology

The audit was governed by 21 operator-locked decisions documented in [`phases/12-codebase-audit-baseline/12-CONTEXT.md`](phases/12-codebase-audit-baseline/12-CONTEXT.md). Key choices:

- **D-01** — One reviewer per file, parallel waves of ~10.
- **D-02** — Reproduction-grade evidence per 🔴: file:line + failing input + expected vs actual + fix sketch + regression test idea.
- **D-03** — Tests-first audit: reviewer reads `__tests__/{file}.test.ts` BEFORE source.
- **D-04** — Orchestrator synthesizes (one consistent format + single master triage table); this file.
- **D-05** — Critical = wrong output on real production data (empirical, not theoretical).
- **D-08 + DP-02** — Zero ⚠️ in final AUDIT.md; all originally ⚠️ resolved at mid-execution operator checkpoint (DP-03 batched AskUserQuestion, 5 batches of 3-4).
- **D-12** — Cross-cutting try/catch sweep (single Plan agent) for systemic pattern that per-file audit misses → [`phases/12-codebase-audit-baseline/12-trycatch-sweep.md`](phases/12-codebase-audit-baseline/12-trycatch-sweep.md).
- **D-14 + D-15** — Cross-AI Codex critique on 5 statistical algorithm files (aiReport, attributionAnalysis, multiMappingCohort, cannibalizationDetection, cpmRoasAnalysis); finding lands in AUDIT.md only when both Opus + Codex agree or operator breaks tie.
- **D-16** — Single Plan-agent test-coverage gap survey runs after all reviewers complete → [`phases/12-codebase-audit-baseline/12-tests-needed.md`](phases/12-codebase-audit-baseline/12-tests-needed.md).
- **D-17 + DP-04** — File layout: `.planning/AUDIT.md` (this file, permanent) + `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` (phase-scoped) + `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` (phase-scoped). Atomic single write — no incremental edits during audit.

**Wave structure (DP-01):**
- Wave A — `lib/algorithm/` (12 files, 5 with Codex pass)
- Wave B — `lib/services/` (16 files)
- Wave C — `lib/state/` + infra (37 files)
- Wave D — `inngest/` (5 files)
- Wave E — `app/api/` (19 files, 2 sub-waves)
- Wave F — `components/` (44 business-logic files, 4 sub-waves)
- Wave G — borderline display components (9 files)
- After all waves: **mid-execution operator checkpoint** (17 ⚠️ triaged in 5 batches) → 3 Plan-agent cross-cutting tasks → this atomic AUDIT.md write.

**Audit corpus (artifacts available for re-verification):**
- `.planning/phases/12-codebase-audit-baseline/raw-returns/` — 144 JSON files (139 Opus reviewers + 5 Codex critiques)
- `.planning/phases/12-codebase-audit-baseline/resolutions.json` — operator decisions on 17 ⚠️ → 15 ✅ + 2 🔴
- `.planning/phases/12-codebase-audit-baseline/12-trycatch-sweep.{json,md}` — D-12 cross-cutting
- `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` — D-16 ranked gaps
- `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` — DP-04 channel map
- `.planning/graphs/graph.json` — graphify knowledge graph (7,625 nodes / 9,107 edges)

---

## Per-file verdicts (139 files)

Grouped by directory. Detailed evidence for every 🔴 lives in the corresponding `raw-returns/<file>.json` (one per file).

### `app/api/` (19 files: 13 ✅ / 6 🔴)

| File | Verdict |
| --- | :---: |
| `app/api/ads/route.ts` | ✅ |
| `app/api/campaigns/route.ts` | ✅ |
| `app/api/dashboard-state/route.ts` | ✅ |
| `app/api/data/route.ts` | ✅ |
| `app/api/debug/shopify-fetch/route.ts` | 🔴 API-10 |
| `app/api/health/route.ts` | ✅ |
| `app/api/inngest/route.ts` | ✅ |
| `app/api/oauth/tiktok/callback/route.ts` | 🔴 API-18 |
| `app/api/operator/backfill/route.ts` | ✅ |
| `app/api/operator/jobs/route.ts` | 🔴 API-23 |
| `app/api/operator/manual-overrides/route.ts` | 🔴 API-26 |
| `app/api/operator/notifications/send/route.ts` | ✅ |
| `app/api/operator/reset/route.ts` | 🔴 API-32 |
| `app/api/operator/sync-now/route.ts` | ✅ |
| `app/api/operator/token-failures/route.ts` | 🔴 API-37, API-38 |
| `app/api/orders-attribution/route.ts` | ✅ |
| `app/api/product-catalog/route.ts` | ✅ |
| `app/api/products/route.ts` | ✅ |
| `app/api/store-meta/route.ts` | ✅ |

### `inngest/` (5 files: 2 ✅ / 3 🔴)

| File | Verdict |
| --- | :---: |
| `inngest/client.ts` | ✅ |
| `inngest/functions/cronDaily.ts` | 🔴 INN-01 |
| `inngest/functions/cronLive.ts` | 🔴 INN-05, INN-07, **INN-10** |
| `inngest/functions/cronWhatsapp.ts` | ✅ |
| `inngest/functions/eventBackfill.ts` | 🔴 INN-14, INN-15, **INN-16** |
| `inngest/functions/eventSyncNow.ts` | ✅ |

### `lib/algorithm/` (12 files: 7 ✅ / 5 🔴, 5 also Codex-reviewed)

| File | Verdict | Codex |
| --- | :---: | :---: |
| `lib/aiReport.ts` | 🔴 ALG-01..07 | ✅ Codex agreed |
| `lib/analytics.ts` | ✅ | — |
| `lib/attributionAnalysis.ts` | 🔴 ALG-01 | ✅ Codex agreed |
| `lib/campaignHealthScore.ts` | ✅ | — |
| `lib/campaignProductMap.ts` | ✅ | — |
| `lib/campaignsAggregator.ts` | ✅ | — |
| `lib/cannibalizationDetection.ts` | ✅ | ✅ Codex agreed |
| `lib/cpmRoasAnalysis.ts` | ✅ | ✅ Codex agreed |
| `lib/insights.ts` | 🔴 ALG-01 (projectedNet) | — |
| `lib/multiMappingCohort.ts` | 🔴 **MMC-BLOCKER-01** | ✅ Codex agreed |
| `lib/ordersAttribution.ts` | 🔴 ALG-01 (sheets paging cap) | — |
| `lib/productCentricView.ts` | 🔴 **ALG-01, ALG-02, ALG-03** | — |

### `lib/services/` (16 files: 16 ✅ / 0 🔴)

| File | Verdict |
| --- | :---: |
| `lib/fetchers/fx.ts` | ✅ |
| `lib/fetchers/googleAds.ts` | ✅ |
| `lib/fetchers/manualOverrides.ts` | ✅ |
| `lib/fetchers/meta.ts` | ✅ |
| `lib/notifications/sendDailySummary.ts` | ✅ |
| `lib/fetchers/shopify.ts` | ✅ |
| `lib/fetchers/shopifyAuth.ts` | ✅ |
| `lib/notifications/summary.ts` | ✅ |
| `lib/notifications/templateParams.ts` | ✅ |
| `lib/fetchers/tiktok.ts` | ✅ |
| `lib/notifications/tokenFailures.ts` | ✅ |
| `lib/hooks/useBillingOneTime.ts` | ✅ |
| `lib/hooks/useBillingRecurring.ts` | ✅ |
| `lib/hooks/useCampaignAttribution.ts` | ✅ |
| `lib/hooks/useCampaignTrueRevenue.ts` | ✅ |
| `lib/notifications/whatsapp.ts` | ✅ |

### `lib/state/` + infra (37 files: 36 ✅ / 1 🔴)

| File | Verdict |
| --- | :---: |
| `lib/ads.ts` (Sheets reader) | ✅ (dead-code cleanup separately) |
| `lib/annotations.ts` | ✅ |
| `lib/apiErrors.ts` | ✅ |
| `lib/billing.ts` | ✅ |
| `lib/cacheConfig.ts` | ✅ |
| `lib/campaignOptimized.ts` | ✅ |
| `lib/campaigns.ts` (Sheets reader) | ✅ (dead-code cleanup separately) |
| `lib/campaignsColumnPrefs.ts` | ✅ |
| `lib/campaignsLinks.ts` | ✅ |
| `lib/chartColors.ts` | ✅ |
| `lib/cloudSync.ts` | ✅ |
| `lib/constants.ts` | ✅ |
| `lib/costs.ts` | ✅ |
| `lib/dashboardStateKeys.ts` | ✅ |
| `lib/dateRange.ts` | ✅ |
| `lib/dateValidation.ts` | ✅ |
| `lib/drawerStack.ts` | ✅ |
| `lib/drillFilter.ts` | ✅ |
| `lib/format.ts` | ✅ |
| `lib/lineItems.ts` | ✅ |
| `lib/operatorReset.ts` | ✅ |
| `lib/platformConfig.ts` | ✅ |
| `lib/platformsByStore.ts` | ✅ |
| `lib/postgresReaders.ts` | ✅ (STA-05 backlog priority — see operator directive) |
| `lib/presets.ts` | ✅ |
| `lib/productCatalog.ts` (Sheets reader) | ✅ (dead-code cleanup separately) |
| `lib/products.ts` (Sheets reader) | 🔴 **STA-46 + STA-47** |
| `lib/rangeClamp.ts` | ✅ |
| `lib/sessionKeys.ts` | ✅ |
| `lib/shopifyRevenueRefunds.ts` | ✅ |
| `lib/sparklineGeometry.ts` | ✅ |
| `lib/supabase.ts` | ✅ |
| `lib/supabaseAdmin.ts` | ✅ |
| `lib/types.ts` | ✅ |
| `lib/urlState.ts` | ✅ |
| `lib/useDashboardRefresh.ts` | ✅ |
| `lib/utils.ts` | ✅ |

### `components/` (50 files: 50 ✅ / 0 🔴)

All component reviews verified ✅. Per-file minor flags (UI consistency, magic constants, missing RTL tests) deferred to [`12-tests-needed.md`](phases/12-codebase-audit-baseline/12-tests-needed.md) HP-14..18 + LP-20.

Top-level: `AdSetTable`, `AdsDrawer`, `AiReportButton`, `AnnotationsPanel`, `BillingCsvImport`, `BillingSettings`, `CampaignDrawer`, `CampaignsColumnsMenu`, `CampaignsTable`, `CampaignsTableRow`, `CloudSync`, `CohortComparisonPanel`, `CollapsibleSection`, `CommandPalette`, `Dashboard`, `DetailTable`, `Filters`, `FreshnessChip`, `GoalTracker`, `HealthScoreBadge`, `HealthScorePanel`, `HeroOverview`, `InsightsBoard`, `InsightsPanel`, `KpiCards`, `MetaShopifyReconciliation`, `MetricHelp`, `MonthlyTables`, `PerStoreCards`, `PnLBreakdown`, `ProductCentricView`, `ProductChannelBreakdown`, `ProductPickerModal`, `ProductsTable`, `RefundIndicator`, `RoasChart`, `RollingNumber`, `Sparkline`, `SyncIndicator`, `TabNav`, `TodayLive`, `WhatsWorking`.

Operator: `BackfillPicker`, `JobsTable`, `ManualOverridesCrud`, `ResetData`, `SyncNowButtons`, `TokenFailuresTable`, `WhatsappTestButtons`.

---

## 🔴 Critical findings (2)

### CRITICAL-01: INN-10 — cronLive `persist-rolling-3day` is non-idempotent on Inngest retry

- **File:** [`dashboard-web/src/inngest/functions/cronLive.ts:746-823`](dashboard-web/src/inngest/functions/cronLive.ts#L746-L823)
- **Failing input:** Two cron-live ticks fire 10 min apart. Tick #1 fetches Meta+Google+TikTok spend successfully and writes via `persist-rolling-3day`. The `step.run` callback's prior-state SELECT (lines 803-809) happens *inside* the step. On retry of the same step (default Inngest retry policy = 4× exponential), the SELECT reads the in-progress state of itself — the "prior" fallback values are no longer the pre-step values.
- **Expected:** Per-platform-preserve semantics (`fb_spend_cad` falls back to last write when this tick's fetch failed) should be stable across retries.
- **Actual:** On retry, the SELECT reads the freshly-written value from attempt 1 → "preserve from self" → silent data corruption on the 1-2% of cron-live ticks that retry. Production scale: ~432 ticks/day × 1% retry ≈ ~4 silent corruptions/day.
- **Fix sketch:** Move the SELECT into a separate `step.run('select-prior-spend', ...)` BEFORE `persist-rolling-3day`. Inngest memoizes step results across retries, so prior values become stable. Alternative: don't preserve via SELECT; pass `null` for failed platforms and let `persistDayForStore`'s own SELECT (line 361-369) do the preservation via the no-spendOverride branch.
- **Regression test:** Custom step stub simulating one retry: `step.run = async (id, cb) => { try { return await cb(); } catch { return await cb(); } }`. Mock: tick 1 writes `fb=100, ga=200, tt=50`. Tick 2 has Meta fetch fail (returns null), Google + TikTok succeed (300, 60). Pin first attempt + 1 retry of `persist-rolling-3day`: assert `fb_spend_cad === 100` (prior preserved), not the value the retry would read from its own first-attempt write.
- **Cross-refs:** Channel finding CHN-03 in [`12-CHANNELS.md`](phases/12-codebase-audit-baseline/12-CHANNELS.md). Test gap HP-02 in [`12-tests-needed.md`](phases/12-codebase-audit-baseline/12-tests-needed.md).

### CRITICAL-02: INN-16 — eventBackfill catch-and-continue swallows Inngest retry signal

- **File:** [`dashboard-web/src/inngest/functions/eventBackfill.ts:215-234`](dashboard-web/src/inngest/functions/eventBackfill.ts#L215-L234)
- **Failing input:** Operator triggers a 21-day × 3-store backfill (63 pairs). A schema-level RLS denial throws on the first `runDailyForStore` call. The per-pair catch records `{ok:false, error:message}` and continues. By pair #2 the same RLS denial throws; the catch records and continues. The loop burns through all 63 pairs with identical failure messages.
- **Expected:** A systemic failure (e.g. schema-level RLS, missing migration, broken env var) should abort after 2-3 same-message failures and let Inngest's per-step retry / dead-letter machinery escalate the whole event.
- **Actual:** No `console.warn`/`console.error` (the error string only lives in the returned `results[i].error`, which Inngest does NOT log prominently). Throw never reaches Inngest → no retry, no DLQ. 63 unnecessary `step.run` invocations burn quota.
- **Fix sketch:**
  1. Add `console.warn` inside the catch so per-pair failure is visible in Inngest run logs without operator inspecting the results matrix.
  2. Add a "systemic-failure abort" guard: if the first 3 consecutive pairs fail with the same error message, throw to let Inngest retry the whole event.
- **Regression test:** Mock `runDailyForStore` to throw the same `Error('RLS denied')` on every call. Drive a backfill of 5 pairs. Assert the handler throws after ≤3 attempts with `Error: systemic failure (3 consecutive identical errors): RLS denied`. Assert pair indices 4-5 were never invoked.
- **Cross-refs:** Try/catch sweep finding CAT-29 in [`12-trycatch-sweep.md`](phases/12-codebase-audit-baseline/12-trycatch-sweep.md). Channel finding CHN-04 in [`12-CHANNELS.md`](phases/12-codebase-audit-baseline/12-CHANNELS.md).

---

## 🔴 Major findings (25)

Concise reference. Full evidence (failing input, expected, actual, fix sketch, regression test idea) in the per-file `raw-returns/*.json`.

### Inngest layer (4)

- **INN-01** [`cronDaily.ts:441-449 + 1121-1126`](dashboard-web/src/inngest/functions/cronDaily.ts#L441-L449) — Return value built from `merged.totalSpendCad` (which **excludes** TikTok) but persisted row at 1121-1126 **includes** TikTok. Operator sees one number in the jobs table and a different one on the dashboard. **Operator-confirmed 🔴 at checkpoint** (resolutions.json INN-01).
- **INN-05** [`cronLive.ts:803-819`](dashboard-web/src/inngest/functions/cronLive.ts#L803-L819) — Subsidiary of INN-10 (same root cause). Fix lands together.
- **INN-07** [`cronLive.ts:393-394 + 449-453`](dashboard-web/src/inngest/functions/cronLive.ts#L393-L453) — Shopify-coupled gating: when Shopify times out for date D-1, the entire iteration `continue`s, blocking ad-platform spend recovery for D-1 even when Meta/Google/TikTok all succeed. Decouple: skip Shopify-column writes but still run a spend-only persist for D-1.
- **INN-14** [`eventBackfill.ts:140-148`](dashboard-web/src/inngest/functions/eventBackfill.ts#L140-L148) — `dateRange` uses UTC arithmetic (`start.getTime() + 24h`). Across IL DST transitions (IDT⇄IST, Oct/Mar), the local calendar day skips or duplicates. A backfill spanning the boundary silently misses or duplicates a day.

### Algorithm layer (15)

#### aiReport.ts (8) — all MAJOR

- **ALG-01** [`lib/aiReport.ts:1101-1109 + 1289-1297`](dashboard-web/src/lib/aiReport.ts#L1101-L1297) — TikTok status taxonomy: hard-coded `ADGROUP_STATUS_DELIVERY_OK` allowlist mis-classifies every other TikTok status (`BUDGET_EXCEED`, `AUDIT`, `REVIEWING`, `NOT_START`) as off. Drives wrong scale/pause guidance + spurious -30 Health Score penalty.
- **ALG-02** [`lib/aiReport.ts:2032-2048`](dashboard-web/src/lib/aiReport.ts#L2032-L2048) — TikTok-excluded budget allocation: `totalSpendAll = metaSpend + googleSpend` (no `ttSpend`). On TikTok-heavy stores, hides 60%+ of spend from the operator's budget table.
- **ALG-03** [`lib/aiReport.ts:1095-1100 + 1299-1303`](dashboard-web/src/lib/aiReport.ts#L1095-L1303) — `last-write-wins` on unordered iteration: when same `(platform, campaignId)` appears on multiple dates in fetcher row order (non-chronological), the final `effectiveStatus` is non-deterministic.
- **ALG-04** [`lib/aiReport.ts:1299-1303`](dashboard-web/src/lib/aiReport.ts#L1299-L1303) — `statusByCampaign` keyed by `${platform}::${campaignId}` (no `storeId`). In operator's default `storeName='All'` view, store A's status silently overwrites store B's for any colliding campaignId.
- **ALG-05** [`lib/aiReport.ts:842-853 + 1083-1092`](dashboard-web/src/lib/aiReport.ts#L842-L1092) — `ordersByCampaignId.set(id, ...)` and `ordersByCampaignName.set(name.toLowerCase(), ...)` keyed without `storeId`. Same `utm_campaign='Brand'` from two stores silently merges revenue.
- **ALG-06** [`lib/aiReport.ts:1124-1131 + 1492-1494 + 1588-1589`](dashboard-web/src/lib/aiReport.ts#L1124-L1589) — Suffix-match lookups use `Array.from(map.keys()).find(k => k.endsWith('::${platform}::${campaignId}'))` — first match wins across stores in `All` view.
- **ALG-07** [`lib/aiReport.ts:1148-1149`](dashboard-web/src/lib/aiReport.ts#L1148-L1149) — `coverage = Math.min(1, det / c.value)` clamps to 1 when Meta under-reports, hiding halo signal (the very thing U-05's halo-warning chip is designed to surface).
- **ALG-08** [`lib/aiReport.ts:1163-1174`](dashboard-web/src/lib/aiReport.ts#L1163-L1174) — Synthetic `trueRevenueInfo` uses `as unknown as ... as never` cast → any new TrueRevenueInfo field silently NaN-propagates.

#### Other algorithm (7)

- **MMC-BLOCKER-01** [`lib/multiMappingCohort.ts:201-205`](dashboard-web/src/lib/multiMappingCohort.ts#L201-L205) — `rankingScore` composite key reversal: under shrinkage at orders=10, weighted score formula can flip rank order vs raw ROAS for adjacent cohort members. Operator sees rank-chip flicker on cohort-comparison panel (Phase 10 HIGH-6 regression-untested).
- **lib/attributionAnalysis.ts ALG-01** [`lib/attributionAnalysis.ts:442-525 + 795-852`](dashboard-web/src/lib/attributionAnalysis.ts#L442-L852) — Multiple branches hard-code the literal string `'Meta'` in operator-facing copy after the TikTok widening (Phase 10 partial fix). Examples: line 442 `'Meta CTR is high but…'`, 469 `'Meta says CTR…'` — should be `${platform}` interpolation.
- **lib/insights.ts ALG-01** [`lib/insights.ts:539`](dashboard-web/src/lib/insights.ts#L539) — `projectedNet` applies last-7-day COGS rate to the entire projected month total, rewriting historic actuals. Operator sees a goal-projection number that doesn't match what already happened in the month.
- **lib/ordersAttribution.ts ALG-01** [`lib/ordersAttribution.ts:214`](dashboard-web/src/lib/ordersAttribution.ts#L214) — Sheet pagination hard-coded to row 100,000. Rows beyond never fetched. **Operator note:** legacy Sheets reader, dead-code-cleanup-eligible per Phase 11 transition, but until removed it can serve stale data if an operator hits a fallback path.
- **ProductCentricView ALG-01** [`lib/productCentricView.ts:289-301`](dashboard-web/src/lib/productCentricView.ts#L289-L301) — `byPlatform.intraAllocatedRevenue` is 500 per platform (`b/HI-05` fix applied via `platformAllocatedRevenue` map), but each member's `allocatedRevenueEstimate` does NOT sum to 500. Operator sees CAD 0 rows under a CAD 500 platform header.
- **ProductCentricView ALG-02** [`lib/productCentricView.ts:263-291`](dashboard-web/src/lib/productCentricView.ts#L263-L291) — Stale-mapped campaign (no aggregated row) is silently dropped from allocator's Step-2 deterministic split — revenue leaks from `t_stale` (sole TikTok). Real production cohorts WILL contain stale mappings.
- **ProductCentricView ALG-03** [`lib/productCentricView.ts:178-181 + 289-291`](dashboard-web/src/lib/productCentricView.ts#L178-L291) — Line 290 `.filter(r => r.agg !== undefined)` silently removes dormant member. JSDoc says "keep products with at least one active campaign" but impl drops members with NO recent activity even when they're part of the cohort surface.

### lib/state (2 — operator-triaged 🔴)

- **STA-46** [`lib/products.ts:50-67`](dashboard-web/src/lib/products.ts#L50-L67) — Local `parseDate` bypass: inline DMY parser accepts `31/02/2026`-style impossible dates, bypassing the WR-04 calendar validation that the Postgres reader applies. Sheets reader silently surfaces fake rows.
- **STA-47** [`lib/products.ts:110`](dashboard-web/src/lib/products.ts#L110) — Filter asymmetry vs Postgres reader: Sheets path drops some rows the Postgres reader keeps. Output divergence on any operator action that touches the Sheets fallback.

### Operator API routes (6 — operator-only surface)

- **API-10** [`app/api/debug/shopify-fetch/route.ts:96-114`](dashboard-web/src/app/api/debug/shopify-fetch/route.ts#L96-L114) — Response body includes `tokenPrefix: token.slice(0, 10) + '...'` (line 103). 10-char prefix of a Shopify Admin API token is sufficient to identify the store + reduce brute-force search space. Operator-only route, but URL-obscurity trust model.
- **API-18** [`app/api/oauth/tiktok/callback/route.ts:50-57`](dashboard-web/src/app/api/oauth/tiktok/callback/route.ts#L50-L57) — Custom `htmlEscape` covers 5 basic chars but NOT `JSON.stringify`-derived contexts. `auth_code + state + error` strings written into a script-tag-context HTML response could break out via crafted backslash sequences.
- **API-23** [`app/api/operator/jobs/route.ts:149-169`](dashboard-web/src/app/api/operator/jobs/route.ts#L149-L169) — Sequential `for ... await fetch(...)` over Inngest REST API. 50 events × ~200ms avg = ~10s p50 latency for the operator's jobs table render. Should use `Promise.all` with concurrency cap.
- **API-26** [`app/api/operator/manual-overrides/route.ts:84-85`](dashboard-web/src/app/api/operator/manual-overrides/route.ts#L84-L85) — `parseFloat('1.5xyz') → 1.5` (silent success on garbage input). Operator typo `'1.5xyz'` succeeds with spend=1.5 instead of 400.
- **API-32** [`app/api/operator/reset/route.ts:123-152`](dashboard-web/src/app/api/operator/reset/route.ts#L123-L152) — Sequential per-table delete loop. On large datasets (≥100k `orders_attribution` rows), each `DELETE FROM ... ` awaits the previous — total reset >30s, near Inngest function timeout.
- **API-37 + API-38** [`app/api/operator/token-failures/route.ts:93-174`](dashboard-web/src/app/api/operator/token-failures/route.ts#L93-L174) — Raw Supabase error message leaked to browser body (line 95, 119, 172). Sibling operator routes (`operator/jobs`, etc.) consistently sanitize via `userFacingError()`; this route deviates.

### Withdrawn / non-bugs

- **INN-02** (cronDaily upsert error handling) — Reviewer withdrew after deeper inspection.
- **INN-06** (cronLive productRows always UPSERT) — Reviewer withdrew (gated correctly by line 481).
- **INN-15** (eventBackfill stale comment) — Documentation-only, NOT a correctness bug. Logged for cleanup.

---

## Bug triage table → Phase 12.1 / 12.2 / 12.3 / Backlog

Each 🔴 finding mapped to a fix phase. Phase assignments based on D-05 severity (CRITICAL = wrong output on real production data) + operator-visible impact.

### Phase 12.1 (P0 — verification-blocking, ship-stopping)

| Finding | File:line | Bug | Materialized in prod |
| --- | --- | --- | --- |
| **CRITICAL-01 / INN-10** | `cronLive.ts:746-823` | Non-idempotent retry → silent data corruption | YES (~4/day at 1% retry rate) |
| **CRITICAL-02 / INN-16** | `eventBackfill.ts:215-234` | Swallows Inngest retry → burned exec budget on systemic failures | YES (every full-backfill RLS/schema failure) |
| **INN-01** | `cronDaily.ts:441-1126` | return-roas vs persisted-roas TikTok mismatch | YES (operator-visible discrepancy) |
| **ALG-04** | `aiReport.ts:1299-1303` | Cross-store collision in `statusByCampaign` (storeName='All' default view) | YES (operator default view) |
| **ALG-05** | `aiReport.ts:842-1092` | Cross-store collision in `ordersByCampaignId/Name` | YES (operator default view) |
| **ALG-06** | `aiReport.ts:1124-1589` | Suffix-match first-wins across stores | YES (operator default view) |
| **MMC-BLOCKER-01** | `multiMappingCohort.ts:201-205` | Ranking score reversal under shrinkage | YES (operator sees rank chip flicker) |
| **ProductCentricView ALG-01** | `productCentricView.ts:289-301` | Sum-conservation violation (CAD 0 under platform header) | YES (operator's product view) |

### Phase 12.2 (P1 — operator-visible bugs, not safety-critical)

| Finding | File:line | Bug |
| --- | --- | --- |
| **ALG-01** (aiReport) | `aiReport.ts:1101-1297` | TikTok status taxonomy → wrong off-chip for non-`DELIVERY_OK` statuses |
| **ALG-02** (aiReport) | `aiReport.ts:2032-2048` | TikTok-excluded budget allocation |
| **ALG-07** (aiReport) | `aiReport.ts:1148-1149` | Coverage clamped to 1 (hides halo signal) |
| **ProductCentricView ALG-02** | `productCentricView.ts:263-291` | TikTok stale-mapped revenue leak |
| **ProductCentricView ALG-03** | `productCentricView.ts:289-291` | Dormant member silently dropped |
| **INN-07** | `cronLive.ts:393-453` | Shopify-coupled gating blocks ad-platform spend recovery for affected date |
| **INN-14** | `eventBackfill.ts:140-148` | DST drift → missing/duplicate days at IL DST transitions |
| **attributionAnalysis ALG-01** | `attributionAnalysis.ts:442-852` | Hard-coded "Meta" literal in operator-facing copy after TikTok widening |
| **insights.ts ALG-01** | `insights.ts:539` | `projectedNet` applies last-7 COGS to whole month |
| **ordersAttribution.ts ALG-01** | `ordersAttribution.ts:214` | Sheet pagination cap at row 100,000 |
| **STA-46** | `products.ts:50-67` | Inline DMY parseDate bypasses WR-04 calendar validation |
| **STA-47** | `products.ts:110` | Filter asymmetry vs Postgres reader |

### Phase 12.3 (P2 — operator-route security/perf hardening)

| Finding | File:line | Bug |
| --- | --- | --- |
| **API-10** | `debug/shopify-fetch/route.ts:96-114` | tokenPrefix leak in debug response |
| **API-18** | `oauth/tiktok/callback/route.ts:50-57` | htmlEscape coverage gap in script-tag context |
| **API-23** | `operator/jobs/route.ts:149-169` | Sequential fan-out → ~10s p50 latency |
| **API-26** | `operator/manual-overrides/route.ts:84-85` | `parseFloat` lenient → silent typo acceptance |
| **API-32** | `operator/reset/route.ts:123-152` | Sequential delete loop → near-timeout on large datasets |
| **API-37 + API-38** | `operator/token-failures/route.ts:93-174` | Raw Supabase error leak to browser |
| **INN-05** | `cronLive.ts:803-819` | Subsidiary of INN-10 (lands together with Phase 12.1) |
| **ALG-03** (aiReport) | `aiReport.ts:1095-1303` | `last-write-wins` (cascades from ALG-04 fix, may need explicit ordering) |

### Backlog (tracked, no immediate fix planned)

| Item | Source | Rationale |
| --- | --- | --- |
| **STA-05** (postgresReaders MAX_CHUNKS truncation) | `12-tests-needed.md` TG-03 | **Operator directive:** priority test/backlog, NOT a bug today (no proof of materialization). |
| **ALG-08** (aiReport synthetic trueRevenueInfo type bypass) | aiReport.ts:1163-1174 | Type-safety; no runtime bug today. |
| **MMC-WARN-01..05** (multiMappingCohort various) | multiMappingCohort.ts | Code quality; no operator-visible bug. |
| **ProductCentricView ALG-04..09** (perf O(n²) + assertions) | productCentricView.ts | Code quality. |
| **Lib/state Sheets-tier cleanup** (ads/campaigns/productCatalog) | `lib/{ads,campaigns,productCatalog}.ts` | **Operator directive:** dead-code cleanup phase, NOT a bug for this audit. |
| **STA-45** (lib/state/products.ts 4-copy parseDate) | products.ts:23-42 | Can collapse to shared helper; not a bug. |
| **INN-15** (eventBackfill stale comment) | eventBackfill.ts:215-234 | Documentation drift; lands with INN-16 fix. |

---

## Cross-cutting findings

Three cross-cutting deliverables expand on file-local findings with whole-system patterns:

### Try/catch sweep (D-12 → `12-trycatch-sweep.md`)
- 134 catch sites across 36 files. 133 INTENTIONAL, 1 SUSPICIOUS.
- **CAT-29 = INN-16** — cross-validates the per-file finding via the orthogonal "all catches" lens. Same fix.
- All other catches verified intentional: S-2 soft-fail, parseRangeParams typed-error 400, FX-failure null sentinel (CRIT-5 / a/WARN-3), per-platform HG-01 soft-fail, sequential for-of + result.error (HIGH-12), per-recipient (HR-04), defensive `res.json().catch(() => ({}))`, localStorage quota fallbacks, decodeURIComponent fallbacks.

### Inter-component channels (`12-CHANNELS.md`)
- 428 import edges, 26 events emitted, 30 event consumers, 29 SWR keys, 25 Inngest triggers, 23 Supabase write tables, 27 read tables, 62 external API calls.
- **10 channel-driven findings** (Section 8). Highlights:
  - **CHN-02 / ALG-04..06** — `aiReport`/`campaignsAggregator` cross-store key bleed (contract owner = `campaignsAggregator.ts`, not `aiReport.ts`).
  - **CHN-03 / INN-10** — channel diagnosis of the cron-live retry idempotency.
  - **CHN-04 / INN-16** — channel diagnosis of the eventBackfill catch-and-continue.
  - **CHN-05 / HR-05** — WhatsApp single-chokepoint topology verified ✅ (the operator's permissive-when-unset env-var caveat is a runbook concern, NOT a code bug per directive).
  - **CHN-10** — reviewer doc inconsistency: `app/api/inngest/route.ts` reviewer wrote `*/15` cadence, `cronLive.ts` reviewer wrote `*/10`. Needs source-of-truth verification.

### Test-coverage gaps (D-16 → `12-tests-needed.md`)
- 88 distinct gaps (after dedup of 430 raw entries). **5 verification-blocking**, 24 high-priority, 39 medium, 20 low + 10 cross-cutting tooling gaps.
- **Top 5 verification-blocking:**
  - **TG-01** — WhatsApp single-chokepoint topology + allowlist enforcement
  - **TG-02** — AI Report cross-store collision + status-freshness regression
  - **TG-03** — postgresReaders MAX_CHUNKS silent truncation (operator-priority)
  - **TG-04** — useCampaignTrueRevenue (519-LOC orchestration, zero direct tests)
  - **TG-05** — Multi-mapped cohort ranking (HIGH-6 regression-untested)

---

## Operator directives applied

Per `resolutions.json` `operator_directives_for_synthesis`:

1. **WhatsApp `SVC-02` deployment env-var caveat (`NOTIFICATION_RECIPIENT_ALLOWLIST` permissive when unset):** NOT included as a blocker in AUDIT.md. Runbook/deployment concern only. The WhatsApp chokepoint code itself is ✅ Verified. The allowlist is enforced at runtime; the operator's responsibility is to keep the env var set in every deployment.
2. **STA-05 `postgresReaders` MAX_CHUNKS silent truncation:** Filed as **priority test/backlog item** in [`12-tests-needed.md`](phases/12-codebase-audit-baseline/12-tests-needed.md) (TG-03), **NOT** a bug in this audit (no proof of materialization on current prod data). If/when materialized, promote to a fix phase.
3. **Sheets-side readers that survived Phase 11 (`lib/ads.ts`, `lib/campaigns.ts`, `lib/productCatalog.ts`):** Dead-code cleanup concerns, NOT bugs for THIS audit. Still verdicted ✅. A separate cleanup phase can remove them.
4. **`lib/state/products.ts` (the one Sheets reader with bugs):** 🔴 Per operator triage — both STA-46 (DMY parse bypass) and STA-47 (filter asymmetry) are concrete latent bugs that can materialize today. If proven later that the Sheets reader is truly unconsumed in production, can downgrade to cleanup/backlog.
5. **`useBilling*` hooks:** Thin pass-through wrappers. Logic lives in audited `billing.ts`. Test gaps documented separately in [`12-tests-needed.md`](phases/12-codebase-audit-baseline/12-tests-needed.md) HP-19.
6. **Final AUDIT.md MUST have zero ⚠️ entries (per D-08 + DP-02).** ✅ Confirmed — all 17 originally-⚠️ files now ✅ Verified (15) or 🔴 Has Bug (2) per operator triage. This file ships with zero ambiguous entries.

---

## Verification artifacts

| Artifact | Path | Purpose |
| --- | --- | --- |
| Raw reviewer returns | `.planning/phases/12-codebase-audit-baseline/raw-returns/` | 144 JSONs (139 Opus + 5 Codex). Per-file evidence for every ✅ and 🔴. |
| Operator triage resolutions | `.planning/phases/12-codebase-audit-baseline/resolutions.json` | 17 ⚠️ → 15 ✅ + 2 🔴 decisions, with operator notes per finding. |
| Try/catch sweep | `.planning/phases/12-codebase-audit-baseline/12-trycatch-sweep.{md,json}` | D-12 cross-cutting result. |
| Test-coverage gaps | `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` | D-16 ranked gaps. |
| Channels map | `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` | DP-04 inter-component map. |
| Discussion log | `.planning/phases/12-codebase-audit-baseline/12-DISCUSSION-LOG.md` | DP-01..DP-04 logistic resolutions for audit retrospective. |
| Knowledge graph | `.planning/graphs/graph.json` + `GRAPH_REPORT.md` | 7,625 nodes / 9,107 edges; used to confirm 564 communities + the dense Campaigns↔Drawer cluster. |
| Codebase snapshot | `.planning/codebase/` | 7 docs (ARCHITECTURE/CONCERNS/CONVENTIONS/INTEGRATIONS/STACK/STRUCTURE/TESTING) regenerated post-Phase-11 as input to the audit. |

---

## Recommended Phase 12.1 scope

**8 fixes, all P0 (verification-blocking + operator-visible-in-default-view):**

1. **INN-10** — cronLive `persist-rolling-3day` retry idempotency (move SELECT to separate `step.run`)
2. **INN-16** — eventBackfill systemic-failure abort + `console.warn`
3. **INN-01** — cronDaily return value uses `dataDailyUpsertedRow.totalSpend` directly (single source of truth)
4. **ALG-04 + ALG-05 + ALG-06** — `aiReport.ts` storeId-scoped key construction (composite `${storeId}::${platform}::${campaignId}`)
   - Contract change requires updating `campaignsAggregator.ts` to thread `storeId` through `Aggregated`
   - Downstream: every consumer of `Aggregated` must accept new key shape (~10 callers per CHANNELS §1.3)
5. **MMC-BLOCKER-01** — multiMappingCohort ranking score reversal: explicit tie-break + non-finite guard
6. **ProductCentricView ALG-01** — sum-conservation fix (`allocatedRevenueEstimate` sums must equal `intraAllocatedRevenue`)

**Suggested split:**
- **12.1.1** — Inngest retry + idempotency (INN-10 + INN-16 + INN-01) — 1 agent, low coupling
- **12.1.2** — aiReport cross-store cleanup (ALG-04/05/06 + storeId threading through `campaignsAggregator.ts`) — 1 agent, high coupling (touches `aiReport.ts` + `campaignsAggregator.ts` + ~10 consumers)
- **12.1.3** — Cohort + Product allocator math (MMC-BLOCKER-01 + ProductCentricView ALG-01) — 1 agent, isolated to 2 algorithm files

**Test backfill (parallel to fixes):**
Each Phase 12.1 fix MUST land with the corresponding regression test from the per-file `raw-returns` `regression_test_idea` field, plus the verification-blocking fixtures from `12-tests-needed.md` TG-02 (aiReport cross-store golden fixture) and TG-05 (multiMappingCohort ranking).

**Optional follow-ups:**
- **Phase 12.2** (11 P1 fixes) — operator-visible but not safety-critical.
- **Phase 12.3** (8 P2 fixes) — operator-route security/perf hardening.
- **Phase 12.4** (Sheets-tier cleanup) — if operator wants to drop the surviving Sheets readers (`lib/ads.ts`, `lib/campaigns.ts`, `lib/productCatalog.ts`, `lib/products.ts`) post-Phase-11. Independent of the bug fixes above.
- **Phase 12.5** (cross-cutting test infra) — `12-tests-needed.md` CC-01..10 (fetcher contract, single-chokepoint repo-grep, DST regression suite, integration test for cron-live × Supabase, component RTL setup, etc.).

---

*Generated 2026-05-24. Phase 12 atomic synthesis write per DP-04.*
