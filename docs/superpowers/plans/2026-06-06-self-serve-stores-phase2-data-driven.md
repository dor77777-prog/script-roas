# Self-Serve Stores — Phase 2 (Data-Driven Cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Strict TDD: write the failing test, run it (confirm fail), implement, run (confirm pass), tsc+lint, commit.
> **(Rewritten 2026-06-07 to full standard — complete code per step, grounded in a dedicated cutover-site read.)**
> **DEPENDENCY:** Phase 1 is SHIPPED (migrations applied; `lib/getStores.ts` live). Phase 2 is safe even before/after anything — every cutover keeps the hardcoded map as fallback and `getStores()` falls back to the 3.

**Goal:** Make the **non-cron** store-list / display-name / color surfaces read from the Phase-1 `getStores()` source instead of the hardcoded maps + the `StoreId` union, and make the home per-store grid responsive — so the dashboard reflects whatever stores exist in the DB — with **ZERO regression** for the existing 3.

**Architecture:** ONE client mechanism — a small cached `GET /api/stores` route + a `useStores()` SWR hook (`fallbackData` = the hardcoded 3) consumed by every client component that needs the list (CampaignsTable, campaign-drawer incl. the TikTok dropdown, operator panels). Server route handlers (sync-now, backfill) call `await loadActiveStoreIds()` directly (async-safe). The hardcoded `STORE_ID_TO_NAME` / `STORE_COLORS` / `STORES_WITH_TIKTOK_IDS` maps stay as **fallbacks** (deleted only in Phase 7). The `StoreId` union widens to `string`. The home per-store grid becomes count-responsive.

**Tech Stack:** Next.js, Supabase, SWR, vitest (node + jsdom).

## Decisions locked by the 2026-06-07 cutover-site read
- **CRONS ARE DEFERRED to Phase 4.** Every cron `const STORES` is read at MODULE LOAD for Inngest factory registration (`STORES.map(makeFn)`) — which cannot use async `loadActiveStoreIds()`. The runtime-read ones (orchestrator `buildEvents`, cohort) are also left until Phase 4 so all cron dynamism lands together. **Phase 2 does NOT touch any cron file.**
- **Client mechanism = `/api/stores` + `useStores()`** (Option A), not `DashboardData.storeList` — because the campaign-drawer + operator panels have no `DashboardData` in scope, a hook is uniform for all of them (and CampaignsTable). One mechanism to test/reason about.
- **Fallbacks stay.** Hardcoded maps remain as the last-resort fallback in Phase 2 (removed in Phase 7). `getStores()` already falls back to the 3, and `useStores()` uses them as `fallbackData`.

---

## Task 1: `/api/stores` route + `useStores()` hook + the no-regression equality ANCHOR

**Files:** Create `dashboard-web/src/app/api/stores/route.ts`, `dashboard-web/src/lib/useStores.ts`; tests `dashboard-web/src/lib/__tests__/storesNoRegressionAnchor.test.ts` + `dashboard-web/src/app/api/stores/__tests__/route.test.ts`.

