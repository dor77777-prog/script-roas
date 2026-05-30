# Coding Conventions

**Analysis Date:** 2026-05-24

**HEAD at analysis time:** `b846ae7` (post-Phase-11 + post-Phase-12 audit fixes)

This document is **prescriptive**: it describes the conventions that future code in this repo MUST follow. Every rule is anchored to existing files — follow those examples when adding new code.

## Single-tier reality (post-Phase 11)

The Apps Script tier was decommissioned in Phase 11 (commits `9c09696..1973d06`, 2026-05-24). What remains is one tier:

| Layer | Tech | Style |
|-------|------|-------|
| Dashboard + cron pipeline | TypeScript (`strict: true`) + React 19 + Next.js 15 + Inngest | Modern ES, types preferred over runtime guards |

References to `READ_FROM=postgres`, `lib/sheets.ts`, `algorithm-parity.test.ts`, `.gs` files, `appsscript.json`, and `.clasp.json` are GONE. Do not reintroduce them. Any historical convention talking about Apps Script (`PascalCase.gs` files, trailing-underscore `_` helpers, V8 runtime) is obsolete and should NOT be cited in new code.

## TypeScript configuration

`dashboard-web/tsconfig.json` (verified):
- `"strict": true` — non-negotiable. All sub-flags inherit (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.).
- `"target": "ES2022"`
- `"moduleResolution": "bundler"` (Next 15 / TS 5 idiom)
- `"paths": { "@/*": ["./src/*"] }` — the **only** path alias. Use it everywhere instead of deep relative imports.
- `"isolatedModules": true` — every file must be independently transpilable. No `const enum`, no `export =` syntax.

`.eslintrc*` / `eslint.config.*` files **do not exist** in the repo. ESLint is wired through `next lint` (npm script `lint` in `dashboard-web/package.json:9`) using the `eslint-config-next` ruleset (devDep at `package.json:35`). No Prettier config. No Biome. Formatting is by convention (see "Code Style" below) — not machine-enforced.

## File and directory naming

**React components** (`dashboard-web/src/components/*.tsx`): `PascalCase.tsx`. Examples: `CampaignsTable.tsx`, `CampaignDrawer.tsx`, `SyncIndicator.tsx`, `HealthScoreBadge.tsx`. 46 components total.

**Library modules** (`dashboard-web/src/lib/*.ts`): `camelCase.ts`. Examples: `attributionAnalysis.ts`, `cloudSync.ts`, `campaignProductMap.ts`, `campaignHealthScore.ts`, `platformConfig.ts`. 49 modules total.

**Hooks** (`dashboard-web/src/lib/hooks/*.ts`): `useXyz.ts`. Examples: `useCampaignAttribution.ts`, `useCampaignTrueRevenue.ts`, `useBillingRecurring.ts`, `useBillingOneTime.ts`.

**Inngest functions** (`dashboard-web/src/inngest/functions/*.ts`): `camelCase.ts` named for the cron's purpose. Examples: `cronDaily.ts`, `cronLive.ts`, `cronWhatsapp.ts`, `eventBackfill.ts`, `eventSyncNow.ts`.

**API routes** (`dashboard-web/src/app/api/<resource>/route.ts`): Next 15 App Router idiom. The directory name is the URL segment.

**Tests** (`dashboard-web/src/**/__tests__/<sourceName>.test.ts`): co-located with source in a sibling `__tests__/` directory. The test file mirrors the source name; one source file may produce several test files when the surface is large (`campaignHealthScore.ts` → `campaignHealthScore.test.ts`; `attributionAnalysis.ts` → 6 test files). See `TESTING.md` for the full list.

## Function and identifier naming

**Functions** (TS): `camelCase`. Examples: `analyzeAttribution`, `applyCohortAdjustmentOnce`, `getCogsRateForStore`, `computeCampaignHealth`, `pushCloudKey`, `hydrateFromCloud`.

**React components**: `PascalCase` — must match the file name.

**Types/interfaces**: `PascalCase`. Prefer `type X = …` over `interface`. Type-only exports use `export type`. Example: `export type CampaignHealth = { … }` in `campaignHealthScore.ts:71`.

