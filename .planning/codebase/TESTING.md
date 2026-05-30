# Testing Patterns

**Analysis Date:** 2026-05-24

**HEAD at analysis time:** `b846ae7` (post-Phase-11 + post-Phase-12 audit fixes)

## Reality check (post-Phase 11 + 12)

This codebase **does** have an automated test suite. Earlier docs (CONVENTIONS / TESTING from 2026-05-18) stated "no tests" — that was true then; it is no longer true.

Live counts at HEAD (verified by `cd dashboard-web && npx vitest run`):

| Metric | Count |
|--------|-------|
| **Test files** | 87 (`find dashboard-web/src -name '*.test.ts'`) |
| **Picked up by `npm test` glob** | 86 |
| **Passing tests** | 946 |
| **Skipped tests** | 0 |
| **Failing tests** | 0 |
| **Runtime** | ~4.6 s |

The 1-file delta (87 vs 86) is the cron-live `__tests__/` files that **are** picked up by the include glob — they're under `src/inngest/**/__tests__/**` which is one of the two enumerated paths in `vitest.config.ts:36-37`. The actual missed file count is **0**, not 1; the earlier "documented at cronLive.test.ts:27 — easy to miss" warning was written before the Phase 05.6 plan 08 fix that widened the glob. Both `src/lib/**/__tests__/**` AND `src/inngest/**/__tests__/**` are now first-class.

Component tests still need a separate config (see "JSDOM gap" below).

## Test framework

**Runner:** vitest 2.1.x (`dashboard-web/package.json:39`)
**Coverage provider:** `@vitest/coverage-v8` 2.1.x (`dashboard-web/package.json:33`)
**Assertion API:** vitest's built-in `expect` (Chai-style)
**Environment:** `node` (`vitest.config.ts:23`) — pure-function default
**Globals:** disabled (`vitest.config.ts:39`) — every test file MUST explicitly `import { describe, it, expect, vi } from 'vitest'`
**Config:** `dashboard-web/vitest.config.ts` (sole config file)
**Path alias:** `@/` → `dashboard-web/src/` (`vitest.config.ts:42-44`, mirrors `tsconfig.json:17`)

### Include glob

```ts
// vitest.config.ts:35-38
include: [
  'src/lib/**/__tests__/**/*.test.{ts,tsx}',
  'src/inngest/**/__tests__/**/*.test.{ts,tsx}',
],
```

Why TWO globs (not one wildcard `src/**/__tests__`):

- Phase 05.6 plan 03 widened the original `src/lib/__tests__/` to `src/lib/**/__tests__/` to pick up `src/lib/fetchers/__tests__/` and `src/lib/notifications/__tests__/` subdirs.
- Phase 05.6 plan 08 added `src/inngest/**/__tests__/**` as a second top-level entry. Same rationale — a new source root must be explicitly enumerated or its tests silently skip. The IN-03 finding flagged this risk; the glob now widens for `.tsx` too so the first React-render test won't disappear.

### Run commands

```bash
cd dashboard-web
npm test                  # vitest run --passWithNoTests (CI mode)
npm run test:watch        # vitest (watch mode, interactive)
npm run test:coverage     # vitest run --coverage (v8 coverage)

# Single file or pattern:
cd dashboard-web && npx vitest run src/lib/__tests__/campaignHealthScore.test.ts
cd dashboard-web && npx vitest run -t 'cohort'   # filter by test-name substring
```

## Test file organization

**Location:** Co-located with source in a sibling `__tests__/` directory.

```
dashboard-web/src/
├── lib/
│   ├── attributionAnalysis.ts
│   ├── campaignHealthScore.ts
│   ├── __tests__/                        ← 69 test files
│   │   ├── attributionAnalysis.test.ts
│   │   ├── campaignHealthScore.test.ts
│   │   └── fixtures.ts                   ← shared factories
│   ├── fetchers/
│   │   ├── shopify.ts
│   │   ├── meta.ts
│   │   └── __tests__/                    ← 7 fetcher test files
│   │       ├── shopify.test.ts
│   │       └── meta.test.ts
│   └── notifications/
│       └── __tests__/                    ← 3 notification test files
├── inngest/functions/
│   ├── cronLive.ts
│   ├── cronDaily.ts
│   └── __tests__/                        ← 8 cron test files
│       ├── cronLive.test.ts
│       └── cronLivePastRowBackfill.test.ts
└── components/
    └── __tests__/
        └── freshnessChip.test.ts         ← 1 component test (still node env)
```

