---
status: partial
phase: 02-foundations
source: [02-VERIFICATION.md, 02-PLAN.md T-14]
started: 2026-05-18T20:32:00Z
updated: 2026-05-18T20:32:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Dashboard loads without white-screen (PLAN T-14 step 5)
expected: `cd dashboard-web && npm run dev` starts on `localhost:3000`. Page renders without a blank screen. Browser DevTools Console shows no NEW warnings introduced by Phase 2 (existing data-fetch warnings about missing `GOOGLE_CLIENT_EMAIL` are pre-existing and unrelated).
result: [pending]

### 2. Cache-Control header is set via cacheControl() helper (PLAN T-14 step 6)
expected: In DevTools → Network tab, the response for `/api/data` includes a `Cache-Control` header in the form `public, s-maxage=60, stale-while-revalidate=300` (or whichever value cacheConfig.ts declares for the `data` key). No raw string literals in route source confirmed programmatically; this verifies the header is actually emitted at runtime.
result: [pending]

### 3. Sentry is silent no-op without DSN env vars (PLAN T-14 step 7)
expected: With `.env.local` having NO `NEXT_PUBLIC_SENTRY_DSN` and NO `SENTRY_DSN`, the dev server runs and the browser Console shows ZERO Sentry-related logs/warnings (no "Sentry has been disabled" message either — the DSN check guards `Sentry.init` entirely).
result: [pending]

### 4. ErrorBoundary shows generic Hebrew message in production (CR-02 fix)
expected: Build with `npm run build`, run `npm run start`, then deliberately trigger a render error (e.g. by adding a `throw new Error('test-leak')` temporarily inside a component render). The fallback UI shows the Hebrew message "שגיאה פנימית. נסה לרענן את הדף." — NOT the raw `Error: test-leak` string. Remove the throw and rebuild before commit. (In `npm run dev` the raw message WILL appear — that's the development-only behavior gated by `process.env.NODE_ENV`.)
result: [pending]

### 5. Sentry end-to-end error delivery (VERIFICATION.md human item)
expected: Set `NEXT_PUBLIC_SENTRY_DSN=<real_dsn>` in `.env.local`, restart `npm run dev`, deliberately trigger a client-side error. Within ~30 seconds the error event appears in the Sentry dashboard project, with stack trace + environment info. After verifying, REMOVE the DSN from `.env.local` (or set it to empty) before any commit.
result: [pending]

### 6. (Optional) Lint pass — only if ESLint is added
expected: `cd dashboard-web && npm run lint` either runs cleanly OR is skipped because ESLint is not configured in this project. ESLint is a documented gap; this is informational, not blocking.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
