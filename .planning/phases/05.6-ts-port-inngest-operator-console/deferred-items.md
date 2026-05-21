# Phase 05.6 — Deferred Items

## Plan 14 (wave 7)

### dashboard-web/package-lock.json drift (not committed)

- **Discovered:** During plan 14 verification step.
- **Symptom:** `npm ci` exits 1 ("Missing: estraverse@4.3.0 from lock file");
  `npm install` succeeded and re-wrote the lockfile (+638 / −6 lines).
- **Scope:** Pre-existing — independent of plan 14's code changes
  (sync-now + backfill routes + BackfillPicker UI only).
- **Action taken:** None. The regenerated lockfile is left in the worktree
  tree but NOT committed. Plan 14 commits only the four files in
  `<files_modified>`.
- **Recommendation for future plan:** A dedicated chore commit should
  reconcile the root lockfile and the `dashboard-web/package-lock.json` and
  re-run `npm ci` cleanly. Touching the lockfile mid-feature would have
  surfaced dependency-resolution surprises across the rest of phase 05.6
  (waves 1-6 already shipped against the old lockfile).
