---
phase: 02-foundations
plan: 02
subsystem: testing
tags: [vitest, sentry, nextjs, typescript, attribution, testing, error-boundary, cache]

requires:
  - phase: 01-data-pipeline
    provides: attributionAnalysis.ts, ordersAttribution.ts, OrderAttributionRow, OrderLineItem types

provides:
  - Vitest test harness (76+ tests for attribution pure functions)
  - Sentry error reporting (env-driven, no-op in localhost)
  - Global React ErrorBoundary with Hebrew RTL fallback UI
  - cacheConfig.ts centralised Cache-Control for all 8 API routes
  - 50k row-count guards in 7 API routes
  - safeDecode() utility (decodeURIComponent with try/catch)
  - Exported computeWindowStability + detectOutlierDays for direct test/import

affects: [03-ui-refresh, 04-component-decomposition, 05-scalability, 07-observability, 08-i18n]

tech-stack:
  added: [vitest ^2.1.0, @vitest/coverage-v8 ^2.1.0, @sentry/nextjs ^8.40.0]
  patterns:
    - Pure-function test harness with deterministic fixtures (no mocking, no IO)
    - env-driven Sentry init (DSN absent = silent no-op)
    - cacheControl(key) helper for DRY Cache-Control headers
    - export helpers from internal modules for testability (Option B)

key-files:
  created:
    - dashboard-web/vitest.config.ts
    - dashboard-web/src/lib/__tests__/fixtures.ts
    - dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts
    - dashboard-web/src/lib/__tests__/analyzeAttribution.test.ts
    - dashboard-web/src/lib/__tests__/analyzeAttributionForAdSet.test.ts
    - dashboard-web/src/lib/__tests__/analyzeAttributionForAd.test.ts
    - dashboard-web/src/lib/__tests__/analyzeProductChannel.test.ts
    - dashboard-web/src/lib/__tests__/detectOutlierDays.test.ts
    - dashboard-web/src/lib/__tests__/computeWindowStability.test.ts
    - dashboard-web/src/lib/__tests__/utils.test.ts
    - dashboard-web/sentry.client.config.ts
    - dashboard-web/sentry.server.config.ts
    - dashboard-web/sentry.edge.config.ts
    - dashboard-web/instrumentation.ts
    - dashboard-web/src/components/ErrorBoundary.tsx
    - dashboard-web/src/lib/cacheConfig.ts
  modified:
    - dashboard-web/package.json
    - dashboard-web/tsconfig.json (already covered __tests__ via src/**/*)
    - dashboard-web/next.config.ts
    - dashboard-web/.env.local.example
    - dashboard-web/.gitignore
    - dashboard-web/src/app/layout.tsx
    - dashboard-web/src/lib/attributionAnalysis.ts
    - dashboard-web/src/lib/utils.ts
    - dashboard-web/src/app/api/data/route.ts
    - dashboard-web/src/app/api/campaigns/route.ts
    - dashboard-web/src/app/api/products/route.ts
    - dashboard-web/src/app/api/ads/route.ts
    - dashboard-web/src/app/api/orders-attribution/route.ts
    - dashboard-web/src/app/api/store-meta/route.ts
    - dashboard-web/src/app/api/product-catalog/route.ts
    - dashboard-web/src/app/api/dashboard-state/route.ts
    - dashboard-web/README.md
    - SYSTEM_OVERVIEW.md

key-decisions:
  - "Use Vitest Option B for private helpers: export computeWindowStability + detectOutlierDays directly — additive, Phase 4 hooks benefit from direct import"
  - "export const revalidate kept as numeric literals — Next.js 15 static analysis requires literals (CACHE_CONFIG expression causes 'Invalid segment configuration' error)"
  - "Sentry init guarded by DSN presence — no-op in localhost, zero overhead, zero warnings"
  - "safeDecode preemptive (0 existing call sites at task time) — ready for Phase 5 query params and Phase 8 i18n"
  - "detectOutlierDays test adapted for LOOKBACK adaptive sizing (IN5-02): baseline needs variance (stdDev != 0) for z-score to fire"

requirements-completed: [REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06]

duration: 110min
completed: 2026-05-18
---

# Phase 2 Plan 02: Foundations Summary

**Vitest harness (84 tests), Sentry error reporting, ErrorBoundary, centralised cacheConfig, row-count guards, and safeDecode utility — all with zero regressions on the existing attribution pipeline.**

## Performance

- **Duration:** ~110 min
- **Completed:** 2026-05-18
- **Tasks:** 13/14 (T-14 is operator-manual, automated gates all pass)
- **Files modified:** 35

## Accomplishments

- 84 tests covering `orderMatchesCampaign` (CR5-01), `analyzeAttribution` (WR5-04), ad-set/ad attribution, product channel, outlier detection, window stability (IN5-02/IN5-03), and `safeDecode`
- Sentry `@sentry/nextjs` installed + instrumentation wired; silent no-op without DSN
- Global `ErrorBoundary` with Hebrew RTL fallback and Sentry capture
- `cacheConfig.ts` eliminates hardcoded `Cache-Control` strings from all 8 API routes
- 50k row-count `console.warn` guards in 7 routes (dashboard-state excluded: bounded by 8 keys)
- `safeDecode` utility preemptive-added for Phase 5/8 utm/query param decode safety

## Task Commits

