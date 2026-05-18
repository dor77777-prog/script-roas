---
phase: 03-ci-cd-apps-script
plan: 01
subsystem: infra
tags: [ci-cd, apps-script, clasp, github-actions, deploy-automation, oauth]

# Dependency graph
requires:
  - phase: 02-foundations
    provides: "Node 22 LTS pinned in dashboard-web (consistent with deploy-gs runner), existing dashboard-web/package.json shape as analog for root manifest minimalism"
provides:
  - "Root `package.json` + `package-lock.json` with `@google/clasp` devDep and `deploy:gs` script"
  - "`.clasp.json` (scriptId + rootDir) committed at repo root"
  - "`.claspignore` scoping clasp to `*.gs` + `appsscript.json` (excludes node_modules + planning artifacts)"
  - "`.github/workflows/deploy-gs.yml` — first GitHub Actions workflow in repo; runs `clasp push --force` on push to main with paths filter"
  - "`CLASPRC_JSON` GitHub Secret pattern (env block, printf+chmod, no stdout echo)"
  - "SETUP.md שלב 0.5 — 5-subsection Hebrew RTL operator guide for one-time clasp setup + troubleshooting table"
  - "SYSTEM_OVERVIEW.md mention of automatic deploy woven into existing Apps Script section"
affects: [phase-04, phase-05, phase-06, phase-07]

# Tech tracking
tech-stack:
  added:
    - "@google/clasp ^2.4.2 (devDep, root)"
    - "GitHub Actions (first workflow in repo)"
  patterns:
    - "CI secret-handling: env block + printf '%s' + chmod 600 + never echo to stdout (D-08)"
    - "GitHub Actions paths filter for cost/noise reduction (D-01) — model for future Phase 5/6/7 workflows"
    - "Two separate npm lockfiles (root + dashboard-web/) — no npm workspaces"
    - "clasp deploy via `npm ci` → `npx clasp status` pre-flight → `npm run deploy:gs`"

key-files:
  created:
    - "package.json (root)"
    - "package-lock.json (root)"
    - ".clasp.json"
    - ".claspignore"
    - ".github/workflows/deploy-gs.yml"
  modified:
    - ".gitignore (remove .clasp.json, add .clasprc.json)"
    - "SETUP.md (שלב 0 callout + new שלב 0.5 section + ## אבטחה bullet)"
    - "SYSTEM_OVERVIEW.md (deploy paragraph in ### 1. Google Apps Script)"

key-decisions:
  - "D-01: paths filter (`**.gs` + `appsscript.json`) — only deploys when actually needed"
  - "D-02: no workflow_dispatch — deferred (retry via dummy commit)"
  - "D-03: trigger on push to main only — no PR/branch deploys"
  - "D-04/D-05: `.clasp.json` removed from .gitignore FIRST (Task 1) before being created (Task 4) — scriptId is non-secret per clasp docs"
  - "D-06: path B1 chosen — link to existing Apps Script project via real scriptId (not clasp clone, which would risk overwriting local files)"
  - "D-07: CLASPRC_JSON GitHub Secret = verbatim ~/.clasprc.json from local clasp login"
  - "D-08: credential write via env block + printf '%s' (avoids trailing newline) + chmod 600; secret never echoed to stdout"
  - "D-09: SETUP.md documents 6-mo invalid_grant recovery (re-login + update Secret value)"
  - "D-13: no Slack until Phase 7 — GitHub default email + Actions tab only"
  - "D-14: minimal package.json (no version/description/license/repository keys)"
  - "D-15: --force required for CI overwrite of server-side state; manual editor edits would be clobbered (T3 documented in SETUP)"
  - "D-16: rootDir '.' — clasp picks up the 9 .gs files + appsscript.json in flat layout at repo root"
  - "D-17: pre-commit hook deferred to Phase 7 (observability)"
  - "D-18: idempotency — clasp push --force is no-op on second run with no diff; mid-failure retry safe"
  - "Orchestrator deviation: `.claspignore` added (not in original plan) — required because Task 2's `npm install` creates node_modules/ which clasp would otherwise scan + try to upload"

patterns-established:
  - "GitHub Actions workflow with paths filter — model for future workflows (Phase 5 per-store triggers / Phase 6 rate-limit infra / Phase 7 observability cron)"
  - "CI secret-handling: env block + printf '%s' + chmod 600 + grep-gate against `echo $SECRET` patterns"
  - "Root-level npm manifest minimalism: name + private + scripts + devDependencies (no version, description, license)"
  - "`.claspignore` companion to `.clasp.json` — required whenever clasp coexists with node_modules at the same rootDir"
  - "Hebrew RTL documentation convention preserved: English technical identifiers inline (clasp, CLASPRC_JSON, GitHub Actions); top-level `## שלב N`, sub `### Nא./Nב./Nג.`"

