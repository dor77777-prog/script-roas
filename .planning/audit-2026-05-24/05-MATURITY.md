# Code Maturity & Testing Audit

Track 5 of an 8-track end-to-end audit of `script-roas`. Read-only pass.
Scope: tests, coverage, error handling, TS strictness, complexity, docs,
pre-push gates, lint.

## Summary

Test suite is healthy on **algorithmic / pure logic** (112 files, 1054
tests, all passing — 6.9s wall, no flakes). Overall coverage `32.4%
stmts / 73.2% branches / 58.5% funcs` — the branch number reflects the
v8 coverage idiom (executed code has good branch density) but the
**denominator includes the entire `src/components/**` tree**, which is
~3% covered. The single component test (`freshnessChip.test.ts`) only
exercises a pure helper exported from a component — there is **no React
render coverage anywhere** despite ~21,000 lines of TSX. App routes,
`src/lib/hooks/*`, `lib/format.ts`, `lib/annotations.ts`, and the
WhatsApp delivery layer are at 0% statements.

`userFacingError` from `lib/apiErrors.ts` is correctly wired across
13 routes; three (`/api/inngest`, `/api/debug/shopify-fetch`, `/api/oauth/tiktok/callback`)
correctly opt out, but **none of the 27 server-side `console.error` calls
forward to Sentry** — server errors only land in Vercel logs.
`Sentry.captureException` is invoked exactly once in production code
(client-side ErrorBoundary). `instrumentation.onRequestError` covers
request-error path, but ad-hoc fetch failures inside route handlers do not.

**TypeScript** uses `strict: true` only. No `noUncheckedIndexedAccess`
(80 occurrences of `: any` / `as unknown as`, of which 11 are in
non-test code, mostly legitimate `step as unknown as StepRunner` casts
required by the Inngest type surface). No `exactOptionalPropertyTypes`.

**Lint is unconfigured.** `npm run lint` opens an interactive
`How would you like to configure ESLint?` prompt — there is no
`.eslintrc*` or `eslint.config.*` file in the project. The script is a
no-op in CI. (Background-completed exit 0 because the interactive
prompt cleanly resolved when stdin closed.)

**Pre-push gates promised by docs are not enforced.** `CONVENTIONS.md`
says four gates (tsc, vitest, User Manual currency, ARCHITECTURE.md
currency); none of them exist as husky/lefthook/lint-staged or
`.git/hooks/pre-push`. Only `pre-push.sample` is present.

**StepRunner stub pattern drift:** Only `cronDaily.test.ts` exports/uses
a `StepRunner`-named pattern; the other 12 inngest tests use ad-hoc
`vi.mock(step)` or direct handler invocation. Same idea, different
shape — moderately diverged.

## P0 (broken tests, missing critical tests, lint errors)

### P0-1 — `npm run lint` is a no-op (interactive prompt). [`dashboard-web/package.json:7`]
`"lint": "next lint"` and there is no committed ESLint config in the
repo (no `eslint.config.*`, no `.eslintrc*` — only `node_modules`
entries). In CI/local non-interactive shells the command just exits 0
after writing the question to stdout. There is no actual linting
running anywhere. Notably `next lint` is also deprecated in Next 16.
**Remediation**: add `eslint.config.mjs` (flat config) extending
`next/core-web-vitals` + `@typescript-eslint/recommended`, switch the
script to `eslint .` so CI fails loud, and add a rule like
`@typescript-eslint/no-explicit-any` (warn).

### P0-2 — Pre-push gates documented but absent. [`.planning/codebase/CONVENTIONS.md`]
`CONVENTIONS.md` explicitly states "two pre-push gates, on par with
tsc and vitest" for docs currency, and project memory enumerates four
gates (tsc, vitest, User Manual, ARCHITECTURE.md). The only `.git/hooks`
entries are `.sample` files. There is no husky / lefthook / pre-commit /
lint-staged config and no shell script wired to git hook paths.
**Remediation**: pick one of the three (husky is least intrusive given
Node devDeps); commit `.husky/pre-push` that runs `npm --prefix dashboard-web run lint && npm --prefix dashboard-web test && npx tsc --noEmit -p dashboard-web && node scripts/check-docs-currency.js`.