**Naming:** `<sourceModuleName>.test.ts`. When a source surface is large enough to warrant multiple test files, append a descriptor: `cronLive.test.ts`, `cronLiveStatusRefresh.test.ts`, `cronLivePastRowBackfill.test.ts`, `cronLiveIsActiveForPlatform.test.ts` (4 test files for the one `cronLive.ts`).

## Test counts per surface (top 10)

| Surface | Test files | Tests | Depth (AUDIT scale) |
|---------|------------|-------|---------------------|
| `attributionAnalysis.ts` | 6 | 71 | EDGE_RICH |
| `campaignHealthScore.ts` | 1 (1067 LOC) | 62 | FULL |
| `cronLive.ts` (3 inngest tests) | 3 | 34 + 24 + 3 = ~58 | EDGE_RICH |
| `cpmRoasAnalysis.ts` | 2 | 30 | EDGE_RICH |
| `shopify.ts` (fetcher) | 2 | 28 | FULL |
| `meta.ts` (fetcher) | 1 | 26 | EDGE_RICH |
| `campaignProductMap.ts` | 1 | 17 | EDGE_RICH |
| `postgresReaders.ts` | 2 (incl. dedup backfill) | 11 + N | HAPPY_ONLY → EDGE_RICH |
| `aiReport.ts` statistics | 1 (492 LOC, AUDIT C-01 backfill) | N | NO_TESTS → EDGE_RICH |
| `cronLivePastRowBackfill.ts` (AUDIT C-03) | 1 | N | NO_TESTS → EDGE_RICH |

**Depth ladder used during v3 audit:**
- `NO_TESTS` — file has no tests at all
- `HAPPY_ONLY` — main path only, no error/edge cases
- `HAPPY_ONLY+` — main path plus 1–2 edges
- `EDGE_RICH` — main path + error envelope + boundary conditions
- `FULL` — every observable behavior pinned, including invariants and stacking effects

## Test structure (canonical pattern)

```ts
// dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts (truncated)
import { describe, it, expect } from 'vitest';
import {
  computeCampaignHealth,
  applyCohortAdjustmentOnce,
  type HealthScoreInputs,
  type CampaignHealth,
} from '@/lib/campaignHealthScore';

// ─────────────────────────────────────────────────────────────────────────
// Factories — keep tests readable. Each builder accepts a partial override
// so individual tests can twiddle exactly the field they care about and
// inherit safe defaults for everything else.
// ─────────────────────────────────────────────────────────────────────────

function makeAggregated(patch: Partial<Aggregated> = {}): Aggregated {
  return { /* sensible defaults */, ...patch };
}

describe('computeCampaignHealth — profitability axis', () => {
  it('weights ROAS × trust at 40%', () => {
    const result = computeCampaignHealth(buildInputs({ /* … */ }));
    expect(result.components.profitability).toBeCloseTo(EXPECTED, 1);
  });
});
```

**Conventions verified across 86 test files:**

1. **Explicit imports** from `'vitest'` — never relies on globals (config forbids it).
2. **`describe(suiteName, ...)` grouping** is by surface or by behavior axis (e.g. "profitability axis", "trajectory axis", "cohort adjustment stacking").
3. **`it(behavior, ...)` describes the behavior** in present-tense English. Common pattern: `it('FIX-25: counts days with roas=0 as active when cpm>0 …', …)` — finding/issue ID prefix when the test pins a regression.
4. **Top-of-file factory functions** (`makeAggregated`, `makeOrder`, `makeTrueRevenue`) with `Partial<…>` patch arguments. Tests override only the fields they care about.
5. **No global setup / teardown** in pure-helper tests. Cron tests use `beforeEach` / `afterEach` for `vi.restoreAllMocks()`.
6. **Header comment block** in every non-trivial test file explaining WHY the file exists, what finding it pins, what fixtures came from. Example: `aiReportStatistics.test.ts:1-23`, `postgresReadersNewestRowDedup.test.ts:1-29`, `cronLivePastRowBackfill.test.ts:1-30`. This is the single most consistent pattern in the test suite.

## Mocking

**Framework:** vitest's built-in (`vi.mock`, `vi.fn`, `vi.spyOn`, `vi.restoreAllMocks`).