requirements-completed: [PHASE-3-CICD]

# Metrics
duration: 32min
completed: 2026-05-18
---

# Phase 3 Plan 1: CI/CD for Apps Script Summary

**Auto-deploy of 9 `.gs` files + `appsscript.json` to script.google.com on every `git push origin main` via clasp + GitHub Actions, eliminating the manual paste-per-file step that was the daily-workflow's top friction point.**

## Performance

- **Duration:** ~32 min (21:28→21:59 IDT — first chore commit through final docs commit, excluding the 16-min operator pause for clasp login + Secret upload between Tasks 3 and 4)
- **Started:** 2026-05-18T18:28:15Z (Task 1 commit)
- **Completed:** 2026-05-18T18:59:48Z (Task 6 commit)
- **Tasks:** 6 (3 auto + 1 human-action + 1 human-verify + 1 auto)
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `npm run deploy:gs` from local pushes all `.gs` + `appsscript.json` files to Apps Script (Success Criterion 1)
- GitHub Action run #26053537084 completed green in 24s with "Pushed 10 files." — verified end-to-end (Success Criterion 2)
- Manual paste-per-file into script.google.com editor is no longer needed for ongoing edits (Success Criterion 3); שלב 0 retains the manual bootstrap instructions for first-time setup only
- SETUP.md gained a complete 5-subsection שלב 0.5 covering install/login, project linking, GitHub Secret, end-to-end test, and a 6-row troubleshooting table (Success Criterion 4)
- `.clasprc.json` gitignored, `.clasp.json` committed — Task 1 sequencing prevented the silent-ignore landmine (Success Criterion 5)
- SYSTEM_OVERVIEW.md `### 1. Google Apps Script` section has the deploy-automation paragraph cross-linking to SETUP שלב 0.5 (Success Criterion 6)
- First GitHub Actions workflow established in the repo — pattern reusable for Phases 5/6/7

## Task Commits

Each task was committed atomically:

1. **Task 1: .gitignore swap (.clasp.json out, .clasprc.json in)** — `e98afb5` (chore)
2. **Task 2: root package.json + npm install** — `2a27477` (chore)
3. **Task 3: GitHub Actions workflow deploy-gs.yml** — `1052737` (ci)
4. **Mid-plan progress tracker (Tasks 1-3 checkpoint)** — `1a2c3a6` (docs)
5. **Task 4: .clasp.json + .claspignore (operator action + orchestrator deviation)** — `b5a30a5` (chore)
6. **Task 5: smoke-test trigger (ManualOverrides.gs comment)** — `09dc5ad` (test)
7. **Task 6: SETUP.md + SYSTEM_OVERVIEW.md Hebrew RTL docs** — `beff972` (docs)

**Plan metadata commit:** `<next>` (docs(phase-03): complete plan 03 with SUMMARY)

## Files Created/Modified

| Path | Role |
|------|------|
| `.gitignore` | MOD — removed `.clasp.json` line 1, appended `.clasprc.json` (preserves 4-line minimalism) |
| `package.json` (root) | NEW — D-14 verbatim body: name + private + scripts.`deploy:gs` + devDep `@google/clasp ^2.4.2` |
| `package-lock.json` (root) | NEW — npm-generated lockfile (committed for deterministic CI `npm ci`) |
| `.clasp.json` | NEW — clasp project descriptor with real scriptId + `rootDir: "."` per D-16 (operator-supplied scriptId in Task 4) |
| `.claspignore` | NEW (orchestrator deviation) — scopes clasp to `*.gs` + `appsscript.json` only; excludes node_modules + .planning/ + dashboard-web/ |
| `.github/workflows/deploy-gs.yml` | NEW — push trigger on main with `**.gs` + `appsscript.json` paths filter; 6 steps (checkout, setup-node 22, npm ci, write creds, clasp status, deploy); concurrency `deploy-gs cancel-in-progress: true`; timeout-minutes: 5 |
| `SETUP.md` | MOD — שלב 0 callout, new שלב 0.5 (5 subsections + 6-row troubleshooting table), `## אבטחה` bullet for `.clasprc.json` Secret pattern |
| `SYSTEM_OVERVIEW.md` | MOD — deploy-automation paragraph appended to `### 1. Google Apps Script` section (woven into existing context, NOT a new `##` heading per PATTERNS.md) |

## Key Links Established