**Constants**: `SCREAMING_SNAKE_CASE` for module-load immutables. Examples:
- `WEIGHTS` in `campaignHealthScore.ts:100` (object frozen by `as const`)
- `TIKTOK_ACTIVE_ENOUGH` in `platformConfig.ts:42`
- `STORES_WITH_TIKTOK` in `cronLive.ts:139` and `cronDaily.ts:86` (duplicated — see "Single source of truth" below)
- `COGS_RATE_OF_REVENUE = 0.25` in `analytics.ts:17`
- `TRANSACTION_FEES_RATE = 0.065` in `costs.ts:37`

**Private helpers** (module-local, not exported): trailing-underscore convention carried over from the deleted Apps Script tier. Examples in `cpmRoasAnalysis.ts`: `halfOverHalfDelta_`, `meanOrNull_`. This is **optional but still encouraged** — it grepability-flags "this is not part of the module's contract."

## Single source of truth (per-platform config)

When the same data needs to be consumed by multiple modules (e.g. writer + reader), hoist it into `lib/platformConfig.ts` and import from both sites. This was the AUDIT U-01 fix:

```ts
// dashboard-web/src/lib/platformConfig.ts:42
export const TIKTOK_ACTIVE_ENOUGH: ReadonlySet<string> = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);
```

Both `cronLive.ts:isActiveForPlatform` (writer) and `postgresReaders.ts` (reader) import this set. Pre-fix they each had their own inline literal that silently drifted.

**Outstanding drift to clean up:** `STORES_WITH_TIKTOK` is duplicated in `cronLive.ts:139` and `cronDaily.ts:86` (same `new Set(['uzoshop'])`). When you change one, change the other. A follow-up should consolidate into `platformConfig.ts`.

## Per-store data convention

Per-store calibration uses environment variables following a strict pattern:

```
${STORE_UPPERCASE}_COGS_RATE     # e.g. UZOSHOP_COGS_RATE=0.31
${STORE_UPPERCASE}_TX_FEES_RATE  # e.g. USMILE360_TX_FEES_RATE=0.045
```

The lookup helpers are in `dashboard-web/src/lib/analytics.ts`:
- `getCogsRateForStore(storeId)` at `analytics.ts:31` — fallback `0.25`
- `getTransactionFeesRateForStore(storeId)` at `analytics.ts:55` — fallback `0.065`

Both helpers validate `parsed >= 0 && parsed <= 1` and fall back to the project-wide default on bad input. **Mirror this pattern** for any future per-store rate (e.g. shipping, returns) — the cron writers (`cronDaily.ts`, `cronLive.ts`) and the read-side `analytics.ts` must agree on the same env-var key.

## Timezone convention

**Every** "today" / "yesterday" / calendar-day resolution in this codebase uses the same pattern:

```ts
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' });
const today = fmt.format(new Date()); // 'YYYY-MM-DD'
```

`'en-CA'` locale produces `YYYY-MM-DD`. `'Asia/Jerusalem'` is the project timezone. 94 references in `dashboard-web/src/`. Verified callsites:
- `dashboard-web/src/inngest/functions/cronLive.ts:208`
- `dashboard-web/src/inngest/functions/cronDaily.ts:132`
- `dashboard-web/src/inngest/functions/eventSyncNow.ts:82`
- `dashboard-web/src/lib/insights.ts:63`
- `dashboard-web/src/lib/shopifyRevenueRefunds.ts:206`
- `dashboard-web/src/app/api/debug/shopify-fetch/route.ts:49`

**Do not** use `new Date().toISOString().slice(0, 10)` for "today" — that returns UTC, which is the wrong day for ~3 hours every morning Israeli time.

## Currency convention

**CAD is the reporting currency.** Every persisted dollar amount in `data_daily` / `campaigns_daily` is in CAD. Foreign currencies (USD from Meta, USD/ILS/EUR from Shopify, USD from TikTok, etc.) are converted at the fetcher boundary via `getFxRate(from, 'CAD', dateStr)` in `dashboard-web/src/lib/fetchers/fx.ts`.

`getFxRate` is **throw-on-failure** by contract — every caller wraps the call site with `.catch(() => null)` or a try/catch and decides its own fallback. See `cronLive.ts:641` (the `a/WARN-3` fix) for the canonical pattern: FX timeout/5xx → null → convert at 1×, log a warning.

