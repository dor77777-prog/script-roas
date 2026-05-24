# Phase 12: Codebase Audit Baseline — Specification

**Created:** 2026-05-24
**Ambiguity score:** 0.06 (gate: ≤ 0.20)
**Requirements:** 8 locked
**Milestone:** v2.0 audit-baseline (Phase 1 of milestone)

## Goal

Produce `.planning/AUDIT.md` — a single canonical baseline document classifying every algorithm file, business-logic component, orchestrator, API route, and inter-component channel in the active codebase as **✅ Verified correct** / **🔴 Has bug** / **⚠️ Uncertain** with evidence, plus `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` ranking test-coverage gaps. **Zero source-code changes** in this phase. Operator-checkpoint resolves every ⚠️ to ✅ or 🔴 inline before the final AUDIT.md ships, so the output contains **zero ⚠️ Uncertain entries**.

## Background

This is the v2.0 milestone's first phase. Recent state:

- **Phases 9–12 (v1.0)** completed audits + fixes on ~10 algorithmic surfaces (`.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md`) — that audit's scope was narrow. The operator now wants a **comprehensive** baseline.
- **Codebase tier-1 inventory** (from `.planning/codebase/STRUCTURE.md`): 235 TS/TSX files in `dashboard-web/src`. Of these: 60 `lib/*.ts`, 6 `inngest/*.ts`, 19 `app/api/**/route.ts`, 53 `components/*.tsx`. Test count: 946 passing across 86 files (`vitest run`).
- **Knowledge graph** built via graphify (`.planning/graphs/graph.json`, 7,625 nodes / 9,107 edges / 564 communities) — captures imports, calls, type references, exports across the repo.
- **Apps Script tier was decommissioned** in Phase 11 — only the single-tier Next.js + Inngest + Supabase architecture is in scope today.

The "U-05 halo-warning chip" task shipped as a single commit (`b846ae7`) without going through `gsd-phase add` — so this phase reuses Phase 12 number; the U-05 work is cross-referenced for traceability only.

## Requirements

1. **Per-file verdict for every in-scope file**: every file in the scope list (Boundaries → In scope) gets exactly one verdict from {✅ Verified correct, 🔴 Has bug, ⚠️ Uncertain → resolved before AUDIT.md ships}.
   - Current: only ~10 surfaces audited (Phase 9 snapshot). No verdict for the other ~125 in-scope files.
   - Target: AUDIT.md contains exactly one verdict per in-scope file with file:line evidence.
   - Acceptance: a verifier can take the In-scope file list from SPEC.md, grep `## .* {filename}` in AUDIT.md, and find exactly one entry per file with status ∈ {✅, 🔴}. Zero ⚠️ entries in the final document.

2. **Reproduction-grade evidence per 🔴 finding**: every Critical/Major/Minor bug entry contains the 5 D-02 fields.
   - Current: prior audit findings (Phase 9) have file:line + impact + suggested fix; missing "failing input", "expected vs actual", and explicit regression-test idea.
   - Target: every 🔴 entry contains: (1) file:line, (2) failing input description, (3) expected output, (4) actual output, (5) suggested fix sketch + regression-test idea.
   - Acceptance: random sample 5 🔴 entries — all 5 contain all 5 fields. Severity is one of {Critical, Major, Minor, Cosmetic} per the D-05/D-07 rubric.

3. **Inter-component channel documentation**: `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` exists and enumerates every cross-file channel detected during per-file review.
   - Current: no channel map exists. Inter-component bugs (e.g. v3 U-01 TIKTOK_ACTIVE_ENOUGH writer↔reader asymmetry) were caught only by deep audit; no systematic enumeration.
   - Target: CHANNELS.md aggregates every channel each per-file reviewer surfaced (imports, props, custom events, SWR keys, Inngest triggers, Supabase reads/writes, API calls) into ONE bird's-eye view, grouped by channel type. A Plan-agent does the cross-cutting sweep + dedupe + ranking after all reviewers complete.
   - Acceptance: CHANNELS.md exists with at least 5 sections (imports / props / custom events / SWR keys / Inngest events) and each section enumerates concrete edges with source→target. AUDIT.md's findings reference CHANNELS.md when an inter-component issue is flagged.