| From | To | Via |
|------|----|----|
| `git push origin main` | `.github/workflows/deploy-gs.yml` | GitHub Actions push trigger with paths filter `**.gs` + `appsscript.json` |
| `.github/workflows/deploy-gs.yml` | `~/.clasprc.json` (runner home) | env block + `printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"` + `chmod 600` (D-08 — never echo to stdout) |
| `clasp push --force` | script.google.com Apps Script project | `.clasp.json` (scriptId) + `~/.clasprc.json` (OAuth refresh token) |
| `package.json scripts.deploy:gs` | `@google/clasp` binary in `node_modules/.bin` | `npm run deploy:gs` runs `clasp push --force` |

## Decisions Made

D-01 (paths filter), D-02 (no workflow_dispatch — deferred), D-03 (main only), D-04/D-05 (gitignore sequencing — task-1-first prevents silent-ignore landmine), D-06 (path B1 — link to existing project, not clone), D-07 (CLASPRC_JSON GitHub Secret), D-08 (credential write via env block + printf + chmod 600, never echo), D-09 (6-month invalid_grant recovery in SETUP), D-13 (no Slack until Phase 7), D-14 (minimal root package.json — no metadata noise), D-15 (--force required for CI; T3 documented), D-16 (rootDir "."), D-17 (pre-commit hook deferred to Phase 7), D-18 (idempotency).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `.claspignore` to scope clasp to `*.gs` + `appsscript.json`**
- **Found during:** Task 4 (operator clasp clone + first `npx clasp status`)
- **Issue:** Plan did not include `.claspignore`. After Task 2's `npm install`, the repo root contains `node_modules/` (~hundreds of files). Without a `.claspignore`, `clasp push --force` would attempt to upload all of `node_modules/` to the Apps Script project, which would (a) fail because Apps Script does not accept arbitrary files, (b) waste time + clasp API quota, and (c) potentially corrupt the project on partial-success. This is a correctness requirement, not a feature.
- **Fix:** Orchestrator added `.claspignore` at repo root (committed alongside `.clasp.json` in Task 4 commit `b5a30a5`) with content scoping clasp to `*.gs` + `appsscript.json` and explicitly excluding `node_modules/**`, `.planning/**`, `dashboard-web/**`, and other top-level artifacts.
- **Files modified:** `.claspignore` (new) — single new file
- **Verification:** Smoke test (Task 5, Action run #26053537084) showed `Pushed 10 files.` exactly — the 9 `.gs` files + `appsscript.json` (not 100+ node_modules files). Local `npx clasp status` lists only the intended 10 files.
- **Committed in:** `b5a30a5` (Task 4 commit, alongside `.clasp.json`)
- **Documented in Task 6:** SETUP.md שלב 0.5ב includes a note explaining why `.claspignore` is required and what it scopes.

**2. [Rule 2 - Missing Critical] Added Node 20 deprecation warning row to SETUP.md troubleshooting table**
- **Found during:** Task 5 smoke test (operator observed warning in Action #26053537084 log)
- **Issue:** GitHub Actions logs print a warning that `actions/checkout@v4` and `actions/setup-node@v4` internally run on Node 20, which GitHub will force-default to Node 24 on 2026-06-02 and remove on 2026-09-16. Without documentation, future operators would not know whether the warning is blocking or how to recover.
- **Fix:** Added a 6th row to the troubleshooting table in שלב 0.5ה stating it is informational-only and that the recovery is to upgrade to `actions/checkout@v5` / `actions/setup-node@v5` when GitHub publishes them.
- **Files modified:** `SETUP.md`
- **Verification:** Grep shows row present; troubleshooting table now has 6 rows (5 original + Node 20 warning).
- **Committed in:** `beff972` (Task 6 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality / documentation)
**Impact on plan:** Both auto-fixes essential. `.claspignore` is a correctness requirement (without it, clasp deploy would either fail or pollute Apps Script with hundreds of irrelevant files). Node 20 warning is documentation completeness — without it, the troubleshooting table would silently omit a known future event. No scope creep.

## Threats Handled

| Threat | Disposition | How |
|--------|-------------|-----|
| T-03-01 (Information Disclosure: secret echoed to stdout) | mitigate | Task 3 workflow uses `env:` block + `printf '%s'` — never `echo "$CLASPRC_JSON"`. Task 3 acceptance criteria included a grep gate against `echo $CLASPRC_JSON` patterns. GitHub Actions also masks the secret value in logs as defense-in-depth. |
| T-03-02 (Credential Leak: `~/.clasprc.json` committed) | mitigate | Task 1 added `.clasprc.json` to `.gitignore` BEFORE any task that creates the file (sequencing prevents accidental commit window). SETUP.md שלב 0.5ג includes a human-readable warning against pasting the file content to Slack/email/chat. ## אבטחה bullet reinforces. |
| T-03-03 (Tampering: `clasp push --force` overwrites manual editor edits) | accept | Per D-15, `--force` is required because git must be source of truth in CI. Risk is documented in SETUP.md שלב 0.5ה ("clasp push --force דורס שינויים שנעשו ידנית"). Recovery: `git revert` + re-push. No automated mitigation — workflow contract change (all `.gs` edits must go through git from this point forward). |
| T-03-04 (Availability: 6-month OAuth refresh-token expiry) | mitigate | SETUP.md שלב 0.5ה documents the recovery procedure: rerun `npx clasp login` locally, copy new `~/.clasprc.json`, update `CLASPRC_JSON` GitHub Secret value. Detection is the Action failing with `Error 401: invalid_grant`, which surfaces in GitHub default email notification (D-11). Per D-10, no proactive cron — deploys happen frequently enough in practice. |

## Issues Encountered

- None during the auto-tasks. Operator-side: `clasp clone` initially tried to push `node_modules/` (surfaced as Rule 2 deviation #1 — added `.claspignore`). Operator confirmed smoke test green after `.claspignore` was committed.

## Smoke Test Evidence

- **GitHub Action run:** #26053537084
- **URL:** https://github.com/dor77777-prog/script-roas/actions/runs/26053537084
- **Duration:** 24s
- **Outcome:** ✓ green — "Pushed 10 files." (the 9 `.gs` files + `appsscript.json`)
- **Trigger commit:** `09dc5ad` (Task 5 — `test(03): trigger deploy-gs workflow`)
- **End-to-end verification:** The smoke-test comment `// CI/CD validation — Phase 3 deploy-gs workflow smoke test` confirmed visible at bottom of `ManualOverrides.gs` in script.google.com after editor refresh — proves the full chain (git push → GitHub Actions → clasp push → Apps Script project) works.

## User Setup Required

None for ongoing use — the CI/CD pipeline is fully automated after the one-time operator setup completed in Tasks 4 + 5. The one-time setup is documented in SETUP.md שלב 0.5 for future operators (new environments / new operators inheriting the project).

**One-time setup recap (for reference — already completed):**
- `npx clasp login` locally (Google OAuth)
- Create `.clasp.json` with real scriptId (Project Settings ⚙️ → copy Script ID)
- Upload `cat ~/.clasprc.json` content as GitHub Secret `CLASPRC_JSON`

## Next Phase Readiness

- **Ready for Phase 4 (Component Decomposition)** per ROADMAP.md. Phase 4 depends on Phase 2 (tests) — that dependency is already met. Phase 3 does not block Phase 4 directly.
- **Phase 7 (Observability) will inherit:** the GitHub Actions pattern + secret-handling convention established here. The pre-commit `.gs` syntax hook (D-17) is queued for Phase 7. Slack/Sentry alerting for Action failures (D-13) is queued for Phase 7.
- **No blockers carried forward.**
- **Workflow contract change:** From this point forward, ALL `.gs` edits MUST go through git → `clasp push` (not via direct script.google.com editor edits). This is documented in SETUP.md שלב 0.5ה (T3 reminder).

## Self-Check: PASSED

**Files exist:**
- FOUND: `package.json` (root)
- FOUND: `package-lock.json` (root)
- FOUND: `.clasp.json`
- FOUND: `.claspignore`
- FOUND: `.github/workflows/deploy-gs.yml`
- FOUND: `SETUP.md` (with שלב 0.5 + ## אבטחה bullet)
- FOUND: `SYSTEM_OVERVIEW.md` (with deploy paragraph)
- FOUND: `.gitignore` (4 lines, `.clasprc.json` present, `.clasp.json` absent)

**Commits exist:**
- FOUND: `e98afb5` (Task 1)
- FOUND: `2a27477` (Task 2)
- FOUND: `1052737` (Task 3)
- FOUND: `1a2c3a6` (mid-plan tracker)
- FOUND: `b5a30a5` (Task 4)
- FOUND: `09dc5ad` (Task 5)
- FOUND: `beff972` (Task 6)

**Verification greps (Task 6):**
- PASS: `grep -c 'clasp' SETUP.md` = 19 (≥5 required)
- PASS: `grep -c 'CLASPRC_JSON' SETUP.md` = 3 (≥2 required)
- PASS: `grep -c 'invalid_grant' SETUP.md` = 1 (≥1 required)
- PASS: `grep -c 'שלב 0.5' SETUP.md` = 2 (≥2 required)
- PASS: `grep -cE 'deploy-gs|clasp push' SYSTEM_OVERVIEW.md` = 1 (≥1 required)
- PASS: 5 subsection headings (`### 0.5א.` through `### 0.5ה.`)

---
*Phase: 03-ci-cd-apps-script*
*Completed: 2026-05-18*