### P0-3 — No React render tests for ~21k lines of TSX. [`src/components/__tests__/`]
The single file `freshnessChip.test.ts` tests a pure formatter
function (`formatTimeAgo`) re-exported from a component — it does NOT
render anything. The 0% statement coverage on virtually all components
(see coverage table below) means a typo inside a JSX block, a missing
prop on a child component, a runtime crash on edge cases — all ship.
**Remediation**: see P1-1 below for prioritised list; also add a
`vitest.config.dom.ts` per the existing comment in `vitest.config.ts:7-15`
(the file already documents the migration path) and a `test:components`
script.

## P1 (coverage gaps on critical algorithms, weak tests, strictness gaps)

### P1-1 — Top 5 priority components missing smoke render tests
None of these have ANY render test; all have substantial conditional
business logic, drawer/panel hierarchies, or grade-gated UI:

1. **`CampaignsTable.tsx`** (2,464 lines, complexity proxy 319) — the
   spine of the dashboard. Sort logic, drilldown filter, column-prefs
   ordering, health-grade chips, ROAS tone, attribution-trust ladder.
   Coverage: 0% statements.
2. **`CampaignDrawer.tsx`** (1,413 lines, complexity 194) — drawer
   stack manager + 4 sub-panels (cohort, attribution, reconciliation,
   AI report). Stale-cohort filter logic and 'unknown' trust-narrowing
   ladder are non-trivial.
3. **`HealthScoreBadge.tsx` + `HealthScorePanel.tsx`** (487 lines combined,
   complexity ~50) — grade chip popover with all 5 sub-components.
   `computeCampaignHealth` is well-tested in pure-function form
   (`campaignHealthScore.test.ts`), but the chip-to-popover gating logic
   (e.g. `insufficient` → ⏳ rendering, click-to-open state machine) is
   un-asserted.
4. **`AdsDrawer.tsx`** (636 lines) — SWR key compositing only tested
   indirectly via `buildDateRangeKey`. The drawer's filter-symmetry
   patch (FIX-04, FIX-07) lives here.
5. **`BillingSettings.tsx`** (1,164 lines, complexity 97) — recurring
   + one-time billing rows, USD↔CAD conversion edit forms, store-scope
   "All" semantics that have shipped 3 separate audit fixes.

### P1-2 — `apiErrors.ts` has 0 dedicated tests despite being used in 13 routes
**[`src/lib/apiErrors.ts`]** Coverage shows 44.4% stmt, 16.6% branch.
The branch table inside `userFacingError` is purely regex-driven and
the regex/return-string contract is what every route depends on. A
missing route (`network/ENOTFOUND` not matching) silently falls through
to the catch-all "שגיאה לא צפויה" message; ops loses signal.
**Remediation**: add `apiErrors.test.ts` covering each branch
(permission, not-found, quota, missing env, network, fallback) plus a
hostile-input case ("forbidden quota 404 fetch failed" — which branch
wins?).

### P1-3 — Server-side errors do not reach Sentry
**[`src/app/api/*/route.ts`]** All 16 route handlers do `console.error`
on catch but only `instrumentation.onRequestError` and the React
`ErrorBoundary` actually call `Sentry.captureException`. Inngest
function failures (cron-daily, cron-live, eventBackfill) similarly
log to console but never push to Sentry — the operator only sees them
in the Inngest dashboard. Three routes (`/api/operator/jobs`,
`/api/operator/manual-overrides`, `/api/operator/sync-now`) catch
multi-step failures with no central reporting at all.
**Remediation**: introduce a `reportRouteError(message, context)`
helper in `lib/apiErrors.ts` that does `console.error` AND
`Sentry.captureException` (when DSN present). Replace every
`console.error(...)` in `app/api/*/route.ts` with it.

