# MT End-to-End Audit — Master Report

**Date:** 2026-05-24
**Method:** 8 parallel `superpowers:dispatching-parallel-agents` subagents
**Repo state:** post-Phase-12.5.x (commits `4c3f7e9`…`4f36f7a`)
**Trust model assumed:** Internal tool · single-user max · URL-obscurity. Findings are calibrated to that threat model — no "add MFA" P0s.

## Executive summary

- **2 NEW correctness P0s** introduced by the Phase 12.5.x percent-of-revenue billing feature. They cause wrong numbers in production P&L for any store with a percent-of-revenue cost line. Confirmed against the code, not yet covered by tests.
- **The single biggest systemic risk is observability**: Sentry does **not** receive errors from any API route or any Inngest function. Backend failures are silent except for the WhatsApp token-failure alert. Two tracks (5 and 8) hit this independently.
- **Two memory rules have no enforcement teeth**: the documented pre-push gates (User Manual currency, ARCHITECTURE.md currency) are not wired to any hook, and `npm run lint` is effectively a no-op (no `eslint.config.*` in the repo). Tracks 5 and 7 hit this independently.
- **Major shipped features** (multi-mapping cohort, cannibalization detection, cohort-aware Health Score, AI executive briefing) are absent from the User Manual. The cohort/cannibalization gap is a P0 docs item because operators are looking at a panel whose semantics they can't verify against any written source.
- **Apps Script residue**: tiny in code, but `docs/ARCHITECTURE.md:550-552,813-814` still says `sheets.ts` + `featureFlags.ts` exist "as legacy" — they were deleted in Phase 11. Misleading source-of-truth.
- Heuristic counters: 263 TS/TSX files · 113 test files / 1054 tests / 32% line + 73% branch coverage · ~437 kB front-page first-load JS · 12 Inngest functions registered (4 docs say 11) · 11 Supabase migrations (one doc says 13).

## P0 — Immediate fix (production-affecting)

