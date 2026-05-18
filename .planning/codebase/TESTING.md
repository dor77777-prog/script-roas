# Testing Patterns

**Analysis Date:** 2026-05-18

## Reality Check

**There is no automated test suite in this repository.** Be honest about
this. Neither layer (TypeScript dashboard, Apps Script backend) has unit
tests, integration tests, snapshot tests, e2e tests, or contract tests.

Evidence:
- `dashboard-web/package.json:5-10` defines only `dev`, `build`, `start`,
  `lint` scripts — no `test`, no `test:watch`, no `coverage`
- `devDependencies` (`dashboard-web/package.json:23-33`): no Jest, no
  Vitest, no Playwright, no Cypress, no Testing Library, no MSW
- No `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx`, or `__tests__/`
  directories anywhere under `dashboard-web/src/` or the repo root
- Apps Script (`*.gs` files) has no test harness — Apps Script doesn't
  natively support testing without third-party scaffolding, and none is
  set up

Plan and build accordingly: any "Definition of Done" that says "tests
pass" needs to be re-read as "manual gates pass" until/unless someone
adds a test runner.

## What Gates Exist Instead

### Primary correctness gate: `npm run build`

```bash
cd dashboard-web
npm run build
```

This compiles TypeScript in `strict` mode (`tsconfig.json:7`) and runs
Next.js's full bundler against every route, layout, and component. In
practice, this is the test suite — any type error, broken import,
missing API response field, or invalid JSX surface as build failures.

What it actually catches:
- Type mismatches (most of what unit tests would catch in JS)
- Missing imports / typos in symbol names
- API response shape drift (when the route handler and a consumer go
  out of sync — `OrdersAttributionResponse` enforced via `satisfies`,
  see WR5-05)
- Discriminated-union exhaustiveness on `switch` statements
- Required-prop violations on React components
- Build-time issues like force-dynamic vs revalidate conflicts
  (IN-04 was caught this way)

What it doesn't catch:
- Wrong math (Bayesian CI off by a constant, attribution sums missing
  a branch)
- Logic regressions inside still-typed branches
- Runtime errors from `JSON.parse` on unexpected input
- Timing bugs (debouncer race conditions, polling overlap)
- UI rendering / styling regressions

**This is the bar:** before merging anything, `npm run build` MUST pass
cleanly. CI does not enforce this — humans do.

### Secondary lint gate: `npm run lint`

```bash
cd dashboard-web
npm run lint
```

Runs `next lint` which wraps ESLint 9 + `eslint-config-next`. There is
no local `.eslintrc` or `eslint.config.*` file — the configuration is
entirely the Next preset:
- React Hooks rules (exhaustive-deps, rules-of-hooks)
- A11y rules (`jsx-a11y/*`)
- Next.js-specific rules (no img tags, etc.)

**Not always run.** This is a hygiene gate, not a correctness gate. New
code introduces warnings periodically — clean those up but don't block
landing on them.

### Apps Script gates

Apps Script has no `build` equivalent. The checks available are:

1. **Editor syntax parsing** — the Apps Script web editor flags syntax
   errors at save time. Catches obvious typos but not logic bugs.

2. **Manual "Run" + verify in Sheet** — open the editor, pick a function
   from the dropdown, press Run, then open the Sheet and confirm the
   expected rows / values exist.
   - `runDailyUpdate` for yesterday's full pipeline
   - `runLiveUpdate` for today (the live trigger)
   - `runUpdateForDate('YYYY-MM-DD')` for a specific historical day
   - `verifyConfig` (`Config.gs:148-227`) prints config status — the
     closest thing to a unit test in the backend; checks every required
     Script Property exists per store

3. **Executions tab** — every triggered or manual run logs to
   Apps Script's Executions view. `Logger.log(...)` output is visible
   there. Failed runs surface red; the operator can drill into the
   exact log line.

4. **`store-meta` lastError column** — when a Shopify GraphQL call fails
   inside `refreshAllStoreMeta`, the reason is written to the store-meta
   tab and surfaced in the dashboard's BillingSettings panel
   (`src/components/BillingSettings.tsx:46-48`) so the operator can see
   misconfiguration even when no run-time error was thrown.

5. **`notifyError_` email** — `Config.gs` "notification.email" Script
   Property; `runUpdateForDate` accumulates errors and pings the
   recipient at the end of a failed daily run
   (`DailyUpdate.gs:67-71`).

### Manual smoke testing

After landing a UI change, click through the affected surface manually:
- Filter changes (date range, store dropdown) — does the dashboard
  re-aggregate?
- Open every drawer that touches changed code (CampaignDrawer,
  AdsDrawer, ProductPickerModal, BillingSettings)
- Refresh the page — does state restore from URL? From localStorage?
- Hover tooltips on attribution chips, ROAS cells, sparklines
- Cmd+K command palette — try each action