4. **Test-coverage gap survey (12-tests-needed.md)**: a single Plan-agent runs after all per-file reviewers and consolidates the test gaps each reviewer surfaced inline.
   - Current: test coverage is uneven (e.g. aiReport.ts had 0 unit tests on 700 LOC of statistics until Phase 10; per `.planning/codebase/TESTING.md`). No prioritised gap list.
   - Target: `12-tests-needed.md` ranks gaps by operational risk and groups them by source file. Each entry: (file:line, what's untested, why it matters, suggested test fixture sketch).
   - Acceptance: file exists with ≥10 ranked gaps; top-5 gaps are explicitly flagged as "verification-blocking" matching the AUDIT-phase9-snapshot pattern.

5. **Cross-cutting sweep (try/catch without rethrow)**: a single sweep finds every silent-swallow on `src/`.
   - Current: silent error-swallow is a systemic pattern that per-file reviewers naturally miss (see HIGH-NEW-4 from Phase 10 — Supabase `{error}` swallow in cron-live).
   - Target: an `try/catch` sweep across the full `src/` tree produces a flat list of every catch site that does NOT rethrow / log / store the error. Each entry: file:line + caller chain (from graphify) + whether the silent swallow is intentional (pattern: comment says "soft-fail") or suspicious.
   - Acceptance: sweep output exists in AUDIT.md (or referenced sibling file); has ≥1 entry per catch site flagged; intentional vs suspicious labels applied.

6. **Operator-checkpoint mid-execution resolves every ⚠️ Uncertain**: AUDIT.md ships with zero ⚠️ entries.
   - Current: prior audits left ⚠️ entries open in the published doc (e.g. Phase 9 AUDIT had 6 ⚠️ that the operator had to triage post-hoc).
   - Target: the executor pauses after per-file reviewers complete, presents the ⚠️ entries to the operator via AskUserQuestion, each ⚠️ gets re-labeled to ✅ or 🔴 inline, then AUDIT.md is written with only ✅/🔴.
   - Acceptance: AUDIT.md `grep -c "⚠️" → 0`. Operator-decision log appended to AUDIT.md showing each ⚠️ → resolution.

7. **No source-code changes during this phase**: only files under `.planning/` are written.
   - Current: prior fix-phases (Phase 10) modified source files in `dashboard-web/src/`. This phase is report-only.
   - Target: zero modifications to `dashboard-web/**`, `apps-script/**`, `supabase/**` or any other source/test/config file during Phase 12 execution.
   - Acceptance: after the phase completes, `git diff main -- dashboard-web supabase` is empty. Any new test files are deferred to Phase 12.x.

8. **AUDIT.md drives the conditional Phase 12.x split**: the AUDIT.md bug triage table maps each 🔴 finding to a proposed fix-phase grouping.
   - Current: prior audits produced flat triage tables; the operator had to manually decide fix-phase grouping (e.g. v2 Wave 1/2 split).
   - Target: AUDIT.md ends with a triage table grouped by suggested fix-phase: Phase 12.1 = Critical, 12.2 = Major, 12.3 = Minor (or whatever the actual severity distribution justifies). Cosmetic items go to a backlog list, not a fix-phase.
   - Acceptance: triage table has ≥3 columns (Finding ID, Severity, Suggested fix phase); every 🔴 entry maps to exactly one fix-phase bucket.

## Boundaries

**In scope (files audited):**

*Algorithm + services + pipeline (66 files):*
- All 60 `dashboard-web/src/lib/**/*.ts` files (excluding `__tests__/`): ads, aiReport, analytics, annotations, apiErrors, attributionAnalysis, billing, cacheConfig, campaignHealthScore, campaignOptimized, campaignProductMap, campaigns, campaignsAggregator, campaignsColumnPrefs, campaignsLinks, cannibalizationDetection, chartColors, cloudSync, constants, costs, cpmRoasAnalysis, dashboardStateKeys, dateRange, dateValidation, drawerStack, drillFilter, format, insights, lineItems, multiMappingCohort, operatorReset, ordersAttribution, platformConfig, platformsByStore, postgresReaders, presets, productCatalog, productCentricView, products, rangeClamp, sessionKeys, shopifyRevenueRefunds, sparklineGeometry, supabase, supabaseAdmin, types, urlState, useDashboardRefresh, utils + fetchers/{fx, googleAds, manualOverrides, meta, shopify, shopifyAuth, tiktok} + hooks/{useBillingOneTime, useBillingRecurring, useCampaignAttribution, useCampaignTrueRevenue} + notifications/{sendDailySummary, summary, templateParams, tokenFailures, whatsapp}
- All 6 `dashboard-web/src/inngest/**/*.ts` files: client + functions/{cronDaily, cronLive, cronWhatsapp, eventBackfill, eventSyncNow}

*API routes (19 files):*
- All 19 `dashboard-web/src/app/api/**/route.ts`: ads, campaigns, dashboard-state, data, debug/shopify-fetch, health, inngest, oauth/tiktok/callback, operator/{backfill, jobs, manual-overrides, notifications/send, reset, sync-now, token-failures}, orders-attribution, product-catalog, products, store-meta

*Components with business logic (49 components):*
- The 40 components grep flagged as having state/effects/fetches (Dashboard, CampaignsTable, CampaignDrawer, AdsDrawer, AiReportButton, AnnotationsPanel, BillingCsvImport, BillingSettings, CampaignsColumnsMenu, CloudSync, CollapsibleSection, CommandPalette, Filters, FreshnessChip, GoalTracker, HealthScoreBadge, HeroOverview, InsightsBoard, KpiCards, MetaShopifyReconciliation, MetricHelp, MonthlyTables, PnLBreakdown, ProductCentricView, ProductChannelBreakdown, ProductPickerModal, ProductsTable, RefundIndicator, RollingNumber, SyncIndicator, TabNav, TodayLive, WhatsWorking, operator/{BackfillPicker, JobsTable, ManualOverridesCrud, ResetData, SyncNowButtons, TokenFailuresTable, WhatsappTestButtons})
- Plus 4 definitely-IN that grep missed (have business-logic via derivation): CampaignsTableRow, CohortComparisonPanel, RoasChart, Sparkline
- Plus 5 components operator confirmed IN 2026-05-24: AdSetTable, DetailTable, HealthScorePanel, InsightsPanel, PerStoreCards

*Cross-cutting deliverables (3 files):*
- `.planning/AUDIT.md` — the master per-file verdict + bug triage
- `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` — inter-component channel map
- `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` — ranked test-coverage gaps

**Total: 134 files audited + 3 cross-cutting docs.**

**Out of scope (explicit):**

- Pure-presentation components — these are passed all derived data via props and don't compute anything: `AttributionAnalysisPanel.tsx` (renders pre-computed analysis from `attributionAnalysis.ts`), `ErrorBoundary.tsx` (React infrastructure), `SectionIntro.tsx` (static intro text), `TabFreshnessHeader.tsx` (timestamp display). Their underlying logic IS audited via the source files they read.
- `dashboard-web/src/app/**/page.tsx` and `layout.tsx` — Next.js routing shells with minimal logic. Most are < 50 LOC and either re-export `<Dashboard />` or render a placeholder. Audit risk is low; defer to backlog if operator-requested later.
- Test files (`**/__tests__/**`) — test code is referenced as evidence ("does X have coverage?") but not audited as a target.
- Third-party libs (`node_modules`) — not under our control.
- Generated code — none currently in the repo, but excluded by policy.
- Documentation files (`.md`) — `.planning/codebase/*.md` captures the docs already; not re-audited.
- Supabase migrations (`supabase/migrations/**/*.sql`) — schema, not code logic. If the operator wants schema audited, separate phase.
- Infra config (`vitest.config.ts`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`) — boundary at TypeScript source, not config.
- Planning artifacts (`.planning/**`) — this IS the planning area; not audited.

**Cross-AI scope (D-14):** Cross-AI convergence is reserved for **statistical algorithm files only** (`attributionAnalysis.ts`, `aiReport.ts`, `multiMappingCohort.ts`, `cannibalizationDetection.ts`, `cpmRoasAnalysis.ts`). All other files use solo gsd-code-reviewer. If the per-file reviewers find no statistical drift suspicion, the Codex convergence pass may be skipped entirely (operator decision in /gsd-plan-phase 12).

## Constraints

- **Concurrency limit per wave:** parallel reviewer invocations capped at ~10 per wave (operator's D-01). 134 files → ≈14 waves. Plan agent computes the exact split in `/gsd-plan-phase 12`.
- **Production data shape required for severity classification:** "🔴 Critical = wrong output on real production data (empirical, not theoretical)" per D-05. Reviewers MUST cite the actual production-shape scenario (e.g. "uzoshop has 142 TikTok status refreshes/day per cron-live volume; bug X means status drift on Y% of them").
- **Stale-version awareness:** prior audit (Phase 9 snapshot) is the **starting baseline**, not a redo target. Per-file reviewers MUST read `.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md` for prior verdicts on the 10 surfaces it covered + the Phase 10 commits that fixed them (`git log b846ae7..main -- dashboard-web/src/<file>` shows post-Phase-9 fix history). Do NOT re-flag findings that Phase 10 already resolved.
- **Test-first audit:** D-03 — reviewer reads the test file first (if any), then the source. "Verified" means both correct code AND test coverage of the operator-relevant behavior.
- **No code changes:** absolute. Even tempting one-line fixes must be deferred to Phase 12.1. Phase 12 is documentation only.
- **Audit ID format:** every finding gets a unique ID `[BUCKET]-[NUM]` (e.g. `ALG-01`, `API-03`, `CHN-02`) where BUCKET is one of {ALG (algorithm/lib), API (api routes), INN (inngest), CMP (component), CHN (channel cross-cutting), CAT (try/catch sweep)}.

## Acceptance Criteria

- [ ] `.planning/AUDIT.md` exists at the repo root of `.planning/`.
- [ ] AUDIT.md contains ≥134 file-verdict entries (one per in-scope file).
- [ ] `grep -c "⚠️ Uncertain" .planning/AUDIT.md` returns `0`.
- [ ] Every 🔴 entry contains all 5 D-02 fields (file:line, failing input, expected, actual, fix sketch + regression test idea).
- [ ] `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` exists with ≥5 channel-type sections.
- [ ] `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` exists with ≥10 ranked gaps + top-5 marked "verification-blocking".
- [ ] AUDIT.md ends with bug triage table mapping every 🔴 entry → severity → suggested fix-phase (12.1/12.2/12.3/backlog).
- [ ] Operator-decision log appended to AUDIT.md showing each ⚠️ → ✅/🔴 resolution path.
- [ ] `git diff main -- dashboard-web supabase` is empty at end of Phase 12.
- [ ] try/catch sweep output present (in AUDIT.md or referenced sibling) labeling every catch site as intentional / suspicious.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                  |
|--------------------|-------|------|--------|----------------------------------------|
| Goal Clarity       | 0.95  | 0.75 | ✓      | Operator wrote the 3-bucket rubric verbatim |
| Boundary Clarity   | 0.95  | 0.70 | ✓      | All 134 files enumerated; 4 OUT components explicit; channel approach locked |
| Constraint Clarity | 0.90  | 0.65 | ✓      | D-01..D-17 pre-baked; no-code-change + severity-rubric explicit |
| Acceptance Criteria| 0.95  | 0.70 | ✓      | 9 pass/fail criteria, all greppable    |
| **Ambiguity**      | 0.06  | ≤0.20| ✓      | Gate passed                            |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective     | Question summary                                    | Decision locked                                              |
|-------|-----------------|----------------------------------------------------|-------------------------------------------------------------|
| 0     | Pre-locked      | Operator authored the 7-step plan + 17 D-decisions | All HOW decisions deferred to /gsd-discuss-phase 12         |
| 1     | Researcher      | Scout codebase — what's in scope?                  | 60 lib + 6 inngest + 19 api + 53 components = 138 candidates|
| 2     | Boundary Keeper | The 13 "PURE" components — which are really IN?    | Operator: 9 IN (4 deterministic + 5 ⚠️ASK confirmed), 4 OUT |
| 2     | Boundary Keeper | Channels — granularity?                            | Operator chose Recommended: per-reviewer local + 1 Plan-agent sweep → CHANNELS.md |

---

*Phase: 12-codebase-audit-baseline*
*Spec created: 2026-05-24*
*Next step: /gsd-discuss-phase 12 — lock the 17 D-decisions (HOW: agent strategy + evidence depth + cross-AI + synthesis + checkpoints)*
