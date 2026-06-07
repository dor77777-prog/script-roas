# Self-Serve Stores — Phase 4 (Dynamic DB-Loop Crons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Inngest crons enumerate the active store list from the DB (`loadActiveStoreIds()`) instead of hardcoded `STORES` constants, so a store added via the future UI enters every cron cycle with **zero deploy** — without double-running or missing-running jobs for the current 3 stores.

**Architecture:** Two sub-phases. **4a** (low risk, ships first): the single-function crons that already iterate stores inside their handler (orchestrator, cohort, canary) just swap `STORES` → `await loadActiveStoreIds()` — no Inngest registration change, no double/missed-run window. **4b** (registration churn, after 4a soaks): the three per-store FACTORY crons (daily/live/yesterday) are folded to the canonical Inngest **scheduler→worker** shape (one static-trigger scheduler that loads stores at runtime and `step.sendEvent`s per store → one registered event worker keyed by store) so they too onboard a store with no deploy. Every persist is idempotent and the cutover is atomic (Inngest PUT), so a transient overlap is harmless; revert = flip `serve()` back.

**Tech Stack:** Inngest (createFunction, cron triggers, step.run/sendEvent/sleep, event-driven workers + concurrency keys), Supabase, Vitest. Grounded by the 2026-06-07 Phase-4 grounding workflow (5 agents + design critic; the critic corrected a research error — see T0).

---

## Decisions locked (2026-06-07 grounding + operator)

