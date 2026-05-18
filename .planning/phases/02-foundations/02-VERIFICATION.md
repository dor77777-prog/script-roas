---
phase: 02-foundations
verified: 2026-05-18T20:30:00Z
status: human_needed
score: 5/6 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "safeDecode exported from lib/utils.ts with one or more existing call sites switched to use it"
    reason: "Zero call sites exist at Phase 2 task time (grep confirmed). PLAN T-12 explicitly permits documenting why none exist as an alternative to switching an existing site. The utility is preemptive for Phase 5 (useSearchParams/UTM params) and Phase 8 (i18n). A TODO(phase-5) comment is co-located with the export. The 8-test suite keeps the contract from drifting. Prompt also explicitly acknowledges this as the accepted deviation."
    accepted_by: "kimpatz"
    accepted_at: "2026-05-18T20:30:00Z"
re_verification: ~
gaps: ~
deferred: ~
human_verification:
  - test: "Trigger a client-side error in production (or staging) and confirm it appears in the Sentry dashboard"
    expected: "An error event with stack trace and environment=production appears in the Sentry issues list within ~30 seconds of the error being thrown"
    why_human: "Sentry DSN is not set in the local dev environment (all Sentry paths are no-op without DSN). Can only verify the actual data flow (client error -> captureException -> Sentry ingestion) with a real DSN configured. Instrumentation wiring is verified programmatically; end-to-end event delivery requires a live Sentry project."
---

# Phase 2: Foundations Verification Report

