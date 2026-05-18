---
phase: 03-ci-cd-apps-script
reviewed: 2026-05-18T22:10:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .clasp.json
  - .claspignore
  - .github/workflows/deploy-gs.yml
  - .gitignore
  - ManualOverrides.gs
  - SETUP.md
  - SYSTEM_OVERVIEW.md
  - package.json
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-18T22:10:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The Phase 3 CI/CD infrastructure is functional and the smoke-test evidence (Action run #26053537084 — "Pushed 10 files.") confirms end-to-end correctness. Threat T1 (no secret echoed to stdout) is properly mitigated via the `env:` block + `printf '%s'` pattern, and credential file permissions are tightened with `chmod 600`. The `.clasprc.json` ignore is correctly in place, and `.clasp.json` is correctly committed (scriptId is non-secret per clasp docs).

However, several robustness and quality gaps remain. The workflow lacks `set -euo pipefail` for its inline bash block, so partial failures in the credential-write step can silently continue. There is a brief permissions race window between `printf > file` and `chmod 600` where the credential file inherits the runner's umask (typically world-readable). The paths filter `**.gs` is over-broad and would trigger the workflow on stray `.gs` files in subdirectories (e.g., `dashboard-web/`) even though `.claspignore` would correctly drop them from the upload — wasting Actions minutes. The action version pins use mutable major tags (`@v4`) rather than SHA digests, leaving the workflow exposed to supply-chain risk if those tags are ever moved. Documentation accuracy is good overall, but `SETUP.md` 0.5א instructs `npm install` locally without explaining why CI uses `npm ci`, and the troubleshooting table's `Script ID not found` row labels a Phase-2-style invalid scriptId but does not distinguish it from a `scriptId` for a project the OAuth account cannot access.

`ManualOverrides.gs` was changed only by appending a trailing comment for smoke-test validation — no functional impact.

## Warnings

### WR-01: Workflow inline bash lacks `set -euo pipefail` (silent partial-failure risk)

**File:** `.github/workflows/deploy-gs.yml:38-44`
**Issue:** The credential-write step uses a multi-line bash block but does not set strict error handling. If `printf` writes a partial file (e.g., disk full, OOM), the runner does not exit; the subsequent `chmod 600` and `npx clasp status` step then operate on a truncated file. The `if [ -z "$CLASPRC_JSON" ]` guard only catches an empty secret, not a partial write. GitHub Actions inline `run:` blocks default to `bash -e` (errexit only) on Linux, not `-euo pipefail`, so unset variables and pipefail errors are not caught.
**Fix:**
```yaml
- name: Write clasp credentials from secret
  env:
    CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
  shell: bash
  run: |
    set -euo pipefail
    if [ -z "$CLASPRC_JSON" ]; then
      echo "::error::CLASPRC_JSON secret is empty. Set it under Settings -> Secrets and variables -> Actions."
      exit 1
    fi
    umask 077
    printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"
    chmod 600 "$HOME/.clasprc.json"
```

### WR-02: Credential file has world-readable race window between `printf` and `chmod 600`

**File:** `.github/workflows/deploy-gs.yml:43-44`
**Issue:** `printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"` creates the file with the runner's default umask (typically `022`, yielding mode `0644` — world-readable). The subsequent `chmod 600` only narrows permissions *after* the file is written. On `ubuntu-latest` runners this is a single-tenant container so the practical exposure is minimal, but the pattern is still incorrect defense-in-depth and would fail any auditor checklist. The fix is to set `umask 077` before the redirect (or use `install -m 600 /dev/stdin "$HOME/.clasprc.json"` with a heredoc) so the file is created with the restrictive mode atomically.
**Fix:** See WR-01 — add `umask 077` before the `printf` redirect, then `chmod 600` becomes belt-and-suspenders.

### WR-03: Paths filter `**.gs` is over-broad — triggers on stray `.gs` files in subdirectories

**File:** `.github/workflows/deploy-gs.yml:6-8`
**Issue:** The paths filter `'**.gs'` matches `.gs` files **anywhere** in the repo, not just at the root. If a future commit adds a `.gs` file under `dashboard-web/` (e.g., a Tailwind sample, a misnamed file, or a copy/paste artifact), the workflow will run and `clasp push --force` will be invoked — which is wasted Actions minutes and adds risk that an unrelated PR triggers a production deploy. The `.claspignore` correctly scopes the upload to root, but the trigger does not match this scope.
**Fix:** Tighten the path filter to root-level only, matching the actual clasp `rootDir: "."` semantics:
```yaml
on:
  push:
    branches: [main]
    paths:
      - '*.gs'           # root-level .gs only
      - 'appsscript.json'
      - '.clasp.json'    # also trigger if scriptId/rootDir changes
      - '.claspignore'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/deploy-gs.yml'  # self-update
```

### WR-04: Action versions pinned to mutable major tags, not SHA digests

**File:** `.github/workflows/deploy-gs.yml:22,27`
**Issue:** Both `actions/checkout@v4` and `actions/setup-node@v4` use mutable major-version tags. If a malicious or buggy `v4.x.y` release is published (or the `v4` tag is rewritten by an attacker who compromises an action repo), the workflow silently inherits the new code on its next run — and that code runs with access to `secrets.CLASPRC_JSON`. The GitHub Actions security guide explicitly recommends SHA pinning for any workflow that handles secrets. The Phase 3 plan permits major-tag pinning under "Claude's discretion", but a CI/CD workflow that writes Google OAuth refresh tokens is exactly the workload that should be SHA-pinned.
**Fix:** Pin to full-length SHAs and add a comment with the version for human readers. Use Dependabot (or Renovate) to manage updates so SHAs auto-bump safely:
```yaml
- name: Checkout
  uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
  with:
    fetch-depth: 1

- name: Setup Node
  uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8  # v4.0.2
  with:
    node-version: '22'
    cache: 'npm'
```
Then add `.github/dependabot.yml` with a `github-actions` ecosystem to keep SHAs current.

## Info

### IN-01: `package.json` missing `engines` field to enforce Node version consistency

**File:** `package.json:1-10`
**Issue:** The workflow pins Node 22, but the root `package.json` has no `engines` field. A local developer running `npm install` on Node 18 (or Node 24 once Node 20 sunsets) will not get an early warning. For a project where the only purpose of `package.json` is to invoke `clasp` via the CI runner, this is low risk — but adding the field costs nothing and prevents a class of "works on CI, fails locally" surprises that match the Phase 2 ethos of explicit version pinning.
**Fix:**
```json
{
  "name": "roas-tracker-root",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "deploy:gs": "clasp push --force"
  },
  "devDependencies": {
    "@google/clasp": "^2.4.2"
  }
}
```

### IN-02: SETUP.md 0.5א uses `npm install` locally while CI uses `npm ci` — mismatch undocumented

**File:** `SETUP.md:37`
**Issue:** The local-setup instructions show `npm install` but the workflow uses `npm ci`. They behave differently: `npm install` updates `package-lock.json` and tolerates lock drift, while `npm ci` requires a perfect match and fails-closed on drift. A new developer following SETUP.md and committing an updated lockfile from a different Node version could cause a CI failure that is not explained by the docs. Worth a one-liner.
**Fix:** Replace `npm install` with `npm ci` in SETUP.md 0.5א (which exercises the same path as CI), or add a brief note explaining the difference. Example:
```diff
-npm install              # מתקין את @google/clasp כ-devDependency
+npm ci                   # מתקין מ-package-lock.json — אותו פקודה כמו ב-CI
```

### IN-03: SETUP.md troubleshooting table conflates two distinct `Script ID not found` causes

**File:** `SETUP.md:94`
**Issue:** The row reads:
> `Script ID not found` ב-Action log | `scriptId` לא תקין ב-`.clasp.json` | להעתיק שוב מ-Project Settings ⚙️ ...

This error is also produced when the `scriptId` *is* syntactically valid but the OAuth account in `CLASPRC_JSON` lacks edit access to that project (e.g., someone uploaded `clasprc.json` from a different Google account than the project owner). The proposed fix ("copy again from Project Settings") does not help in that scenario. Adding a second row distinguishing the two cases would save an operator a real debugging cycle.
**Fix:** Split into two rows, or expand the existing row:
> `Script ID not found` ב-Action log | (1) `scriptId` שגוי ב-`.clasp.json`, **או** (2) ה-OAuth account של `CLASPRC_JSON` לא Editor ב-Apps Script project | (1) להעתיק שוב מ-Project Settings ⚙️; (2) לוודא שה-`clasp login` בוצע עם אותו חשבון Google שיש לו edit access ל-project

### IN-04: `.claspignore` pattern works but is not maximally defensive against unintended file uploads

**File:** `.claspignore:1-3`
**Issue:** The current pattern (`**/**` then unignore `*.gs` and `appsscript.json`) relies on clasp's anymatch semantics correctly handling `**/**` as "match every file recursively". The smoke test confirmed this works — "Pushed 10 files." matches the 9 `.gs` + `appsscript.json` exactly. However, the more idiomatic clasp pattern (and the one shown in the clasp README) is:
```
# upload nothing except *.gs and appsscript.json at root
**/**
!*.gs
!appsscript.json
```
The current file matches this exactly, so no change needed — but consider adding a one-line comment explaining intent. This will help future maintainers who might be tempted to add `*.md` exclusions thinking the file is permissive-by-default rather than restrictive-by-default.
**Fix:** Optional — prepend a comment:
```
# Restrict clasp upload to *.gs + appsscript.json at repo root only.
# Without this file, clasp would attempt to upload node_modules/ (created by `npm install`)
# and fail or pollute the Apps Script project.
**/**
!*.gs
!appsscript.json
```

---

_Reviewed: 2026-05-18T22:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