- [ ] **Step 1: Write the no-regression ANCHOR test FIRST** (this is the guard the whole phase rests on) — `dashboard-web/src/lib/__tests__/storesNoRegressionAnchor.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => ({ data: null as null | unknown[], error: null as null | { message: string } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }) }) }));
import { getStores } from '@/lib/getStores';
import { STORE_ID_TO_NAME, STORES_WITH_TIKTOK_IDS } from '@/lib/platformsByStore';
import { STORE_COLORS } from '@/lib/storeColors';

// The DB rows as seeded + backfilled by Phase 1 (migration 20260606170000).
const SEEDED = [
  { id: 'uzoshop',   name: 'uzoshop',   brand_color: 'var(--store-uzo)', is_headless: false, has_tiktok: true,  status: 'active', display_order: 1 },
  { id: 'zolplus',   name: 'Zol Plus',  brand_color: 'var(--store-3)',   is_headless: false, has_tiktok: false, status: 'active', display_order: 2 },
  { id: 'usmile360', name: '360usmile', brand_color: 'var(--store-usm)', is_headless: true,  has_tiktok: true,  status: 'active', display_order: 3 },
];
beforeEach(() => { db.data = SEEDED; db.error = null; });

describe('getStores — zero-regression equality anchor (DB == hardcoded for the 3)', () => {
  it('storeName matches STORE_ID_TO_NAME for each of the 3', async () => {
    for (const s of await getStores()) expect(s.storeName).toBe(STORE_ID_TO_NAME[s.storeId as keyof typeof STORE_ID_TO_NAME]);
  });
  it('brandColor matches STORE_COLORS (keyed by display name) for each of the 3', async () => {
    for (const s of await getStores()) expect(s.brandColor).toBe(STORE_COLORS[s.storeName]);
  });
  it('hasTikTok matches STORES_WITH_TIKTOK_IDS for each of the 3', async () => {
    for (const s of await getStores()) expect(s.hasTikTok).toBe(STORES_WITH_TIKTOK_IDS.has(s.storeId));
  });
});
```
- [ ] **Step 2: Run it.** `cd dashboard-web && npx vitest run src/lib/__tests__/storesNoRegressionAnchor.test.ts`. It should PASS against the shipped Phase-1 `getStores` (it asserts existing equivalence). If ANY assertion fails, the maps already diverge from the seed — STOP and report the mismatch (do not proceed; the anchor must hold before cutover).
- [ ] **Step 3: `/api/stores` route** — `dashboard-web/src/app/api/stores/route.ts`:
```ts
// dashboard-web/src/app/api/stores/route.ts
// Self-serve stores Phase 2 — the client store list (active stores, DB-backed
// with hardcoded fallback inside getStores). Cached like other config routes.
import { NextResponse } from 'next/server';
import { getStores } from '@/lib/getStores';
import { cacheControl } from '@/lib/cacheConfig';

export const runtime = 'nodejs';
export const revalidate = 60; // matches CACHE_CONFIG.stores

export async function GET(): Promise<NextResponse> {
  const stores = await getStores(); // never throws — internal fallback to the 3
  return NextResponse.json({ stores }, { headers: { 'Cache-Control': cacheControl('stores') } });
}
```
Add a `stores: { revalidate: 60, swr: 300 }` entry to `CACHE_CONFIG` in `lib/cacheConfig.ts` (next to `storeMeta`).
- [ ] **Step 4: `useStores()` hook** — `dashboard-web/src/lib/useStores.ts`:
```ts
// dashboard-web/src/lib/useStores.ts
// Client hook for the store list. SWR over /api/stores; fallbackData = the
// hardcoded 3 so first paint + any fetch failure is byte-identical to today.
'use client';
import useSWR from 'swr';
import type { StoreInfo } from '@/lib/getStores';

const FALLBACK: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1 },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2 },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3 },
];

const fetcher = (u: string) => fetch(u).then((r) => r.json()).then((j) => (j?.stores as StoreInfo[]) ?? FALLBACK);

export function useStores(): { stores: StoreInfo[] } {
  const { data } = useSWR<StoreInfo[]>('/api/stores', fetcher, { fallbackData: FALLBACK, revalidateOnFocus: false });
  return { stores: data && data.length ? data : FALLBACK };
}
```
- [ ] **Step 5: route test** (`app/api/stores/__tests__/route.test.ts`): mock `@/lib/getStores` → returns a known list; assert `GET()` returns `{ stores }`. Run → pass.
- [ ] **Step 6:** tsc + eslint clean. **Commit:** `feat(stores): /api/stores route + useStores hook + no-regression anchor (Phase 2)`.

---

## Task 2: Operator API routes (sync-now, backfill) → `loadActiveStoreIds()`

**Files:** `app/api/operator/sync-now/route.ts`, `app/api/operator/backfill/route.ts` + tests.

- [ ] **Step 1: READ** both routes. Current (both): `const ALL_STORES = ['uzoshop','zolplus','usmile360'] as const; const VALID_STORES = new Set<string>(ALL_STORES);` used to validate the POSTed store + (sync-now scope='all') to iterate.
- [ ] **Step 2: Failing test** — spy `loadActiveStoreIds` (from `@/lib/getStores`), POST to each route, assert the route awaited `loadActiveStoreIds()` and validated the requested store against its result. (Mirror the existing route test harness if present; else node test importing `POST`.)
- [ ] **Step 3: Implement** — in EACH route, remove the module-level `ALL_STORES`/`VALID_STORES` consts; `import { loadActiveStoreIds } from '@/lib/getStores';`; inside `POST`, `const activeStoreIds = await loadActiveStoreIds(); const valid = new Set(activeStoreIds);` and use `valid`/`activeStoreIds` where `VALID_STORES`/`ALL_STORES` were used. (Server handler is async — safe. No caching: archive/activate reflows on the next POST.)
- [ ] **Step 4:** run tests → pass; tsc + the route suites green. **Commit:** `feat(stores): operator sync-now + backfill use loadActiveStoreIds (Phase 2)`.

---