1. **T-01: Install Vitest** - `2f1b45f` (chore)
2. **T-02: Test fixtures** - `f01704e` (test)
3. **T-03: orderMatchesCampaign tests** - `f459dad` (test)
4. **T-04: analyzeAttribution tests** - `4ff7098` (test)
5. **T-05: Ad-set + ad attribution tests** - `14643b2` (test)
6. **T-06: analyzeProductChannel tests** - `a78ae31` (test)
7. **T-07: Window stability + outlier tests** - `a663624` (test)
8. **T-08: @sentry/nextjs + config** - `e170d57` (feat)
9. **T-09: ErrorBoundary** - `f3c79ee` (feat)
10. **T-10: cacheConfig + 8 routes** - `d097192` (refactor)
11. **T-11: Row-count guards** - `ee9c0f7` (feat)
12. **T-12: safeDecode + tests** - `b6bf259` (feat)
13. **T-13: README + SYSTEM_OVERVIEW docs** - `1c50a27` (docs)
14. **T-14: Manual smoke** - no commit (operator-manual task)

## Files Created/Modified

- `dashboard-web/vitest.config.ts` — Vitest config (node env, @-alias, passWithNoTests)
- `dashboard-web/src/lib/__tests__/fixtures.ts` — Deterministic factories (makeOrder, makeCampaign, etc.)
- `dashboard-web/src/lib/__tests__/*.test.ts` — 84 tests across 8 test files
- `dashboard-web/sentry.*.config.ts` — Client/server/edge Sentry init (DSN-gated)
- `dashboard-web/instrumentation.ts` — Next.js 15 register hook
- `dashboard-web/src/components/ErrorBoundary.tsx` — React class ErrorBoundary with Hebrew fallback
- `dashboard-web/src/app/layout.tsx` — Wraps children in ErrorBoundary
- `dashboard-web/src/lib/attributionAnalysis.ts` — Exported computeWindowStability + detectOutlierDays
- `dashboard-web/src/lib/cacheConfig.ts` — CACHE_CONFIG + cacheControl() helper
- `dashboard-web/src/app/api/*/route.ts` — Uses cacheControl() + row-count guards
- `dashboard-web/src/lib/utils.ts` — Added safeDecode()
- `dashboard-web/next.config.ts` — withSentryConfig wrapper
- `dashboard-web/README.md` + `SYSTEM_OVERVIEW.md` — Phase 2 documentation sections

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Next.js static analysis rejects CACHE_CONFIG expression for `export const revalidate`**
- **Found during:** T-10 (cacheConfig + route refactor)
- **Issue:** `export const revalidate = CACHE_CONFIG.data.revalidate;` causes "Invalid segment configuration export detected" — Next.js 15 requires a numeric literal for static analysis
- **Fix:** Kept numeric literals for `export const revalidate` with inline comment pointing to CACHE_CONFIG key. `cacheControl(key)` still used for the Cache-Control header (the main DRY goal). CACHE_CONFIG import changed to `cacheControl`-only.
- **Files modified:** All 8 API routes
- **Verification:** `npm run build` passes without "Invalid segment configuration" warnings
- **Committed in:** `d097192`

**2. [Rule 1 - Bug] detectOutlierDays outlier test initially failed with uniform baseline**
- **Found during:** T-04 (analyzeAttribution tests — outlier day assertion)
- **Issue:** Test used 14 days of uniform value=100 as baseline. With stdDev=0 in trailing window, z-score check skips (IN5-02) → no outlier detected even with spike at day 14
- **Fix:** Changed test baseline to include variance (alternating 90/110/95/105/100 values) + spike at 2000 so stdDev ≠ 0 and z-score correctly fires
- **Files modified:** `analyzeAttribution.test.ts`
- **Committed in:** `4ff7098`

**3. [Rule 1 - Bug] computeWindowStability verdict tests initially incorrect**
- **Found during:** T-07 (window stability tests)
- **Issue:** Tests using 7 meta points per window (meta_window_sum=700) but small matched amounts (90 + 10 CAD) → coverages 0.129 and 0.014 → both small, low σ → 'stable' instead of 'volatile'
- **Fix:** Changed meta series to 1 point per window (meta_sum=100 per window) so coverage contrasts (0.9 vs 0.1) produce σ≈0.4 correctly yielding 'volatile'
- **Files modified:** `computeWindowStability.test.ts`
- **Committed in:** `a663624`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs)
**Impact on plan:** No scope change. All fixes necessary for correctness. The `revalidate` literal constraint is a Next.js limitation not mentioned in the plan; the cacheControl() DRY win is preserved for headers.

## Issues Encountered

**ESLint not configured:** `npm run lint` prompts for ESLint setup interactively (pre-existing state — no ESLint config file exists). T-14 includes `npm run lint` as a gate but lint was not set up before Phase 2. Pre-existing issue, out of scope for Phase 2. Recommend adding ESLint config in Phase 4 (component decomposition will benefit from linting).

## Known Stubs

None — no hardcoded empty values, placeholders, or unwired components introduced in this plan.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Sentry is opt-in (DSN-gated) and does not add attack surface in localhost.

## Next Phase Readiness

- Test harness ready for Phase 3 (Apps Script observability) and Phase 4 (component decomposition)
- `detectOutlierDays` and `computeWindowStability` exported for Phase 4 hooks
- `safeDecode` ready for Phase 5 query params
- ErrorBoundary ready for Phase 4 per-component boundaries
- cacheConfig ready for TTL tuning in Phase 5 (pagination)

## Self-Check: PASSED