## Hebrew RTL convention

The dashboard is Hebrew-first, RTL throughout. Two rules:

**1. Use Tailwind logical-side utilities, not directional ones:**
- `start-2` / `end-2` instead of `left-2` / `right-2`
- `ms-3` / `me-3` instead of `ml-3` / `mr-3`
- `ps-3` / `pe-3` instead of `pl-3` / `pr-3`

Verified callsites: `SyncIndicator.tsx:139`, `MetricHelp.tsx:110, 146`, `PerStoreCards.tsx:142`. The fix `382bed8 fix(product-picker): search icon uses logical end-2.5 for RTL (HIGH-2)` (commit 2026-05-23) is the regression that proved this rule isn't optional — a `right-2.5` rendered on the WRONG side under RTL.

**2. Wrap RTL-content roots with `dir="rtl"`:**
- `Dashboard.tsx:205`: `<div dir="rtl" className="min-h-screen bg-background">` — the root container
- Popovers / drawers each re-declare `dir="rtl"` because they render in portals outside the root: `SyncIndicator.tsx:138`, `MetricHelp.tsx:107`, `HealthScoreBadge.tsx:93`, `CommandPalette.tsx:468`, `ProductPickerModal.tsx:231`, `HealthScorePanel.tsx:140`, `AdsDrawer.tsx`, etc.

**Hebrew strings live inline in components and pure-helper return values** — no i18n framework. This is intentional (single-operator product, no localization need).

## Import organization

Order within a file (observed in `dashboard-web/src/components/Dashboard.tsx:1-30` and most lib files):

1. React + framework imports (`react`, `next/link`, `next/navigation`)
2. Third-party (`swr`, `recharts`, `lucide-react`, `@supabase/supabase-js`)
3. Internal — types first (`import type { … } from '@/lib/…'`)
4. Internal — values (`import { … } from '@/lib/…'`)
5. Local / sibling (`./Filters`, `./KpiCards`)

**Always use the `@/` alias for internal imports.** Deep relatives (`../../lib/…`) only appear in test files where the test sits one directory deeper than the source. New code MUST use `@/lib/foo` over `../../lib/foo`.

`export type` is used aggressively — separating type-only re-exports from value re-exports keeps `isolatedModules` happy and the bundle smaller.

## JSDoc and comment density

This is a **comment-heavy** codebase. The pattern is **deliberate** and load-bearing:

- 42 of 49 `lib/*.ts` files (86%) open with a `/** … */` module-header block explaining intent, math derivation, and audit history.
- Major modules carry **23+** JSDoc / fence-comment blocks (`attributionAnalysis.ts`).
- Audit-fix annotations are inlined at the patched site, NOT relegated to commit messages. Pattern: `// Audit fix YYYY-MM-DD (<finding-id>): …` or `// AUDIT <finding-id> (<date>): …`. Verified at:
  - `costs.ts:27` — "Audit fix 2026-05-23 (d/HI-01): deleted the unused STORE_FIXED_COSTS map…"
  - `analytics.ts:20` — "Audit fix 2026-05-23 (d/HI-02): per-store COGS rate at the read side."
  - `campaignHealthScore.ts:65` — "Audit fix 2026-05-24 (U-06): the apply function was renamed from `applyCohortHealthAdjustment` to `applyCohortAdjustmentOnce`…"
  - `platformConfig.ts:4-39` — module-header explains why the file was created (AUDIT U-01) and what asymmetry it eliminates.

**Why this matters:** the operator-debugger reading this code months later needs to know WHY a non-obvious constant or branch exists. The audit-fix inline pattern is the project's substitute for an institutional code-review trail.

When you patch an audit finding:
1. Inline a comment at the patched site with the finding ID (`AUDIT U-XX` / `b/HI-NN` / etc.) and a 1-2 sentence rationale.
2. The commit message follows the parallel pattern (see "Commit conventions" below).

## Code style (formatting)

No Prettier — formatting is by convention. The observed style:

- **2-space indent**
- **Single quotes** for strings, **double quotes** only inside JSX attributes
- **Semicolons** terminate statements
- **Trailing commas** in multi-line arrays / objects / param lists
- **Arrow functions** preferred for callbacks; `function` keyword for top-level named exports
- **`const`** by default; **`let`** only when reassignment is genuinely needed; **`var`** never
- **No unused imports / variables** — ESLint via `next lint` catches this

