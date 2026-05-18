---
phase: 03-ci-cd-apps-script
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .gitignore
  - package.json
  - package-lock.json
  - .clasp.json
  - .github/workflows/deploy-gs.yml
  - SETUP.md
  - SYSTEM_OVERVIEW.md
autonomous: false
requirements:
  - PHASE-3-CICD
tags:
  - ci-cd
  - apps-script
  - clasp
  - github-actions
  - deploy-automation
must_haves:
  truths:
    - "`npm run deploy:gs` from local pushes all `.gs` + `appsscript.json` files to Apps Script project (Success Criterion 1)"
    - "GitHub Action runs successfully on a test commit touching a `.gs` file (Success Criterion 2 — verified in Actions tab)"
    - "Manual upload to script.google.com is no longer needed for deployment (Success Criterion 3)"
    - "SETUP.md documents the new deployment flow (Success Criterion 4)"
    - "`.clasprc.json` is in `.gitignore` and `.clasp.json` is committed to git (Success Criterion 5)"
    - "SYSTEM_OVERVIEW.md mentions the new CI/CD path (Success Criterion 6)"
    - "Trigger runs only on paths `*.gs` + `appsscript.json` on push to `main` (D-01, D-03)"
    - "Action writes CLASPRC_JSON secret to `~/.clasprc.json` only — never echoed to stdout (D-08, threat T1)"
  artifacts:
    - path: ".gitignore"
      provides: "ignore list without `.clasp.json`, with `.clasprc.json`"
      contains: ".clasprc.json"
    - path: "package.json"
      provides: "root npm manifest with `deploy:gs` script and @google/clasp devDep (D-14 exact body)"
      contains: '"deploy:gs": "clasp push --force"'
    - path: "package-lock.json"
      provides: "deterministic lockfile (npm-managed, auto-generated)"
    - path: ".clasp.json"
      provides: "clasp project descriptor with scriptId and rootDir (D-06, D-16)"
      contains: '"scriptId"'
    - path: ".github/workflows/deploy-gs.yml"
      provides: "GitHub Action running `clasp push --force` on push to main with paths filter (D-01, D-08)"
      contains: "clasp push --force"
    - path: "SETUP.md"
      provides: "Hebrew RTL documentation of CI/CD flow + invalid_grant recovery procedure (D-09, D-12)"
    - path: "SYSTEM_OVERVIEW.md"
      provides: "one-line mention of automatic deploy woven into existing Apps Script section"
  key_links:
    - from: "git push origin main"
      to: ".github/workflows/deploy-gs.yml"
      via: "GitHub Actions push trigger with paths filter `*.gs` + `appsscript.json`"
      pattern: "on:\\s*push"
    - from: ".github/workflows/deploy-gs.yml"
      to: "~/.clasprc.json (runner home)"
      via: "echo $CLASPRC_JSON > ~/.clasprc.json (D-08 verbatim snippet — env block, never echo to stdout)"
      pattern: "CLASPRC_JSON"
    - from: "clasp push --force"
      to: "script.google.com Apps Script project"
      via: "`.clasp.json` (scriptId) + `~/.clasprc.json` (OAuth refresh token)"
      pattern: "clasp push --force"
    - from: "package.json scripts.deploy:gs"
      to: "@google/clasp binary in node_modules/.bin"
      via: "`npm run deploy:gs` runs `clasp push --force`"
      pattern: '"deploy:gs"'

user_setup:
  - service: clasp (Google Apps Script CLI)
    why: "One-time local OAuth login against the Google account that owns the Apps Script project, per D-07"
    env_vars: []
    dashboard_config:
      - task: "Run `npx clasp login` locally — browser opens to Google OAuth. Sign in with the account that has edit access to the ROAS Tracker Apps Script project. Result: `~/.clasprc.json` is created."
        location: "Local terminal, from repo root"
      - task: "Run `npx clasp clone <scriptId>` if the project already exists in script.google.com (recommended), or `npx clasp create --type standalone --title 'ROAS Tracker'` for a new project. Result: `.clasp.json` is created with the real scriptId."
        location: "Local terminal, from repo root"
      - task: "Copy the full content of `~/.clasprc.json` (output of `cat ~/.clasprc.json`) and paste it as a GitHub Repository Secret named `CLASPRC_JSON`."
        location: "GitHub repo → Settings → Secrets and variables → Actions → New repository secret"
---

<objective>
Eliminate the manual upload step for `*.gs` files to script.google.com. Every `git push` to `main` that touches a `*.gs` file or `appsscript.json` will trigger a GitHub Action that runs `clasp push --force`, automatically updating the Apps Script project.

