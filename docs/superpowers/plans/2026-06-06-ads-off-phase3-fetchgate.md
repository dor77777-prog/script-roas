# Ads-Off — Phase 3 (Fetch-Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a (store, platform) is OFF, stop spending platform-API quota fetching its ad data — while keeping revenue/Shopify flowing and the operator's freshness signal GREEN (not false-red).

**Architecture:** Gate at the **worker level + cron-daily**, NOT the orchestrator. Each per-platform worker (meta/google/tiktok) and each cron-daily fetch step consults the Phase-1 helpers (`isAdsEnabled` for Meta/Google; `tiktokAccountFetchEnabled` for the shared TikTok account) and, when off, **records freshness success and returns BEFORE the API fetch**. This skips the expensive platform API call (the real cost) while the worker still runs (Inngest execs are a flat base fee — no $ saved by skipping them) and records a fresh `success` row, so the Health tab never false-reds. The orchestrator/`buildEvents` is intentionally **left unchanged** (gating there would suppress the freshness update → false-red).

**Tech Stack:** Next.js, Supabase, Inngest, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (§C fetch-gate, §J.3). Phases 1+2 shipped.

---

## Locked design decisions (from the 2026-06-06 pipeline mapping)

1. **Gate at the worker + cron-daily, not the orchestrator.** Reason: the orchestrator (`buildEvents` in `priorityBuilder.ts`) skipping a job means no worker runs → no freshness row written → the Health tab shows that platform as stale/red. Gating in the worker (early-return AFTER recording freshness `success`, BEFORE the API fetch) skips the API call but keeps freshness green. Inngest execs are a flat fee (no saving from skipping them); the platform API quota is the real cost, and that IS skipped.
2. **TikTok uses `tiktokAccountFetchEnabled`, NEVER per-store `isAdsEnabled`.** The shared account (uzoshop+usmile360) is fetched once and split per store via campaign-store-map. Per-store gating would drop a still-on store's data when the account owner is off. Skip the account fetch ONLY when TikTok is off for ALL of `TIKTOK_SHARED_STORES`.
3. **Meta/Google use per-store `isAdsEnabled(map, storeId, platform)`.**
4. **NOT gated:** Shopify/revenue (cron-live, cron-daily step 1), the `data_daily`/`campaigns_daily`/`ads_daily` persist + aggregation RPCs (idempotent; missing ad rows just don't upsert), registry enrollment (metadata, no quota), and the reconcile harness (registry ⊇ dailies is already tolerated).
5. **Freshness on skip = `success`** (lag resets), reusing each worker's EXISTING success-recording helper for its no-op path. A distinct `off_gated` status (nicer Health-tab UX) is DEFERRED (needs a DB enum + UI). An off platform thus shows green/fresh — acceptable: the operator toggled it and sees it in the /operator "מצב פרסום" tab.
6. **Default (empty `store_ad_state`) ⇒ all-ON ⇒ pipeline behaves EXACTLY as today.** Every gate is keyed off `isAdsEnabled`/`tiktokAccountFetchEnabled`, which default ON for missing rows.
7. **adStateMap loading:** the worker pure cores accept an OPTIONAL `adStateMap` input (default `{}` = all ON, so existing tests are unaffected); the Inngest binding loads it once via `fetchAdStateFromPostgres()` and passes it in. cron-daily loads it as a new first `step.run('fetch-ad-state', …)`.

---

## Task 1: metaWorker + googleWorker fetch-gate (per-store `isAdsEnabled`)

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts`
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`, `…/googleWorker.test.ts`

Both workers expose a pure core (`runMetaWorkerJob` / `runGoogleWorkerJob`) wrapped by an Inngest binding. Both handle `scope='status'` and `scope='hot_metrics'`, fetch per-store, and already have a no-op path that records freshness `success` (e.g. empty hot-set, or the existing `checkGoogleConfigured` short-circuit). Mirror THAT pattern for the gated-off case.

- [ ] **Step 1: READ both workers.** For each: find the pure-core input type (`RunMetaWorkerJobInput` / `RunGoogleWorkerJobInput`), where `storeId` + `scope` are extracted, the API fetch call per scope (`fetchStatus` / `fetchHotMetrics`), and the EXISTING freshness-success helper(s) used by a no-op path (e.g. `recAllStatusScopes('success')` / `recHotPair('success')` / `rec({…status:'success'})`, and how googleWorker's `checkGoogleConfigured` early-returns recording success). Note the exact helper names + scope→freshness-scope mapping.

- [ ] **Step 2: Write the failing tests.** For EACH worker, add cases (mirror the existing test harness + mocks; the fetchers are mocked — assert they are NOT called when gated):
  - `scope='status'`, store OFF for the platform (`adStateMap = { '<store>:<platform>': false }`) → the status fetcher (`fetchStatus`) is NEVER called, AND a freshness `success` row is recorded for the status scopes, AND the job returns without error.
  - `scope='hot_metrics'`, store OFF → the hot-metrics fetcher is NEVER called, freshness `success` recorded.
  - store ON / `adStateMap = {}` (default) → behaves EXACTLY as the existing tests (fetcher called). (The existing tests already cover this; just confirm they still pass with the optional param defaulting to `{}`.)

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** In each pure core:
  - Add `adStateMap?: AdStateMap` to the input type (optional). At the top, `const adStateMap = input.adStateMap ?? {};`.
  - Import `import { isAdsEnabled, type AdStateMap } from '@/lib/adState';`.
  - In the `status` branch, immediately AFTER `storeId`/`scope` are known and AFTER any existing config short-circuit, BEFORE the `fetchStatus(...)` call: `if (!isAdsEnabled(adStateMap, storeId, 'meta'|'google')) { <record freshness success for the status scopes, exactly as the existing no-op path does>; return; }`.
  - In the `hot_metrics` branch, same: BEFORE `fetchHotMetrics(...)`, `if (!isAdsEnabled(...)) { <record hot freshness success>; return; }`.
  - In the Inngest binding, load `const adStateMap = await fetchAdStateFromPostgres();` (import from `@/lib/postgresReaders`) and pass it into the pure core's input.

- [ ] **Step 5: Run — confirm PASS** + re-run the FULL `metaWorker.test.ts` + `googleWorker.test.ts` (existing cases green — the optional param keeps them unchanged).

- [ ] **Step 6: tsc + eslint** (touched files; ignore the pre-existing MODULE_TYPELESS warning).

- [ ] **Step 7: Commit**
```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts dashboard-web/src/inngest/functions/googleWorker.ts dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts
git commit -m "feat(ads-off): meta+google worker fetch-gate (isAdsEnabled, freshness success on skip) (Phase 3)"
```

---

## Task 2: tiktokWorker fetch-gate (account-level `tiktokAccountFetchEnabled`)

**Files:**
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

- [ ] **Step 1: READ tiktokWorker.** Find `RunTikTokWorkerJobInput`, the status branch (`runTikTokStatusBranch`) + hot_metrics branch (`runTikTokHotMetricsBranch`), the existing `checkTikTokConfigured(storeId)` no-op-success short-circuit, and the freshness-success helpers (`recAllStatusScopes('success')` / `recHotPair('success')`). Note where `getTikTokAccountForStore` / the account fetch happens.

- [ ] **Step 2: Write failing tests** (mirror the harness):
  - status branch, `adStateMap = { 'uzoshop:tiktok': false, 'usmile360:tiktok': false }` (both shared stores off) → the account fetcher is NEVER called, freshness `success` recorded, returns clean.
  - hot_metrics branch, both off → fetcher not called, freshness success.
  - **Critical case:** `adStateMap = { 'uzoshop:tiktok': false }` ONLY (usmile360 still ON) → the account fetch STILL happens (NOT gated) — `tiktokAccountFetchEnabled` is true. Assert the fetcher IS called.
  - `adStateMap = {}` → unchanged.

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** Add `adStateMap?: AdStateMap` to the input (default `{}`); import `{ tiktokAccountFetchEnabled, type AdStateMap }`. In BOTH branches, after the existing `checkTikTokConfigured` short-circuit and BEFORE the account fetch: `if (!tiktokAccountFetchEnabled(adStateMap)) { <record freshness success>; return; }`. Load `adStateMap` in the Inngest binding via `fetchAdStateFromPostgres()` and pass in. DO NOT add any per-store `isAdsEnabled` check inside the fetch (would break the shared-account split).

- [ ] **Step 5: Run — confirm PASS** + full `tiktokWorker.test.ts` green.
- [ ] **Step 6: tsc + eslint.**
- [ ] **Step 7: Commit**
```bash
git add dashboard-web/src/inngest/functions/tiktokWorker.ts dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
git commit -m "feat(ads-off): tiktok worker fetch-gate (tiktokAccountFetchEnabled, account-level) (Phase 3)"
```

---

## Task 3: cron-daily fetch-gate (nightly + yesterday-refresh + Refresh-All inherit)

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Test: `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`
- Verify only (no change): `cronYesterdayRefresh.ts`, `eventSyncNow.ts`, `cronLive.ts`

`runDailyForStoreInner` (called by cron-daily, cron-yesterday-refresh, and the Refresh-All `eventSyncNow`) has 5 steps; steps 2/3/3.5 fetch Meta/Google/TikTok. cron-daily does NOT write `data_freshness` (worker-owned), so no freshness recording is needed here — just return the zero/empty sentinels so persist writes nothing for the off platform.

- [ ] **Step 1: READ `runDailyForStoreInner`** — the `fetch-meta` (lines ~621), `fetch-google` (~683), `fetch-tiktok` (~723) `step.run` blocks, their exact return-sentinel shapes (the metaSkipDueToBudget early-return shows the Meta sentinel shape; the `!STORES_WITH_TIKTOK.has(storeId)` early-return shows the TikTok sentinel), and where to add a first `step.run('fetch-ad-state', …)`.

- [ ] **Step 2: Write failing tests** (extend `cronDaily.test.ts`, mocking the fetchers):
  - store OFF for Meta (`adStateMap = { '<store>:meta': false }`) → `fetchMetaSpendForDay`/`fetchMetaAdSetInsights`/`fetchMetaAdInsights`/`fetchMetaBudgets` are NEVER called; the run completes; `data_daily` Meta spend is 0.
  - store OFF for Google → Google fetchers never called.
  - TikTok OFF for ALL shared stores → TikTok fetchers never called; TikTok ON for one shared store → fetched.
  - `adStateMap = {}` → all fetchers called (existing behavior; existing tests cover this — confirm green).
  (How the test injects `adStateMap`: mock `fetchAdStateFromPostgres` to return the off map.)

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.**
  - Import `{ isAdsEnabled, tiktokAccountFetchEnabled }` from `@/lib/adState` and `fetchAdStateFromPostgres` from `@/lib/postgresReaders`.
  - As the FIRST step in `runDailyForStoreInner`: `const adStateMap = await step.run('fetch-ad-state', () => fetchAdStateFromPostgres());`.
  - `fetch-meta` step: at the top (after the existing `metaSkipDueToBudget` check), `if (!isAdsEnabled(adStateMap, storeId, 'meta')) return <existing Meta zero sentinel>;`.
  - `fetch-google` step: at the top of the try, `if (!isAdsEnabled(adStateMap, storeId, 'google')) return <Google zero sentinel>;`.
  - `fetch-tiktok` step: change the existing guard to `if (!STORES_WITH_TIKTOK.has(storeId) || !tiktokAccountFetchEnabled(adStateMap)) return <TikTok zero sentinel>;`.
  - Use the EXACT sentinel shapes the existing early-returns already use (copy them).

- [ ] **Step 5: Run — confirm PASS** + full `cronDaily.test.ts` green.
- [ ] **Step 6: Verify inheritance + cron-live** — confirm `cronYesterdayRefresh.ts` + `eventSyncNow.ts` call `runDailyForStore`/`runDailyForStoreInner` (so they inherit the gate — NO change needed), and that `cronLive.ts` fetches NO ad data (Shopify-only — NO gate needed). State findings in the report. No code change to these three.
- [ ] **Step 7: tsc + eslint.**
- [ ] **Step 8: Commit**
```bash
git add dashboard-web/src/inngest/functions/cronDaily.ts dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts
git commit -m "feat(ads-off): cron-daily fetch-gate (meta/google isAdsEnabled, tiktok account-level); yesterday-refresh + Refresh-All inherit (Phase 3)"
```

---

## Task 4: Docs + reconcile-interaction note + full local gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (Phase 3 semantics)
- Modify: `docs/ARCHITECTURE.md` (§41)
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (version bump + "מה התחדש")

- [ ] **Step 1: Spec addendum** — "## Phase 3 — locked fetch-gate semantics": worker+cron-daily gate (not orchestrator); Meta/Google per-store `isAdsEnabled`; TikTok account-level `tiktokAccountFetchEnabled` (never per-store); freshness `success` on skip (no false-red); Shopify/persist/aggregation/registries/reconcile NOT gated; default empty table ⇒ unchanged; the `off_gated` freshness status deferred.

- [ ] **Step 2: ARCHITECTURE §41** — "Ads-off fetch-gate (Phase 3)": the worker-level gate + cron-daily gate, the rationale for NOT gating the orchestrator (freshness), the TikTok account-level rule, the reconcile interaction (when off, campaigns_daily/ads_daily get no new rows → registry ⊇ dailies, which the coverage-parity harness already tolerates; INV-6/7/9/10 don't false-fire because there's no row to compare), and the explicit non-goals.

- [ ] **Step 3: User Manual** — bump version (2.46.0 → 2.47.0, keep box aligned) + a "מה התחדש" entry: when a store's platform is off, the dashboard stops pulling that platform's data from the API (saving quota); revenue keeps updating; the freshness/health signal stays green; turning it back on resumes pulling from that point. Note historical data is untouched.

- [ ] **Step 4: Full local gate** — from `dashboard-web/`: `npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green (unit + DOM; tsc clean; lint 0 errors).

- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/specs/2026-06-06-ads-off-state-design.md docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(ads-off): spec + ARCHITECTURE §41 + User Manual 2.47.0 (Phase 3 fetch-gate)"
```

---

## Self-review (run before execution)

- **Spec coverage (§C / §J.3):** Meta/Google worker gate (T1) ✓ · TikTok account-level worker gate (T2) ✓ · cron-daily + inherited yesterday-refresh/Refresh-All (T3) ✓ · cron-live confirmed Shopify-only (T3.6) ✓ · docs + reconcile note (T4) ✓.
- **Additive / no-regression:** `adStateMap` optional (default `{}`) in every worker pure core + cron-daily loads it fresh; empty map ⇒ `isAdsEnabled`/`tiktokAccountFetchEnabled` return true ⇒ every gate is a pass-through ⇒ today's behavior. Existing worker/cron tests stay green (they pass no map).
- **Freshness safety:** every worker skip records `success` via the EXISTING helper (reused, not invented) ⇒ no false-red.
- **TikTok correctness:** account-level `tiktokAccountFetchEnabled` only; NEVER per-store inside the fetch ⇒ a still-on shared store keeps its data.
- **Not gated:** Shopify/revenue, persist + aggregation RPCs, registry enrollment, reconcile — confirmed in each task.
- **Type/name consistency:** `isAdsEnabled`, `tiktokAccountFetchEnabled`, `AdStateMap`, `fetchAdStateFromPostgres`, `adStateMap` (input field) identical across tasks.
- **Open verifications for the implementer:** (a) each worker's exact freshness-success helper name + scope mapping (T1/T2 Step 1); (b) the exact sentinel shapes in cron-daily (T3 Step 1); (c) that yesterday-refresh/Refresh-All truly route through `runDailyForStoreInner` (T3.6); (d) how the worker tests inject mocks (assert fetcher NOT called).
