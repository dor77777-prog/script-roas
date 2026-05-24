# Phase 12: Codebase Audit Baseline — Context

**Created:** 2026-05-24
**Decisions captured:** 21 (17 operator-pre-locked D-decisions + 4 discuss-phase resolutions)
**SPEC.md:** `.planning/phases/12-codebase-audit-baseline/12-SPEC.md` (4b77df1)

---

## <spec_lock>

**8 requirements LOCKED by SPEC.md.** Downstream agents (gsd-planner, gsd-executor) MUST read SPEC.md before acting. Do NOT re-derive WHAT/WHY from this CONTEXT.md — it only captures HOW.

| # | Requirement (one-liner)                                        |
|---|---------------------------------------------------------------|
| 1 | Per-file verdict for every in-scope file (134 files)          |
| 2 | Reproduction-grade evidence per 🔴 (5 D-02 fields)             |
| 3 | Inter-component channel map (12-CHANNELS.md)                  |
| 4 | Test-coverage gap survey (12-tests-needed.md)                 |
| 5 | Cross-cutting try/catch sweep (D-12)                          |
| 6 | Operator-checkpoint resolves every ⚠️ → zero in final AUDIT.md|
| 7 | No source-code changes during this phase                      |
| 8 | AUDIT.md triage table drives conditional Phase 12.x split     |

## <canonical_refs>

Files downstream agents MUST read in order to plan + execute correctly.

| Path | Why |
|---|---|
| `.planning/phases/12-codebase-audit-baseline/12-SPEC.md` | Locked requirements — MUST read before planning |
| `.planning/AUDIT.md` (does NOT exist yet — Phase 12 produces it) | Will be the canonical output artifact |
| `.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md` | Prior audit baseline (10 surfaces). Reviewers MUST read entries for files in their wave; do NOT re-flag Phase-10-resolved findings. |
| `.planning/codebase/ARCHITECTURE.md` | Inngest functions + 19 API routes + 11 Supabase tables map |
| `.planning/codebase/STRUCTURE.md` | Full src tree, 235 TS/TSX file inventory |
| `.planning/codebase/STACK.md` | Runtime + tooling + API versions + env contract |
| `.planning/codebase/INTEGRATIONS.md` | External services + auth + endpoints |
| `.planning/codebase/CONVENTIONS.md` | Coding conventions reviewers should respect |
| `.planning/codebase/TESTING.md` | 946 tests / 86 files / coverage gap context |
| `.planning/codebase/CONCERNS.md` | Known open tech-debt (cross-reference, not re-flag) |
| `.planning/graphs/graph.json` (6.8 MB) | 7,625 nodes / 9,107 edges — feed for the Plan-agent that builds 12-CHANNELS.md |
| `.planning/graphs/GRAPH_REPORT.md` (220 KB) | Human-readable graph summary; reviewers cross-reference for inter-component edges |
| `.planning/STATE.md` | Milestone v2.0 evolution log |

## <domain>

Phase 12 delivers a documented baseline of "verified correct" for the active codebase. **Documentation-only phase** — produces `.planning/AUDIT.md` + 2 sibling working docs. No source-code changes.

The audit is the entry phase of milestone v2.0 (`audit-baseline`). Phase 12.x — conditional fix phases — will follow ONLY if 🔴 critical findings surface, derived from AUDIT.md's triage table.

---

## <decisions>

### Operator-pre-locked decisions (D-01 .. D-17)

These were captured verbatim from the operator's original 7-step prompt for this milestone. They are **non-negotiable** by downstream agents — DO NOT re-litigate.

| ID    | Decision (HOW)                                                                                                                                                            |
|-------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| D-01  | One `gsd-code-reviewer` agent per file, parallel waves of ~10 reviewers per wave                                                                                          |
| D-02  | Reproduction-grade evidence per 🔴 finding: (1) file:line, (2) failing input, (3) expected output, (4) actual output, (5) fix sketch + regression-test idea               |
| D-03  | Tests-first audit: reviewer reads `__tests__/{file}.test.ts` BEFORE `{file}.ts`. "Verified" = correct code + test coverage of operator-relevant behavior                  |
| D-04  | Orchestrator synthesizes — each reviewer returns structured findings; orchestrator merges into AUDIT.md with consistent format + single triage table                       |
| D-05  | Severity rubric: **Critical** = wrong output on real production data (empirical, not theoretical). Reviewer MUST cite the production-shape scenario                       |
| D-06  | CANCELLED — no multi-tenant launch concern; scope is "today, on existing data"                                                                                            |
| D-07  | **Minor** = wrong output in rare edge case. **Cosmetic** = code smell with no output impact (dead code, missing JSDoc, weak typing internal, `console.log`)               |
| D-08  | ⚠️ Uncertain → operator triage; all resolved to ✅ or 🔴 BEFORE AUDIT.md ships. Zero ⚠️ in final document                                                                |
| D-09/10/11 | Scope defined in SPEC.md §Boundaries (134 files: lib + inngest + api + 49 components)                                                                                |
| D-12  | Cross-cutting sweep ONE: try/catch without rethrow across entire `dashboard-web/src/`. Systemic pattern per-file audit misses                                              |
| D-13  | Out of scope per SPEC.md §Boundaries: pure UI presentation, third-party libs, generated code, .md docs, supabase migrations, infra config                                  |
| D-14  | Cross-AI convergence ONLY on statistical algorithm files: `attributionAnalysis.ts`, `aiReport.ts`, `multiMappingCohort.ts`, `cannibalizationDetection.ts`, `cpmRoasAnalysis.ts`. Skip if no statistical drift suspicion surfaces |
| D-15  | Cross-AI convergence mechanism: Opus reviews → Codex critiques the review → converge. Finding enters AUDIT.md only when both AIs agree OR operator breaks tie. Disagreements get "⚠️ Disputed by [AI]" annotation until operator resolves |
| D-16  | Test-coverage gap survey: a single Plan-agent runs AFTER all reviewers complete. Does dedupe + ranking on gaps reviewers flagged inline. Produces `12-tests-needed.md` sorted by priority |
| D-17  | File layout — `.planning/AUDIT.md` at root (permanent artifact) + `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` (phase-scoped working doc) + `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` (phase-scoped channel map) |