## Error handling

77 `throw new Error(…)` callsites across `dashboard-web/src/lib`. The patterns:

**Pure helpers** (e.g. `campaignHealthScore.ts:111`): throw at module load if invariants violate. Example:
```ts
if (Math.abs(_WEIGHT_SUM - 1.0) > 1e-9) {
  throw new Error(`Health-score weights must sum to 1.0, got ${_WEIGHT_SUM}`);
}
```

**Fetchers** (e.g. `fetchers/fx.ts`, `fetchers/tiktok.ts`): throw on network / API envelope failure. Callers wrap with `try/catch` or `.catch()` and decide policy.

**Cron functions** (e.g. `cronLive.ts`): sequential `for...of await` + explicit `result.error` checks (HIGH-12 + HIGH-NEW-4 fixes intact). One failed store does not block the rest.

**API routes** (`app/api/*/route.ts`): wrap with `userFacingError(…)` from `@/lib/apiErrors` to produce structured `{ error, code }` responses. NEVER leak stack traces to the client.

**No error-monitoring service beyond Sentry** — `@sentry/nextjs` v8 is wired in `next.config.ts:15` and hooked at `dashboard-web/src/components/ErrorBoundary.tsx` (`Sentry.captureException` on React render errors). Only 2 explicit `captureException` callsites — everything else relies on Sentry's automatic Next.js instrumentation.

## Logging

**No logger library** (no pino, no winston, no bunyan). 16 `console.*` calls across `lib/`. The convention:
- `console.error(...)` for things the operator needs to see in Inngest logs / Vercel logs
- `console.warn(...)` for soft-fail / graceful-degradation paths (e.g. FX timeout)
- `console.log(...)` is rare — almost always considered noise and removed in review

Cron functions log step-level summaries via the `step.run('label', async () => …)` wrapper — Inngest's dashboard renders each label as a timeline entry. Prefer that over `console.log` inside cron handlers.

## Function design

**Pure functions** are the default in `lib/`. Side effects (network, DB, time) are pushed to the edges (`fetchers/`, `inngest/functions/`, `app/api/*/route.ts`). 68 of 69 `lib/__tests__/*.test.ts` files exercise pure helpers — they import the function, call it with a fixture, assert the return shape. Mocking is reserved for the few helpers that touch `supabase` or `fetch`.

**Factory builders** are used in test files to keep fixtures readable. Pattern from `campaignHealthScore.test.ts:18`:
```ts
function makeAggregated(patch: Partial<Aggregated> = {}): Aggregated {
  return { /* sensible defaults */, ...patch };
}
```
A shared `dashboard-web/src/lib/__tests__/fixtures.ts` exports `makeOrder()`, `makeOrderAttributionRow()`, etc. for cross-test reuse.

## Module design

**Named exports only** — no default exports anywhere in `lib/`. The only `export default` in the codebase is on React components (Next 15 requires it for `app/**/page.tsx`).

**No barrel files** (`index.ts` re-export files). Import directly from the source module:
```ts
import { computeCampaignHealth } from '@/lib/campaignHealthScore'; // ✓
import { computeCampaignHealth } from '@/lib';                     // ✗ no barrel
```

**One concern per file** — modules grow as the concern grows (`aiReport.ts` is 2282 LOC, `cronLive.ts` is 1238 LOC, `attributionAnalysis.ts` is 1202 LOC). Splitting is by independent responsibility, not by line count.

## TypeScript escape hatches — observed

`@ts-expect-error`, `@ts-ignore`, and inline `any` together total **104** occurrences in `lib/`. `as unknown as X` double-casts: 29 occurrences. Mostly in test fixtures (`as unknown as TrueRevenueInfo['attribution']` at `campaignHealthScore.test.ts:77`) where a deep type is partially constructed. **Production source code should resort to escape hatches sparingly** — every callsite is a future maintenance hazard.

## Atomic-commit discipline (operator-enforced)

Every commit must be:
1. **Atomic** — one logical change, no drive-by edits.
2. **`tsc` clean** — `cd dashboard-web && npx tsc --noEmit` returns zero errors.
3. **`vitest` green** — `cd dashboard-web && npx vitest run` returns 0 failures (skips are OK if documented).

