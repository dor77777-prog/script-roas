# Sentry SDK 8 → 10 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `@sentry/nextjs` from `^8.40.0` to `^10.x` (latest stable) to close HIGH CVE GHSA-mw96-cpmx-2vgc, preserving all current capture/scrub/init behavior.

**Architecture:** Iterative bump-build-fix loop. Update `package.json`, run install, run build + tests, fix anything the version bump breaks (most likely candidates: `withSentryConfig` option keys, `Sentry.ErrorEvent` type name, mock factories), commit.

**Tech Stack:** TypeScript 5, Next.js 15, `@sentry/nextjs` (upgrading from ^8.40 → ^10.x), Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-05-25-sentry-sdk-upgrade-design.md`

**Prerequisite:** Worktree branch `phase-13.2.1-sentry-sdk-upgrade` via `superpowers:using-git-worktrees`.

---

## File Structure

| File | Action | Notes |
|------|--------|-------|
| `dashboard-web/package.json` | Modify | Bump `@sentry/nextjs` version range |
| `dashboard-web/package-lock.json` | Auto-regenerated | npm install |
| `dashboard-web/next.config.ts` | Possibly modify | If `withSentryConfig` options shuffled in v10 |
| `dashboard-web/sentry.{server,client,edge}.config.ts` | Possibly modify | If `Sentry.init` signature/typings changed |
| `dashboard-web/src/lib/sentry/scrub.ts` | Possibly modify | If `Sentry.ErrorEvent` type renamed |
| `dashboard-web/src/lib/__tests__/sentryScrub.test.ts` | Possibly modify | If exports changed enough that mock factories don't match |
| `dashboard-web/src/lib/__tests__/sentryCapture.test.ts` | Possibly modify | Same |

Total: 1–6 files, ~20 LOC max.

---

## Task 1: Establish baseline + survey current state

- [ ] **Step 1: Confirm baseline tests + build are green BEFORE the bump**

Run:
```
cd dashboard-web && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -10
```
Expected: `1096 passed (1096)` + clean build with route table.

Rationale: any post-bump failure should be diff-able against a known-green baseline. Skipping this means we can't distinguish bump-induced failures from pre-existing ones.

- [ ] **Step 2: Capture the current First Load JS for the / route as a baseline**

From the build output of Step 1, note the First Load JS for `/`. Expected to be around `437 kB` based on prior phases. Write it down in a scratch comment if needed.

Rationale: Sentry v10 ships OpenTelemetry by default. We want to detect a meaningful bundle regression. If First Load JS jumps >20%, we'll need to disable tracing integration.

---

## Task 2: Bump the dep + initial install

- [ ] **Step 3: Update package.json**

Open `dashboard-web/package.json`. Find:
```json
"@sentry/nextjs": "^8.40.0",
```
Replace with:
```json
"@sentry/nextjs": "^10.0.0",
```

The `^10.0.0` resolves to the latest 10.x — npm prefers the highest matching minor/patch within the major range. If we want a specific tested version, we can pin `~10.x.x` later; for the initial bump, taking latest minor is fine.

- [ ] **Step 4: Run npm install**

Run: `cd dashboard-web && npm install 2>&1 | tail -10`
Expected: `added/changed/removed N packages` summary. Peer-dep warnings may appear — note them but don't act unless `npm install` actually errors out.

- [ ] **Step 5: Verify the CVE no longer reports**

Run: `cd dashboard-web && npm audit --audit-level=high 2>&1 | tail -20`
Expected: GHSA-mw96-cpmx-2vgc NOT in the output. If still present, this CVE wasn't actually fixed in our chosen minor — diagnose and pick a specific newer 10.x version.

---

## Task 3: Run build, fix whatever breaks

- [ ] **Step 6: Run npm run build**

Run: `cd dashboard-web && npm run build 2>&1 | tail -40`

Most likely outcomes:
- **Clean build** → skip to Step 9.
- **`withSentryConfig` complains about unknown options** → Step 7.
- **TS error about `Sentry.ErrorEvent` or similar type** → Step 8.

- [ ] **Step 7: If `withSentryConfig` options changed (likely)**

Sentry v10 moved several top-level options under nested objects. Common reshuffles from v8 → v10:

| v8 option | v10 location |
|-----------|--------------|
| `silent` | `silent` (unchanged) |
| `widenClientFileUpload` | `sourcemaps.widenClientFileUpload` |
| `hideSourceMaps` | `sourcemaps.disable` or removed (default off) |
| `disableLogger` | `disableLogger` or `disable` (verify in build error message) |

Open `dashboard-web/next.config.ts`. If the build complained about specific keys, restructure the second arg to `withSentryConfig` accordingly. Example transformation:

```ts
// Before (v8):
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});

