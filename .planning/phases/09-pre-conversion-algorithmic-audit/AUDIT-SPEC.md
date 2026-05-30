---
phase: 9
title: Pre-Conversion Algorithmic Audit
type: report-only
deliverable: .planning/AUDIT.md
no_code_changes: true
created: 2026-05-24
---

# Phase 9 — Pre-Conversion Algorithmic Audit

## Why this phase exists

Before the dashboard moves into "conversion funnel" work, we owe the operator a
one-shot, ground-truth audit of every algorithmic surface that already drives
decisions: attribution analysis, health scoring, CPM/ROAS trajectory, product
allocation, refund accounting, fetchers, the effective-status pipeline, and
the statistical computations inside the AI report.

The output is a **single classification document** — `.planning/AUDIT.md` —
that for each algorithm/component returns one of three statuses with
evidence, then summarises all 🔴 Bug findings in a triage table that maps
each bug to severity and the future fix phase.

**No code changes are made in this phase.** Only `.planning/AUDIT.md` is
written. Bug fixes get their own follow-up phases.

## Scope (concrete files / functions)

1. `dashboard-web/src/lib/analyzeAttribution.ts` (~746 LOC) — Bayesian CI,
   trust score, window stability, outlier detection.
2. `dashboard-web/src/lib/campaignHealthScore.ts` — 4 components, weights
   .4/.15/.25/.2, insufficient gate $30/$100, trust modulation, operator
   adjustments.
3. `dashboard-web/src/lib/cpmRoasAnalysis.ts` — half-over-half, prev-period,
   neutral fallbacks.
4. `dashboard-web/src/lib/campaignProductMap.ts` — `allocateProductRevenue`
   per-platform.
5. `dashboard-web/src/lib/fetchers/shopify.ts` — refund handling,
   `buildWindowUrl`, `total_price` vs `current_total_price`.
6. `dashboard-web/src/inngest/functions/cronLive.ts` — `effective_status`
   UPDATE logic (Phase 05.7.x).
7. `dashboard-web/src/lib/fetchers/{meta,googleAds,tiktok,fx}.ts` —
   extraction patterns + currency handling.
8. Order attribution classifier (`Shopify.gs:classifyOrderAttribution_`,
   ported to TS in `fetchers/shopify.ts`) — priority ladder
   fbclid → gclid → utm → referring_site.
9. `dashboard-web/src/lib/aiReport.ts` — statistical computations
   (z-score, CV, momentum).
10. `dashboard-web/src/lib/postgresReaders.ts` aggregator behavior — triggers
    of `effective_status`, newest-row selection semantics.

## Classification rubric

| Status | Meaning | Evidence required |
|---|---|---|
| ✅ Verified correct | Algorithm matches intent; math is sound; edge cases handled | Test coverage citation OR math derivation OR manual trace through the code |
| 🔴 Has bug | Concrete defect found in math, edge case, or business intent | Bug description + impact + suggested fix + file:line |
| ⚠️ Uncertain | Cannot decide without operator input or historical-data validation | What the open question is + what data/decision would settle it |

## Method

Two parallel agents:

### Agent A — `gsd-code-reviewer` (math + edge cases)
Verifies math correctness, checks test coverage per algorithm, flags missing
edge cases, points at concrete file:line evidence. Produces a per-file
verdict for each of the 10 scope items.

### Agent B — `Plan` subagent (test-suite architectural pass)
Walks the existing test files and answers: for each algorithm above —
which have tests, which don't, where are the holes? Identifies coverage
gaps and the boundaries between "tested for happy path" vs "untested for
edge cases". Output is consumed by the synthesis step.

### Synthesis
The orchestrator (this conversation) merges both agent reports into
`.planning/AUDIT.md` with the structure below. Bugs across both agents
deduplicated and ranked.

## `.planning/AUDIT.md` structure

```markdown
# Pre-Conversion Algorithmic Audit
Date: 2026-05-24 · Phase: 9 · Output of: gsd-code-reviewer + Plan subagent
Baseline: <commit SHA at audit time>

## Summary table
| # | Surface | Status | Evidence |
|---|---|---|---|
| 1 | analyzeAttribution.ts | ✅/🔴/⚠️ | one-line summary |
| ... | ... | ... | ... |

## Per-surface verdicts
### 1. analyzeAttribution.ts
**Status:** ✅ / 🔴 / ⚠️
**Evidence / Reasoning:** ...
**Test coverage gap (from Plan agent):** ...
**Issues (if any):** ...

(one section per scope item)

## Test-suite gap analysis (from Plan agent)
- Surface X: 0 tests
- Surface Y: tested for happy path only; missing edge cases A, B
- ...

## Bug triage table
| Bug | Severity | Fix in phase |
|---|---|---|
| <description> | Critical / Major / Minor / Cosmetic | Phase N (proposed) |
```

## Constraints (DO NOT)

- DO NOT modify any source code. Read-only audit.
- DO NOT add tests in this phase. That belongs to the follow-up fix phases.
- DO NOT speculate on bugs without file:line evidence. ⚠️ Uncertain is the
  honest answer when evidence is missing.
- DO NOT regress prior operator constraints (GoalTracker is global,
  TodayLive is always live, single-recipient WhatsApp, per-store COGS env,
  Asia/Jerusalem TZ).

## Success criteria

- [ ] `.planning/AUDIT.md` exists at repo root of `.planning/`
- [ ] All 10 scope surfaces have a verdict
- [ ] Every 🔴 Bug has file:line + suggested fix + severity + target-fix-phase
- [ ] Every ⚠️ Uncertain has a clear "what would settle this" line
- [ ] No source files were modified during this phase