1. **Operator chose FULL scope: 4a + 4b** (4a ships first + soaks, then 4b fold) → zero-deploy store adds everywhere.
2. **Inngest constraint (verified):** the `serve({functions:[...]})` array + each function `id` + each cron `trigger` MUST be static at module-load (synchronous; no `await`). The store **iteration** CAN be runtime (`await loadActiveStoreIds()` inside the handler/step.run). Proven by the existing orchestrator→worker pattern. So the only shape that adds a store with zero deploy is: **static-count scheduler trigger → runtime store enumeration in handler → per-store events → one registered worker.**
3. **Idempotency (verified) → transient double-run is harmless:** `data_freshness` upsert onConflict `store_id,platform,scope,table_name`; `campaigns_daily` onConflict `date,store_id,platform,campaign_id,ad_set_id`; `ads_daily` onConflict `date,store_id,ad_id`; `agg_data_daily_for_date(d)` RPC is a pure ZERO→SUM→DERIVE pass (no additive INSERT); Inngest event ids are deterministic (`${platform}:${storeId}:${scope}:${tickId}`) → duplicate events within a tick are de-duped. A brief overlap costs compute, not data.
4. **Decision-7 gates are PHASE-6-blocking, not Phase-4-blocking.** `isTikTokConfiguredForStore` / `isGoogleConfiguredForStore` are sync env reads; a DB-only-cred store (only possible once the Phase-6 add-UI exists) would be silently skipped. We LAND async DB-aware variants in 4b behind the existing worker injection seam (inert while creds are env-only, thanks to the Phase-3 dual-read), with a regression test; ACTIVATION is verified in Phase 6. Today's 3 stores all have env creds → no behavior change.
5. **Cutover safety:** 4a = in-handler swaps (no registration change → no window). 4b = REPLACE-IN-PLACE in `serve()` in ONE commit (Inngest's PUT de-registers old + registers new atomically). Keep old factory code on disk; revert = flip `serve()` back. NEVER register old + new for the same logical job across two deploys.
6. **`getStores()` fallback:** DB error/empty → hardcoded 3 (safe during a DB blip); all-archived → `[]` (intentional). A DB blip can momentarily drop a 4th store for one tick; self-heals next tick. Acceptable + documented.

### Cron inventory (grounding-verified)
| Cron | Pattern today | 4a/4b | Change |
|---|---|---|---|
| `cronTickOrchestrator` (*/10) | single fn, iterates `STORES` in handler | **4a** | `STORES` → `loadActiveStoreIds()` (runTickOnce + inline handler) |
| `cronCohortRefresh` (Mon 04:00) | single fn, `stores: STORES` param | **4a** | line 421 → `await loadActiveStoreIds()` |
| `cronOauthCanary` | single fn, inline `[...]` | **4a** | line 115 → `await loadActiveStoreIds()` |
| `cronDaily` (00:05) | **factory** `STORES.map(makeCronDaily)` (id `cron-daily-{store}`) | **4b** | fold → scheduler→worker |
| `cronLive` (*/10) | **factory** `STORES.map(makeCronLive)` (id `cron-live-{store}`) | **4b** | fold → scheduler→worker |
| `cronYesterdayRefresh` (every 2h, staggered) | **factory** `STORES.map(...)` (per-store CRON_STAGGER) | **4b** | fold → scheduler→worker (stagger via step.sleep) |
| `cronWhatsapp` | already data-driven (`summary.stores`) | — | NO CHANGE |
| `cronLiveHeavy` | disabled (`[]`) | — | NO CHANGE |

---

## Task 0: Correct the premise + audit local `StoreId` unions (read-only, no commit)

- [ ] **Step 1:** Confirm the research correction: `cronDaily.ts` factory `makeCronDaily` + `export const cronDailyFunctions = STORES.map(makeCronDaily)` ALREADY EXISTS (~lines 1796-1816) and is imported in `route.ts`. **Strike any task that "adds the missing cronDaily factory" — it is a no-op risk.**
- [ ] **Step 2:** Note each cron's local `type StoreId = typeof STORES[number]` (cronDaily:257, cronLive:134, cronYesterdayRefresh, cronCohortRefresh). The orchestrator imports `StoreId` from `@/lib/registries/types` (now `string` since Phase 2). When a cron's `STORES` becomes a runtime `string[]`, replace its local `StoreId` union usages with the widened `string` / imported `StoreId` — tsc will surface each site. Record them; fix at cutover.

---

# SUB-PHASE 4a — Runtime store enumeration in single-function crons (low risk, ships first)

## Task 1: Same-fan-out equality test (the guard the whole phase rests on)

**Files:** Create `dashboard-web/src/lib/registries/__tests__/phase4FanOutEquality.test.ts`. (Mirror the harness in the existing `priorityBuilder.test.ts` / `cronTickOrchestrator.test.ts`.)

`buildEvents` (`src/lib/registries/priorityBuilder.ts`) is a PURE function taking `{ stores, freshness, metaBucStateByStore, googleBucStateByStore, tiktokBucStateByStore, tickId, nowMs }` and returning `{name, id, data}[]` — the oracle, no Inngest needed.

- [ ] **Step 1: Write the test:**
```ts
import { describe, it, expect } from 'vitest';
import { buildEvents } from '@/lib/registries/priorityBuilder';
import type { StoreId } from '@/lib/registries/types';

const baseArgs = () => ({
  freshness: [] as Parameters<typeof buildEvents>[0]['freshness'],
  metaBucStateByStore: {
    uzoshop: { pct: 5, etaMinutes: 0 }, zolplus: { pct: 5, etaMinutes: 0 }, usmile360: { pct: 0, etaMinutes: 0 },
  },
  googleBucStateByStore: {},
  tiktokBucStateByStore: {},
  tickId: '2026-06-07T12:00',
  nowMs: new Date('2026-06-07T12:00:42Z').getTime(),
});

describe('Phase 4 fan-out equality (DB store list == hardcoded for the 3)', () => {
  it('DB-loop store list produces byte-identical fan-out to the hardcoded 3', () => {
    const HARDCODED = ['uzoshop', 'zolplus', 'usmile360'] as StoreId[];
    const FROM_DB = ['uzoshop', 'zolplus', 'usmile360'] as StoreId[]; // simulate loadActiveStoreIds()
    expect(buildEvents({ stores: FROM_DB, ...baseArgs() })).toEqual(buildEvents({ stores: HARDCODED, ...baseArgs() }));
  });
  it('emits 18 events for the 3 stores when all stale + low BUC (3×3×2)', () => {
    const out = buildEvents({ stores: ['uzoshop', 'zolplus', 'usmile360'] as StoreId[], ...baseArgs() });
    expect(out).toHaveLength(18);
    const tuples = out.map((e) => `${(e.data as { store_id: string }).store_id}:${e.name}:${(e.data as { scope: string }).scope}`).sort();
    expect(tuples).toEqual([
      'usmile360:google/job.requested:hot_metrics', 'usmile360:google/job.requested:status',
      'usmile360:meta/job.requested:hot_metrics', 'usmile360:meta/job.requested:status',
      'usmile360:tiktok/job.requested:hot_metrics', 'usmile360:tiktok/job.requested:status',
      'uzoshop:google/job.requested:hot_metrics', 'uzoshop:google/job.requested:status',
      'uzoshop:meta/job.requested:hot_metrics', 'uzoshop:meta/job.requested:status',
      'uzoshop:tiktok/job.requested:hot_metrics', 'uzoshop:tiktok/job.requested:status',
      'zolplus:google/job.requested:hot_metrics', 'zolplus:google/job.requested:status',
      'zolplus:meta/job.requested:hot_metrics', 'zolplus:meta/job.requested:status',
      'zolplus:tiktok/job.requested:hot_metrics', 'zolplus:tiktok/job.requested:status',
    ]);
  });
  it('4th store adds exactly 6 events (no-deploy extensibility), all newstore:*', () => {
    const out = buildEvents({ stores: ['uzoshop', 'zolplus', 'usmile360', 'newstore'] as StoreId[], ...baseArgs(),
      metaBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 }, zolplus: { pct: 5, etaMinutes: 0 }, usmile360: { pct: 0, etaMinutes: 0 }, newstore: { pct: 0, etaMinutes: 0 } } });
    expect(out).toHaveLength(24);
    expect(out.filter((e) => (e.data as { store_id: string }).store_id === 'newstore')).toHaveLength(6);
  });
});
```
- [ ] **Step 2: Run it.** `cd dashboard-web && npx vitest run src/lib/registries/__tests__/phase4FanOutEquality.test.ts`. It should PASS immediately (buildEvents is already store-list-driven). **Adjust the exact event NAMES/tuple strings to match the real `buildEvents` output** if they differ (read the function first; the grounding reported `${platform}/job.requested` + `scope` in `data`). If the 18/24 counts differ, reconcile with the real BUC skip-layers (set BUC pct low + freshness empty so nothing is skipped). This test is the equivalence guard — it must reflect reality, then stay green through T2.
- [ ] **Step 3: Commit.** `git add` the test; `git commit -m "test(crons): Phase 4 fan-out equality guard (DB list == hardcoded 3) (Phase 4a)"` (+ trailing blank line + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` on every commit).

---

## Task 2: `cronTickOrchestrator` → `loadActiveStoreIds()` (the headline change)

**Files:** `dashboard-web/src/inngest/functions/cronTickOrchestrator.ts`. Test: extend `cronTickOrchestrator.test.ts`.

Current: `const STORES: StoreId[] = ['uzoshop','zolplus','usmile360'];` (line 17) used in `runTickOnce` (`buildEvents({ stores: STORES, ... })` line 41) AND in the cron handler's `compute-events` step.run (`buildEvents({ stores: STORES, ... })` line 82). Both must become runtime DB reads.

- [ ] **Step 1: Make `runTickOnce` take an injectable `loadStores` dep** (for testability) defaulting to `loadActiveStoreIds`. Add to the input type: `loadStores: () => Promise<string[]>`. Inside, `const stores = await loadStores();` and pass `stores` to `buildEvents` instead of `STORES`. Import `loadActiveStoreIds` from `@/lib/getStores`.
- [ ] **Step 2: In the cron handler's `compute-events` step.run**, replace `stores: STORES` (line 82) with a runtime read: add `const stores = await loadActiveStoreIds();` inside the step (before `buildEvents`) and pass `stores`. (The step.run is async — safe.) Keep `step.sendEvent` at the outer level exactly as-is (the nested-step rule).
- [ ] **Step 3: Delete the module-level `const STORES`** once both usages are gone (or keep ONLY if something else references it — grep first; the grounding shows only these two sites).
- [ ] **Step 4: Test** — in `cronTickOrchestrator.test.ts`, call `runTickOnce` with `loadStores: async () => ['uzoshop','zolplus','usmile360']` and assert `fanOutCount === 18` (unchanged); add a case `loadStores: async () => ['uzoshop','zolplus','usmile360','newstore']` (+ a buc entry for newstore) → asserts the 4th store fans out (24). Mock sendEvent/upsertSnapshot/loadFreshness/loadMetaBuc as the existing tests do.
- [ ] **Step 5: Run** the orchestrator tests + the T1 equality test → green. `npx tsc --noEmit` → 0 (fix any local `StoreId` collapse).
- [ ] **Step 6: Commit.** `git commit -m "feat(crons): orchestrator enumerates stores via loadActiveStoreIds (Phase 4a)"`.

---

## Task 3: `cronCohortRefresh` → `loadActiveStoreIds()`

**Files:** `dashboard-web/src/inngest/functions/cronCohortRefresh.ts` (STORES const line 80; `stores: STORES` at the `runCohortRefreshStepped({ stores: STORES, ... })` call ~line 421). Test: extend the cohort test if present.

- [ ] **Step 1:** In the cron handler (`cronCohortRefresh` createFunction, ~line 407-446), resolve the store list at runtime: replace `stores: STORES` with `stores: await loadActiveStoreIds()`. Resolve it before the `runCohortRefreshStepped` call (or in an early `step.run('load-stores', () => loadActiveStoreIds())` for durability). `runCohortRefreshStepped` already takes `stores: readonly string[]` and has per-store soft-fail — no signature change. Import `loadActiveStoreIds`. Remove the module-level `const STORES` if now unused (grep — line 358 comment references it; update the comment, the const may still be referenced only in comments).
- [ ] **Step 2: Test** — assert `runCohortRefreshStepped` is invoked with the DB list (mock `loadActiveStoreIds` → `['a','b']`, assert the stepped fn iterates both). If no cohort test harness exists, add a focused one mocking the deps.
- [ ] **Step 3: Run + tsc → green. Commit.** `git commit -m "feat(crons): cohort refresh enumerates stores via loadActiveStoreIds (Phase 4a)"`.

---

## Task 4: `cronOauthCanary` → `loadActiveStoreIds()`

**Files:** `dashboard-web/src/inngest/functions/cronOauthCanary.ts` (inline `(['uzoshop','zolplus','usmile360'] as const).map(...)` ~line 115; local `type CanaryStore` line 36).

- [ ] **Step 1:** Inside the handler, `const stores = await loadActiveStoreIds();` then `...stores.map((storeId) => ({ ... probe: () => fetchGoogleAdsSpendForDay(storeId, yesterday) ... }))`. Replace the inline array. The Meta/TikTok/Google probe entries that are hardcoded to `'uzoshop'` (lines 110, 126) stay as-is unless they should iterate (TikTok is uzoshop-only per `STORES_WITH_TIKTOK_IDS` — keep the comment). Adjust the `CanaryStore` type to `string` where the runtime list flows in (tsc will show it). Import `loadActiveStoreIds`.
- [ ] **Step 2:** Light test or rely on tsc (canary is non-critical, no double-run risk). If a canary test exists, update it.
- [ ] **Step 3: Run + tsc → green. Commit.** `git commit -m "feat(crons): oauth canary enumerates stores via loadActiveStoreIds (Phase 4a)"`.

---

## Task 5: 4a gate, docs, ship + soak

- [ ] **Step 1: Full local gate.** `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green (esp. the T1 equality + orchestrator tests).
- [ ] **Step 2: Docs.** ARCHITECTURE — extend §45 (or a new sub-section): "Phase 4a — orchestrator/cohort/canary enumerate the active store list from the DB (`loadActiveStoreIds`) inside the handler; the per-store factory crons (daily/live/yesterday) still register statically and move in 4b." The docs-currency gate's Arch rule fires (inngest/*.ts changed) → ARCHITECTURE.md must be in the push; no UX files → no User Manual needed.
- [ ] **Step 3: Commit docs. GATED push** (operator OK) — `git push origin main`.
- [ ] **Step 4: Post-deploy verify (production, per the no-localhost rule):** in the Inngest dashboard confirm `cron-tick-orchestrator` still fires every 10 min and its fan_out reflects `loadActiveStoreIds` (18 for the 3 stores); confirm NO function ids/triggers changed (4a is in-handler only). Check `data_freshness` stays green over one tick cycle. **Soak ≥ a few tick cycles before starting 4b.**

---

# SUB-PHASE 4b — Fold the per-store factory crons to scheduler→worker (after 4a soaks)

> The canonical Inngest shape (already proven by orchestrator→metaWorker). One static-trigger **scheduler** per family loads stores at runtime and `step.sendEvent`s one event per store; one registered **worker** (concurrency keyed by store) runs the per-store work. Adding a store = a new `stores` row; next schedule enumerates it; zero deploy.

## Task 6: Async DB-aware Decision-7 gates (inert now, Phase-6-activated)

**Files:** `dashboard-web/src/lib/fetchers/tiktokAccountConfig.ts` (`isTikTokConfiguredForStore`), `googleAccountConfig.ts` (`isGoogleConfiguredForStore`); the workers `tiktokWorker.ts` (call sites ~386, ~568; injection seam `input.isTikTokConfigured` ~243, default ~303), `googleWorker.ts` (~244, ~409; seam ~142, default ~178). Tests alongside.

- [ ] **Step 1: READ** the sync gates + the worker injection seams + the 4 call sites (`checkTikTokConfigured`/`checkGoogleConfigured` → if false, `recAllStatusScopes('success'); return;`). Confirm the workers already accept `input.isTikTokConfigured?` / `input.isGoogleConfigured?` with sync defaults.
- [ ] **Step 2: Write failing tests** — a store whose creds are ONLY in `store_secrets` (mock `getStoreSecret` → present, `process.env` → absent) is reported CONFIGURED by the new async gate (so the worker does NOT skip + falsely record success). And an env-cred store stays configured (no regression). For TikTok, honor `TIKTOK_SHARED_STORES` (uzoshop+usmile360 share one advertiser account — configured if the store maps to a configured shared account).
- [ ] **Step 3: Implement** `isTikTokConfiguredForStoreAsync(storeId)` / `isGoogleConfiguredForStoreAsync(storeId)`: try `getStoreSecret(storeId,'TIKTOK_ADVERTISER_ID')`/`getStoreSecret(storeId,'GOOGLEADS_CUSTOMER_ID')`, fall back to the existing sync env check (matching the Phase-3 dual-read). Make `checkTikTokConfigured`/`checkGoogleConfigured` async, `await` at the 4 worker call sites, default the injected gate to the async DB-aware impl. **Inert today** (env creds present → same result); the dual-read means no behavior change for the 3 stores.
- [ ] **Step 4: Run worker + fetcher suites + tsc → green. Commit.** `git commit -m "feat(crons): DB-aware TikTok/Google configured-gates behind worker injection seam (Phase 4b; activated Phase 6)"`.

---

## Task 7: Pure `planStoreJobs(stores)` seam + factory same-fan-out test

**Files:** Create `dashboard-web/src/lib/inngest/planStoreJobs.ts` + test. This is the oracle for the factory→scheduler equivalence (analogous to `buildEvents` for the orchestrator).

- [ ] **Step 1:** Implement a pure `planStoreJobs(stores: string[], opts): { storeId: string; eventName: string; data: {...}; id: string }[]` that returns, for a given store list, the exact set of per-store sync events a scheduler would emit for one family (daily/live/yesterday). Deterministic id per (family, store, date). Keep it Inngest-free + side-effect-free.
- [ ] **Step 2: Test** — `planStoreJobs(['uzoshop','zolplus','usmile360'])` deep-equals the job set the OLD factory would run (one per store, same handler args — storeId + date) for each family; a 4th store adds exactly one more job; deterministic ids stable.
- [ ] **Step 3: Run + tsc → green. Commit.** `git commit -m "feat(crons): pure planStoreJobs seam + factory fan-out equality test (Phase 4b)"`.

---

## Task 8: Implement scheduler→worker fold for daily / live / yesterday

**Files:** `cronDaily.ts`, `cronLive.ts`, `cronYesterdayRefresh.ts` (add scheduler + worker; keep `runDailyForStore`/`runLiveForStore` handlers untouched — they're already store-agnostic). New event names e.g. `cron/daily.store.requested`, `cron/live.store.requested`, `cron/yesterday.store.requested`.

- [ ] **Step 1 (per family): Add a static-trigger SCHEDULER function** that keeps the family's existing cron trigger, loads stores at runtime, and emits one event per store via `planStoreJobs`:
```ts
export const cronDailyScheduler = inngest.createFunction(
  { id: 'cron-daily-scheduler', triggers: [{ cron: 'TZ=Asia/Jerusalem 5 0 * * *' }] },
  async ({ step }) => {
    const stores = await step.run('load-stores', () => loadActiveStoreIds());
    const jobs = planStoreJobs(stores, { family: 'daily', date: yesterdayJerusalem() });
    if (jobs.length > 0) await step.sendEvent('fan-out-daily', jobs.map(j => ({ name: j.eventName, id: j.id, data: j.data })));
    return { enqueued: jobs.length };
  },
);
```
- [ ] **Step 2 (per family): Add a single registered WORKER** keyed by store, calling the existing handler:
```ts
export const cronDailyWorker = inngest.createFunction(
  { id: 'cron-daily-worker', concurrency: [{ key: 'event.data.storeId', limit: 1 }], retries: 1 },
  { event: 'cron/daily.store.requested' },
  async ({ event, step }) => runDailyForStore(event.data.storeId, event.data.date, { step }),
);
```
- [ ] **Step 3 (cronLive):** same shape; worker calls `runLiveForStore(event.data.storeId, { step })`; scheduler keeps `*/10` trigger.
- [ ] **Step 4 (cronYesterdayRefresh):** scheduler keeps the every-2h trigger; reproduce the per-store **stagger** (was 15/20/25-min cron offsets) as `step.sleep(\`stagger-${i}\`, \`${i * 5}m\`)` between emits (or a per-event delay) to avoid hammering Meta's shared rate limit. Worker calls `runDailyForStore(storeId, yesterdayJerusalem(), {step})` with `concurrency key event.data.storeId`.
- [ ] **Step 5:** Replace each cron's local `type StoreId = typeof STORES[number]` with the widened `string`/imported `StoreId` (tsc surfaces). Keep the OLD `make*`/`*Functions` factory exports ON DISK (do not delete) for the revert lever.
- [ ] **Step 6: Tests** — each scheduler, with `loadActiveStoreIds` mocked to 3, emits the `planStoreJobs` set (3 events, right names/ids); with 4 stores → 4 events. Each worker invokes the right handler with `event.data`. Run + tsc → green.
- [ ] **Step 7: Commit.** `git commit -m "feat(crons): scheduler→worker fold for daily/live/yesterday (factory kept on disk for revert) (Phase 4b)"`.

---

## Task 9: Atomic registration cutover in `serve()`

**Files:** `dashboard-web/src/app/api/inngest/route.ts`.

- [ ] **Step 1:** In the `serve({ functions: [...] })` array, in ONE commit: REMOVE `...cronDailyFunctions`, `...cronLiveFunctions`, `...cronYesterdayRefreshFunctions` and ADD `cronDailyScheduler, cronDailyWorker, cronLiveScheduler, cronLiveWorker, cronYesterdayRefreshScheduler, cronYesterdayRefreshWorker`. (Inngest's PUT-on-deploy reconciles atomically — the old `cron-daily-{store}` etc. ids de-register in the SAME PUT that registers the new scheduler+worker ids → no overlap window.)
- [ ] **Step 2:** Confirm the new routes are reachable through the existing `isDashboardAuthAllowlisted` allowlist for `/api/inngest` (per [[inngest-allowlist-requirement]] — `/api/inngest` must be allowlisted so Inngest can sync). No new allowlist entry needed (the path is unchanged), but the new functions MUST be in `serve()` or Inngest won't register them.
- [ ] **Step 3:** `npx tsc --noEmit` + full suite → green. **Commit.** `git commit -m "feat(crons): atomic serve() cutover — factory crons → scheduler+worker (Phase 4b)"`.

---

## Task 10: 4b gate, ship + verify

- [ ] **Step 1: Full local gate** (unit + DOM + tsc + lint) green.
- [ ] **Step 2: GATED push** (operator OK) — `git push origin main`. (ARCHITECTURE.md is in this push for T11 → docs-currency Arch rule satisfied.)
- [ ] **Step 3: Post-deploy verify (production):** in the Inngest dashboard confirm the OLD ids `cron-daily-{store}` / `cron-live-{store}` / `cron-yesterday-refresh-{store}` are GONE and the new `*-scheduler` + `*-worker` ids are present. Watch the next `*/10` live tick + the next 00:05 daily: each store's job fires EXACTLY ONCE (no double, no miss). Spot-check `data_daily` for the affected dates has no double-counted spend (the idempotent agg RPC guarantees this, but verify). Re-run `npm run audit:reconcile` (prod) → parity unchanged.

---

## Task 11: Docs + revert lever

- [ ] **Step 1: ARCHITECTURE** — update the "cron dynamism deferred to Phase 4" note (§3446 area) to "DONE — orchestrator/cohort/canary enumerate the DB (4a); daily/live/yesterday folded to scheduler→worker (4b)." Document: the scheduler→worker shape, the atomic-cutover sequence, the **revert lever** (flip `serve()` back to `...cron*Functions` — the factory code is still on disk; idempotent persists make even a mid-window revert safe), and the **Phase-6 activation step** for the DB-aware gates (T6). State that adding a store now requires no deploy for ALL crons. Note the local `StoreId` unions were widened.
- [ ] **Step 2:** Commit (docs were pushed with T10; if separate, push gated). 

---

## Self-review

- **Spec coverage (P4):** cron factories → `loadActiveStoreIds()` DB-loop (4a orchestrator/cohort/canary in-handler; 4b daily/live/yesterday via scheduler→worker) ✅; "same fan-out" equality test (T1 buildEvents oracle + T7 planStoreJobs oracle) ✅; idempotent persist verified ✅; revert = flip serve() back (factory kept on disk) ✅. Operator chose full 4a+4b.
- **No placeholders:** 4a tasks give exact seams (orchestrator :17/:41/:82, cohort :421, canary :115, `loadActiveStoreIds` getStores.ts:54) + complete test code; 4b gives the concrete scheduler/worker pattern + the exact atomic-cutover sequence. Per-task implementers verify the precise lines (the grounding research had one error — T0 corrects it — so READ before edit).
- **Zero-regression:** 4a = in-handler only (no registration change → no double/missed-run); the equality test locks DB-list == hardcoded-3; getStores falls back to the 3 on DB blip. 4b = atomic PUT cutover + idempotent persists + revert lever; the DB-aware gates are inert (dual-read) until Phase 6.
- **Type consistency:** `loadActiveStoreIds(): Promise<string[]>`, `buildEvents({stores})`, `planStoreJobs(stores)`, `runDailyForStore(storeId,date,{step})`, `runLiveForStore(storeId,{step})`, the `cron/*.store.requested` event names + `concurrency key event.data.storeId` are consistent across tasks.
- **Open verifications for the implementer:** the exact `buildEvents` event names/tuples + the 18/24 counts (T1 — reconcile with the real BUC skip-layers); each cron's local `StoreId` union collapse sites (tsc); the worker injection-seam line numbers for the gates (T6); that `/api/inngest` stays allowlisted + the new functions are all in `serve()` (T9).