This is enforced by the operator manually (no pre-commit hook is wired). Phases that ship multiple commits run all three gates between each commit. Verified via recent commit graph: every audit fix has its OWN commit (`adb0c17`, `c6e590c`, `b919705`, `e953a2d`, `a7d36f5`, etc. — one finding ID per commit).

## Commit conventions

Format: `<type>(<scope>): <one-line summary> (<finding-id> [/ <finding-id>])`

Examples from recent history (`git log --oneline -10`):
- `b846ae7 fix(attribution): show raw coverage + halo-exceeded warning chip (AUDIT U-05)`
- `c2f4f9c refactor(health-score): rename + assert applyCohortAdjustmentOnce to prevent double-apply (AUDIT U-06)`
- `f001f70 fix(attribution): surface mixed window-stability verdict in operator copy (AUDIT U-04)`
- `b919705 fix(tiktok-status): shared TIKTOK_ACTIVE_ENOUGH set for writer + reader symmetry (AUDIT U-01)`
- `48a2945 fix(cron-live): include tt in todaySpendCad return summary (AUDIT B-01)`

**Types in use:** `fix`, `feat`, `refactor`, `chore`, `docs`, `test`.

**Body** (optional, ~3-10 lines for non-trivial changes) explains:
- WHAT changed
- WHY (link to audit finding / operator request / bug report)
- TESTS added/touched

The finding-ID suffix is **load-bearing**. It binds the commit to its audit-spec entry so `git log --grep='U-06'` retrieves the patch. Honor this even for follow-up commits that touch the same finding.

## `git add` discipline (NEVER use `-A` or `.`)

**Rule:** `git add <specific files>` only. **Never** `git add -A`, `git add .`, or `git add --all`.

This is a hard-won lesson from earlier in the project: a `git add -A` race during a multi-phase work session pulled an unrelated working-tree change into a focused commit. The audit trail was contaminated and the commit needed to be rewritten.

**When committing, list every file by name in the `git add` command.** If the file list is long, that's a signal the commit is too large — split it first.

## Documentation discipline

Two pre-push gates, on par with `tsc` and `vitest`:

**UX changes** → update `docs/USER_MANUAL.md` (Hebrew, operator-facing).

**Architecture / code / pipeline changes** → update `docs/ARCHITECTURE.md` (English, technical).

The user-memory note (`feedback_keep_user_manual_current.md`) is explicit: "Two separate pre-push gates, on par with tsc/vitest." Stale docs are a commit-blocker.

## Localhost rule (verification)

**Never `curl localhost` in verify checks.** All runtime verification, payload checks, and smoke-tests must hit the production URL (e.g. `https://script-roas.vercel.app/api/health`). A local dev server can pass while production fails (env-var divergence, Sentry wiring, Inngest URLs).

The user-memory note (`feedback_no_localhost_checks.md`) treats this as a workflow invariant. Phase `<verify>` blocks that include `curl http://localhost:3000/...` are wrong by construction.

## Audit-fix annotation style

When you patch an audit finding, leave a permanent inline trace. Three forms in active use:

1. **Header line in module JSDoc** (when the finding reshapes a whole file):
   ```ts
   /**
    * Audit fix 2026-05-23 (d/HI-01): deleted the unused STORE_FIXED_COSTS map…
    */
   ```

2. **Block comment at the patched code site:**
   ```ts
   // AUDIT U-02 (2026-05-24): all default-fixture instances represent a
   // normal up/down/flat read; the 'no-baseline' verdict is exercised
   // explicitly in cpmRoasAnalysis.test.ts.
   ```

3. **JSDoc on a renamed export** (when the rename IS the fix):
   ```ts
   /** Audit fix 2026-05-24 (U-06): the apply function was renamed from
    *  `applyCohortHealthAdjustment` to `applyCohortAdjustmentOnce` and
    *  now asserts this field is 0 on entry — calling it twice on the
    *  same base throws instead of silently double-applying. */
   ```

The finding ID (`U-06`, `d/HI-01`, etc.) is the join key between the source, the commit message, and the audit `.planning/audit-*/AUDIT*.md` table. Keep all three in sync.

---

*Convention analysis: 2026-05-24*