### P1-4 — Inngest test pattern drift from documented `StepRunner` stub
**[`src/inngest/functions/__tests__/*.ts`]** STRUCTURE doc says all
inngest tests use the StepRunner stub pattern from `cronDaily.test.ts`.
Reality: only that one file uses `StepRunner` as a named type. The
other 12 tests use:
- `cronWhatsapp.test.ts` — cron-trigger introspection only, no step
  execution (so the question doesn't apply).
- `cronLive*.test.ts` (5 files) — duck-typed `step` objects with
  `vi.fn()` for each `step.run` / `step.sleepUntil` / `step.sendEvent`.
- `events.test.ts`, `eventBackfillSystemicFailure.test.ts` —
  `(fn as unknown as { fn: ... }).fn` direct invocation with a
  hand-rolled step object.
- `eventBackfillDstRange.test.ts` — pure unit test of `dateRange()`
  helper, no step needed.

Functionally equivalent but **different shapes per file means a future
contributor has 3 templates to choose from**. Coverage is 83% inngest
funcs — adequate but a small refactor to one shared
`createMockStepRunner()` helper in `src/inngest/__tests__/helpers/`
would unify them.

### P1-5 — `cohortComparisonSortKey.test.ts` is a single behavioural test for a complex feature
**[`src/lib/__tests__/cohortComparisonSortKey.test.ts`]** Cohort
comparison is one of the higher-risk algorithms in the codebase
(introduced in 05.7 multi-mapping intelligence). The test file name
implies it covers only sort keys. The full `computeMultiMappingCohort`
algorithm IS covered by `multiMappingCohort.test.ts` +
`multiMappingCohortRanking.test.ts`, but the **`CohortComparisonPanel`
component rendering and the cohort-vs-current-campaign navigation
flow are un-tested**.

### P1-6 — Heavy mocking that violates "mock only at external boundaries"
**[various]** A few suspect cases:
- `postgresReaders.test.ts` and `postgresReadersNewestRowDedup.test.ts`
  mock `@/lib/supabase` (the internal client wrapper). Per the project
  memory note this is OK because supabase IS the external boundary,
  but the mock is a thenable chainable monster that re-implements 60%
  of the Supabase JS query builder. A failure mode where Supabase
  changes the chain (e.g. `.range()` deprecation) would not be caught
  by these tests. **Recommend**: track Supabase SDK version against a
  fixture in a tiny `contract` test that hits a known-shape table on a
  test schema (NOT in CI per the no-localhost rule, but in a
  pre-deploy step).
- `drawerStack.test.ts` mocks `react` itself (the whole `useState` /
  `useEffect` / `useRef` machinery is hand-rolled — 100+ lines of
  harness). This is justified by the comment but it tests
  IMPLEMENTATION of the hook, not behaviour. **Recommend**: once a
  jsdom config exists (per `vitest.config.ts:7` comment), rewrite
  this against `@testing-library/react`.
- `useDashboardRefresh.test.ts` mocks both `swr` AND `react` — same
  rewrite recommendation.

### P1-7 — TypeScript strictness can go further
**[`dashboard-web/tsconfig.json`]** Only `strict: true` is set. Missing:
- `noUncheckedIndexedAccess` — would surface array/index access bugs
  in `dateRange.ts`, `attributionAnalysis.ts`, and the cron-loop
  fan-outs. Estimated migration cost: ~50-80 spots flagged based on
  the patterns in `aggregateByStore`, `for (const r of rows)` loops,
  and the various `dailyArr[i]` accesses.
- `exactOptionalPropertyTypes` — would catch `{ trustLevel?: undefined }`
  vs missing key bugs in the `Aggregated` / `CampaignHealth` shapes.
- `noPropertyAccessFromIndexSignature` — environment variable lookups
  use `process.env.X`; this strictness level would force the
  `process.env['X']` form, which is more accurate for the typings.

Counts: `grep ': any\|as unknown as'` returns 80 hits total, 11 in
production code:
- 5 are `step as unknown as StepRunner` (legitimate — Inngest type
  surface is narrower than runtime).
- 2 are `data as unknown as DbRow[]` in `postgresReaders.ts` (could
  be replaced with a typed `.returns<DbRow[]>()` call).
- 1 is in `aiReport.ts:1232` (`as unknown as ReturnType<typeof
  analyzeCpmVsRoas>['details']`) — the inline inference is gnarly;
  refactor `analyzeCpmVsRoas` to export an explicit `Details` type.
- 3 are mention-only inside `//` comments (`cronLive.ts:262`,
  `postgresReaders.ts:624`, `cpmRoasAnalysis.ts:216`,
  `CampaignsTableRow.tsx:218`) — the grep is catching the literal
  word "any" inside English prose. Harmless.

## P2 (cleanup, doc gaps)

### P2-1 — `lib/format.ts` has 0% coverage despite being a formatting layer
**[`src/lib/format.ts`]** 164 lines, no tests. Currency / number /
percentage formatters that the entire UI depends on. The fact that
no test imports from it means either (a) the UI rarely uses it (in
which case some of it might be dead code) or (b) every component
re-implements its own formatting (which the audit's other complexity
table suggests — `formatCurrency` is in `lib/utils.ts` and IS tested,
but `lib/format.ts` exists in parallel).
**Investigation**: confirm which is canonical, delete the other.

### P2-2 — `lib/annotations.ts` 0% coverage. [`src/lib/annotations.ts`]
113 lines, no tests. Functional-area mismatch — annotations are a
state-storage layer (similar to billing / goal / insightStates which
ARE tested). Add a small test for read/write/migration round-trip.

### P2-3 — `lib/hooks/useCampaignTrueRevenue.ts` 0% coverage despite being load-bearing
**[`src/lib/hooks/useCampaignTrueRevenue.ts`]** 519 lines (the largest
hook in the codebase). Produces `TrueRevenueInfo` which `HealthScoreBadge`,
`AttributionAnalysisPanel`, and the campaigns table all consume. Pure
TS, no React-render gymnastics needed for the most part. The fact that
3 separate audit-fix annotations in this file mention "FIX-04 / FIX-07
attribution coverage" shows it's been a bug source.

### P2-4 — `lib/insights.ts` 21.7% coverage despite carrying the InsightsBoard
**[`src/lib/insights.ts`]** Lines 158-767 (~83% of the file) are
uncovered: this is the anomaly detection, recommendation engine, and
forecast logic surfaced in `InsightsBoard.tsx`. The header doc is
excellent — the code is ripe for a tabular test sweep.

### P2-5 — TODO sweep: tsc not in any script
**[`dashboard-web/package.json`]** No `"typecheck"` script. CI relies
on `next build` to surface type errors (which it does, but only the
ones that block the build — `noEmit` errors in non-built modules
silently pass). Add `"typecheck": "tsc --noEmit"` and wire it into
the proposed P0-2 pre-push gate.

### P2-6 — `next lint` deprecation warning
**[`dashboard-web/package.json:7`]** Next 16 removes `next lint`. The
deprecation banner is in every lint run. Migrate now (part of P0-1).

### P2-7 — Mixed Hebrew/English in tests
**[various test files]** Some tests assert Hebrew strings inline
(`expect(r.label).toBe('עודכן עכשיו')`). Brittle to copy changes. Consider
extracting these to a constants module that both production code and
tests import. (Minor — only call out for the few that change
frequently per the user-manual currency convention.)

## Coverage table (file → lines% → branches%)

(Subset — focusing on critical-path modules and gaps. Full table in
the coverage run.)

| File                                  | Lines% | Branches% | Funcs% |
|---------------------------------------|--------|-----------|--------|
| **Pure / well-tested algorithms** ||||
| `lib/campaignHealthScore.ts`          | 96.1   | 90.2      | 100    |
| `lib/cannibalizationDetection.ts`     | 94.4   | 86.3      | 83.3   |
| `lib/cpmRoasAnalysis.ts`              | 95.5   | 88.6      | 100    |
| `lib/multiMappingCohort.ts`           | 100    | 87.5      | 100    |
| `lib/productCentricView.ts`           | 100    | 84.3      | 100    |
| `lib/shopifyRevenueRefunds.ts`        | 97.8   | 69.4      | 100    |
| `lib/attributionAnalysis.ts`          | 91.0   | 88.6      | 93.3   |
| `lib/sparklineGeometry.ts`            | 93.8   | 83.3      | 100    |
| `lib/cacheConfig.ts`                  | 100    | 100       | 100    |
| `lib/drawerStack.ts`                  | 100    | 76.9      | 100    |
| `lib/drillFilter.ts`                  | 100    | 100       | 100    |
| `lib/rangeClamp.ts`                   | 100    | 100       | 100    |
| `lib/aiReport.ts`                     | 83.5   | 73.6      | 100    |
| `lib/campaignProductMap.ts`           | 82.4   | 80.6      | 80     |
| `lib/billing.ts`                      | 64.4   | 60.9      | 61.1   |
| `inngest/functions/cronDaily.ts`      | 82.3   | 76.2      | 80     |
| `inngest/functions/cronLive.ts`       | 84.2   | 73.7      | 100    |
| `inngest/functions/eventBackfill.ts`  | 96.9   | 92.9      | 66.7   |
| `lib/fetchers/fx.ts`                  | 100    | 100       | 100    |
| `lib/fetchers/shopify.ts`             | 90.6   | 64.5      | 100    |
| `lib/fetchers/meta.ts`                | 85.6   | 70.6      | 100    |
| `lib/fetchers/tiktok.ts`              | 92.2   | 56.0      | 100    |
| `lib/fetchers/googleAds.ts`           | 58.4   | 63.6      | 100    |
| `lib/fetchers/shopifyAuth.ts`         | 92.3   | 94.7      | 100    |
| **Critical gaps** ||||
| `lib/apiErrors.ts`                    | 44.4   | 16.7      | 100    |
| `lib/insights.ts`                     | 21.7   | 95.0      | 17.6   |
| `lib/cloudSync.ts`                    | 78.4   | 49.2      | 85.7   |
| `lib/postgresReaders.ts`              | 75.8   | 51.8      | 63.2   |
| `lib/notifications/whatsapp.ts`       | 2.6    | 100       | 0      |
| `lib/notifications/summary.ts`        | 0.7    | 100       | 0      |
| `app/api/operator/manual-overrides`   | 13.9   | 10.0      | 25.0   |
| `app/api/health/route.ts`             | 6.9    | 100       | 0      |

## Files with 0% coverage

Production-code files (excluding components which are en-masse 0%):

- `src/app/api/ads/route.ts`
- `src/app/api/campaigns/route.ts`
- `src/app/api/dashboard-state/route.ts`
- `src/app/api/data/route.ts`
- `src/app/api/inngest/route.ts`
- `src/app/api/operator/backfill/route.ts`
- `src/app/api/operator/notifications/send/route.ts`
- `src/app/api/operator/sync-now/route.ts`
- `src/app/api/orders-attribution/route.ts`
- `src/app/api/product-catalog/route.ts`
- `src/app/api/products/route.ts`
- `src/app/api/store-meta/route.ts`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/operator/page.tsx`
- `src/lib/ads.ts`, `src/lib/campaigns.ts`, `src/lib/products.ts`
  (all three are the data-shape / fetch shells — should at least have
  shape contract tests)
- `src/lib/annotations.ts`
- `src/lib/campaignsLinks.ts` (3.6%)
- `src/lib/costs.ts` (15.8%)
- `src/lib/dashboardStateKeys.ts`
- `src/lib/format.ts` (potentially dead code, see P2-1)
- `src/lib/platformsByStore.ts`
- `src/lib/productCatalog.ts`
- `src/lib/types.ts` (pure types — 0% is expected)
- `src/lib/urlState.ts` (381 lines — URL serialisation, deserves tests)
- `src/lib/hooks/useBillingOneTime.ts`
- `src/lib/hooks/useBillingRecurring.ts`
- `src/lib/hooks/useCampaignAttribution.ts` (the `.test.ts` file uses
  React mock-harness — proxy coverage exists but in the harness layer)
- `src/lib/hooks/useCampaignTrueRevenue.ts` (519 lines — see P2-3)

Component files (all 0% statements except 5 partial below):
- All 49 `.tsx` files in `src/components/` and `src/components/operator/`
  except: `CampaignsTableRow.tsx` (14.5%), `CohortComparisonPanel.tsx`
  (5.2%), `HealthScoreBadge.tsx` (9.5%), `MetaShopifyReconciliation.tsx`
  (32.9%), `MetricHelp.tsx` (49%), `MonthlyTables.tsx` (5.1%),
  `KpiCards.tsx` (21.6%), `RefundIndicator.tsx` (3.9%),
  `RollingNumber.tsx` (3.8%), `Sparkline.tsx` (3.8%).
- Even the 5 "partial" components are partially covered only because
  they export a helper that's imported (and thus parsed) by another
  module's test — not because they're actually rendered.

## Top 10 complexity hotspots

Using `if/for/while/case/catch/&&/||/?:` density as a proxy. Ranked by
proxy score; lines included for context.

| Rank | File                                        | Lines | Proxy |
|------|---------------------------------------------|-------|-------|
| 1    | `lib/aiReport.ts`                           | 2,496 | 410   |
| 2    | `components/CampaignsTable.tsx`             | 2,464 | 319   |
| 3    | `inngest/functions/cronLive.ts`             | 1,427 | 195   |
| 4    | `components/CampaignDrawer.tsx`             | 1,413 | 194   |
| 5    | `lib/postgresReaders.ts`                    | 1,040 | 168   |
| 6    | `lib/attributionAnalysis.ts`                | 1,234 | 157   |
| 7    | `lib/fetchers/shopify.ts`                   | 1,090 | 153   |
| 8    | `inngest/functions/cronDaily.ts`            | 1,277 | 133   |
| 9    | `components/ProductsTable.tsx`              | 933   | 114   |
| 10   | `components/BillingSettings.tsx`            | 1,164 | 97    |

Observations:
- `aiReport.ts` is the most complex *and* the most decision-laden file.
  Its 83.5% coverage and excellent docstrings make this acceptable, but
  a future refactor should split the report-generation steps into
  per-section modules (the `aiReport*` test files already group by
  section — the implementation could mirror that).
- `CampaignsTable.tsx` is the highest-risk component. P1-1 above
  prioritises this for component-test introduction.
- `postgresReaders.ts` complexity is partly inherent (8 readers, each
  with its own DB-shape mapping) — splitting per-reader would help
  but is a Phase-2 refactor question.

## TS strictness assessment

Current `tsconfig.json`:
```
"strict": true        // implies noImplicitAny, strictNullChecks,
                      // strictFunctionTypes, strictBindCallApply,
                      // strictPropertyInitialization,
                      // alwaysStrict, useUnknownInCatchVariables, etc.
"noEmit": true        // build is `next build`, tsc only typechecks
```

Missing (in order of estimated value):
- `"noUncheckedIndexedAccess": true` — high value, ~50-80 spots
- `"exactOptionalPropertyTypes": true` — medium value, narrower migration
- `"noFallthroughCasesInSwitch": true` — minor, cheap
- `"noPropertyAccessFromIndexSignature": true` — `process.env.X` form
  becomes `process.env['X']`; some friction but more accurate
- `"verbatimModuleSyntax": true` — would catch the few `import type`
  vs `import` ambiguities; cheap migration

`any` / `as unknown as` audit (production code only — 11 total):
- 5 × `step as unknown as StepRunner` — legitimate.
- 2 × `(data as unknown as DbRow[] | null) ?? []` in `postgresReaders.ts`
  — replace with `.returns<DbRow[]>()` call form.
- 1 × `aiReport.ts:1232` — refactor the consumed type to be exported.
- 3 × literal `any` mentions inside English-language `//` comments —
  false-positive grep hits.

## Pre-push gate inventory

Documented in `.planning/codebase/CONVENTIONS.md` and project memory:

| Gate                         | Documented | Implemented |
|------------------------------|------------|-------------|
| `tsc --noEmit`               | Yes        | **No**      |
| `vitest run`                 | Yes        | **No**      |
| `docs/USER_MANUAL.md` currency | Yes      | **No**      |
| `docs/ARCHITECTURE.md` currency | Yes     | **No**      |

The only evidence of any gate at the git layer is `.git/hooks/pre-push.sample`
(the unmodified git template). No husky / lefthook / lint-staged /
pre-commit config exists. No `scripts/check-docs-currency.js` exists.
No CI workflow file enforces these either (no `.github/workflows/` is
checked in based on `find`).

**Compliance: 0/4.** All four gates are aspirational only.

## Lint summary

Cannot produce a meaningful tally — `npm run lint` lands in
`next lint`'s interactive ESLint-setup prompt (no committed config).
The command writes:
```
? How would you like to configure ESLint? https://nextjs.org/docs/...
   Strict (recommended)
   Base
   Cancel
```
and exits 0 if stdin closes before a choice is made (which is what
happened in the background invocation here).

**Errors: unknown. Warnings: unknown. Top rules triggered: unknown.**

Once a config is added (per P0-1), expected initial warnings will
likely centre on:
- `@typescript-eslint/no-explicit-any` — 11 production hits
- `@typescript-eslint/no-unused-vars` — small (suite already passes tsc)
- `react-hooks/exhaustive-deps` — `drawerStack.test.ts` documents an
  effect that intentionally narrows its deps; expect some hand-tuned
  disables
- `@next/next/no-img-element` — unknown, depends on JSX

## Notes for other tracks

- **Track 1 (correctness)**: Coverage gaps in `lib/apiErrors.ts` and
  `lib/insights.ts` mean some operator-visible Hebrew text and some
  anomaly thresholds are tested only transitively. If your track audits
  the anomaly z-score or the operator-facing error strings, expect to
  be the first to land regressions.
- **Track 2 (performance)**: `lib/format.ts` at 0% coverage is
  suspicious — it may be dead code being imported only for type
  inference. Investigating that and removing it would shave bundle size.
- **Track 3 (security)**: server-side `console.error` not going to
  Sentry (P1-3) means security incidents (failed auth, suspicious
  payloads) only land in Vercel logs. Worth confirming whether
  Track 3's threat model accepts that retention/searchability.
- **Track 4 (UX)**: the absence of any component render test means UX
  regressions ship without test signal. Coordinate with Track 4 on
  whether the project wants Storybook-like visual regression vs.
  vitest + jsdom + RTL for component tests.
- **Track 6/7/8**: P0-2 (pre-push gates) and P0-1 (lint) are
  cross-cutting blockers — recommend prioritising in whichever track
  owns developer experience.

## Constraints honoured

- Read-only pass — no source files modified.
- All verification ran against local checkouts (no localhost curls);
  the lint and test scripts are normal dev-loop tooling.
- Output written to the exact path specified.
