# Self-Serve Stores — Phase 2 (Data-Driven Cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> **DEPENDENCY:** Ships AFTER Phase 1 is deployed (migrations applied so `stores` has the new columns). Safe even if it lands first — `getStores()` falls back to the hardcoded 3 (identical behavior).

**Goal:** Make every store-list / display-name / color / cron-fan-out site read from the Phase-1 `getStores()` source instead of the ~11 hardcoded lists + ~8 component maps + the `StoreId` union — so adding/archiving a store reflows the whole dashboard automatically — with **ZERO regression** for the existing 3 stores.

**Architecture:** Server (crons, API routes) call `loadActiveStoreIds()` / `getStores()` directly. The client gets the list from a new cached `/api/stores` route via a `useStores()` SWR hook; display-name/color lookups go through small helpers that prefer the live list and fall back to the existing hardcoded map (so a loading/empty state is byte-identical to today). The `StoreId` union widens to `string`. The home per-store grid becomes responsive to the store count. A no-regression equality test (`getStores()` ⊇ the old hardcoded maps for the 3) is the anchor.

**Tech Stack:** Next.js, Supabase, SWR, vitest (node + dom).

**Spec:** `docs/superpowers/specs/2026-06-06-self-serve-store-management-design.md` (Phase P2). Phase-1 seams (shipped): `lib/getStores.ts` (`getStores()`, `loadActiveStoreIds()`, `StoreInfo`).

## Cutover site inventory (from the 2026-06-06 mapping Workflows)
- **Crons (async):** `cronDaily.ts:256`, `cronLive.ts:133`, `cronYesterdayRefresh.ts:41`, `cronCohortRefresh.ts:80`, `cronTickOrchestrator.ts:17` (each `const STORES = [...]`).
- **API routes (async):** `app/api/operator/sync-now/route.ts` (ALL_STORES), `app/api/operator/backfill/route.ts` (ALL_STORES).
- **Display-name / color maps (sync, client):** `lib/platformsByStore.ts` (STORE_ID_TO_NAME, STORE_NAMES, STORES_WITH_TIKTOK_IDS), `lib/storeColors.ts` (STORE_COLORS), `components/CampaignsTable.tsx:852`, `components/campaign-drawer/index.tsx:120-122` + the **TikTok store dropdown options 691-735**, operator `SyncNowButtons.tsx:67`, `BackfillPicker.tsx:56`, `ManualOverridesCrud.tsx:79,126`, `TokenFailuresTable.tsx:81-83`.
- **Types:** `registries/types.ts` (`StoreId` union), `lib/adState.ts` (any StoreId use).
- **Responsive layout:** `components/home/PerStoreRow.tsx:228` (`md:grid-cols-3`).

---

## Task 1: Client store-list distribution + display helpers + the no-regression anchor

**Files:** Create `app/api/stores/route.ts`, `lib/useStores.ts` (hook + `storeName()`/`storeColorFor()` helpers); test `lib/__tests__/storesNoRegression.test.ts`.

- [ ] **Step 1: No-regression equality test FIRST** (the anchor). Assert that `getStores()` (mock the DB to return the 3 seeded+backfilled rows) produces, for uzoshop/zolplus/usmile360, the SAME storeName + brandColor + displayOrder + hasTikTok as the CURRENT hardcoded maps (`STORE_ID_TO_NAME`, `STORE_COLORS`, `STORES_WITH_TIKTOK_IDS`). This locks "DB-driven == hardcoded" for the 3. Run → (it should pass against Phase-1 `getStores`; if it fails, the maps diverged — fix before cutover).
- [ ] **Step 2: `/api/stores` route** — `GET` returns `await getStores()` (cached via `CACHE_CONFIG` — add a `stores` entry, e.g. revalidate 60/swr 300). Degrade to `[]`? No — return getStores() which already falls back to hardcoded. Runtime nodejs.
- [ ] **Step 3: `useStores()` hook + helpers** — `useStores()` SWR over `/api/stores` (fallbackData = the hardcoded 3 so first paint is identical). `storeName(id, stores)` / `storeColorFor(name, stores)` prefer the list, fall back to the existing `STORE_ID_TO_NAME` / `STORE_COLORS`. + tests.
- [ ] **Step 4:** tsc + eslint + the equality test green. **Commit.**

---

## Task 2: Crons → `loadActiveStoreIds()` (+ derived TikTok set)

**Files:** `cronDaily.ts`, `cronLive.ts`, `cronYesterdayRefresh.ts`, `cronCohortRefresh.ts`, `cronTickOrchestrator.ts` + their tests.