// After (v10) — adjust ONLY the keys the build error names; leave the rest:
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  sourcemaps: {
    widenClientFileUpload: true,
    // hideSourceMaps removed — v10 hides them by default
  },
  disableLogger: true,
});
```

Do NOT speculatively move all keys at once — only those the v10 build error explicitly rejects. The Sentry v10 build wrapper emits clear console errors that name the rejected key.

Re-run Step 6 after edits.

- [ ] **Step 8: If `Sentry.ErrorEvent` type renamed**

Open `dashboard-web/src/lib/sentry/scrub.ts`. Find the import:
```ts
import type * as Sentry from '@sentry/nextjs';

// ...
return (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
```

In v10, the type might be exported as `ErrorEvent` directly (not on the namespace) or `EventHint`-typed differently. If TS errors here, fix by replacing the type. Two likely fixes:

```ts
// Option A: import the type by name
import type { ErrorEvent } from '@sentry/nextjs';
// Then: (event: ErrorEvent): ErrorEvent | null => { ... }
```

OR
```ts
// Option B: more generic
import type * as Sentry from '@sentry/nextjs';
// Then keep Sentry.ErrorEvent if it still resolves OR fall back to any
```

Pick whichever satisfies tsc. If the type genuinely doesn't exist, fall back to a structural type literal in the file itself.

Re-run Step 6 after edits.

- [ ] **Step 9: If build is clean, capture the new First Load JS**

Compare against the Step 2 baseline. Examples:
- `437 kB → 445 kB` (+2%): fine, ship.
- `437 kB → 520 kB` (+20%): tracing integration likely added by default. Add `Sentry.init({ ..., integrations: (defaults) => defaults.filter(i => i.name !== 'BrowserTracing' && i.name !== 'OpenTelemetry') })` to `sentry.client.config.ts` to strip. Re-build.

If the increase is in the 2–10% range, accept and proceed.

---

## Task 4: Run vitest, fix whatever breaks

- [ ] **Step 10: Run the full test suite**

Run: `cd dashboard-web && npm test 2>&1 | tail -10`
Expected: 1096 passing.

If specific tests fail, the most likely causes are:
- `vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))` factories miss new required exports (e.g. v10 might do automatic instrumentation that expects `init` to be mocked too).
- The `Sentry.ErrorEvent` type rename cascade into tests.

- [ ] **Step 11: If sentryScrub.test.ts fails on type**

Open `dashboard-web/src/lib/__tests__/sentryScrub.test.ts`. Find:
```ts
import type * as Sentry from '@sentry/nextjs';
// ...
function makeEvent(overrides: Partial<Sentry.ErrorEvent>): Sentry.ErrorEvent {
```

Apply the same fix as Step 8 (option A or B). The pattern is identical.

Re-run Step 10.

- [ ] **Step 12: If sentryCapture.test.ts fails on mock shape**

Open `dashboard-web/src/lib/__tests__/sentryCapture.test.ts`. Find the mock factory:
```ts
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));
```

If v10 requires more exports to be mocked (e.g. the SDK does runtime imports of `getCurrentScope` etc.), add stubs:
```ts
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  // Add the specific exports the v10 runtime expects. Only add what
  // the test error explicitly names; don't speculatively bloat the mock.
}));
```

Re-run Step 10.

---

## Task 5: Final regression + commit + push

- [ ] **Step 13: Confirm all checks green**

```
cd dashboard-web && npm test 2>&1 | tail -5
cd dashboard-web && npm run build 2>&1 | tail -10
cd dashboard-web && npx tsc --noEmit 2>&1 | tail -5
```
All three should be clean.

- [ ] **Step 14: Stage the changes**

```bash
cd /Users/dorperetz/script-roas/.claude/worktrees/phase-13.2.1-sentry-sdk-upgrade
git status --short
git add \
  dashboard-web/package.json \
  dashboard-web/package-lock.json