**23 of 86 test files use vi.mock / vi.fn / vi.spyOn.** The other 63 are pure-helper tests with no mocking — they import a function, build a fixture, assert the return.

**Two dominant mocking idioms:**

**1. Module mock (top of file, before any imports of the mocked module):**
```ts
// dashboard-web/src/lib/__tests__/postgresReadersNewestRowDedup.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;

function setSupabaseRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { /* chainable from().select() returning mockRows */ }
}));
```

**2. Spy on a real module's export (used in cron tests):**
```ts
// dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
// …
const spy = vi.spyOn(shopifyFetcher, 'fetchShopifyRevenue').mockResolvedValue({ /* … */ });
```

The cron tests `import * as fooModule` precisely so they can `vi.spyOn` individual exports without rewriting the production module.

**What to mock:**
- Supabase reads / writes (`@/lib/supabase`)
- Network fetchers (`shopify`, `meta`, `googleAds`, `tiktok`, `fx`)
- `Inngest`'s `step.run(label, fn)` — see `makeStepStub()` pattern in `cronLivePastRowBackfill.test.ts:43`
- Time, when the test depends on "today" (use `vi.useFakeTimers()` sparingly — most callsites prefer passing `now: Date` as an explicit param)

**What NOT to mock:**
- Pure helpers (`analyzeAttribution`, `computeCampaignHealth`, `analyzeCpmVsRoas`) — exercise them with real fixtures.
- Internal helpers of the file under test — mocking them invalidates the test.

## Fixtures

**Shared:** `dashboard-web/src/lib/__tests__/fixtures.ts` exports `makeOrder()`, `makeOrderLineItem()`, `makeOrderAttributionRow()` factories used across attribution tests.

**Test-local:** Most tests declare local factories (`makeAggregated`, `makeTrueRevenue`, `makeCpmRoasAnalysis`) at the top of the file because the fixture shape is module-specific.

**Real-world fixture sourcing:** When the test pins a probe-extracted real-world scenario, the fixture annotations grep-bind to the probe document:
```ts
// dashboard-web/src/lib/__tests__/shopifyRevenueRefunds.test.ts
/**
 * Fixtures derive from .planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/
 * 05.2.3.0-PROBE-EVIDENCE.md (D-C4). Each fixture numeric value is annotated
 * with its source (// Fixture from PROBE-EVIDENCE.md ## {store}) so the
 * binding is grep-checkable. NO fictional fixtures.
 */
```

This is the project's substitute for golden-file testing — the binding to a probe document means a fixture drift requires updating the probe too.

## Coverage

**Tool:** `@vitest/coverage-v8` (configured but not threshold-enforced).

**Run:** `cd dashboard-web && npm run test:coverage`

**No coverage targets in CI.** No `coverage.threshold` in `vitest.config.ts`. No CI workflow yet (see "CI / automation gap" below) — coverage is run on-demand by the operator during audits.

## Test types

**Unit tests (pure helpers):** The dominant 63 files. Import a function, build a fixture, assert. No DB, no network, no time.

**Inngest function tests (cron handlers):** 8 files under `src/inngest/functions/__tests__/`. Mock all external boundaries (fetchers, Supabase, FX), exercise the handler end-to-end with a `makeStepStub()` that just invokes the callback. Assert (a) what was fetched, (b) what was persisted, (c) what was returned to the orchestrator.

**Integration tests:** **None.** No real Supabase, no real Inngest dev server, no real platform APIs. The cron-live × Supabase × postgresReaders round-trip is exercised piecewise but never end-to-end. This is the largest tooling gap.

**Component / E2E tests:** None. The only "component" test (`components/__tests__/freshnessChip.test.ts`) exercises a pure formatter helper (`formatTimeAgo`) — not a React render. No Playwright, no Cypress, no React Testing Library.

## Coverage gaps (from `.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md`)

The Phase 9 audit identified 5 verification-blocking gaps. **Three were backfilled in Phase 10**; **two remain**:

### Backfilled in Phase 10 (commits `adb0c17`, `c6e590c`, `a7d36f5`, `e953a2d`)