Purpose: This is a major friction point in daily workflow (`.planning/codebase/CONCERNS.md` :: "Apps Script Upload Manual" + Recommendation #3 — HIGH IMPACT, LOW EFFORT, ~2h). Every edit to `DailyUpdate.gs` / `Shopify.gs` / `Config.gs` currently requires opening the Apps Script editor and pasting file-by-file. Risk: half-deploy (half of a file in production, half local) and uncertainty whether the `.gs` in production matches the commit hash in git. Solution: `clasp` + GitHub Action.

Output:
- `.gitignore` updated (remove `.clasp.json`, add `.clasprc.json`) — done FIRST before creating `.clasp.json` (D-04, D-05).
- New root `package.json` + `package-lock.json` with `@google/clasp` as devDependency (D-14 body verbatim).
- `.clasp.json` committed with real scriptId + `rootDir: "."` (D-06, D-16).
- `.github/workflows/deploy-gs.yml` with trigger `on: push: branches: [main], paths: ['**.gs', 'appsscript.json']` (D-01, D-03).
- `CLASPRC_JSON` GitHub Secret (D-07 — uploaded by operator).
- SETUP.md + SYSTEM_OVERVIEW.md updated (Hebrew RTL, preserving existing style per PATTERNS.md).
- End-to-end smoke test: no-op commit to `.gs` → green Action in Actions tab.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/03-ci-cd-apps-script/03-CONTEXT.md
@.planning/phases/03-ci-cd-apps-script/03-PATTERNS.md
@.planning/codebase/CONCERNS.md
@.gitignore
@appsscript.json
@dashboard-web/package.json

<interfaces>
<!-- Concrete inlined values from CONTEXT.md decisions. Executor should NOT have to re-read CONTEXT.md to find these. -->

**`.gitignore` — current state (4 lines, line 1 is `.clasp.json` — confirmed via Read):**
```
.clasp.json
.DS_Store
node_modules/
.vercel
```
Line 1 (`.clasp.json`) MUST be removed before `.clasp.json` can be committed (D-04, D-05).

**`.gitignore` — target state (per D-04, D-05 + PATTERNS.md "Gitignore minimalism: one pattern per line, no comments, no section headers"):**
```
.DS_Store
node_modules/
.vercel
.clasprc.json
```

**Root `package.json` — EXACT body per D-14 (do NOT add description, version, repository, license, author):**
```json
{
  "name": "roas-tracker-root",
  "private": true,
  "scripts": {
    "deploy:gs": "clasp push --force"
  },
  "devDependencies": {
    "@google/clasp": "^2.4.2"
  }
}
```
D-14 deliberately omits `version`. PATTERNS.md confirms: "no optional metadata".

**`.clasp.json` — body per D-06, D-16 + clasp docs (scriptId is NOT secret per D-04):**
```json
{
  "scriptId": "<real script ID — set by operator in T-4 after `clasp clone`>",
  "rootDir": "."
}
```
`rootDir: "."` per D-16 — clasp runs from repo root and picks up the 9 `.gs` files (`Config.gs`, `FX.gs`, `Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`, `ManualOverrides.gs`, `SheetBuilder.gs`, `DailyUpdate.gs`, `Main.gs`) + `appsscript.json` in cwd flat layout.

**Workflow credential snippet per D-08 (verbatim — do NOT echo secret to stdout, threat T1):**
```yaml
- run: echo "$CLASPRC_JSON" > ~/.clasprc.json
  env:
    CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
```

**Workflow trigger per D-01, D-03 + "Claude's Discretion" bullets:**
- `on: push: branches: [main]` (D-03 — main only)
- `paths: ['**.gs', 'appsscript.json']` (D-01 — paths filter)
- NO `workflow_dispatch` (D-02 — manual override deferred)
- `runs-on: ubuntu-latest` (Claude's Discretion)
- `actions/setup-node@v4` with `node-version: '22'` (Claude's Discretion — matches Node 22 LTS in `dashboard-web/package.json` devDep `@types/node: ^22`)
- `actions/checkout@v4` with `fetch-depth: 1` (Claude's Discretion — shallow clone, clasp does not need git history)
- `concurrency: group: deploy-gs, cancel-in-progress: true` (Claude's Discretion — recommended)
- `--force` is REQUIRED per D-15 — clasp default refuses to overwrite remote changes; in CI, git is source of truth

**Apps Script root files (per `.planning/codebase/STACK.md` + CONTEXT.md `canonical_refs`):**
- 9 `.gs` files at root: `Config.gs`, `FX.gs`, `Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`, `ManualOverrides.gs`, `SheetBuilder.gs`, `DailyUpdate.gs`, `Main.gs`
- `appsscript.json` at root (V8 runtime, Asia/Jerusalem timezone, OAuth scopes for drive/sheets/urlfetch/gmail.send/script.scriptapp)
- NOT modified by this phase — deploy mechanism only (CONTEXT.md `domain` "Out of scope")

**SETUP.md heading convention (Hebrew RTL, from existing file):**
- Top-level: `## שלב N — <title>` (e.g., `## שלב 0 — יצירת פרויקט Apps Script` at line 7)
- Sub-level: `### Nא. <subtitle>` (e.g., `### 1ה. מה לשמור לכל חנות` at line 146)
- Tables: `| תופעה | סיבה אפשרית |` pattern in "תחזוקה ופתרון תקלות" section (line 844)
- Inline English technical tokens preserved (no transliteration of `clasp`, `GitHub Actions`, `CLASPRC_JSON`)
- Horizontal rules `---` between major sections

**SYSTEM_OVERVIEW.md heading convention (Hebrew RTL with emoji prefix):**
- Top-level: `## 🎯 <title>` / `## 🧩 <title>` / `## 🔄 <title>` etc.
- Sub-level: `### N. <subtitle>` (e.g., `### 1. Google Apps Script (איסוף נתונים)` at line 97)
- The Apps Script section at line 97 is where the deploy mention goes (PATTERNS.md: "do NOT add a new top-level ## section; CONTEXT.md says 'mentions' (מזכיר) — woven into existing context")

**.github/ directory state:**
- DOES NOT EXIST (confirmed `ls -la /Users/dorperetz/script-roas/.github` returned no such directory)
- This is the FIRST GitHub Action in the repo — no existing pattern to mirror, build from CONTEXT.md only
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: .gitignore fix — remove .clasp.json, add .clasprc.json (MUST land FIRST)</name>
  <files>.gitignore</files>
  <read_first>
- `/Users/dorperetz/script-roas/.gitignore` (current state — 4 lines, line 1 is `.clasp.json`)
- CONTEXT.md decisions D-04, D-05 (script ID is not secret; gitignore edit lands first)
- CONTEXT.md `code_context` "Known landmines" (`.clasprc.json` contains OAuth refresh token, MUST never be committed)
- PATTERNS.md section "`.gitignore` (root) — MOD" + "Shared Patterns / Gitignore minimalism"
- `/Users/dorperetz/script-roas/dashboard-web/.gitignore` (style reference — one pattern per line, no comments)
  </read_first>
  <action>
**Sequencing rationale (CRITICAL):** This task MUST run before Task 3 (`.clasp.json` creation). The current `.gitignore` line 1 is `.clasp.json` — if `.clasp.json` is created before this edit lands, git will silently ignore it and the later commit will fail to include it. Per CONTEXT.md `specifics`: "ה-task המוקדם ביותר חייב להתחיל ב`.gitignore` fix".

**Exact edit:**

The current `.gitignore` is exactly 4 lines:
```
.clasp.json
.DS_Store
node_modules/
.vercel
```

Replace its full content with exactly these 4 lines (same line count, `.clasprc.json` appended last, `.clasp.json` removed; no comments, no blank lines, no section headers per PATTERNS.md "Gitignore minimalism"):
```
.DS_Store
node_modules/
.vercel
.clasprc.json
```

Use the `Write` tool — not `sed`, not multi-step `Edit`. Single atomic file write.

**Threat mitigation T2 (refresh token leak via committed `~/.clasprc.json`):** This task IS the mitigation — the `.clasprc.json` line must be present.

**Do NOT:**
- Add comments like `# clasp credentials`
- Add a blank line before `.clasprc.json`
- Sort alphabetically (preserve existing order, append `.clasprc.json` at the bottom — keeps diff minimal)
- Touch `dashboard-web/.gitignore`
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas && grep -v '^#' .gitignore | grep -c '^\.clasprc\.json$' | grep -q '^1$' && ! grep -v '^#' .gitignore | grep -q '^\.clasp\.json$' && [ "$(wc -l < .gitignore | tr -d ' ')" = "4" ]</automated>
  </verify>
  <acceptance_criteria>
- `.gitignore` contains the line `.clasprc.json` (grep -c on non-comment lines equals 1)
- `.gitignore` does NOT contain a line `.clasp.json` (grep on non-comment lines equals 0)
- File has exactly 4 lines (preserves minimalism)
- `git check-ignore .clasp.json` returns nothing (no longer ignored)
- `git check-ignore .clasprc.json` returns `.clasprc.json` (correctly ignored)
  </acceptance_criteria>
  <done>
- `/Users/dorperetz/script-roas/.gitignore` content matches the 4 lines specified above
- All grep checks in verify pass
- `.clasp.json` is no longer ignored by git; `.clasprc.json` IS ignored
  </done>
</task>

<task type="auto">
  <name>Task 2: root package.json + npm install (creates package-lock.json + node_modules)</name>
  <files>package.json, package-lock.json</files>
  <read_first>
- `/Users/dorperetz/script-roas/dashboard-web/package.json` (analog for shape only — NOT for content; copy "private + scripts + devDependencies" structure, NOT next/react deps)
- CONTEXT.md decision D-14 (exact body of root `package.json` — verbatim, no metadata noise)
- CONTEXT.md "Claude's Discretion" bullet on `clasp` version pin (`^2.4.2` — semver caret)
- PATTERNS.md section "`package.json` (root)" + "Shared Patterns / npm manifest minimalism"
- `/Users/dorperetz/script-roas/.gitignore` (after Task 1 modifications — verify `node_modules/` still present so `npm install` doesn't pollute git)
  </read_first>
  <action>
**Dependency check:** Task 1 must be complete. Run `grep -c '^\.clasprc\.json$' /Users/dorperetz/script-roas/.gitignore` first — must return `1`. If not, halt.

**a) Create `/Users/dorperetz/script-roas/package.json` (root, NOT inside dashboard-web/) with EXACTLY this body per D-14:**

```json
{
  "name": "roas-tracker-root",
  "private": true,
  "scripts": {
    "deploy:gs": "clasp push --force"
  },
  "devDependencies": {
    "@google/clasp": "^2.4.2"
  }
}
```

Use the `Write` tool. Body is from CONTEXT.md D-14 verbatim. Do NOT add:
- `"version"` (D-14 omits it; PATTERNS.md "no optional metadata")
- `"description"` (omit per PATTERNS.md)
- `"main"`, `"type": "module"` (PATTERNS.md "match dashboard-web's omission")
- `"workspaces"` (PATTERNS.md "do not introduce npm workspaces — two separate lockfiles")
- Any `"dependencies"` key (D-14 — only dev tooling at root)
- Other scripts (D-14 only `deploy:gs`)

**b) Run `npm install` from repo root** to generate `package-lock.json` and install `@google/clasp` into root `node_modules/`:

```bash
cd /Users/dorperetz/script-roas && npm install
```

Expected outputs:
- `/Users/dorperetz/script-roas/package-lock.json` created (npm-generated, commit as-is per PATTERNS.md: "no handwritten content")
- `/Users/dorperetz/script-roas/node_modules/` created (already gitignored via `node_modules/` line preserved in Task 1)
- `/Users/dorperetz/script-roas/node_modules/.bin/clasp` executable exists

**c) Do NOT touch `dashboard-web/package.json` or `dashboard-web/package-lock.json`** (CONTEXT.md `canonical_refs` "Phase 2 carry-forward: two separate lockfiles").

**d) Do NOT run `clasp login` or `clasp clone`** — those are operator actions (Task 4).
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas && test -f package.json && test -f package-lock.json && node -e "const p=require('./package.json'); if(p.name !== 'roas-tracker-root') process.exit(10); if(p.private !== true) process.exit(11); if(!p.scripts || p.scripts['deploy:gs'] !== 'clasp push --force') process.exit(12); if(!p.devDependencies || !p.devDependencies['@google/clasp']) process.exit(13); if(p.dependencies) process.exit(14); if(p.workspaces) process.exit(15);" && test -x node_modules/.bin/clasp</automated>
  </verify>
  <acceptance_criteria>
- `/Users/dorperetz/script-roas/package.json` exists
- `package.json` contains exactly the keys `name`, `private`, `scripts`, `devDependencies` (no `dependencies`, no `workspaces`, no `version`, no `description`)
- `package.json.name === "roas-tracker-root"`
- `package.json.private === true`
- `package.json.scripts["deploy:gs"] === "clasp push --force"`
- `package.json.devDependencies["@google/clasp"]` starts with `^2.4`
- `/Users/dorperetz/script-roas/package-lock.json` exists (npm-generated)
- `/Users/dorperetz/script-roas/node_modules/.bin/clasp` is executable
- `dashboard-web/package.json` and `dashboard-web/package-lock.json` are unchanged (git diff empty for those files)
  </acceptance_criteria>
  <done>
- Root `package.json` exists with D-14 body verbatim
- `package-lock.json` generated and staged
- clasp binary executable in root `node_modules/.bin/`
- `dashboard-web/` is untouched
  </done>
</task>

<task type="auto">
  <name>Task 3: GitHub Actions workflow — .github/workflows/deploy-gs.yml</name>
  <files>.github/workflows/deploy-gs.yml</files>
  <read_first>
- CONTEXT.md decisions D-01 (trigger on push to main with paths filter), D-02 (no workflow_dispatch), D-03 (main only), D-08 (credential write snippet verbatim), D-15 (--force required), D-18 (idempotency)
- CONTEXT.md "Claude's Discretion" bullets: workflow name, job name, ubuntu-latest, node-version 22, fetch-depth 1, concurrency group, clasp ^2.4.2
- PATTERNS.md section "`.github/workflows/deploy-gs.yml` — CI workflow" (no analog — synthesize from CONTEXT.md)
- `/Users/dorperetz/script-roas/appsscript.json` (read once to confirm path filter `appsscript.json` matches the root file location)
- `/Users/dorperetz/script-roas/.github/` directory state (does NOT exist — must be created)
  </read_first>
  <action>
**Sequencing:** Task 2 must be complete (`package-lock.json` exists — workflow uses `npm ci` which requires the lockfile).

**Create the directory + file:**

The path `/Users/dorperetz/script-roas/.github/workflows/deploy-gs.yml` must be created. Both `.github/` and `.github/workflows/` will be created by the `Write` tool when writing the file.

**Exact file content (every value is sourced from CONTEXT.md — do NOT modify):**

```yaml
name: Deploy Apps Script (clasp push)

on:
  push:
    branches: [main]
    paths:
      - '**.gs'
      - 'appsscript.json'

concurrency:
  group: deploy-gs
  cancel-in-progress: true

jobs:
  deploy:
    name: clasp push --force
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies (npm ci from root)
        run: npm ci

      - name: Write clasp credentials from secret
        env:
          CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
        run: |
          if [ -z "$CLASPRC_JSON" ]; then
            echo "::error::CLASPRC_JSON secret is empty. Set it under Settings -> Secrets and variables -> Actions."
            exit 1
          fi
          printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"
          chmod 600 "$HOME/.clasprc.json"

      - name: Verify clasp can see the project
        run: npx clasp status

      - name: Push to Apps Script
        run: npm run deploy:gs
```

**Annotated rationale for every choice (do NOT remove these from the file content — but the executor MUST understand them):**

- `name: Deploy Apps Script (clasp push)` — descriptive (Claude's Discretion)
- `on.push.branches: [main]` — D-03 (main only)
- `on.push.paths` — D-01 (`**.gs` matches `.gs` at any depth + root; `appsscript.json` is exact root path). `**.gs` is the YAML glob form; `**/*.gs` and `**.gs` both match all `.gs` — using `**.gs` for consistency with GitHub's published examples
- NO `workflow_dispatch` — D-02 (deferred to Phase 7 if needed)
- `concurrency.group: deploy-gs` + `cancel-in-progress: true` — Claude's Discretion ("cancels in-progress runs when a new push arrives — optional but recommended")
- `timeout-minutes: 5` — Apps Script push completes in <30s typically; 5min absorbs network jitter
- `actions/checkout@v4` with `fetch-depth: 1` — Claude's Discretion (shallow clone)
- `actions/setup-node@v4` with `node-version: '22'` — Claude's Discretion (matches Node 22 LTS in dashboard-web devDep `@types/node: ^22`)
- `cache: 'npm'` — speeds up subsequent runs
- `npm ci` (not `npm install`) — deterministic from lockfile
- Credential write step uses `env:` block, NEVER `echo "$CLASPRC_JSON"` to stdout — **threat T1 mitigation per D-08**
- `printf '%s'` (not `echo`) — avoids trailing newline that could corrupt the JSON
- `chmod 600` — best practice for credential file (refresh token has ~6mo expiry per D-09)
- `npx clasp status` as pre-flight — fails fast with a clear error if scriptId or token is bad
- `npm run deploy:gs` (not `npx clasp push --force` directly) — uses the script from `package.json` so future changes to the deploy command happen in one place

**Idempotency (D-18):** `clasp push --force` run twice in a row is a no-op on the second run (clasp detects no diff). If a push fails mid-stream (network), a simple retry suffices.

**Do NOT:**
- Add `workflow_dispatch:` (D-02 — deferred)
- Add Slack/Sentry/email notification steps (D-11, D-13 — deferred to Phase 7)
- Add a cron schedule to "warm" the refresh token (D-10 — not needed; deploy runs frequently enough)
- Add `permissions:` block (defaults are fine for both public and private repos for secret read)
- `echo` the secret value to stdout under any circumstance (threat T1)
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas && test -f .github/workflows/deploy-gs.yml && python3 -c "import yaml; d = yaml.safe_load(open('.github/workflows/deploy-gs.yml')); on_block = d.get(True) or d.get('on'); assert on_block, 'missing on block'; assert on_block['push']['branches'] == ['main'], 'wrong branches'; assert '**.gs' in on_block['push']['paths'] and 'appsscript.json' in on_block['push']['paths'], 'wrong paths'; assert d['jobs']['deploy']['runs-on'] == 'ubuntu-latest', 'wrong runner'; assert any('CLASPRC_JSON' in str(s) for s in d['jobs']['deploy']['steps']), 'missing CLASPRC_JSON'; print('yaml ok')" && grep -q 'clasp push --force\|npm run deploy:gs' .github/workflows/deploy-gs.yml && ! grep -E 'echo[[:space:]]+["\x27]?\$CLASPRC_JSON|echo[[:space:]]+["\x27]?\$\{?CLASPRC_JSON' .github/workflows/deploy-gs.yml | grep -v '^#'</automated>
  </verify>
  <acceptance_criteria>
- `.github/workflows/deploy-gs.yml` exists and parses as valid YAML
- `on.push.branches` equals `['main']`
- `on.push.paths` contains both `**.gs` and `appsscript.json`
- File contains `${{ secrets.CLASPRC_JSON }}` exactly once (in the env block of the credential-write step)
- File does NOT contain `echo "$CLASPRC_JSON"` or `echo $CLASPRC_JSON` or any pattern that would echo the secret to stdout (threat T1 grep gate)
- File contains `npm run deploy:gs` OR `clasp push --force` (the actual deploy step)
- File contains `chmod 600` on `~/.clasprc.json`
- File contains `npx clasp status` as a pre-flight verification step
- File contains `concurrency: group: deploy-gs` (or `concurrency:` with `group:` on the next line)
- File does NOT contain `workflow_dispatch` (D-02 deferred)
- File does NOT contain `schedule:` (D-10 — no cron warming)
  </acceptance_criteria>
  <done>
- `.github/` directory created
- `.github/workflows/deploy-gs.yml` written with the exact content above
- YAML parses cleanly via `python3 -c "import yaml; yaml.safe_load(...)"`
- All grep-based acceptance criteria pass
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 4: Operator action — clasp login locally + capture ~/.clasprc.json</name>
  <read_first>
- CONTEXT.md decisions D-06 (clone-or-create choice), D-07 (CLASPRC_JSON source), D-09 (6-month refresh-token expiry), D-16 (rootDir)
- The current state of `/Users/dorperetz/script-roas/.clasp.json` (may or may not exist — operator must check)
- The existing Apps Script project in script.google.com — operator must know which one (the ROAS Tracker project that currently runs the daily triggers)
  </read_first>
  <files>.clasp.json (created/edited by operator)</files>
  <action>
**This is a checkpoint:human-action task** — Claude CANNOT execute it because it requires Google OAuth browser interaction and GitHub UI access. The operator performs the steps detailed in `<how-to-verify>` below: (1) `npx clasp login` to create `~/.clasprc.json`, (2) link `.clasp.json` to the existing Apps Script project via `clasp clone <scriptId>` or by manually creating the file with the real scriptId from script.google.com, (3) upload the contents of `~/.clasprc.json` as a GitHub Repository Secret named `CLASPRC_JSON`. See `<how-to-verify>` for exact step-by-step instructions and `<acceptance_criteria>` for what counts as done.

After the operator completes the steps and types `approved` in the resume signal with the Script ID + Secret confirmation, the execute-phase workflow resumes to Task 5.
  </action>
  <verify>
    <automated>MISSING — this is a human-action checkpoint; verification is via operator resume signal containing (1) Script ID, (2) GitHub Secret creation confirmation, (3) `npx clasp status` output. Automated checks happen in the verification block of Task 5 (which runs `npm run deploy:gs` locally and watches the Action).</automated>
  </verify>
  <done>See `<acceptance_criteria>` below — operator-confirmed completion of all 6 criteria (~/.clasprc.json valid, .clasp.json has real scriptId, clasp status works, .clasp.json staged, CLASPRC_JSON Secret exists, B1 or B2 path chosen).</done>
  <what-built>
Tasks 1-3 produced the local glue: `.gitignore` fix, root `package.json` + `npm install`, and the GitHub Action YAML. But the workflow cannot run yet because:
1. There is no `.clasp.json` with a real scriptId (just the placeholder from Task 3 has not been written — `.clasp.json` is created HERE, not in Task 3, because it requires the scriptId from the existing Apps Script project).
2. There is no `CLASPRC_JSON` GitHub Secret yet (no value to upload yet — created here).

This step requires browser interaction (Google OAuth) and is therefore operator-manual.
  </what-built>
  <how-to-verify>
**Step A — Run `clasp login` locally:**

From the repo root in a local terminal (NOT the CI runner):
```bash
cd /Users/dorperetz/script-roas
npx clasp login
```

A browser will open to Google OAuth. **Sign in with the Google account that has edit access to the ROAS Tracker Apps Script project** (the same account currently used at script.google.com to edit the `.gs` files). Approve scopes (`script.projects`, `script.deployments`, etc.).

After approval, the terminal will print `Saved credentials to ~/.clasprc.json`.

**Step B — Link to the existing Apps Script project (D-06 path B1, recommended):**

1. Go to https://script.google.com and open the ROAS Tracker project.
2. Click **Project Settings ⚙️** (left sidebar) and copy the **Script ID** (long string).
3. Create `/Users/dorperetz/script-roas/.clasp.json` with the real scriptId:
   ```json
   {
     "scriptId": "<paste the real Script ID here>",
     "rootDir": "."
   }
   ```
   `rootDir: "."` per D-16.

   Alternative (D-06): you may instead run `npx clasp clone <scriptId>` from the repo root, which will create `.clasp.json` automatically. WARNING: `clasp clone` will also download the current Apps Script files into the cwd — if there is drift between the `.gs` files in git and the ones in script.google.com, the local files will be overwritten. **Always check `git diff` after `clasp clone` before committing.**

4. Verify with `npx clasp status` — expected output: `Not ignored files:` followed by a list of the 9 `.gs` files + `appsscript.json`.

**Step C — Upload `~/.clasprc.json` as a GitHub Secret (D-07):**

1. Locally, run:
   ```bash
   cat ~/.clasprc.json
   ```
   Copy the full JSON output (one line, looks like `{"token":{...},"oauth2ClientSettings":{...}}`).

2. In GitHub: navigate to the repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - **Name:** `CLASPRC_JSON` (exact case)
   - **Secret value:** paste the JSON from step C.1
   - Click **Add secret**

3. Confirm the secret appears in the Actions secrets list (the value is hidden after creation — GitHub will only show the name and "Last updated" timestamp).

**Step D — Local smoke test:**

```bash
cd /Users/dorperetz/script-roas
npx clasp status
```
Expected: a list of `.gs` files + `appsscript.json` shown as "Not ignored", with no errors.

Do NOT run `clasp push` yet — that will be tested via the CI in Task 5.

**Threat T2 reminder (refresh token leak):** Never paste the contents of `~/.clasprc.json` into Slack, email, or any chat. Never commit it. `.gitignore` from Task 1 should already protect against an accidental commit, but verify with `git check-ignore ~/.clasprc.json` if needed.

**Threat T4 reminder (6-month expiry):** If the project goes 6 months without any `.gs` changes (unlikely), the refresh token will expire and the next deploy will fail with `Error 401: invalid_grant`. The recovery procedure is documented in SETUP.md (Task 6): rerun `clasp login` locally, copy the new `~/.clasprc.json`, and update the GitHub Secret value.
  </how-to-verify>
  <acceptance_criteria>
- `~/.clasprc.json` exists on the operator's machine and contains valid OAuth tokens (verified by `npx clasp status` succeeding)
- `/Users/dorperetz/script-roas/.clasp.json` exists with a real `scriptId` (not a placeholder string like `REPLACE_ME` or `<paste>`) and `rootDir: "."`
- `npx clasp status` from repo root returns a list of `.gs` files without errors
- `git status` shows `.clasp.json` as a staged/untracked file (NOT ignored — Task 1 already removed the ignore line)
- A GitHub Secret named exactly `CLASPRC_JSON` exists in the repo's Actions secrets (visible in Settings → Secrets and variables → Actions; value is hidden after creation)
- The operator confirms in the resume signal that they chose path B1 (clone existing) or B2 (create new) per D-06
  </acceptance_criteria>
  <resume-signal>
Type `approved` and include:
1. The Script ID that was placed into `.clasp.json` (so the planner can verify it for downstream steps)
2. Confirmation that the `CLASPRC_JSON` GitHub Secret was created (do NOT paste the actual token — just confirm the name + creation timestamp)
3. The output of `npx clasp status` (to confirm clasp can see the project)
4. Which path was chosen: B1 (clone existing) or B2 (create new)

If anything failed (clasp login stuck, OAuth error, GitHub Secret upload failed), describe the error in the resume signal — the plan may need revision.
  </resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: End-to-end smoke test — no-op commit to .gs triggers green Action</name>
  <read_first>
- The `.github/workflows/deploy-gs.yml` file (created in Task 3) — to know which steps to look for in the Action log
- The current Apps Script project URL (from Task 4 — operator should have it handy)
- CONTEXT.md decisions D-12 (failure recovery — Actions tab + email), D-15 (--force overwrites manual edits — Threat T3)
  </read_first>
  <files>ManualOverrides.gs (single comment line appended as a smoke-test trigger; reverted in commit history if needed)</files>
  <action>
**This is a checkpoint:human-verify task** — Claude executes the local-side automation (`npm run deploy:gs` to validate local setup, then `git push origin main` after appending a comment to `ManualOverrides.gs`), then PAUSES for the operator to verify the resulting GitHub Action run is green in the Actions tab and that the comment line appears in script.google.com.

Concrete operator-side automation Claude CAN perform without checkpoint pause:
1. Run `npm run deploy:gs` from repo root to verify local clasp setup works
2. Append the single comment line to `ManualOverrides.gs`
3. `git add ManualOverrides.gs && git commit -m "test(03): trigger deploy-gs workflow" && git push origin main`

Then PAUSE and ask the operator to confirm via the resume signal:
- URL of the resulting Actions run
- Whether all 6 workflow steps turned green
- Whether the comment line appears at the bottom of `ManualOverrides.gs` in script.google.com

See `<how-to-verify>` for full step-by-step + failure-mode debugging table and `<acceptance_criteria>` for the 8 verification points.
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas && npm run deploy:gs 2>&1 | grep -qE 'Pushed [0-9]+ files'</automated>
  </verify>
  <done>See `<acceptance_criteria>` below — operator-confirmed green Action run + comment appearing in script.google.com `ManualOverrides.gs`.</done>
  <what-built>
After Tasks 1-4: `.clasp.json` has a real scriptId, `CLASPRC_JSON` is uploaded as a Secret, the workflow file exists. Now we verify the full chain end-to-end via a real commit.
  </what-built>
  <how-to-verify>
**Step A — Local deploy sanity (verifies `.clasp.json` + local `~/.clasprc.json` work):**

```bash
cd /Users/dorperetz/script-roas
npm run deploy:gs
```

Expected: `Pushing files...` followed by a list of `Config.gs`, `FX.gs`, ..., `appsscript.json`, ending with `Pushed N files.` and no error. Then visit https://script.google.com → ROAS Tracker project → open `Config.gs` and verify the content matches the local file (search for a unique string like `spreadsheet.canonical-id`).

If this fails locally, STOP — fix locally before attempting the CI test. The CI cannot succeed if the local setup is broken.

**Step B — No-op commit to a `.gs` file:**

Pick a safe file — `ManualOverrides.gs` is recommended because it is NOT executed by the daily trigger (so even if something goes wrong, no daily data is affected).

1. Append a single comment line to the end of `/Users/dorperetz/script-roas/ManualOverrides.gs`:
   ```javascript
   // CI/CD validation — Phase 3 deploy-gs workflow smoke test
   ```
2. Commit and push:
   ```bash
   cd /Users/dorperetz/script-roas
   git add ManualOverrides.gs
   git commit -m "test(03): trigger deploy-gs workflow"
   git push origin main
   ```

**Step C — Watch the Action run in the GitHub Actions tab:**

1. GitHub → repo → **Actions** tab.
2. A new run should appear: **Deploy Apps Script (clasp push)** with status running/queued.
3. Wait for it to turn green (typically 30-90 seconds).
4. Click the run to inspect each step's log:
   - **Checkout** — green
   - **Setup Node** — green
   - **Install dependencies (npm ci from root)** — green
   - **Write clasp credentials from secret** — green (output should show NO `$CLASPRC_JSON` value — threat T1 verification)
   - **Verify clasp can see the project** — green with output listing `.gs` files
   - **Push to Apps Script** — green with `Pushed N files.`

**Step D — Verify the comment appears in script.google.com:**

1. Go to script.google.com → ROAS Tracker project → `ManualOverrides.gs`.
2. Scroll to the bottom — the comment `// CI/CD validation — Phase 3 deploy-gs workflow smoke test` should be there.
3. If yes, the CI/CD pipeline works end-to-end.

**Step E (optional) — Verify the paths filter works:**

To confirm the Action does NOT run for non-`.gs` changes:
1. Make a trivial edit to `/Users/dorperetz/script-roas/SETUP.md` (e.g., add a space at the end of a line) — note: this will be overwritten in Task 6, so the change is throwaway.
2. Commit and push.
3. Confirm no new run appears in the Actions tab.

**If the Action fails:**

- Failed at "Write clasp credentials" → `CLASPRC_JSON` secret is empty or malformed. Re-run Task 4 step C.
- Failed at "Verify clasp can see the project" with `invalid_grant` → refresh token expired (D-09 / threat T4). Run `npx clasp login` again locally, copy the new `~/.clasprc.json`, update the GitHub Secret value.
- Failed at "Verify clasp can see the project" with `Script ID not found` → wrong scriptId in `.clasp.json`. Verify against script.google.com Project Settings.
- Failed at "Push to Apps Script" with quota/rate limit → wait 5 minutes and retry by pushing an amended commit or another small change.

**Threat T3 reminder (`--force` overwrites manual edits):** This is the first push that exercises `--force`. If anyone had manual unsaved edits in the script.google.com editor for ROAS Tracker, those edits are now overwritten. Recovery: `git revert` the push commit and re-push. Document this risk in SETUP.md (Task 6).
  </how-to-verify>
  <acceptance_criteria>
- Local `npm run deploy:gs` succeeds with `Pushed N files.` output
- A new commit on `main` touching `ManualOverrides.gs` is pushed
- A new run titled "Deploy Apps Script (clasp push)" appears in the GitHub Actions tab
- The run completes with status SUCCESS (green checkmark)
- Every step in the run is green (Checkout, Setup Node, Install dependencies, Write clasp credentials, Verify clasp can see the project, Push to Apps Script)
- The "Write clasp credentials" step log does NOT contain the secret value (GitHub masks it; threat T1 mitigated)
- Opening `ManualOverrides.gs` in script.google.com shows the new comment line at the bottom (proves `clasp push` actually wrote to the project)
- (Optional Step E) A commit touching only `SETUP.md` does NOT trigger a new Action run (paths filter works per D-01)
  </acceptance_criteria>
  <resume-signal>
Type `approved` and include:
1. The URL of the Actions run (e.g., `https://github.com/<user>/script-roas/actions/runs/12345`)
2. Confirmation that the comment line appears in `ManualOverrides.gs` in script.google.com
3. (Optional) Confirmation of paths filter: "paths filter verified" if Step E was tested

If the Action failed:
- Failure mode (which step + error message from the log)
- Whether local `npm run deploy:gs` succeeded (helps localize the issue to CI vs local)
- The plan may need revision (e.g., a Task 5.1 to add error handling)
  </resume-signal>
</task>

<task type="auto">
  <name>Task 6: SETUP.md + SYSTEM_OVERVIEW.md documentation updates (Hebrew RTL)</name>
  <files>SETUP.md, SYSTEM_OVERVIEW.md</files>
  <read_first>
- `/Users/dorperetz/script-roas/SETUP.md` (current state — Hebrew RTL operator guide; specifically heading at line 7 `## שלב 0 — יצירת פרויקט Apps Script`, the troubleshooting table starting at line 844 `## תחזוקה ופתרון תקלות`, and the security section at line 862 `## אבטחה`)
- `/Users/dorperetz/script-roas/SYSTEM_OVERVIEW.md` (current state — Hebrew RTL architecture doc; specifically `### 1. Google Apps Script (איסוף נתונים)` at line 97)
- CONTEXT.md decisions D-09 (6-month invalid_grant recovery), D-12 (failure recovery procedure), D-15 (--force overwrites — threat T3 docs)
- PATTERNS.md sections "`SETUP.md` — MOD" and "`SYSTEM_OVERVIEW.md` — MOD" + "Shared Patterns / Hebrew RTL documentation convention"
  </read_first>
  <action>
**Sequencing:** Task 5 must be complete (smoke test verified). Now document the working flow.

**a) SETUP.md updates:**

Add a NEW section `## שלב 0.5 — חיבור clasp ל-Apps Script project (CI/CD)` between the existing `## שלב 0` (line 7) and `## שלב 1` (line 27). Use `Edit` (NOT full Write) to insert the new section.

The new section content (Hebrew RTL, English technical tokens preserved per PATTERNS.md "Shared Patterns / Hebrew RTL documentation convention"):

```markdown
---

## שלב 0.5 — חיבור clasp ל-Apps Script project (CI/CD)

> 💡 שלב חד-פעמי. אחרי הגדרה ראשונית, deploy של `.gs` יקרה אוטומטית בכל push ל-`main`.

### 0.5א. התקנת clasp + login מקומי

מ-root של ה-repo (לא מ-`dashboard-web/`):

```bash
npm install              # מתקין את @google/clasp כ-devDependency
npx clasp login          # פותח דפדפן ל-Google OAuth
```

ב-OAuth: להתחבר עם **חשבון Google שיש לו edit access ל-Apps Script project** (אותו חשבון שבו פתחת את ה-project ב-script.google.com בשלב 0).

תוצאה: נוצר `~/.clasprc.json` עם credentials. **הקובץ הזה ב-gitignore — אסור לקמיט אותו.**

### 0.5ב. קישור ל-Apps Script project

1. https://script.google.com → ה-project של ROAS Tracker → **Project Settings ⚙️** → להעתיק את **Script ID**.
2. לערוך את `.clasp.json` ב-root של ה-repo:
   ```json
   {
     "scriptId": "<הדבק כאן את ה-Script ID האמיתי>",
     "rootDir": "."
   }
   ```
3. לבדוק שהקישור עובד:
   ```bash
   npx clasp status
   ```
   צריך להחזיר list של 9 קבצי `*.gs` + `appsscript.json`.

4. אופציה אלטרנטיבית: `npx clasp clone <scriptId>` (יוצר את `.clasp.json` אוטומטית, אבל **דורס קבצים מקומיים** אם יש drift — תמיד לבדוק `git diff` לפני commit).

### 0.5ג. הגדרת GitHub Secret

כדי שה-GitHub Action יוכל לדחוף, צריך את ה-credentials כ-Secret:

1. מקומית:
   ```bash
   cat ~/.clasprc.json
   ```
   להעתיק את כל ה-JSON.
2. GitHub: ה-repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - **Name**: `CLASPRC_JSON` (case-sensitive)
   - **Value**: הדבק את ה-JSON.
   - **Add secret**.

> ⚠️ **אזהרה (T2):** אסור לקמיט את `~/.clasprc.json` או להדביק את התוכן ל-Slack / email / chat. הוא מכיל refresh token של Google. `.gitignore` כבר מגן (יש שם `.clasprc.json`), אבל הזהרות אנושיות לא מזיקות.

### 0.5ד. בדיקת end-to-end

1. לשנות קובץ `.gs` קטן (לדוגמה הוסף comment ב-`ManualOverrides.gs`).
2. `git commit && git push origin main`.
3. GitHub → **Actions** tab → לוודא שה-workflow **"Deploy Apps Script (clasp push)"** רץ ועובר ירוק.
4. https://script.google.com → ה-project → לוודא שה-change נכנס.

### 0.5ה. מה לעשות כש-deploy נכשל

| תופעה | סיבה אפשרית | פתרון |
|---|---|---|
| `Error 401: invalid_grant` ב-Action log | refresh token פג (6 חודשי inactivity, D-09) | `npx clasp login` מקומית מחדש → `cat ~/.clasprc.json` → לעדכן את ערך ה-Secret `CLASPRC_JSON` ב-GitHub Settings |
| `Script ID not found` ב-Action log | `scriptId` לא תקין ב-`.clasp.json` | להעתיק שוב מ-Project Settings ⚙️ ב-script.google.com → לעדכן `.clasp.json` → commit + push |
| Action לא רץ בכלל אחרי push | קובץ שהשתנה לא תואם ל-paths filter (`**.gs` או `appsscript.json`) | זה התנהגות מכוונת (D-01). אם רוצים להפעיל manually — לקמיט שינוי ב-`.gs` (אפילו comment) |
| ה-Action ירוק אבל הקובץ לא מתעדכן ב-Apps Script | `scriptId` ב-`.clasp.json` מצביע על project אחר | להשוות את ה-`scriptId` ב-`.clasp.json` עם ה-Script ID ב-script.google.com → תיקון + push |
| ה-Action דרס שינויים שעשיתי ידנית בעורך Apps Script | זה התנהגות מכוונת של `clasp push --force` (D-15, threat T3) | `git revert <commit-hash>` של ה-push הבעייתי → push חדש → ה-Action יחזיר את המצב הקודם |

> 💡 **תזכורת (T3):** `clasp push --force` דורס שינויים שנעשו ידנית בעורך Apps Script. **כל שינוי ל-`.gs` צריך לעבור דרך git** מכאן והלאה — לא דרך העורך באתר. אם בכל זאת ערכת ידנית, להעתיק את התוכן ל-git לפני שאתה pushיים שוב.

> 💡 **GitHub default email**: ב-failure של Action, GitHub שולח email למחבר ה-commit (D-11). אם רוצים פחות notifications — Settings → Notifications. אין Slack integration ב-phase הזה (נדחה ל-Phase 7 per D-13).

---
```

Then update the existing `## שלב 0` heading to ADD a short callout at the top (just below the `## שלב 0 — יצירת פרויקט Apps Script` line) pointing to שלב 0.5. Use `Edit` to insert this single block right after the שלב 0 heading:

```markdown
> 💡 **חדש מ-Phase 3 (CI/CD)**: deploy של קבצי `*.gs` הוא **אוטומטי** עכשיו דרך GitHub Actions. אחרי ה-setup הראשוני (השלבים למטה), שום upload ידני לא נדרש — כל `git push` ל-`main` שמשנה `*.gs` או `appsscript.json` מפעיל workflow שעושה `clasp push --force` לפרויקט Apps Script אוטומטית. ראה **שלב 0.5** למטה למסלול ה-CI/CD המלא.
```

Also add a single bullet to the existing `## אבטחה` section (line 862) — use `Edit` to append below the existing security bullets:

```markdown
- `~/.clasprc.json` (Google OAuth refresh token של clasp) gitignored ומועלה כ-GitHub Secret בשם `CLASPRC_JSON`. אסור לקמיט אותו או להעבירו ב-channels לא מוצפנים.
```

**b) SYSTEM_OVERVIEW.md updates:**

Per PATTERNS.md "do NOT add a new top-level ## section — CONTEXT.md says 'mentions' (מזכיר) — woven into existing context", append a single paragraph to the END of the existing `### 1. Google Apps Script (איסוף נתונים)` section (line 97) before the next subsection `### 2. Google Sheets (נתונים)` (line 117). Use `Edit` to insert this paragraph:

```markdown
**Deploy אוטומטי (מ-Phase 3):** קבצי `.gs` ו-`appsscript.json` deploy אוטומטית ל-script.google.com דרך GitHub Actions בכל push ל-`main`. ה-workflow ב-`.github/workflows/deploy-gs.yml` מריץ `clasp push --force` כשנגעו ב-`**.gs` או ב-`appsscript.json`. לפרטי setup ראה `SETUP.md` שלב 0.5.
```

**Do NOT:**
- Edit `dashboard-web/README.md` (dashboard side is unchanged in this phase)
- Add a new top-level `## CI/CD` section in SYSTEM_OVERVIEW.md (PATTERNS.md: "do NOT add a new top-level ## section")
- Remove or rewrite the existing שלב 0 instructions — just prepend the callout
- Touch any `.gs` file or `appsscript.json` (deploy mechanism only — out of scope per CONTEXT.md `domain`)
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas && grep -q '## שלב 0.5' SETUP.md && grep -q 'clasp login' SETUP.md && grep -q 'CLASPRC_JSON' SETUP.md && grep -q 'invalid_grant' SETUP.md && grep -q 'אסור לקמיט' SETUP.md && grep -q 'deploy-gs\|clasp push' SYSTEM_OVERVIEW.md && grep -q 'Phase 3' SYSTEM_OVERVIEW.md && [ "$(grep -c 'clasprc' SETUP.md)" -ge 3 ]</automated>
  </verify>
  <acceptance_criteria>
- SETUP.md contains a new top-level section `## שלב 0.5 — חיבור clasp ל-Apps Script project (CI/CD)` between שלב 0 and שלב 1
- The new שלב 0.5 section has 5 subsections: `### 0.5א.`, `### 0.5ב.`, `### 0.5ג.`, `### 0.5ד.`, `### 0.5ה.`
- SETUP.md contains the troubleshooting table covering: `invalid_grant`, `Script ID not found`, paths filter behavior, scriptId mismatch, --force overwrite (5 rows minimum)
- SETUP.md `## אבטחה` section has a new bullet mentioning `.clasprc.json` and `CLASPRC_JSON` Secret
- SETUP.md שלב 0 heading has a callout (>) pointing to שלב 0.5
- SYSTEM_OVERVIEW.md `### 1. Google Apps Script (איסוף נתונים)` section has a new paragraph mentioning automatic deploy + cross-link to SETUP שלב 0.5
- SYSTEM_OVERVIEW.md does NOT have a new top-level `## CI/CD` section (constraint from PATTERNS.md)
- `dashboard-web/README.md` is unchanged
- All Hebrew text preserved (no English translations or RTL marker issues)
- Grep counts: `grep -c 'clasp' SETUP.md` >= 5; `grep -c 'CLASPRC_JSON' SETUP.md` >= 2; `grep -c 'clasp\|deploy-gs' SYSTEM_OVERVIEW.md` >= 1
  </acceptance_criteria>
  <done>
- SETUP.md has the new שלב 0.5 section with all 5 subsections and the failure-recovery table
- שלב 0 has the callout pointing to שלב 0.5
- `## אבטחה` has the new `.clasprc.json` bullet
- SYSTEM_OVERVIEW.md `### 1. Google Apps Script` section has the deploy-automation paragraph
- All verify greps pass
- `dashboard-web/README.md` is untouched
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| local dev → git remote (GitHub) | Developer pushes commits + `.clasp.json` (scriptId is non-secret per D-04). `.clasprc.json` MUST NOT cross this boundary (gitignored). |
| GitHub Actions runner → GitHub Secrets store | The `CLASPRC_JSON` secret is fetched into the runner's env at job start. Secret value flows into `~/.clasprc.json` on the ephemeral runner only. |
| GitHub Actions runner → script.google.com (Google APIs) | `clasp push --force` authenticates with the OAuth refresh token from `~/.clasprc.json` and writes `.gs` files to the Apps Script project. |
| GitHub repo → public/internal viewers | If repo is public, `.clasp.json` (scriptId) is publicly visible. Per D-04 + clasp docs, scriptId alone is not a credential — read access to a project requires Google authentication. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Information Disclosure | `.github/workflows/deploy-gs.yml` credential write step | mitigate | Per D-08: use the `env:` block, write directly to `~/.clasprc.json` with `printf '%s'`, never `echo "$CLASPRC_JSON"` to stdout. Task 3 acceptance criteria includes a grep gate that fails if `echo $CLASPRC_JSON` appears. GitHub also masks secrets in logs as defense-in-depth. |
| T-03-02 | Information Disclosure / Credential Leak | `~/.clasprc.json` local file | mitigate | Task 1 adds `.clasprc.json` to `.gitignore` BEFORE any task that would create the file (no possible window where it could be accidentally committed). SETUP.md שלב 0.5ג includes a human-readable warning against pasting the file content to Slack/email/chat. |
| T-03-03 | Tampering / Data Loss | `clasp push --force` overwriting unsaved manual edits in script.google.com editor | accept | Per D-15: `--force` is required because in CI git must be the source of truth. The risk is documented in SETUP.md שלב 0.5ה ("--force דורס שינויים שנעשו ידנית"). Recovery is `git revert` + re-push. No automated mitigation — this is a workflow contract change (all `.gs` edits must go through git from this point forward). |
| T-03-04 | Denial of Service / Availability | 6-month OAuth refresh-token expiry (D-09) | mitigate | SETUP.md שלב 0.5ה documents the recovery procedure: rerun `clasp login` locally, copy new `~/.clasprc.json`, update `CLASPRC_JSON` GitHub Secret value. Per D-10, no proactive cron to keep the token alive (deploys happen frequently enough in practice — every `.gs` change). Detection is the Action failing with `Error 401: invalid_grant`, which surfaces in GitHub default email notification (D-11). |
</threat_model>

<verification>

## Phase-Level Verification

After Tasks 1-6 are complete, run these checks:

### A. Local sanity (Tasks 1, 2, 3 + post-Task 4)

```bash
cd /Users/dorperetz/script-roas
test -f package.json && test -f package-lock.json && test -f .clasp.json && test -f .github/workflows/deploy-gs.yml
```

```bash
# `.gitignore` is correct (Task 1)
grep -v '^#' .gitignore | grep -c '^\.clasprc\.json$' | grep -q '^1$' && ! grep -v '^#' .gitignore | grep -q '^\.clasp\.json$'
```

```bash
# package.json matches D-14 exactly (Task 2)
node -e "const p=require('./package.json'); if(p.name !== 'roas-tracker-root' || p.private !== true || p.scripts['deploy:gs'] !== 'clasp push --force' || !p.devDependencies['@google/clasp']) process.exit(1); if(p.dependencies || p.workspaces) process.exit(2);"
```

```bash
# .clasp.json has a real scriptId (operator filled it in Task 4)
node -e "const c=require('./.clasp.json'); if(!c.scriptId || c.scriptId.length < 10 || c.scriptId.includes('REPLACE') || c.scriptId.includes('paste') || c.rootDir !== '.') process.exit(1);"
```

```bash
# Workflow YAML is valid + has correct trigger + credential handling (Task 3)
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy-gs.yml')); ob=d.get(True) or d.get('on'); assert ob['push']['branches']==['main']; assert '**.gs' in ob['push']['paths'] and 'appsscript.json' in ob['push']['paths']; print('ok')"
```

```bash
# Threat T1 grep gate: no echo of secret to stdout
! grep -v '^#' .github/workflows/deploy-gs.yml | grep -E 'echo[[:space:]]+("|\x27)?\$CLASPRC_JSON|echo[[:space:]]+\$\{?CLASPRC_JSON'
```

```bash
# clasp can see the project (after operator Task 4 link)
npx clasp status
# expected: list of 9 .gs files + appsscript.json
```

### B. CI sanity (after Task 5 smoke test)

- GitHub Actions tab shows a successful run titled "Deploy Apps Script (clasp push)"
- Run completed with green status on all 6 steps
- script.google.com shows the test comment in `ManualOverrides.gs`

### C. Documentation grep (Task 6)

```bash
grep -c 'clasp' SETUP.md           # expected >= 5
grep -c 'CLASPRC_JSON' SETUP.md    # expected >= 2
grep -c 'invalid_grant' SETUP.md   # expected >= 1
grep -c 'שלב 0.5' SETUP.md         # expected >= 2 (heading + cross-references)
grep -c 'deploy-gs\|clasp push' SYSTEM_OVERVIEW.md  # expected >= 1
```

</verification>

<success_criteria>

The phase is complete when all 6 success criteria from ROADMAP.md are met:

1. `npm run deploy:gs` from local pushes all `.gs` + `appsscript.json` files to the Apps Script project — verified in Task 5 step A.
2. GitHub Action runs successfully on a test commit that touches a `.gs` file — verified in Task 5 step C (Actions tab shows green run).
3. Manual upload to script.google.com is no longer needed — verified by Task 5 step D (comment appears in editor via `clasp push`, not via manual paste).
4. SETUP.md updated with new deployment instructions — verified in Task 6 (שלב 0.5 added with 5 subsections).
5. `.clasprc.json` is gitignored, only `.clasp.json` is committed — verified by Task 1 grep gates + Task 4 (`.clasp.json` staged successfully).
6. SYSTEM_OVERVIEW.md notes the new CI/CD path — verified in Task 6 (paragraph added to section `### 1. Google Apps Script`).

Additionally, all 4 threats in the threat model have their dispositions executed:
- T-03-01 (secret echo to stdout): Task 3 acceptance criteria grep gate
- T-03-02 (committed credentials): Task 1 sequencing + SETUP.md warning
- T-03-03 (--force overwrites manual edits): documented + accepted in SETUP.md שלב 0.5ה
- T-03-04 (6-month token expiry): documented recovery procedure in SETUP.md

</success_criteria>

<output>

After all 6 tasks are complete (including operator approval at Task 4 and Task 5), create:

`.planning/phases/03-ci-cd-apps-script/03-01-SUMMARY.md`

Per `templates/summary.md`. Cover:
- **What was built:** root `package.json` + `.clasp.json` + `.github/workflows/deploy-gs.yml` + SETUP/SYSTEM_OVERVIEW updates
- **What becomes automatic:** deploy of `.gs` files via `git push origin main` (paths filter limits runs to actual `.gs` changes)
- **What was removed:** manual upload step (`.gs` paste into script.google.com editor) — though SETUP.md שלב 0 still describes it for first-time bootstrap
- **Decisions made (cite IDs):** D-01 paths filter, D-02 no workflow_dispatch, D-03 main only, D-04/D-05 gitignore sequencing, D-06 clone-vs-create choice, D-07 CLASPRC_JSON Secret, D-08 credential write pattern, D-09 6-mo expiry recovery, D-13 no Slack until Phase 7, D-14 minimal package.json, D-15 --force required, D-16 rootDir, D-17 pre-commit hook deferred, D-18 idempotency
- **Patterns established:** GitHub Actions workflow with paths filter (model for future workflows in Phases 5/6/7), CI secret-handling pattern (env block, no stdout echo, chmod 600)
- **Threats handled:** T-03-01..T-03-04 with their dispositions
- **Next phase:** Phase 4 (Component Decomposition) per ROADMAP.md

</output>