Drawer drill-down chain is particularly fragile and worth re-walking
because of the Esc stacking (`useDrawerEsc`) and the per-render IIFE
analyzer calls (IN5-01).

### Code-review process

The repo has a **multi-round code review process** documented in
`.planning/reviews/`:

```
.planning/reviews/REVIEW.md
.planning/reviews/REVIEW-2.md
.planning/reviews/REVIEW-3.md
.planning/reviews/REVIEW-4.md
.planning/reviews/REVIEW-5.md
```

Each round:
1. `/gsd-code-review --depth standard` (or `deep`) is invoked on a
   recently-shipped surface (e.g., "round-5-attribution-pipeline" in
   REVIEW-5.md)
2. The reviewer produces a structured report: critical / warning /
   info findings, each with file:line anchors and proposed fixes
3. `/gsd-code-review --fix` applies the fixes in a follow-up commit
4. Round-N+1 reviews the surface again to catch any regressions
   introduced by the fixes

The output of this process is itself a kind of regression catalog —
many code patterns in the repo (the `safeDecode_` helper, the
`Object.create(null)` for params, the `Number.isFinite` guards, the
variance-zero CI skip, the unparseable-date preservation in idempotent
writes) exist EXPLICITLY because a review round flagged the bug. New
code should anticipate these patterns rather than wait for the next
round to surface them again.

**This is currently the strongest correctness gate in the repo.** It
catches what `npm run build` can't (math errors, data-loss edge cases,
silent fall-throughs) at the cost of human reviewer time.

## Test Framework

**Runner:** None.

**Assertion Library:** None.

**Run Commands:**
```bash
# Dashboard (TypeScript layer)
cd dashboard-web
npm run build          # The closest thing to a test suite
npm run lint           # Style + hooks rules + a11y

# Apps Script (backend) — must be done in the editor UI:
#   1. Open the Apps Script project tied to the spreadsheet
#   2. Run `verifyConfig` from the dropdown
#   3. Inspect Logger output in the Executions tab
#   4. Open the Sheet to verify outputs
```

## Test File Organization

**Location:** N/A — no tests.

**Naming:** N/A.

**Structure:**

```
dashboard-web/
├── src/
│   ├── app/        # Routes + API handlers — no tests
│   ├── components/ # React components — no tests
│   └── lib/        # Pure analytics + helpers — no tests
└── (no __tests__/ directory anywhere)
```

When adding tests in the future, the natural convention given the rest
of the repo style:
- Co-located `*.test.ts(x)` next to the file under test
- One test file per source file
- `lib/*.test.ts` would be the highest-leverage starting point because
  the analytics layer is pure (see "Suggestions for future testing"
  below)

## Test Structure

N/A — no tests exist. Patterns below are recommendations rather than
established conventions.

## Mocking

N/A. If tests are added in the future, the boundaries that would need
test doubles:

- `googleapis.sheets` calls in `src/lib/sheets.ts` and
  `src/lib/ordersAttribution.ts` — would need a Sheets client mock or a
  fixture-driven `fetchOrdersAttribution` substitute
- `fetch('/api/...')` calls in `src/lib/cloudSync.ts` — would need MSW
  or a `globalThis.fetch` stub
- `window.localStorage` reads/writes — would need `jsdom` env (Vitest /
  Jest both provide one)
- `useSWR` hooks — would need `SWRConfig` wrapping with a custom fetcher
  in the test render

## Fixtures and Factories

N/A. If tests are added, the natural fixture shape:

- `OrderAttributionRow[]` — the densest analytic input; a small handful
  of realistic orders (one Meta-paid, one fbclid-only, one organic, one
  with utm_id, one with utm_term) covers most of `attributionAnalysis.ts`
- `CampaignRow[]` — sample campaigns spanning all three stores
- `DailyRow[]` — multi-day, multi-store series for analytics tests
- All as `const FIXTURE: ReadonlyArray<...>` in `__fixtures__/` next to
  the test file

## Coverage

**Requirements:** None — no test suite to measure coverage on.

## Test Types

**Unit Tests:** None.

**Integration Tests:** None.

**E2E Tests:** None.

## What's Tested Via the Type System vs. Would Benefit From Runtime Tests

**Already protected by the type system:**
- Response shapes between API routes and consumers (enforced via
  `satisfies` — see `OrdersAttributionResponse`,
  `CampaignsResponse`, etc.)
- Cloud-sync key registration (`STATE_KEYS` is a `const` tuple; the
  derived `StateKey` type prevents a typo'd key from sneaking into
  `pushCloudKey` or `CHANGE_EVENTS`)
- Discriminated unions on insights (`Severity`), order sources
  (`OrderSource`), trust levels (`AttributionTrust.level`)
- Per-component prop contracts (`Props` types on every drawer / panel)
- Return shapes from analyzers (`AttributionAnalysis | null`,
  `ProductChannelBreakdown`, etc.)