## Task 3: Operator panels → `useStores()`

**Files:** `components/operator/SyncNowButtons.tsx`, `BackfillPicker.tsx`, `ManualOverridesCrud.tsx` + DOM tests. (`TokenFailuresTable.tsx` — NO change; its `STORE_LABEL` is post-hoc display only.)

- [ ] **Step 1: READ** the three panels' hardcoded `STORES`/`ALL_STORES` consts + how they're used (option lists, default store).
- [ ] **Step 2: Failing DOM tests** — each panel, with `useStores()` mocked to the 3, renders the same store options as today; with a 4th store, it appears. (Mock `@/lib/useStores`.)
- [ ] **Step 3: Implement** — in each panel: `import { useStores } from '@/lib/useStores';` then inside the component `const { stores } = useStores(); const ALL_STORES = stores.map((s) => s.storeId);` (SyncNowButtons names its `STORES`). For `ManualOverridesCrud`'s default store, use `stores[0]?.storeId ?? 'uzoshop'`. Remove the module-level consts (the hook + getStores fallback cover the empty/loading case).
- [ ] **Step 4:** DOM tests → pass; tsc + eslint + designColorGuard green. **Commit:** `feat(stores): operator panels list stores via useStores (Phase 2)`.

---

## Task 4: CampaignsTable + campaign-drawer display names + the TikTok dropdown → `useStores()`

**Files:** `components/CampaignsTable.tsx`, `components/campaign-drawer/index.tsx` + DOM tests.

- [ ] **Step 1: READ** the hardcoded maps: `CampaignsTable.tsx` `STORE_DISPLAY_NAMES_MAP` (useMemo `{uzoshop:'uzoshop', zolplus:'Zol Plus', usmile360:'360usmile'}`), `campaign-drawer/index.tsx` `STORE_DISPLAY_NAMES_CONST` + the `<NativeSelect data-testid="drawer-store-select">` whose `<option>`s are HARDCODED (`691-735`).
- [ ] **Step 2: Failing DOM tests** — (a) CampaignsTable with `useStores()` mocked to the 3 → store names byte-identical to today; (b) the drawer's store dropdown lists the active stores from `useStores()` and **a 4th store appears as a remap option**; (c) with `useStores()` empty/loading the hardcoded fallback names still render (zero-regression).
- [ ] **Step 3: Implement**
  - CampaignsTable: `const { stores: storeList } = useStores();` then build `STORE_DISPLAY_NAMES_MAP` from `storeList` with the hardcoded 3 as fallback:
    ```ts
    const STORE_DISPLAY_NAMES_MAP: Record<string, string> = useMemo(() => {
      const m: Record<string, string> = {};
      for (const s of storeList) m[s.storeId] = s.storeName;
      if (!m.uzoshop) m.uzoshop = 'uzoshop';
      if (!m.zolplus) m.zolplus = 'Zol Plus';
      if (!m.usmile360) m.usmile360 = '360usmile';
      return m;
    }, [storeList]);
    ```
  - campaign-drawer: rename `STORE_DISPLAY_NAMES_CONST` → `..._FALLBACK`; inside the component `const { stores: storeList } = useStores();`; the display-name lookup builds a map from `storeList` then `?? FALLBACK[id] ?? summary?.storeName ?? id`; the dropdown `<option>`s map over `storeList` (keep the leading `<option value="__unmapped__">(לא ממופה · ברירת מחדל uzoshop)</option>`).
- [ ] **Step 4:** DOM tests → pass; tsc + eslint + designColorGuard green. **Commit:** `feat(stores): CampaignsTable + campaign-drawer (incl. TikTok dropdown) list stores via useStores (Phase 2)`.

---

## Task 5: `StoreId` union → `string`

**Files:** `lib/registries/types.ts` + any access-site needing a fallback (tsc surfaces them).

