---
phase: 11
title: Decommission Apps Script tier
created: 2026-05-24
baseline: c2f4f9c (after Phase 10)
authorisation: operator confirmed 2026-05-24
strategy: single agent, careful staged removal, regression test after each stage
---

# Phase 11 — Decommission Apps Script tier

## Why

Operator confirmed Apps Script tier is fully dormant. `READ_FROM=postgres` is
permanent (Phase 05.7.0). The `.gs` codepath is the only thing keeping the
classifier divergence note alive in `AUDIT.md` Cross-surface #1, and it
keeps the `algorithm-parity.test.ts` skipped-by-default test on life support.

Removing the entire tier is safer than leaving zombies — every line that
references "sheets" or "appsScript" is a future-trap for a developer who
forgets the cut-over happened.

## In scope

### Source files to delete (root-level .gs + clasp)
- `Shopify.gs`
- `Config.gs`
- `DailyUpdate.gs`
- `GoogleAds.gs`
- `MetaAds.gs`
- `SheetBuilder.gs`
- `Notifications.gs`
- `ManualOverrides.gs`
- `FX.gs`
- `Main.gs`
- `appsscript.json`
- `.clasp.json`

### dashboard-web cleanup
- `dashboard-web/src/lib/sheets.ts` — DELETE after relocating its 2 surviving exports:
  - `isAllowedStateKey` → move to a new `lib/dashboardStateKeys.ts` (or merge into `lib/cloudSync.ts` which is the natural owner since cloudSync defines the same `StateKey` type).
  - `StoreMetaRow` type → move into `lib/postgresReaders.ts` (its only consumer).
- `dashboard-web/src/lib/featureFlags.ts` — DELETE the `readFrom()` function (always returns 'postgres' now). Decide: delete the whole file if no other flags live there, OR keep the file with the read-from removed.
- `dashboard-web/src/lib/__tests__/featureFlags.test.ts` — DELETE (test only covers readFrom; once function gone, file is moot).
- `dashboard-web/src/lib/fetchers/__tests__/algorithm-parity.test.ts` — DELETE (AUDIT C-05).
- Comments in `lib/fetchers/meta.ts:28` and `lib/fetchers/shopify.ts:394` — UPDATE to remove the "READ_FROM=postgres is permanent and the .gs codepath is dormant" lines (the codepath no longer exists, so the comment lies).

### Documentation cleanup
- `SETUP.md` — likely has Apps Script setup instructions. Read it; rewrite if needed.
- `SYSTEM_OVERVIEW.md` — likely references both tiers. Rewrite to remove .gs tier.
- `README.md` — likely has setup pointers; rewrite section if it references clasp.
- `COGS_SETUP.md` — may reference Apps Script config; check.
- `WELCOME.md` — check.

### Memory update
- `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_script_roas_dashboard.md` mentions "standalone Apps Script project, clasp CI auto-deploys .gs on push". Update to reflect removal.

## Constraints

1. tsc clean after every commit.
2. Full vitest pass after every commit — no regressions to any of the 975 existing tests.
3. Use the conflict prevention rules (explicit paths in `git add`, atomic `git add+commit`, `git status --short` before each commit, absolute paths in `cd`).
4. Single agent — no parallel agents needed; scope is contained.

## Sequencing (suggested)

The agent commits in this order so each commit is independently safe:

1. **Relocate sheets.ts exports** → move `isAllowedStateKey` to new file + `StoreMetaRow` to postgresReaders. Update the 4 importing callers. Test that the dashboard still builds and tests pass. Sheets.ts now contains nothing referenced by anyone.
2. **Delete `sheets.ts`** + the test file `algorithm-parity.test.ts` + any test that exclusively targets sheets.ts.
3. **Delete `readFrom()` + `featureFlags.test.ts`** — confirm no remaining caller.
4. **Update comments** in `meta.ts` + `shopify.ts` + any other file with stale .gs references.
5. **Delete root-level .gs + clasp files** in one atomic commit.
6. **Documentation pass** — rewrite SETUP.md / SYSTEM_OVERVIEW.md / README.md to remove Apps Script references.

## Out of scope

- U-03 (CV magic numbers) — operator deferred ("when you have time"). Track as backlog.
- U-05 (COVERAGE_UPPER_CLAMP) — operator pending decision after explanation.
- Any other AUDIT.md polish items.

## Success criteria

- [ ] All 10 .gs files removed
- [ ] `appsscript.json` + `.clasp.json` removed
- [ ] `algorithm-parity.test.ts` removed (AUDIT C-05)
- [ ] `lib/sheets.ts` removed; exports relocated; no broken imports
- [ ] `readFrom()` removed; `featureFlags.test.ts` removed
- [ ] No file in `dashboard-web/src` mentions "sheets" except in legitimate context (e.g., a comment explaining historical migration). Use grep to verify.
- [ ] Documentation updated (no clasp / Apps Script setup instructions remain).
- [ ] tsc clean; 975 tests pass (minus the removed test files); ideally close to 975 minus the removed test file count.
- [ ] Final regression sweep before push.