**Would benefit from runtime tests:**

1. **Attribution analyzers (`src/lib/attributionAnalysis.ts` — highest
   priority).** The most testable surface in the codebase:
   - `orderMatchesCampaign` — 4 tier-strategy branches × edge cases
     (utm_id match, utm_id mismatch with same name, utm_campaign-only,
     no UTM at all, wrong store, wrong platform). CR5-01 was a behaviour
     bug in this exact function — a single regression test would have
     caught it.
   - `analyzeAttribution` — the whole 200-LOC engine has 6+ trust
     ladder branches (`metaClaim===0 && det===0`, `det===0 && claim>0`,
     coverage ≥0.8, 0.4-0.8, <0.4, plus window-stability downgrade).
     Each branch has Hebrew-string outputs that are part of the
     contract.
   - `computeWindowStability` — bucketing edge cases (totalDays<14,
     tail-days<3 vs ≥3 after IN5-03 fix, mid-window flips), zero-meta
     filter behaviour, σ thresholds for verdicts
   - `detectOutlierDays` — the LOOKBACK relaxation (IN5-02) needs a
     regression test pinning the behaviour on 14-day ranges
   - `buildAnalysis` — three sibling callers (`...ForAdSet`, `...ForAd`,
     and the not-yet-existent `...ForAd` channel variant) share this
     helper. Coverage-via-buildAnalysis would protect all of them.
   - `analyzeProductChannel` — the explicit-zero return contract
     (Pitfall 3) needs a test

2. **Idempotent Sheets writes (`SheetBuilder.gs:725-799`, `1565-1627`).**
   The clear-then-write pattern with the `keptRows` filter has data-loss
   risk (WR5-02). An integration test driving against a real test
   spreadsheet would cover:
   - Re-writing same day → identical row count, no duplicates
   - Crash mid-format → next run preserves the unformatted rows
   - Malformed date in existing data → never silently destroyed
   - Migration paths (lastCol<13, lastCol<14) → applied idempotently

3. **Cloud-sync state machine (`src/lib/cloudSync.ts`).** Subtle race
   conditions documented inline (`HYDRATE_GRACE_MS`, `pendingRetries`
   cancellation on superseding push, `pendingKeys` counter accounting).
   These are exactly the cases unit tests are good at:
   - Push during in-flight hydrate → local value wins
   - Retry of stale value cancelled by newer push
   - `pendingKeys` reaches 0 after concurrent pushes resolve
   - `writeLocal(undefined)` doesn't write the literal string "undefined"
   - Hydrate of `null` cloud value mirrors removal locally (WR2-04)

4. **Per-line-item allocation (`src/lib/campaignProductMap.ts:122-157`).**
   Math-heavy; allocation rules have edge cases (zero spend, all-zero
   spend, orphan products).

5. **Parsers (`parseDate`, `parseNumber`, `parseLineItems`,
   `parseSource`).** Each handles ~5 input shapes. Parameterised tests
   would cover them in <50 LOC each.

6. **Snapshot tests on key components (`CampaignsTable`, `CampaignDrawer`,
   `KpiCards`, `PnLBreakdown`).** Would catch unintended layout /
   labelling changes during refactors.

## Suggestions for Future Testing

If/when the repo adds a test runner, the recommended order:

1. **Vitest** as the runner (small footprint, ESM-native, Next.js 15 +
   React 19 compatible).
   ```bash
   npm i -D vitest @vitest/coverage-v8
   ```
2. **Start with `src/lib/attributionAnalysis.ts`.** Pure functions, no
   IO, deterministic — easiest possible win, highest payoff (the most
   reviewed file in the codebase, currently relying on human review for
   correctness).
3. **Add fixtures in `src/lib/__fixtures__/orders.ts`** — a curated
   array of `OrderAttributionRow` covering each `OrderSource`, each
   UTM-match tier, each fbclid/gclid combination. Reuse across analyzer
   tests.
4. **Then `src/lib/insights.ts`** (anomaly z-score math), then
   `src/lib/campaignProductMap.ts` (allocation), then
   `src/lib/cloudSync.ts` (state machine with `vi.useFakeTimers()` to
   pin debounce / retry behaviour).
5. **Component snapshot tests** can wait — the type system catches
   most regressions and the surface area is large.
6. **Apps Script** doesn't get tests in this plan. The best
   instrumentation there remains `verifyConfig` + structured
   `Logger.log` output + the `notifyError_` email channel.

For now: **the codebase is type-tight enough that
`npm run build && manual click-through` catches most regressions, the
multi-round review process catches the rest, and explicit defensive
patterns (try/catch around every section, idempotent writes,
`Number.isFinite` guards, `Object.create(null)` maps) ARE the
substitute for missing test coverage.**

---

*Testing analysis: 2026-05-18*