| ID | Gap | Fix commit | Test file |
|----|-----|------------|-----------|
| C-01 | `aiReport.ts` statistics: ZERO tests for ~700 LOC of medianMad / stddev / CV / momentum | `adb0c17 test(ai-report): oracle for medianMad / stddev / CV / z-score / momentum` | `aiReportStatistics.test.ts` (492 LOC, hand-computed oracle fixtures) |
| C-02 | `postgresReaders.ts` newest-row dedup unguarded | `c6e590c test(postgres-readers): newest-row dedup fixture pins prefer-newer semantics` | `postgresReadersNewestRowDedup.test.ts` |
| C-03 | `cronLive.ts` past-row backfill date-boundary untested (off-by-one risk on `effective_status` UPDATE window) | `e953a2d test(cron-live): past-row backfill date boundary fixture` | `cronLivePastRowBackfill.test.ts` |
| C-04 | TikTok `code !== 0` envelope path uncovered | `a7d36f5 test(tiktok-fetcher): code !== 0 envelope path surfaces as throw` | `tiktok.test.ts` (added envelope-error case) |

### Still open

| ID | Gap | Why still open |
|----|-----|----------------|
| C-05 | `algorithm-parity.test.ts` was `it.skip` by default — no automated drift detection vs Sheets baseline | **RESOLVED-BY-DELETION** in Phase 11 step 2 (`74633ee refactor(legacy): remove lib/sheets.ts + algorithm-parity test`). With Apps Script gone, the parity test had no truth source to compare to. There is currently **no drift-detection mechanism** for the TS fetchers vs anything. If a TS fetcher silently changes its number, CI catches NOTHING. |
| — (new) | No cross-fetcher contract test enforcing `{ storeId, date, spend, currency }` shape across all 4 ad-platform fetchers (`meta`, `googleAds`, `tiktok`, `fx`) | Surfaced by AGENT-B in Phase 9 audit. A fetcher could drift its return shape and only break at the call site. Not yet ticketed. |
| — (new) | No integration test for cron-live × Supabase | Piecewise mocks only. Cron-live → Supabase upsert → postgresReaders read is never exercised end-to-end. Not yet ticketed. |

## Strong coverage areas (HEAD)

These surfaces are FULL or EDGE_RICH and are the project's best-tested code:

| Surface | Tests | Files |
|---------|-------|-------|
| `attributionAnalysis.ts` | 71 | `analyzeAttribution.test.ts` (23) + `attributionAnalysis.test.ts` (5) + `computeWindowStability.test.ts` (11) + `detectOutlierDays.test.ts` (9) + `analyzeAttributionForAd.test.ts` (12) + `analyzeAttributionForAdSet.test.ts` (11) |
| `campaignHealthScore.ts` | 62 | `campaignHealthScore.test.ts` (1067 LOC — covers grade derivation, insufficient gate boundaries, profitability source priority, per-platform pivots, trajectory tone mapping, trajectory renorm with `hasData=false`, attribution clarity fallbacks, operator adjustments with stacking + clamp, cohort adjustments with 2-member floor + idempotent application via `applyCohortAdjustmentOnce`) |
| `cronLive.ts` | ~58 | `cronLive.test.ts` (7) + `cronLiveStatusRefresh.test.ts` (3) + `cronLiveIsActiveForPlatform.test.ts` (24) + `cronLivePastRowBackfill.test.ts` (N) |
| `shopify.ts` | 28 | `shopify.test.ts` (19) + `shopifyRevenueRefunds.test.ts` (9 — D-C3 refund invariants) |
| `cpmRoasAnalysis.ts` | 30 | `cpmRoasAnalysis.test.ts` (21) + `cpmPrevAlignment.test.ts` (9) — covers 9 verdict combinations incl. the post-fix `'no-baseline'` (AUDIT U-02) |
| `meta.ts` | 26 | `meta.test.ts` (omni_purchase priority chain, status field, currency conversion) |
| `aiReport.ts` (statistics) | N + 3 storeId regex | `aiReportStatistics.test.ts` (AUDIT C-01) + `aiReportStoreId.test.ts` (legacy) |

## Notable thinness