- [ ] **Step 1: Edit** `lib/registries/types.ts`: `export type StoreId = 'uzoshop' | 'zolplus' | 'usmile360';` → `export type StoreId = string;` (keep the name + add a comment: "widened for self-serve stores; runtime identity comes from getStores()").
- [ ] **Step 2: `npx tsc --noEmit`** — fix every site the compiler surfaces. Known ones: `Dashboard.tsx` `STORE_ID_TO_NAME[d.storeId as StoreId]` → add `?? d.storeId`; any `Record<StoreId, X>` that assumed exhaustiveness now needs a runtime guard / `?? fallback`. Keep `STORE_ID_TO_NAME`/`STORE_COLORS` as fallbacks (don't delete).
- [ ] **Step 3: Run the FULL unit + DOM suite** (the union touches many files) — all green. tsc clean. **Commit:** `refactor(stores): widen StoreId union to string (Phase 2)`.

> Note: the cron files (`cronDaily.ts`, `cronLive.ts`) each define a LOCAL `StoreId = typeof STORES[number]` — those are independent + stay as the literal-3 until Phase 4 (they're not the `registries/types` union). Leave them.

---

## Task 6: Responsive home per-store grid (2/3/4/5+ stores)

**Files:** `components/home/PerStoreRow.tsx` + `components/home/__tests__/PerStoreRow.dom.test.tsx`.

- [ ] **Step 1: READ** the desktop grid wrapper (~line 228: `'md:grid md:grid-cols-3 md:gap-4 md:overflow-visible'`) + the mobile carousel (kept identical).
- [ ] **Step 2: Failing DOM test** — render PerStoreRow with 2, 4, 5 stores; assert the desktop grid wrapper has the right column class/style for each count (2→`md:grid-cols-2`, 3→`md:grid-cols-3`, 4→`md:grid-cols-4` (or 2×2), 5+→an auto-fit inline style); 3 stores → unchanged (`md:grid-cols-3`). Mobile carousel markup unchanged.
- [ ] **Step 3: Implement** — compute the desktop grid class from `stores.length`: 1→`md:grid-cols-1`, 2→`md:grid-cols-2`, 3→`md:grid-cols-3`, 4→`md:grid-cols-4` (full Tailwind literals so JIT extracts them); for `>4` apply an inline `style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}` on md+ (Tailwind can't express arbitrary `repeat`). Keep the mobile `flex … overflow-x-auto` deck exactly as-is. Use `cn(...)` so the existing classes stay.
- [ ] **Step 4:** DOM tests → pass; the full `PerStoreRow.dom.test.tsx` green; tsc + designColorGuard green. **Commit:** `feat(stores): responsive per-store home grid for N stores (Phase 2)`.

---

## Task 7: Docs + full gate

**Files:** `docs/ARCHITECTURE.md` (§44) + `docs/ROAS-Dashboard-User-Manual.md` (only if operator-visible — Phase 2 is largely invisible; skip or 1-line).

- [ ] **Step 1: ARCHITECTURE §44** — "Self-serve stores Phase 2: data-driven cutover (non-cron)". Cover: `/api/stores` + `useStores()` as the client store-list mechanism; the operator routes using `loadActiveStoreIds()`; the display-name/color maps + the campaign-drawer TikTok dropdown now sourced from `useStores()` (hardcoded maps retained as fallback until Phase 7); `StoreId` widened to `string`; the responsive home grid; the no-regression equality anchor. State explicitly that **all cron store-list dynamism is DEFERRED to Phase 4** (factory registration is module-load/sync) and the **add-store UI is Phase 6**, so no half-state reaches the operator before crons are dynamic.
- [ ] **Step 2: Full local gate** — `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` — all green; the 3 stores byte-identical (the anchor + DOM tests prove it).
- [ ] **Step 3: Commit.** (Ship — `git push` — is GATED on operator OK.)

---

## Self-review
- **Spec coverage (P2 / non-cron):** client mechanism + anchor (T1) · operator routes (T2) · operator panels (T3) · CampaignsTable + drawer + TikTok dropdown (T4) · `StoreId`→string (T5) · responsive grid (T6) · docs/gate (T7). Crons explicitly DEFERRED to P4 (documented, untouched in P2) — this is the deliberate scope correction from the cutover-site read.
- **No placeholders:** every code-changing step shows the code or the exact transformation + the test code; the anchor test + route/hook code are complete; component edits give the exact useMemo/lookup bodies.
- **Zero-regression:** the equality anchor (T1) locks DB==hardcoded for the 3; every consumer keeps the hardcoded map as fallback; `useStores()` fallbackData = the 3; `getStores()` falls back to the 3; full suite + DOM byte-identical at each step.
- **Type/name consistency:** `getStores`/`loadActiveStoreIds`/`StoreInfo`/`useStores`/`/api/stores`/`STORE_ID_TO_NAME`/`STORE_COLORS`/`STORES_WITH_TIKTOK_IDS` identical across tasks.
- **Open verifications for the implementer:** (a) the exact `ALL_STORES`/`VALID_STORES` usage in each operator route (T2); (b) the exact campaign-drawer dropdown JSX to map over (T4); (c) every `StoreId`-narrowing site tsc surfaces (T5); (d) the exact PerStoreRow grid className + how `stores` is in scope there (T6).