```

If `next.config.ts`, the sentry configs, `scrub.ts`, or the test files were modified, add them too:
```bash
git add \
  dashboard-web/next.config.ts \
  dashboard-web/sentry.server.config.ts \
  dashboard-web/sentry.client.config.ts \
  dashboard-web/sentry.edge.config.ts \
  dashboard-web/src/lib/sentry/scrub.ts \
  dashboard-web/src/lib/__tests__/sentryScrub.test.ts \
  dashboard-web/src/lib/__tests__/sentryCapture.test.ts
```
(Only those that actually changed; `git status` will show.)

- [ ] **Step 15: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(deps): bump @sentry/nextjs 8.40 → 10.x — fix GHSA-mw96-cpmx-2vgc (Phase 13.2.1)

Closes the HIGH-severity CVE flagged by the MT audit (Track 1 P1-05). The
vulnerability lives in a transitive rollup dependency pulled in by
@sentry/nextjs ^8.40; @sentry/nextjs ^10.x bundles a patched rollup
that's no longer vulnerable.

What changed at the API surface:
- package.json: @sentry/nextjs ^8.40.0 → ^10.x.x
- next.config.ts: withSentryConfig options reshuffled where v10 required
  (sourcemaps options moved under nested key; hideSourceMaps removed —
  v10's default behavior already hides them).
- Other surface (Sentry.init signature, Sentry.captureException,
  captureRequestError, beforeSend hook) is stable across v8 → v10; no
  behavior change there.

Behavior preserved:
- tracesSampleRate: 0.1 (unchanged)
- beforeSend PII scrubber (unchanged)
- Capture sites in lib/sentry/capture.ts (unchanged)
- ErrorBoundary captureException (unchanged)
- Server / client / edge runtime split (unchanged)

Tests: 1096 prior pass, no new tests added (this is a dep bump, not a
behavior change). Build: clean.

Spec: docs/superpowers/specs/2026-05-25-sentry-sdk-upgrade-design.md
Plan: docs/superpowers/plans/2026-05-25-sentry-sdk-upgrade.md
Audit: .planning/audit-2026-05-24/MASTER-REPORT.md (Track 1 P1-05)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Adjust the commit body if the actual changes diverged from the assumptions (e.g. `Sentry.ErrorEvent` rename did happen — mention it).

- [ ] **Step 16: Merge to main + push**

```bash
cd /Users/dorperetz/script-roas
git merge --ff-only worktree-phase-13.2.1-sentry-sdk-upgrade
git push origin main
```

Expected: pre-push hook runs (tsc + vitest + lint + docs-currency); all pass; push completes. Vercel auto-deploys (the `vercel.json` ignoreCommand sees `dashboard-web/package.json` changed → BUILD).

- [ ] **Step 17: Poll Vercel for READY + verify**

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('/Users/dorperetz/Library/Application Support/com.vercel.cli/auth.json'))['token'])")
TEAM_ID="team_i4MS1oAvzzkwzw0JfNlGohDs"
PROJECT_ID="prj_Ry9iXqreLr1qYsmeFtqonxD3fX5v"
until STATE=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=1" | python3 -c "import json,sys; deps=json.load(sys.stdin).get('deployments',[]); print(deps[0].get('state','?') if deps else 'NONE')") && [ "$STATE" = "READY" ]; do
  echo "[$(date +%H:%M:%S)] state=$STATE"; sleep 15
done
echo "READY"
```

Then smoke prod:
```bash
curl -sI https://roas-dashboard-smoky.vercel.app/ | head -3
curl -sI https://roas-dashboard-smoky.vercel.app/api/health | head -3
```
Expected: both `HTTP/2 200`.

---

## Done definition

- `npm audit --audit-level=high` no longer lists GHSA-mw96-cpmx-2vgc.
- `npm test` → 1096 passing.
- `npm run build` → clean.
- `git log -1` → commit on origin/main.
- Vercel deploy → READY with `meta.githubCommitSha` matching the push commit.
- Prod URL serves 200.
