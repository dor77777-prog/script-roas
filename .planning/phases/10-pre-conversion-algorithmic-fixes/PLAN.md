---
phase: 10
title: Pre-Conversion Algorithmic Fixes
input: .planning/AUDIT.md
created: 2026-05-24
baseline: 6f71f754
strategy: 2 parallel agents (source / tests) → final regression → 2 verification agents → push
---

# Phase 10 — Pre-Conversion Algorithmic Fixes

## Why this phase exists

`.planning/AUDIT.md` (Phase 9) classified 10 algorithmic surfaces. The
findings: 1 🔴 bug, 5 ⚠️ uncertain (4 of them worth fixing now), and 5
verification-blocking test gaps (4 of them worth filling now).

This phase ships **3 groups** of remediation in atomic per-finding commits,
runs the full test suite, and then spawns 2 verification agents to confirm
no other components were affected.

## Scope

### Group A — concrete bug
- **B-01** — `cronLive.ts:1146-1149`: return value drops `tt` from
  `todaySpendCad`. One-line fix + type annotation update at `:537`.

### Group B — ⚠️ → ✅ resolutions
- **U-01** — TikTok writer↔reader asymmetry. Extract `TIKTOK_ACTIVE_ENOUGH`
  to a new `lib/platformConfig.ts` consumed by both:
  - `cronLive.ts:isActiveForPlatform` (writer)
  - `postgresReaders.ts:608` (reader)
- **U-02** — `cpmRoasAnalysis.ts:247`: emit a `'no-baseline'` verdict when
  `prevCpmMean === 0` AND `havePrev=true`, instead of silently mapping
  null delta → `'flat'` → operator-misleading "יציבות מלאה" copy.
- **U-04** — `attributionAnalysis.ts:511-525`: surface the `'mixed'`
  window-stability verdict to the operator (currently only `'stable'` and
  `'volatile'` get tooltip text — `'mixed'` is silently swallowed).
- **U-06** — `campaignHealthScore.ts:558`: rename
  `applyCohortHealthAdjustment` → `applyCohortAdjustmentOnce` and add an
  `assert(base.components.cohortAdjustment === 0)` runtime guard so
  double-apply fails loud.

### Group C — verification-blocking test backfills
- **C-01** — `aiReport.ts` statistics oracle. Add unit tests for
  `medianMad`, mean/variance/stddev/CV calculations, and CV-threshold
  bucket boundaries (0.15 / 0.35). Cover the momentum scoring path.
- **C-02** — `postgresReaders.ts` newest-row dedup fixture. Push two rows
  for the same `(key)` pair with different `updated_at`; assert the
  newer wins.
- **C-03** — `cronLive.ts` past-row backfill date-boundary fixture
  (lines ~1060-1103). Pin the UPDATE window's bounds (no off-by-one).
- **C-04** — `tiktok.ts` `code !== 0` envelope path. Pin that a
  TikTok envelope with `code !== 0` surfaces as an Error (not silent 0).

## Out of scope (deferred to polish pass)

- **U-03** — `aiReport.ts` magic-number CV thresholds (cosmetic)
- **U-05** — `attributionAnalysis.ts` `COVERAGE_UPPER_CLAMP = 2` (operator-tunable)
- **C-05** — re-enable / remove `algorithm-parity.test.ts` (operator decision)
- Tooling: vitest glob to cover `inngest/__tests__/`, cross-fetcher contract tests, cron-live × Supabase integration tests.

## Agent ownership matrix (zero file overlap)

### Agent K — Source fixes (Groups A + B)
- `dashboard-web/src/inngest/functions/cronLive.ts` — B-01 (return value at `:1146-1149` + type at `:537`) + U-01 (extract TIKTOK_ACTIVE_ENOUGH)
- `dashboard-web/src/lib/platformConfig.ts` — NEW FILE (U-01)
- `dashboard-web/src/lib/postgresReaders.ts` — U-01 (import the shared set at `:608`)
- `dashboard-web/src/lib/cpmRoasAnalysis.ts` — U-02 ('no-baseline' verdict)
- `dashboard-web/src/lib/attributionAnalysis.ts` — U-04 (surface 'mixed' verdict at `:511-525`)
- `dashboard-web/src/lib/campaignHealthScore.ts` — U-06 (rename + assert)
- Matching tests in `__tests__/` that pin the new behaviour for each finding

### Agent L — Test backfills only (Group C)
- `dashboard-web/src/lib/__tests__/aiReportStatistics.test.ts` — NEW FILE (C-01)
- `dashboard-web/src/lib/__tests__/postgresReadersNewestRowDedup.test.ts` — NEW FILE (C-02)
- `dashboard-web/src/inngest/functions/__tests__/cronLivePastRowBackfill.test.ts` — NEW FILE (C-03)
- `dashboard-web/src/lib/fetchers/__tests__/tiktok.test.ts` — APPEND C-04 cases to existing file
- Agent L does NOT modify any source code — read-only on source

## Conflict prevention (REQUIRED — applies to both agents)

The v1/v3 git-add races taught us:

1. **NEVER use `git add -A` or `git add .`** — only `git add <explicit-paths>` for owned files.
2. **Combine `git add` + `git commit` in a SINGLE Bash invocation** chained with `&&`.
3. **Before each commit** run `git status --short` and confirm ONLY your owned files appear staged.
4. **Use ABSOLUTE paths** in `cd` and `git add` (cwd state doesn't persist between Bash calls).
5. **Use `git commit --only <paths>`** as defense-in-depth.

## Test discipline (REQUIRED — strict)

- Every commit ends with `cd dashboard-web && npx tsc --noEmit && npx vitest run` — BOTH must pass.
- Every fix gets ≥1 regression test that asserts the pre-fix behaviour would have failed.
- Production-shaped fixtures (real row shapes, real fetcher payloads).
- For Group C tests: use real-shape inputs that mirror Supabase/TikTok payloads.

## Operator constraints (DO NOT regress)

1. GoalTracker is GLOBAL — ignores `filters.store` + `filters.range`.
2. TodayLive is always LIVE — `today` recomputed every render.
3. WhatsApp alerts ONLY to +972524809540 — single-recipient intentional.
4. Per-store COGS via `${STORE_UPPERCASE}_COGS_RATE` env var.
5. Asia/Jerusalem TZ canonical.
6. Hebrew RTL — `start/end` properties.
7. v1+v2+v3 audit fixes (77 commits in `48a377e..6f71f75`) are CURRENT TRUTH — do NOT regress them.

## After both agents complete

1. Orchestrator runs final `npx tsc --noEmit && npx vitest run`.
2. Orchestrator spawns 2 verification agents in parallel:
   - **Verify-Code** (gsd-code-reviewer subagent): re-reviews the diff of Phase 10 + adjacent code paths for any introduced bugs / intent regressions.
   - **Verify-Impact** (Explore subagent): grep-based cross-impact check — does ANY other file consume the renamed/changed symbols (`applyCohortHealthAdjustment`, `todaySpendCad`, `TIKTOK_ACTIVE_ENOUGH`, etc.) and does it still work?
3. If both verifications PASS: push Phase 10 commits to main.
4. If either flags a regression: surface to operator, do not push.

## Expected output

- Group A: 1 commit
- Group B: 4 commits (one per U-finding)
- Group C: 4 commits (one per C-finding)
- Total: ~9 atomic commits
- New tests: ~20-30 added (1+ per fix, 4-8 per C-backfill)
- Final test count: ~935-950 passing (up from 915)