| # | Finding | Track | File:line | Recommended remediation | Suggested owner phase |
|---|---------|-------|-----------|--------------------------|-----------------------|
| P0-A | ✅ **SHIPPED 2026-05-24 (commit `673849c`).** Per-store path now precomputes `revenueByStore` in `aggregateByStore` and threads it through `aggregate` → `billingForRange`. Σ per-store ≈ global fixedCosts invariant restored for percent-of-revenue rows. Locked by 2 new tests in `aggregateByStoreAllRowSplit.test.ts`. | T2 | `dashboard-web/src/lib/analytics.ts` (signature + 2 call-site changes) | (Done — Phase 13.1) | Phase 12.5.x hotfix |
| P0-B | ✅ **SHIPPED 2026-05-24 (commit `673849c`).** `forecastMonthEnd.projectedFixedCosts` now passes `revenue: projectedRev` to `billingForRange`. Percent rows contribute to the projection. Locked by 1 new monthDay-independent test in `insightsProjectedNetMtd.test.ts`. Known limitation noted: store-specific percent rows still use even-split fallback in forecast (deferred P1). | T2 | `dashboard-web/src/lib/insights.ts:586-606` | (Done — Phase 13.1) | Phase 12.5.x hotfix |
| P0-C | ✅ **SHIPPED 2026-05-24 (commit `bef480f`).** Added `captureRouteError` to 15 API routes (top-level catches) + top-level `captureStepError` wrap in `runDailyForStore` + `runLiveForStore`. PII scrubber wired into all 3 Sentry configs. cronWhatsapp/eventBackfill/eventSyncNow handler wraps deferred to 13.2.2. | T5, T8 | `dashboard-web/src/lib/sentry/{scrub,capture}.ts` + 15 routes + 2 Inngest handlers | (Done — Phase 13.2) | Phase 13 observability baseline |
| P0-D | ✅ **SHIPPED 2026-05-24 (commit `bef480f`).** cronDaily's 3 platform catches (Meta + Google + TikTok) now call `captureCronFetchError` — captures to Sentry + 1 throttled WhatsApp alert per (platform, storeId) per cron run (in-memory dedup Set), with existing 1/6h `tokenFailures.ts` provider throttle as cross-run dedupe. cronLive kept its existing `isAuthError`-gated behavior (cadence × platforms would over-alert) — deferred to 13.2.3 with cadence-appropriate dedupe. | T3, T8 | `dashboard-web/src/inngest/functions/cronDaily.ts` (3 catch blocks) | (Done — Phase 13.2) | Phase 13 observability baseline |
| P0-E | **Inngest step payload bloat.** `cronDaily.ts:239` `fetch-shopify` step returns ~500 KB (day + orders + line_items + catalog) → ~1.8 MB/day × 3 stores × 30 ≈ 54 MB/month memoized in Inngest's step storage. Cost + retry latency risk. | T8 | `dashboard-web/src/inngest/functions/cronDaily.ts:239` | Split into `fetch-shopify-orders` (returns just IDs + summary) + `fetch-shopify-line-items` (per-order, on-demand). Or: aggregate inside the step and return only the daily totals consumed downstream. | Phase 13 |
| P0-F | ✅ **SHIPPED 2026-05-24 (commits `c1909fd` + `9acf217`).** husky 9 at repo root + `.husky/pre-push` running tsc + vitest + lint + docs-currency. `dashboard-web/eslint.config.js` (currently no-op — eslint-config-next ^15.5 incompatible with ESLint v9; real rules deferred to 13.3.1). `scripts/docs-currency.mjs` blocks pushes that touch UX/arch tripwire paths without updating the corresponding doc. Bypass via `--no-verify` documented. Apps Script residue removed (root `package.json` + `.claspignore`). **Vercel git auto-deploy: working** — Vercel API `gitProviderOptions.createDeployments: enabled` + GitHub App "All repositories" access. The earlier "broken" diagnosis was a misread: `vercel ls` was showing my manual `vercel --prod` CLI deploys; the git-source auto-deploys ran in parallel and appeared as `source: "git"` in the API. Net effect: every push to main since 13.2 has created two deployments (one auto, one manual). Going forward — skip `vercel --prod` after pushes. | T5, T7 | root `package.json`, `.husky/pre-push`, `dashboard-web/eslint.config.js`, `scripts/docs-currency.mjs`, `scripts/lib/docs-currency-rules.mjs` | (Done — Phase 13.3) | Phase 13 engineering gates |
| P0-G | **Major shipped features absent from User Manual.** Multi-mapping cohort panel (`CohortComparisonPanel.tsx`), cannibalization detection (`cannibalizationDetection.ts`), cohort-aware Health Score (`campaignHealthScore.ts` cohortAdjustment), and the AI executive-briefing report (today's commit `4c3f7e9`) — none documented. Words *cannibalization*/*קניבל* never appear in the manual; *cohort* appears once in passing. | T7 | `docs/ROAS-Dashboard-User-Manual.md` (missing sections) | Add 4 sections (one per feature) using the "Step / Screenshot / Why" pattern already in the manual. Tag each with phase reference. While editing, also add the line "מטרת ההכנסה החודשית היא יעד עסקי גלובלי אחד — לא משתנה עם פילטרי חנות או תקופה" under §4.3 (GoalTracker), per the memory rule. | Phase 05.3 (in-dashboard manual phase, currently pending) — solve the doc gap and the in-dashboard-manual feature together |
| P0-H | **Architecture doc claims removed files still exist.** `docs/ARCHITECTURE.md:550-552,813-814` says `lib/sheets.ts` + `lib/featureFlags.ts` still exist "as legacy". Phase 11 deleted both. New engineers / future-Claude will look for them and get lost. | T7 | `docs/ARCHITECTURE.md:550-552,813-814` | Delete those paragraphs, replace with a single "Phase 11 single-tier baseline: Apps Script tier removed; readers go straight to Postgres." Verify no other doc references `sheets.ts`, `READ_FROM=sheets`, `clasp`, or `appsscript.json`. | Phase 13 docs sweep |

## P1 — Next phase (significant gaps)

| Track | Finding | File:line | Fix sketch |
|-------|---------|-----------|------------|
| T1 | Sentry has no `beforeSend` scrubber; fetcher throws embed raw upstream HTTP bodies that flow through `instrumentation.ts:30-40 → captureRequestError` un-redacted. Risk: refresh tokens + customer phone in Sentry. | `googleAds.ts:233`, `meta.ts:{344,453,533}`, `tiktok.ts:{159,167,243}`, `shopifyAuth.ts:{70,90,100}`, `sentry.server.config.ts` | Add `beforeSend` with regex scrub for `(refresh_token|access_token|Bearer\s+\S+|[+]\d{10,15})`. Strip request body for `/api/operator/*`. |
| T1 | `/api/debug/shopify-fetch` is a permanent unauthenticated diagnostic route shipped to prod. Token leak was fixed earlier but the route should be deleted. | `dashboard-web/src/app/api/debug/shopify-fetch/route.ts` | Delete the route folder, or env-gate behind `process.env.ENABLE_DEBUG_ROUTES === '1'` and OFF in prod Vercel env. |
| T1 | Inngest signing-key verification is implicit — `serve()` not called with explicit `signingKey:`. One missing env var in a preview deploy = open webhook. | `dashboard-web/src/app/api/inngest/route.ts` | Explicit `serve({ client: inngest, functions: [...], signingKey: process.env.INNGEST_SIGNING_KEY })` + boot-time assert. |
| T1 | All `/api/operator/*` routes have only URL obscurity — no header check, no rate limit, no `X-Robots-Tag: noindex` on the prod URL. | `dashboard-web/src/app/api/operator/*/route.ts`, `dashboard-web/middleware.ts` (missing) | One `requireOperatorSecret(req)` helper + middleware that 404s without the header. Same secret in `OPERATOR_SECRET` env. Set `X-Robots-Tag: noindex` in `next.config.ts`. |
| T1 | ~~`@sentry/nextjs ^8.40.0` has HIGH GHSA-mw96-cpmx-2vgc (rollup path traversal).~~ **SHIPPED 2026-05-25 (Phase 13.2.1, commit eb3dd38)** — bumped to `@sentry/nextjs@10.53.1`. CVE gone (16 vulns → 13 mod, 0 high). Only config change: `hideSourceMaps: true` → `sourcemaps: { deleteSourcemapsAfterUpload: true }`. 1096/1096 tests pass. | `dashboard-web/package.json` | `npm i @sentry/nextjs@^10.53.1` and revalidate sentry configs. |
| T2 | `computeWindowStability` clamps coverage upper-side only; refund-heavy weeks with `matched < 0` flow unbounded into σ → false 'volatile' verdicts. | `dashboard-web/src/lib/insights.ts:` `computeWindowStability` | Clamp `matched` to `Math.max(0, matched)` before σ. Add test with negative refund-heavy week. |
| T2 | `cannibalization.revenueGrowthPct` uses `Math.abs(earlyRev)` denominator — negative-early scenarios produce inflated positive growth. | `dashboard-web/src/lib/cannibalizationDetection.ts` (`revenueGrowthPct`) | Use signed `earlyRev` denominator; if `earlyRev <= 0` return `null` and surface "N/A" in UI. |
| T3 | No 429 / `Retry-After` backoff in ANY fetcher. Inngest's blind retry-then-deadletter amplifies rate-limit storms (page-1..N re-fetched per retry). | `dashboard-web/src/lib/fetchers/{meta,googleAds,tiktok,shopify}.ts` | Wrapper helper `fetchWithBackoff(url, opts)` that respects `Retry-After` (or exponential 2s/4s/8s) on 429 and surfaces a typed `RateLimitError` Inngest can use. |
| T3 | Google OAuth refresh-token expiry (~2026-05-30 per memory) has no proactive detector. Operator finds out AFTER first cron fails. | `dashboard-web/src/inngest/functions/cronDaily.ts` (add a new cron) | Add `cron-oauth-canary` at `0 0 * * *` IL that calls `getAccessToken('uzoshop')` and fires `notifyTokenFailure('google-oauth-refresh', ...)` if it fails. |
| T3 | `cronLive.ts:422` SELECT inside `persistDayForStore` lives inside the bigger `persist-rolling-3day` step.run — not memoized like the INN-10 prior-spend SELECT. Per-platform-preserve fallback corrupts on retry. | `dashboard-web/src/inngest/functions/cronLive.ts:422` | Hoist the SELECT into its own `step.run('read-prior-platform-spend', ...)`. |
| T3 | `sendDailySummary.ts:112-119` throws on ANY recipient failure → all recipients re-sent on Inngest retry. Single-recipient deployment masks the bug today. | `dashboard-web/src/lib/notifications/sendDailySummary.ts:112-119` | Wrap each recipient send in `step.run('send-whatsapp-${recipient}', ...)` so individual failures retry independently. |
| T4 | Layer violation: `app/api/data/route.ts:21` directly fetches Frankfurter instead of using `lib/fetchers/fx.ts`. | `dashboard-web/src/app/api/data/route.ts:21` | Replace inline fetch with `fetchFx(...)` import. |
| T5 | `apiErrors.ts` only 44% line coverage despite being used by 13 routes. | `dashboard-web/src/lib/apiErrors.ts` + `__tests__/apiErrors.test.ts` | Add tests for every error branch + Sentry-scrubbing path. |
| T5 | StepRunner pattern drift: 12 of 13 Inngest tests do NOT use the documented StepRunner stub from `cronDaily.test.ts`. | `dashboard-web/src/inngest/functions/__tests__/*.test.ts` | Refactor each to import the shared `StepRunner` stub. |
| T5 | TS strictness gaps: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` not enabled. | `dashboard-web/tsconfig.json` | Enable both, fix the resulting type errors (mostly array-access narrowing in `analytics.ts`, `aggregator` files). |
| T6 | `BillingSettings` modal missing `role="dialog"` / `aria-modal` / ESC handler. | `dashboard-web/src/components/BillingSettings.tsx:185` | Wrap modal in `<div role="dialog" aria-modal="true">`, add `useDrawerEsc` hook. |
| T6 | `CommandPalette` modal: missing dialog semantics AND bypasses `useDrawerEsc` — its own keydown listener collides with the drawer stack when both a CampaignDrawer and the palette are open. | `dashboard-web/src/components/CommandPalette.tsx:111-140,462-490` | Remove the local keydown listener, route through `useDrawerEsc`. Add `role="dialog"`. |
| T6 | All 15 tables lack `<caption>` and `<th scope>`. Operator JobsTable + ManualOverridesCrud use physical `text-right` instead of `text-start`. | (table components, listed in `06-FRONTEND.md`) | Codemod: add `<caption className="sr-only">{tableName}</caption>` + `scope="col"` to header cells. Replace `text-right`/`text-left` with `text-end`/`text-start`. |
| T6 | Zero `aria-live` anywhere — `SyncIndicator` status changes silent to assistive tech. | `dashboard-web/src/components/SyncIndicator.tsx` | Add `aria-live="polite"` to the status pill region. |
| T7 | `.planning/codebase/STRUCTURE.md` says 5K LOC for cronDaily (actual 1,277); says 144 lib specs (actual 89); says 54 components (actual 46+7); says 235 TS/TSX (actual 263). 4 of the 7 codebase docs have drift. | `.planning/codebase/{STRUCTURE,TESTING,STACK,INTEGRATIONS,ARCHITECTURE}.md` | Refresh all 7 docs. Wire to the pre-push gate from P0-F. |
| T7 | 17 env vars referenced via `process.env.X` are missing or unmapped in `docs/PROPS-MAP.md`. | `docs/PROPS-MAP.md` | Diff list in `07-DOCS.md`; add missing entries. While editing, replace Apps-Script-style dot-notation keys with the actual Vercel UPPER_SNAKE names. |
| T8 | `fetchOrdersAttribution` always SELECTs `line_items` JSONB even when `includeLineItems=false`. | `dashboard-web/src/lib/postgresReaders.ts:885` | Make projection conditional on the flag. |
| T8 | New `fetchCurrentCampaignStatuses` pulls ~27K rows to extract ~150 keys. | `dashboard-web/src/lib/postgresReaders.ts:739-790` | Push to SQL via `DISTINCT ON (campaign_id)` or via a SQL view. |
| T8 | cron-live exec count now ~78K/month — above the 50K Inngest free tier. Budget comments in `cronLive.ts:24-25` are stale. | `dashboard-web/src/inngest/functions/cronLive.ts:24-25` | Either drop frequency to */15 (still well within 3-day rolling window), or consolidate the per-date `select-prior-spend` steps. Update the budget comment either way. |

## P2 — Cleanup / nice-to-have

Each track's full P2 list is in its detail file. Bulk patterns worth one polish PR:

- **Apps Script residue cleanup** (~1 hr): delete root `package.json` `deploy:gs` script + `@google/clasp` dev dep; delete `.claspignore`; delete `lib/apiErrors.ts:27` dead Google Sheets regex; remove `SyncIndicator.tsx:157-158` stale env-var reference.
- **Constants dedup** (~1 hr): `['uzoshop','zolplus','usmile360']` declared in 8 places under 3 names; `STORES_WITH_TIKTOK` declared twice; `getCogsRateForStore` declared 3 times; `STORE_COLORS` declared in `PerStoreCards.tsx:10` AND `TodayLive.tsx:139` **with different hex values for the same stores**. Consolidate into `lib/platformConfig.ts` and `lib/chartColors.ts`.
- **Logical Tailwind classes** (~30 min via codemod): 36 physical `pl-*`/`pr-*`/`ml-*`/`mr-*`/`text-left`/`text-right` occurrences should be `ps-*`/`pe-*`/`ms-*`/`me-*`/`text-start`/`text-end`. List in `06-FRONTEND.md`.
- **Inline hex deletion** (~30 min): 32 inline hex colors outside the allowed `chartColors.ts`. List in `06-FRONTEND.md`.
- **Doc number sync** (~30 min): the 4 numbers cited in the exec summary above — sync after the P0-F gate is wired.

## Cross-track convergence (independent signals = high confidence)

The following items were flagged independently by ≥2 tracks. Treat them as high-confidence findings:

| Issue | Tracks | Why convergence matters |
|-------|--------|-------------------------|
| `/api/debug/shopify-fetch` shipped to prod, unauthenticated | T1 (security) + T8 (perf/observability) | Both an attack-surface and a dev-only artifact in the deployable manifest. Delete or env-gate. |
| Sentry not capturing API/Inngest errors | T5 (maturity) + T8 (observability) | Maturity track found "server console.error never reaching Sentry"; Observability track found "0 captureException in either layer". Same root, two symptoms. |
| Pre-push gates missing | T5 (`pre-push` hook absent) + T7 (docs-currency gate absent) | Confirms the engineering-discipline gap is structural, not just docs-side. |
| Apps Script residue | T1 (`.claspignore`) + T4 (`deploy:gs` + `@google/clasp` in root pkg) + T7 (`docs/ARCHITECTURE.md` claims `sheets.ts` exists) | The cleanup needs to span code + docs + tooling. |
| Codebase doc drift (STRUCTURE, TESTING, STACK, INTEGRATIONS) | T4 (architecture) + T7 (docs) | Tracks dispatched with no shared context independently caught the same drift — strong signal the docs are not being maintained automatically. |
| Cohort / cannibalization features not documented | T6 (UX) — flagged a11y on the panel + T7 — flagged absent doc | Same panel: half-built doc + a11y gap. Suggests the feature was shipped without the docs-currency gate, exactly the P0-F problem. |

## Per-track summaries

| Track | File | Headline | P0 | P1 | P2 |
|-------|------|----------|----|----|----|
| T1 — Security | `01-SECURITY.md` | Healthy core, weak edges. `/api/debug/shopify-fetch` is the only real surface concern. | 0 | 5 | 6 |
| T2 — Algorithms | `02-ALGORITHMS.md` | **2 new P0s in percent-of-revenue billing.** GoalTracker correct + locked by test. | 2 | 3 | 2 |
| T3 — Pipeline | `03-PIPELINE.md` | All 11 functions registered, all crons in IL TZ, all writes upsert. P0 is a stale docstring; real risk is OAuth refresh expiry + missing 429 backoff. | 1 (docstring) | 7 | 6 |
| T4 — Architecture | `04-ARCHITECTURE.md` | Layering honored almost completely. Top file = `aiReport.ts` 2,496 LOC. STRUCTURE.md drift is the surprising finding. | 0 | 3 | 8 |
| T5 — Maturity | `05-MATURITY.md` | Pure-function coverage excellent; **zero React render tests**; lint not configured; pre-push gates not wired. | 3 | 7 | 5 |
| T6 — Frontend | `06-FRONTEND.md` | GoalTracker correctly global. SWR + cloudSync correct. 10 a11y items, 36 physical Tailwind classes, monster components. | 0 | 10 | 6 |
| T7 — Docs | `07-DOCS.md` | Pre-push gate missing + 4 major features undocumented + ARCHITECTURE.md claims deleted files exist. | 3 | 11 | 4 |
| T8 — Perf/Obs | `08-PERF-OBSERVABILITY.md` | **Sentry blind to backend errors.** Inngest payload bloat. cron-live above free tier. Front-page 437 kB. | 4 | 5 | 6 |
| **Total** | — | — | **13** | **51** | **43** |

(P0 count of 13 reflects per-track counts. After consolidation across tracks, the unique P0 set is **8** as listed above.)

## Recommended next-phase punch list (dependency order)

This is the suggested sequence to address P0s. Each item is a candidate phase folder under `.planning/phases/`.

1. **`13.1-billing-percent-of-revenue-hotfix`** — Fix P0-A + P0-B with regression tests. Smallest blast radius. Ship first. (~1-2 hrs)
2. **`13.2-observability-baseline`** — `withErrorCapture` wrapper + Sentry wiring across 19 API routes + 11 Inngest functions. Add `beforeSend` scrubber (P1) at the same time. (~half day)
3. **`13.3-engineering-gates`** — `eslint.config.js` + husky + `pre-push` hook running tsc/vitest/User-Manual-currency/ARCHITECTURE-currency. (~half day)
4. **`13.4-cron-fetcher-resilience`** — 429 backoff + non-auth-fetch-error alerting + OAuth canary cron + Inngest step payload split. (~half day)
5. **`13.5-docs-currency-sweep`** — Document the 4 missing features, fix ARCHITECTURE.md Apps-Script residue, refresh `.planning/codebase/*.md`, fix PROPS-MAP diff. Lands AFTER 13.3 (so gate fails on regression). (~half day)
6. **`13.6-apps-script-residue-cleanup` + constants dedup + a11y polish** — bundle P2s into one cleanup phase. (~half day)

Total ≈ **3 working days** to clear all P0s and the highest-leverage P1s. Each step is independently shippable.

## Stats

- **Tracks dispatched:** 8 (1 `pentest-advisor`, 7 `general-purpose`)
- **Total wall-clock time:** ~12 min (parallel)
- **Total agent token usage:** ~1.75 M tokens
- **Files inspected:** ≥263 TS/TSX + 11 SQL migrations + 4 operator docs + 7 internal codebase docs
- **Findings:** 13 P0 (8 unique) + 51 P1 + 43 P2 = 107 total
- **Cross-track convergence points:** 6 (independent corroboration)

## Source files (this run)

- Plan: `AUDIT-PLAN.md`
- Detail reports: `01-SECURITY.md`, `02-ALGORITHMS.md`, `03-PIPELINE.md`, `04-ARCHITECTURE.md`, `05-MATURITY.md`, `06-FRONTEND.md`, `07-DOCS.md`, `08-PERF-OBSERVABILITY.md`
- This file: `MASTER-REPORT.md`

## Comparison vs prior baselines

- `.planning/audit-2026-05-23/`, `audit-2026-05-23-v2/` — earlier algorithmic-only runs; superseded.
- `.planning/audit-2026-05-23-v3/` — most recent prior baseline; had a 4-part Opus review + Codex verification. Track 2 explicitly diffed against it: 1 v3 finding (CRIT-1 invariant) re-emerged in a NEW shape via the billing feature (P0-A); 5 of the v3 MED/LOW findings are still unfixed (listed in `02-ALGORITHMS.md`). The pipeline and architecture tracks confirm the v3-era refactors held.

---

*Audit run completed 2026-05-24 via `superpowers:dispatching-parallel-agents`.*
