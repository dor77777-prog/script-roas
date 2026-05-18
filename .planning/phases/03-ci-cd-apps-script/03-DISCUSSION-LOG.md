# Phase 3: CI/CD for Apps Script - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 03-ci-cd-apps-script
**Areas discussed:** Trigger strategy, Pre-commit hook, Failure notifications
**Areas auto-defaulted:** Credential lifecycle

---

## Plans-Exist Decision

Phase 3 already had `03-PLAN.md` (1 plan) created without user context. User asked how to proceed.

| Option | Description | Selected |
|--------|-------------|----------|
| Continue and replan after | Capture context now, re-run /gsd-plan-phase 03 after | ✓ |
| View existing plan first | Show 03-PLAN.md before deciding | |
| Cancel | Stop discussion — keep existing plan | |

**User's choice:** Continue and replan after.

---

## Gray-Area Selection

Four candidate gray areas presented. User chose three to discuss; one auto-defaulted.

| Area | Selected |
|------|----------|
| Trigger strategy | ✓ |
| Pre-commit hook | ✓ |
| Failure notifications | ✓ |
| Credential lifecycle | (auto-defaulted: setup-once-and-forget + 6-month note in SETUP) |

---

## Trigger Strategy

### Question 1 — When should the GitHub Action fire?

| Option | Description | Selected |
|--------|-------------|----------|
| Paths filter on push to main (Recommended) | Action runs only when push to main touches `*.gs` or `appsscript.json`. Zero-friction, matches existing plan. | ✓ |
| Every push to main (no path filter) | Simpler config — but every dashboard-only commit also runs clasp push. Burns Action minutes, noisy in Actions tab. | |
| Manual workflow_dispatch only | Safest — click 'Run workflow' to deploy. Defeats automation. | |
| Paths filter + manual override | Auto-deploy + workflow_dispatch escape hatch. More YAML; defer unless needed. | |

**User's choice:** Paths filter on push to main.
**Notes:** Matches the existing PLAN frontmatter. `workflow_dispatch` deferred unless retry pattern emerges; <5 lines to add later.

### Question 2 — Which paths in the filter?

| Option | Description | Selected |
|--------|-------------|----------|
| `*.gs` + `appsscript.json` (Recommended) | Only Apps Script-relevant files trigger deploy. Smallest blast radius. | ✓ |
| `*.gs` + `appsscript.json` + `.clasp.json` | Also trigger if script ID or clasp config changes. Useful if migrating projects, otherwise redundant. | |
| `*.gs` + `appsscript.json` + `.github/workflows/deploy-gs.yml` | Also trigger if Action itself changes. Risk: meta-cycle (fix in the very Action that runs). | |

**User's choice:** `*.gs` + `appsscript.json`.

---

## Pre-commit Hook

### Question — Add `.gs` syntax validation pre-commit hook?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 7 (Recommended) | Phase 7 (observability) better suited — pre-commit + Apps Script lint co-located. Phase 3 stays focused on deploy mechanism. Aligns with ROADMAP's "optional" marker. | ✓ |
| Husky + simple `node -c` | Add husky as devDep at root + hook running `node --check *.gs`. Catches syntax errors before Action fails. Adds dependency on other developers' machines. | |
| Plain `.git/hooks/pre-commit` bash script | Bash hook + SETUP.md instructions for chmod. Zero dependencies. Not synced automatically on fresh clones — each developer must enable. | |

**User's choice:** Defer to Phase 7.
**Notes:** Phase 3 = deploy mechanism only. Pre-commit lint belongs in observability work alongside Apps Script log retention.

---

## Failure Notifications

### Question — How will we discover a failed deploy?

| Option | Description | Selected |
|--------|-------------|----------|
| Default GitHub: email + Actions tab (Recommended) | GitHub sends failure email to repo owner + Actions tab is canonical. Sufficient for solo-operator dev. Risk: if not logged in, missed. Document fallback in SETUP.md. | ✓ |
| Slack webhook on failure | Add `if: failure()` step that POSTs to a Slack webhook with run link. Requires Slack workspace + webhook URL as GH Secret. ~15min effort. | |
| Sentry monitor (defer to Phase 7) | Sentry cron monitor / GitHub Actions integration. Defer with the rest of observability. Phase 3 documents the Actions-tab path only. | |

**User's choice:** Default GitHub: email + Actions tab.
**Notes:** SETUP.md will include a "what to do when deploy fails" subsection that walks through Actions tab → run logs → fix → re-push. Sentry/Slack notifications budgeted to Phase 7.

---

## Credential Lifecycle (Auto-Defaulted)

User chose not to discuss this area. Default applied:

- **Policy:** setup-once-and-forget.
- **SETUP.md addition:** Single paragraph noting Google rotates OAuth refresh tokens every ~6 months of inactivity. Recovery procedure: re-run `clasp login` locally, copy fresh `~/.clasprc.json` into the `CLASPRC_JSON` GitHub Secret.
- **No proactive rotation cron** — the Action's natural cadence (every `.gs` change) keeps the token live.

---

## Claude's Discretion

The following implementation details are not gray areas; Claude/planner decides:

- Node version in Action: `actions/setup-node@v4` with `node-version: '22'` (matches dashboard-web Phase 2 LTS).
- Runner image: `ubuntu-latest`.
- `clasp` semver pin: `^2.4.2`.
- Workflow `concurrency` group: optional but recommended (`deploy-gs` cancels overlapping runs).
- `actions/checkout@v4` with `fetch-depth: 1` (shallow clone — clasp needs no history).
- Workflow display name and job name — descriptive but free-form.

---

## Confirmation

User reviewed the full summary (all 4 decisions including the auto-defaulted credential lifecycle policy) and approved with **"כן, כתוב (מומלץ)"** — proceeding to write CONTEXT.md and committing.

---

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`. Mirror here for audit:

- Pre-commit hook for `.gs` syntax validation → Phase 7
- Slack webhook on Action failures → Phase 7
- Sentry cron monitor → Phase 7
- Manual `workflow_dispatch` button → Phase 7 (only if needed)
- `.gs` linting (eslint-config-googleappsscript) → Phase 7
- Apps Script side test runner — V8 doesn't support; observability work in Phase 7 fills the gap
- Pre-merge preview deploys — out of scope; Apps Script has no preview env
- Multi-environment (staging Apps Script project) → Phase 9+ if ever needed