| Surface | Tests | Why thin |
|---------|-------|----------|
| `googleAds.ts` (fetcher) | 9 | HAPPY_ONLY+ — `runGaqlQuery` pagination tested; minimal error envelope coverage |
| `tiktok.ts` (fetcher) | 5 + AUDIT C-04 envelope test | Most operator-volatile platform (BUDGET_EXCEED daily, AUDIT on creative changes), historically the thinnest fetcher. C-04 backfill helps; still no cache eviction test, no rate-limit test |
| `postgresReaders.ts` | 11 + AUDIT C-02 dedup test | HAPPY_ONLY+ snake_case → camelCase parity tests dominate; `effective_status` normalisation (trim + uppercase + null handling) at lines 599–644 still untested |
| `manualOverrides.ts` (fetcher) | N | Operator-write surface, low-priority tests |
| `shopifyAuth.ts` (fetcher) | N | OAuth surface, hard to mock cleanly |

## JSDOM gap

**No React component tests.** Pre-conditions for the FIRST jsdom test (verified at `vitest.config.ts:13-22` comment block):

1. Create a SECOND vitest config (`vitest.config.dom.ts`) with `environment: 'jsdom'` and an include glob limited to component tests. Do NOT switch the project-wide default — it would re-run 86 pure-function tests under JSDOM (~5× slower for no benefit).
2. Wire either a Vitest projects file or a `test:components` npm script.
3. Add `@testing-library/react` + `@testing-library/jest-dom` deps.
4. Configure `setupFiles` for jest-dom matchers.

The 1 existing `components/__tests__/freshnessChip.test.ts` is intentionally pure-function (it tests `formatTimeAgo`, not a React render) so the `node` environment suffices.

## CI / automation gap

**`.github/workflows/` does not exist.** No GitHub Actions config. No CI runs on push or PR.

What this means:
- Tests run **only when the operator runs them manually** before push.
- No automated `tsc --noEmit` gate, no automated `npm test` gate, no automated `npm run build` gate, no automated coverage check.
- The atomic-commit + tsc-clean + vitest-pass discipline (see CONVENTIONS.md) is **entirely on the operator's hands**. If they forget, regressions land.

This is the single largest tooling gap in the project. A minimal `.github/workflows/ci.yml` running `cd dashboard-web && npm ci && npm test && npx tsc --noEmit && npm run build` on every push would eliminate the regression class entirely. Not yet ticketed.

## Common test patterns

**Async testing:**
```ts
it('rejects when Shopify returns 5xx', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce(
    new Response('Server Error', { status: 503 }),
  );
  await expect(fetchShopifyRevenue(/* … */)).rejects.toThrow(/503/);
});
```

**Error testing:**
```ts
it('throws when weights do not sum to 1.0', () => {
  // Module-load assertion in campaignHealthScore.ts:111 — covered implicitly
  // by every successful import; if a future commit breaks WEIGHTS this test
  // file (and 85 others) fail to import.
  expect(() => computeCampaignHealth(/* invalid */)).toThrow();
});
```

**Boundary / regression pinning:**
```ts
it('FIX-25: counts days with roas=0 as active when cpm>0', () => {
  // 7 days, ALL with cpm>0 but only 4 with roas>0 — pre-FIX-25 this returned
  // hasData=false; post-fix returns the analysis.
  const series = makeSeries(/* … */);
  expect(analyzeCpmVsRoas(series).hasData).toBe(true);
});
```

**Date-boundary fixtures (recommended pattern from AUDIT C-03):**
```ts
// Pin EXACT dates passed to the query builder so an off-by-one or
// inequality flip can't slip through silently.
const TODAY = '2026-05-24';
const LOOKBACK_FROM = '2026-05-18'; // today - 6
expect(supabaseSpy.gte).toHaveBeenCalledWith('date', LOOKBACK_FROM);
expect(supabaseSpy.lt).toHaveBeenCalledWith('date', TODAY);
```

## Recommended invariants when adding new tests

1. **Explicit imports from `'vitest'`** — config has `globals: false`.
2. **Use the `@/` path alias** — never `../../lib/foo`.
3. **Header comment block** explaining WHY the file exists, what surface it pins, what finding (if any) it backfills, what fixtures it uses (real vs synthetic).
4. **Local factories** for fixture construction with `Partial<…>` patch args.
5. **Boundary tests** for any new threshold or window (5-day, 50-page, lookback-days, etc.).
6. **`it.skip` is forbidden by convention** — if a test cannot run, delete it or mark it `it.todo()` with a JIRA-style note. Phase 11 removed the only `it.skip` in the codebase.
7. **Mock at the module boundary**, not internal helpers.
8. **Pin real fixtures to probe documents** when the test exercises a real-world bug (grep-checkable annotations).

---

*Testing analysis: 2026-05-24*