**Phase Goal:** Add the smallest-effort highest-leverage infrastructure to support all later phases — testing harness, observability, shared utilities. Without these, every subsequent phase ships blind.
**Verified:** 2026-05-18T20:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npm run test` passes with 30-50 tests (floor) in `dashboard-web/src/lib/__tests__/` | VERIFIED | 84 tests across 8 test files, all pass: utils(8), orderMatchesCampaign(8), analyzeProductChannel(11), analyzeAttributionForAd(12), computeWindowStability(11), analyzeAttributionForAdSet(11), detectOutlierDays(9), analyzeAttribution(14). Exceeded floor. |
| 2 | Sentry DSN env var documented in README; uncaught client errors flow to Sentry dashboard | VERIFIED (partial — see human verification) | `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` documented at README.md:253. `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts` all exist and are wired. `withSentryConfig` wraps `next.config.ts`. `ErrorBoundary` imported in `layout.tsx`. WR-01 and WR-03 fixes applied (DSN-gated `onRequestError`, no `replayIntegration`). End-to-end event delivery requires human test with live DSN. |
| 3 | All 8 `/api/*` routes import cache config from `cacheConfig.ts` (no `s-maxage=NNN` string literals in route handlers) | VERIFIED | `grep -rn "s-maxage=" dashboard-web/src/app/api/` returns zero hits. All 8 routes import `cacheControl` from `@/lib/cacheConfig` and use it to build the Cache-Control header. `export const revalidate` uses numeric literals per Next.js 15 static analysis constraint (documented deviation in PLAN). |
| 4 | Each API route logs a warning when result set exceeds the row-count threshold (50k) | VERIFIED | 7 routes (`/api/data`, `/api/campaigns`, `/api/products`, `/api/ads`, `/api/orders-attribution`, `/api/store-meta`, `/api/product-catalog`) contain `if (rows.length > 50000) { console.warn(...) }`. `/api/dashboard-state` is intentionally excluded — bounded by 8 fixed `ALLOWED_STATE_KEYS`, never returns a row array. SUMMARY claim of "7 routes" matches actual code. |
| 5 | `safeDecode` exported from `lib/utils.ts` with one or more existing call sites switched, or documented as preemptive | VERIFIED (override applied) | `export function safeDecode` at `utils.ts:59`. Zero existing call sites (grep confirmed). PLAN T-12 explicitly permitted documenting absence. `TODO(phase-5)` comment at line 38 documents the planned consumer. 8 tests in `utils.test.ts` keep the contract stable. Accepted as preemptive per PLAN, prompt note, and override above. |
| 6 | `npm run build` passes with zero new TypeScript errors | VERIFIED | Build output: "Compiled successfully in 5.3s", "Linting and checking validity of types..." completed, 12 static pages generated, route table printed. Zero TypeScript errors. Expected "Missing GOOGLE_CLIENT_EMAIL" server logs during page generation are normal (no `.env.local` in CI). |

**Score:** 5/6 truths verified (6/6 including override)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `dashboard-web/vitest.config.ts` | Vitest configuration | VERIFIED | Exists, includes `src/lib/__tests__/**/*.test.ts` pattern |
| `dashboard-web/src/lib/__tests__/fixtures.ts` | Deterministic test factories | VERIFIED | Exists |
| `dashboard-web/src/lib/__tests__/*.test.ts` | 8 test files, 84 tests | VERIFIED | All 8 files present, all 84 tests pass |
| `dashboard-web/sentry.client.config.ts` | Client Sentry init (DSN-gated) | VERIFIED | Exists, DSN-gated, no `replayIntegration` (WR-03 fix applied) |
| `dashboard-web/sentry.server.config.ts` | Server Sentry init | VERIFIED | Exists |
| `dashboard-web/sentry.edge.config.ts` | Edge Sentry init | VERIFIED | Exists |
| `dashboard-web/instrumentation.ts` | Next.js register hook + DSN-gated onRequestError | VERIFIED | WR-01 fix applied — `onRequestError` is now an async function with DSN guard and lazy import; no top-level await |
| `dashboard-web/src/components/ErrorBoundary.tsx` | React class ErrorBoundary with Hebrew RTL fallback | VERIFIED | Exists, wired in `layout.tsx`, CR-02 fix applied (dev shows raw `error.message`, prod shows generic Hebrew message) |
| `dashboard-web/src/lib/cacheConfig.ts` | CACHE_CONFIG + cacheControl() | VERIFIED | Exists with 8 keys; WR-05 fix applied (dashboardState.revalidate raised from 10s to 30s) |
| `dashboard-web/src/lib/apiErrors.ts` | Shared `userFacingError()` helper | VERIFIED | Exists at `src/lib/apiErrors.ts`. CR-01 fix: all 8 routes import and use `userFacingError()` — no raw `err.message` in client responses |
| `dashboard-web/src/lib/utils.ts` (safeDecode) | `safeDecode` export | VERIFIED | `export function safeDecode` at line 59 |
| `dashboard-web/src/lib/attributionAnalysis.ts` | CR-03 + IN-01 fixes | VERIFIED | `spend > 0` guard at lines 295, 346, 732, 756; `windowCountWithData` rename applied |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `layout.tsx` | `ErrorBoundary` | import + JSX wrap | WIRED | `import { ErrorBoundary }` at line 4; `{children}` wrapped at line 31 |
| All 8 API routes | `cacheConfig.ts` | `import { cacheControl }` | WIRED | All 8 routes import `cacheControl` and call it in response headers |
| All 8 API routes | `apiErrors.ts` | `import { userFacingError }` | WIRED | All 8 routes import and call `userFacingError(message)` in catch blocks |
| `instrumentation.ts` | `sentry.server.config.ts` | `await import('./sentry.server.config')` | WIRED | Conditional on `NEXT_RUNTIME === 'nodejs'` |
| `instrumentation.ts` | `sentry.edge.config.ts` | `await import('./sentry.edge.config')` | WIRED | Conditional on `NEXT_RUNTIME === 'edge'` |
| `next.config.ts` | `@sentry/nextjs` | `withSentryConfig(nextConfig, ...)` | WIRED | Line 2 import, line 15 wrapper |
| `sentry.client.config.ts` | `NEXT_PUBLIC_SENTRY_DSN` | DSN guard | WIRED | `const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN; if (dsn) { Sentry.init(...) }` |
| `instrumentation.ts` | `SENTRY_DSN` | onRequestError DSN guard | WIRED | `if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;` before lazy import |

### Data-Flow Trace (Level 4)

Level 4 not applicable to this phase — no components rendering dynamic database-sourced data were introduced. All artifacts are infrastructure (test harness, error reporting config, cache config, utility function). The ErrorBoundary renders only when a React error is caught — that path requires human testing (see Human Verification section).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `npm run test` passes with 84 tests | `cd dashboard-web && npm run test` | 8 test files, 84 tests, all passed, Duration 450ms | PASS |
| Zero `s-maxage` string literals in API routes | `grep -rn "s-maxage=" dashboard-web/src/app/api/` | 0 hits | PASS |
| Row-count guards present in 7 routes | `grep -rn "50000" dashboard-web/src/app/api/` | 7 routes contain `if (rows.length > 50000) { console.warn(...) }` | PASS |
| `safeDecode` exported from utils.ts | `grep -n "^export function safeDecode" utils.ts` | Line 59: `export function safeDecode(value: string \| null \| undefined): string` | PASS |
| Sentry DSN documented in README | `grep -n "SENTRY_DSN" dashboard-web/README.md` | Line 253: documents both `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` with full context | PASS |
| `npm run build` passes zero TS errors | `cd dashboard-web && npm run build` | "Compiled successfully in 5.3s", all 12 pages generated, zero errors | PASS |
| `apiErrors.ts` exists and is imported by all 8 routes | `grep -rn "userFacingError" dashboard-web/src/app/api/` | 8 route files, all import and call `userFacingError` | PASS |

### Requirements Coverage

REQUIREMENTS.md does not exist at `.planning/REQUIREMENTS.md` — the file was not found in the repository. Requirements are traced from the PLAN frontmatter and ROADMAP.md instead.

| Requirement | Source Plan | Description (from ROADMAP.md) | Status | Evidence |
|-------------|-------------|-------------------------------|--------|----------|
| REQ-01 | 02-PLAN.md | Install Vitest + write 30-50 unit tests for attributionAnalysis functions | SATISFIED | 84 tests across 8 files, all pass |
| REQ-02 | 02-PLAN.md | Install Sentry SDK + global ErrorBoundary for client + edge error reporting | SATISFIED | All Sentry config files exist, ErrorBoundary wired in layout, WR-01/WR-03/CR-02 fixes applied |
| REQ-03 | 02-PLAN.md | Extract cache TTLs into `dashboard-web/src/lib/cacheConfig.ts` with `cacheControl(key)` helper | SATISFIED | cacheConfig.ts exists, all 8 routes import and use `cacheControl()`, zero hardcoded `s-maxage` literals |
| REQ-04 | 02-PLAN.md | Add row-count guards (`if (rows.length > 50000) console.warn(...)`) to every `/api/*` route | SATISFIED | 7 routes have the guard; dashboard-state excluded by design (bounded by 8 fixed keys) |
| REQ-05 | 02-PLAN.md | Create `safeDecode` utility in `dashboard-web/src/lib/utils.ts` | SATISFIED | Export exists at utils.ts:59, 8 tests, documented preemptive (no call sites at Phase 2 time) |
| REQ-06 | 02-PLAN.md | (Implicit) `npm run build` passes with zero TypeScript errors (SC-6) | SATISFIED | Build passes cleanly |

No orphaned requirements — REQUIREMENTS.md does not exist in the repository, so no cross-check gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `dashboard-web/src/lib/utils.ts` | 38 | `TODO(phase-5)` comment | Info | Intentional — documents planned consumer for `safeDecode()`. Not a stub; the utility is fully implemented with tests. |
| `dashboard-web/instrumentation.ts` | (none) | WR-01 previously had top-level await; now fixed | Info | Fixed — `onRequestError` is now a proper async function with DSN gate. |
| `dashboard-web/sentry.client.config.ts` | (none) | WR-03 previously had `replayIntegration`; now removed | Info | Fixed — privacy implications documented in README and code comment. |

No blockers or stub patterns found. The `return { rows: [], error: ... }` patterns in API catch blocks are the intentional graceful-degrade pattern (WR-06 fix), not stubs — they're the error path, not the success path.

### Human Verification Required

#### 1. Sentry End-to-End Error Delivery

**Test:** With `NEXT_PUBLIC_SENTRY_DSN` set to a real Sentry project DSN (in `.env.local`), deploy or run `npm run dev`, then trigger a client-side error (e.g., throw from a `useEffect` in any component, or deliberately trigger the ErrorBoundary by passing a bad prop).

**Expected:** An error event appears in the Sentry dashboard within ~30 seconds, showing the correct stack trace, environment (`development` or `production`), and no raw PII in the error message body (since `userFacingError()` sanitizes the message before any user-facing output).

**Why human:** The Sentry DSN is absent from the local environment. All code paths that call `Sentry.captureException` or `captureRequestError` are no-op without a DSN — this is correct behavior, but it means the actual data delivery (error event ingestion at `sentry.io`) cannot be verified programmatically. The wiring is verified (all config files exist, `withSentryConfig` wraps Next.js, `ErrorBoundary` captures and forwards errors, `onRequestError` DSN-gates correctly), but end-to-end delivery requires a live DSN and a real Sentry project.

### Gaps Summary

No gaps blocking goal achievement. All six success criteria from ROADMAP.md are met:

1. Tests: 84 pass (exceeds 30-50 floor).
2. Sentry wiring: fully wired; end-to-end delivery pending human smoke test.
3. Cache config: all 8 routes use `cacheControl()`, zero `s-maxage` literals.
4. Row-count guards: 7 applicable routes guarded; dashboard-state excluded by design.
5. `safeDecode`: exported, tested, documented as preemptive with override accepted.
6. Build: passes with zero TypeScript errors.

Post-review fixes (CR-01 `apiErrors.ts`, CR-02 ErrorBoundary dev/prod conditional, CR-03 `spend > 0` guards, WR-01 DSN-gated `onRequestError`, WR-03 no `replayIntegration`, WR-04 value-size guard, WR-05 revalidate raised, WR-06 uniform 200+empty-rows pattern, IN-01 `windowCountWithData` rename, IN-06 `force-dynamic` removed, IN-08 error shape fix) are all confirmed applied in the post-fix codebase.

---

_Verified: 2026-05-18T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