### Discuss-phase resolutions (operator-confirmed 2026-05-24)

| ID    | Decision (HOW)                                                                                                                                                            |
|-------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| DP-01 | **Wave split by directory** — keep context tight per reviewer. Concrete wave plan: Wave A `lib/algorithm` (analytics, insights, attributionAnalysis, aiReport, multiMappingCohort, cannibalizationDetection, campaignHealthScore, cpmRoasAnalysis, productCentricView, ordersAttribution, campaignProductMap, campaignsAggregator). Wave B `lib/services` (fetchers/*, hooks/*, notifications/*). Wave C `lib/state+infra` (cloudSync, drawerStack, useDashboardRefresh, postgresReaders, supabase, supabaseAdmin, presets, dashboardStateKeys, types, utils, format, dateRange, dateValidation, rangeClamp, urlState, sessionKeys, cacheConfig, constants, drillFilter, apiErrors, platformConfig, platformsByStore, sparklineGeometry, chartColors, shopifyRevenueRefunds, lineItems, productCatalog, ads, billing, campaigns, campaignOptimized, campaignsColumnPrefs, campaignsLinks, products, costs, operatorReset, annotations). Wave D `inngest/*` (cronDaily, cronLive, cronWhatsapp, eventBackfill, eventSyncNow, client). Wave E `api/` (19 routes split into 2 sub-waves of ~10). Wave F `components-bizlogic` (40 split into 4 sub-waves of ~10). Wave G `components-borderline` (4 confirmed-IN + 5 operator-confirmed-IN = 9 in one wave). gsd-planner finalizes the exact per-wave file lists. |
| DP-02 | **Checkpoint timing: mid-execution.** After ALL reviewers complete + BEFORE Plan-agent for tests-needed.md AND before final AUDIT.md write. Sequence: all-reviewers → collect ⚠️ → operator-checkpoint → Plan-agent (test gaps) → cross-cutting try/catch sweep → AUDIT.md synthesis-write |
| DP-03 | **Triage UX: batched AskUserQuestion with table.** One prompt = all ⚠️ entries with file:line + reviewer's reasoning. Multi-select per finding (✅/🔴/needs-more-research). If >4 ⚠️ entries, split into multiple prompts of 3-4 each. The "needs-more-research" branch loops back to a single follow-up reviewer (per file) before re-asking |
| DP-04 | **AUDIT.md write strategy: all-at-once atomic.** Orchestrator collects all structured reviewer returns + Plan-agent output + try/catch sweep + operator-resolution log → merge in-memory → single atomic write. NEVER incremental append. Risk: agent crash mid-execute means re-running waves; mitigation: each reviewer commits its raw structured return to `.planning/phases/12-codebase-audit-baseline/raw-returns/{file-slug}.json` immediately after completion (this IS incremental but to working files, not the canonical AUDIT.md) |

### Cross-AI invocation specifics (refines D-14 / D-15)

- **Trigger condition:** Always-on for the 5 statistical files in D-14. Codex pass spawned automatically after Opus pass on each of those files completes, WITHOUT waiting for human signal.
- **Codex pass scope:** Each Codex invocation gets Opus's structured return + the source file + the test file + relevant fixtures. Codex's output: VERIFY / VERIFY-WITH-CAVEAT / REJECT / UNCERTAIN per finding, plus optionally up to 5 NEW findings Opus missed.
- **Convergence logic:** Finding enters AUDIT.md as ✅ if both AIs verify; as 🔴 if both agree (severity = lower of the two if they disagree on severity); as `⚠️ Disputed by [AI]` if they disagree on existence, which becomes an operator-checkpoint triage item.
- **Skip condition:** If 0 statistical files surface ANY finding from Opus pass, Codex pass is skipped (D-14 escape hatch).

### Operator-checkpoint precise UX

```
AskUserQuestion(
  header: "⚠️ Triage 1/N",
  question: "3 of the 17 ⚠️ Uncertain findings from per-file review. Pick a resolution for each:",
  options: per-question, 3 options each:
    - "✅ Verified — file is fine, audit-time uncertainty was unwarranted"
    - "🔴 Has bug — promote to a finding with severity {operator picks}"
    - "Re-research — spawn one follow-up reviewer with deeper context (delay this finding by ~10 min)"
)
```

Loop until all ⚠️ resolved. "Re-research" entries get one more reviewer pass; if STILL ⚠️ after re-research → operator picks ✅ or 🔴 (no second re-research allowed).

### "Definitely include" reviewer prompt scaffolding

Every reviewer gets this skeleton (planner customizes per file):
```
You are gsd-code-reviewer for {FILE}.

Read first (D-03):
1. The test file at {TEST_PATH} (if exists). Note what's covered + gaps.
2. The source file at {FILE}.

Cross-reference (do NOT re-flag):
- .planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md — find any entry mentioning {FILE}. If found, the listed bugs are FIXED (Phase 10). Do not re-flag.
- Recent commits touching this file: `git log b846ae7..main -- {FILE}` — these are the current truth.

Operator constraints (NEVER flag as bugs):
- GoalTracker GLOBAL (ignores filters.store + filters.range)
- TodayLive always LIVE (own SWR fetch)
- WhatsApp alerts ONLY to +972524809540
- Per-store COGS via ${STORE}_COGS_RATE env var
- Asia/Jerusalem TZ canonical
- Hebrew RTL — `start/end` Tailwind properties

Severity rubric (D-05/D-07):
- CRITICAL: wrong output on real production data — cite the production-shape scenario
- MAJOR: wrong output under realistic conditions
- MINOR: wrong output in rare edge case
- COSMETIC: code smell with no output impact

Output (structured):
- per-finding: severity, file:line, failing input, expected, actual, fix sketch, regression-test idea
- inline test-coverage gap list (for the Plan-agent later to dedupe)
- inline inter-component channel list (imports / props / events / SWR keys / Inngest triggers / Supabase reads/writes / API calls)
- verdict for the file: ✅ Verified / 🔴 Has bug / ⚠️ Uncertain (with what would settle it)

Write to: .planning/phases/12-codebase-audit-baseline/raw-returns/{FILE_SLUG}.json
```

---

## <code_context>

### Reusable assets per `.planning/codebase/`
- **`gsd-code-reviewer` agent** — already exists. Used in Phase 9 + Phase 10 verify-code. Familiar with the codebase conventions.
- **Prior audit artifacts** (`.planning/audit-2026-05-23-v3/`) — 4 OPUS review files + Codex verification + master report. Pattern for the format AUDIT.md should follow.
- **Knowledge graph at `.planning/graphs/`** — built 2026-05-24 with graphify (7,625 nodes / 9,107 edges). Plan-agent for CHANNELS.md should query this first via `graphify query {term}` instead of grep-from-scratch.
- **Vitest config covers both `lib/__tests__` AND `inngest/__tests__`** (confirmed during Step 1a quality scout — `vitest.config.ts:35-38`). Reviewers can rely on `npm run test` reporting everything.

### Patterns to follow (from prior audits Phase 9/10/11)
- Atomic per-finding commits with `(AUDIT {ID})` suffix in commit message
- Markdown structure: H2 per file, H3 per finding, with file:line + snippet
- Triage table format from `AUDIT-phase9-snapshot.md` is the canonical shape

### Files NOT to touch during execution
- All `dashboard-web/src/**/*.ts` and `**/*.tsx` — source code
- All `dashboard-web/src/**/__tests__/**` — test files
- `supabase/migrations/**/*.sql` — schema
- `apps-script/` doesn't exist (Phase 11 removed it)

---

## <deferred>

Items raised but explicitly OUT of Phase 12 (carry forward to Phase 12.x or backlog):

- **Schema audit of supabase migrations** — out per SPEC.md. If operator wants this, separate phase.
- **Audit of `dashboard-web/src/app/**/page.tsx` + layout.tsx** — Next.js routing shells, OUT per SPEC.md.
- **Re-enabling `algorithm-parity.test.ts`** — DELETED in Phase 11; operator decision, not auditor's call.
- **U-03 from Phase 9 snapshot** (CV thresholds magic numbers) — cosmetic, operator deferred to "when you have time" backlog. Audit will likely re-surface; orchestrator should reference the prior decision in the AUDIT.md entry.

---

*Phase: 12-codebase-audit-baseline*
*Context created: 2026-05-24*
*Next step: /gsd-plan-phase 12 — produce PLAN.md with per-wave task breakdown + checkpoint + synthesis + tests-needed steps*