- [ ] **Step 1:** For each cron factory/orchestrator, replace the hardcoded `const STORES = [...]` with the active list. NOTE the registration constraint: Inngest factories build functions at MODULE LOAD (sync), but `loadActiveStoreIds()` is async. **Phase 2 keeps the per-store factory** (Phase 4 makes crons dynamic); so at module load we still need a sync list. **Resolution for Phase 2:** keep the factory iterating a sync `HARDCODED_STORE_IDS` for *function registration*, but have each function's HANDLER pass through the store it owns unchanged (no change to which functions exist yet). The orchestrator's RUNTIME fan-out (`cronTickOrchestrator`, which reads a list at run time) switches to `await loadActiveStoreIds()`. So Phase 2 cutover for crons = ONLY the runtime-fan-out sites (orchestrator + any handler that loops stores at run time); the static factory list stays until Phase 4. Document this split clearly.
- [ ] **Step 2:** "same fan-out" guard — a test that the orchestrator enqueues the same (store,platform,scope) set from `loadActiveStoreIds()` (mocked to the 3) as the old hardcoded list. + STORES_WITH_TIKTOK derived from `getStores().filter(hasTikTok)`.
- [ ] **Step 3:** tsc + the cron suites green. **Commit.**

> The async-factory tension is the real subtlety. Phase 2 only cuts over the RUNTIME loops; the per-store function *registration* stays hardcoded until Phase 4 (dynamic crons). Both states are guarded so the 3 stores are unaffected.

---

## Task 3: Operator API routes → `loadActiveStoreIds()`

**Files:** `app/api/operator/sync-now/route.ts`, `app/api/operator/backfill/route.ts` + tests.

- [ ] Replace `ALL_STORES = [...]` with `await loadActiveStoreIds()` (validate a requested store against the live list). Default empty/failure → fallback list (getStores handles it). Tests: a request for an active store works; the list reflects getStores. tsc + tests green. **Commit.**

---

## Task 4: Component display-name/color maps → `useStores()` (hardcoded fallback)

**Files:** `platformsByStore.ts`, `storeColors.ts`, `CampaignsTable.tsx`, `campaign-drawer/index.tsx` (incl. the TikTok dropdown), operator `SyncNowButtons/BackfillPicker/ManualOverridesCrud/TokenFailuresTable` + DOM tests.

- [ ] **Step 1:** Keep the hardcoded const maps as the FALLBACK (do not delete in Phase 2). Components switch their lookups to `useStores()` + `storeName()`/`storeColorFor()` (which fall back to the const maps). The **campaign-drawer TikTok store dropdown** (`691-735`) maps over `useStores()` so a new store appears as a remap target.
- [ ] **Step 2:** operator forms (SyncNowButtons/BackfillPicker/ManualOverridesCrud) list stores from `useStores()`; TokenFailuresTable resolves names via `storeName()`.
- [ ] **Step 3:** DOM tests — with `useStores()` returning the 3, every surface renders identical names/colors to today (no-regression). With a 4th store, it appears. tsc + eslint + designColorGuard green. **Commit.**

---

## Task 5: `StoreId` union → `string`

**Files:** `registries/types.ts`, `lib/adState.ts`, any other `StoreId` consumer.

- [ ] Widen `type StoreId = 'uzoshop'|'zolplus'|'usmile360'` → `type StoreId = string` (keep the name for readability; add a comment). Fix any code that relied on the literal narrowing. tsc clean (the compiler surfaces every site). Full suite green. **Commit.**

---

## Task 6: Responsive home per-store grid (N stores)

**Files:** `components/home/PerStoreRow.tsx` + its DOM test.

- [ ] Replace `md:grid md:grid-cols-3` with a count-responsive grid (e.g. `grid-cols-[repeat(auto-fit,minmax(232px,1fr))]` on md+, or count-aware classes: 1→1, 2→2, 3→3, 4→2×2/4, 5+→auto-fit). Mobile carousel unchanged. DOM test: render 2/4/5 stores → grid lays out without overflow/gap; 3 stores → unchanged from today. tsc + designColorGuard green. **Commit.**

---

## Task 7: Docs + full gate (ship after Phase 1)

- [ ] ARCHITECTURE §44 — "Self-serve stores Phase 2: data-driven cutover" (the getStores seam, the async-factory split deferring dynamic-registration to Phase 4, the responsive grid, the no-regression anchor). User Manual: usually no operator-facing change (invisible) — skip or 1-line.
- [ ] Full local gate: `npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green; the 3 stores byte-identical.
- [ ] **Commit.** (Ship — push + any migration — is GATED on operator OK, after Phase 1 is live.)

---

## Self-review
- **Coverage:** client distribution + anchor (T1) · crons runtime-loops (T2) · operator routes (T3) · component maps incl. TikTok dropdown (T4) · StoreId→string (T5) · responsive grid (T6) · docs/gate (T7). The static cron-function registration is intentionally DEFERRED to Phase 4 (dynamic crons) — documented in T2.
- **Zero-regression:** every cutover keeps the hardcoded map/list as fallback; `useStores()` fallbackData = the 3; the equality test (T1) locks DB==hardcoded; full suite + the 3 byte-identical at each step.
- **Open verifications:** (a) the exact async-factory split (which cron sites loop at runtime vs register at module-load); (b) whether to distribute the client list via `/api/stores`+`useStores` (this plan) or fold into `DashboardData` — confirm against how components currently get `data`; (c) every `StoreId`-narrowing site the compiler surfaces in T5.
