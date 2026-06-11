# Self-Serve Stores — Phase 6b (archive / restore / delete + "חנויות שהוסרו") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add store lifecycle management to the `/operator` "חנויות" tab — **archive** (non-destructive, reversible), **restore**, and **delete** (hard, irreversible, heavily gated) — plus a **"חנויות שהוסרו"** (archived) area, completing the self-serve store project's operator surface.

**Architecture:** Three small operator routes (`[id]/archive`, `[id]/restore`, `[id] DELETE`) behind the operator-secret + dashboard gates, + UI actions on the existing StoreList/StoresTab. Archive/restore flip `stores.status` (already honored by `getStores`/`loadActiveStoreIds` from Phases 1/2/4 → archived stores auto-drop from live surfaces + crons, data retained). Delete wipes config + all store-scoped data rows, but ONLY for an already-archived store + a typed-name confirm-token.

**Tech Stack:** Next.js route handlers (`getSupabaseAdmin`), Vitest (node + jsdom), the existing operator UI primitives.

---

## LOCKED SAFETY DECISIONS (the "no data loss" mandate — operator to bless before T2/T3 delete)
1. **Archive is the default + fully reversible.** It only flips `status='archived'` + `archived_at` — NO data is touched; restore brings everything back byte-identical.
2. **Delete is gated by TWO independent guards:** (a) the store MUST already be `status='archived'` (you cannot delete a live store — you archive first, then delete from the removed-area; an active store → 409 "archive first"); (b) a **confirm-token**: the request must carry the EXACT store name, server-verified (mirrors the reset route's `YES-DELETE-ALL-DATA` typed-confirmation). Both must pass.
3. **Delete is exhaustive + FK-safe:** wipes EVERY store-scoped table (enumerated by grepping `store_id` across the schema), children before parents, by `store_id`. No orphans, no half-delete.
4. **The live 3 stores are untouchable by accident:** they're active (delete requires archived) AND deleting requires typing their exact name. Zero-regression: archive/restore of a NEW/other store never affects the 3.
5. **Delete UI is unmistakably destructive:** red, "פעולה בלתי-הפיכה", lists what will be wiped, only reachable from the "חנויות שהוסרו" area.

---

## Task 1: Archive + Restore routes
**Files:** Create `dashboard-web/src/app/api/operator/stores/[id]/archive/route.ts` + `[id]/restore/route.ts` + tests. Read first: `[id]/route.ts` (T8 — conventions, RESERVED_STORE_IDS guard, getSupabaseAdmin, captureRouteError), `lib/getStores.ts` (confirm `getStores`/`loadActiveStoreIds` already EXCLUDE `status='archived'` — they do per Phase 1/4; the routes rely on this).

- **POST `/[id]/archive`:** validate id exists (404) + not reserved (400); `UPDATE stores SET status='archived', archived_at=now() WHERE id=`. Idempotent (already-archived → 200 no-op). Return the updated store (masked/no secrets). 
- **POST `/[id]/restore`:** `UPDATE stores SET status='active', archived_at=null WHERE id=`. 404 if missing; idempotent.
- ZERO-REGRESSION: archiving drops the store from `getStores()` (home/totals/goal) + `loadActiveStoreIds()` (crons) automatically — add a test asserting an archived store is excluded by both, and restore re-includes it. Data rows are NOT touched by archive/restore.

- [ ] **Step 1: Failing tests** (`__tests__/route.test.ts` for each): archive flips status+archived_at (404 missing, reserved→400, idempotent); restore flips back; the getStores/loadActiveStoreIds exclude-archived assertion (mock the stores table). Run → RED.
- [ ] **Step 2: Implement** both routes. Run → GREEN. tsc 0; lint clean.
- [ ] **Step 3: Commit** `feat(stores): archive + restore routes ([id]/archive, [id]/restore) — status flip, data retained (Phase 6b T1)`

## Task 2: Delete route (hard, double-gated)
**Files:** Extend `dashboard-web/src/app/api/operator/stores/[id]/route.ts` with a `DELETE` handler + tests. Read first: the reset route (`app/api/operator/reset/route.ts`) for the confirm-token pattern; **grep `supabase/migrations` for every table with a `store_id` column** to build the exhaustive wipe list.

- **DELETE `/[id]`** body `{ confirmName: string }`:
  1. Validate id exists (404) + not reserved (400).
  2. **Guard A:** the store MUST be `status='archived'` — else **409** `{error:'archive the store before deleting'}`.
  3. **Guard B (confirm-token):** `confirmName` must EXACTLY equal the store's `name` — else **400** `{error:'confirmation name does not match'}`. (Constant-time compare not required — it's a name, not a secret — but exact match.)
  4. **Wipe (FK-safe, children→parents, all by `store_id`):** the enumerated store-scoped data tables FIRST (data_daily, products_daily, campaigns_daily, ads_daily, orders_attribution, campaign_registry, adset_registry, ad_registry, customer_cohort_monthly, customer_first_order, store_events, data_freshness, meta_buc_usage, campaign_status_events, + ANY other table the grep finds with store_id), then config (store_ad_state, store_webhooks, store_secrets), then `stores` LAST (FK parent). Use the grep result as the source of truth — do NOT hardcode a stale list; the test asserts every store_id table is covered.
  5. Return 200 `{ ok, deleted: storeId, tablesWiped: [...] }` (NEVER echo a secret).
- Best-effort cleanup with logging: if a table delete errors, capture + continue the rest (so a partial delete still removes as much as possible), then report which failed. (Unlike add-rollback, delete is "remove everything"; a failed table is logged, not rolled back.)

- [ ] **Step 1: Failing tests:** active store → 409 (archive-first guard); archived store with WRONG confirmName → 400 (no delete); archived + correct confirmName → deletes from EVERY store_id table (assert each table's delete was called by store_id) + stores last; reserved id → 400; missing → 404; no secret in response. A guard test: the wipe list == the set of store_id tables in the schema (so a future table can't be silently missed). Run → RED.
- [ ] **Step 2: Implement** the DELETE handler. Run → GREEN. tsc 0; lint clean.
- [ ] **Step 3: Commit** `feat(stores): DELETE store route — archived-only + typed-name confirm + exhaustive FK-safe wipe (Phase 6b T2)`

## Task 3: UI — archive/delete actions + "חנויות שהוסרו" area
**Files:** Modify `dashboard-web/src/components/operator/StoreRow.tsx` + `StoreList.tsx` + `dashboard-web/src/app/operator/StoresTab.tsx` + a new confirm-delete modal component + DOM tests. Read first: the current StoreList/StoreRow (T6) + StoresTab (T7) + the credential matrix (the fix-batch) + the project's modal/Sheet primitive (per the "modal-over-Sheet must be Radix" rule — use the Sheet/Dialog primitive, never a hand-rolled overlay).

- **StoreRow (active):** add an **"העבר לארכיון"** (archive) action (calls `onArchive(storeId)`). NO delete on active rows (delete is removed-area only — safety decision #2/#5).
- **StoresTab:** add a **"חנויות שהוסרו"** (archived) section below the active list — lists archived stores (from the GET list, `status==='archived'`, tagged "הוסרה") with **"שחזר"** (restore) + **"מחק לצמיתות"** (delete) actions. (The GET list already returns archived via `includeArchived` — confirm StoreList currently filters to active; the removed-area renders the archived ones.)
- **Delete confirm modal** (Radix Dialog/Sheet primitive): destructive styling (red), "פעולה בלתי-הפיכה — כל הנתונים של החנות יימחקו", an input where the operator types the store's EXACT name, "מחק" disabled until the typed name matches; on confirm → DELETE `/[id]` with `{confirmName}`; on success → close + re-fetch.
- Wire `onArchive`/`onRestore`/`onDelete` in StoresTab → the routes via operatorFetch → re-fetch the list on success. NO info loss (active list + removed-area both visible).

- [ ] **Step 1: Failing DOM tests:** StoreRow archive action calls onArchive; the removed-area renders archived stores with restore+delete; the delete modal requires the exact typed name (מחק disabled until match) then calls DELETE with confirmName; restore calls restore; success re-fetches. Run → RED.
- [ ] **Step 2: Implement** (Radix modal; token-only, light+dark, RTL, a11y; destructive styling via status tokens). Run → GREEN. tsc 0; `npm run test:components` green; design-color + a11y guards clean.
- [ ] **Step 3: Commit** `feat(stores): archive/restore/delete UI + "חנויות שהוסרו" area + typed-name delete modal (Phase 6b T3)`

## Task 4: Audit + docs + gate
**Files:** `app/api/__tests__/ciSecretsAudit.test.ts` (add archive/restore/delete to COVERED) + `docs/ROAS-Dashboard-User-Manual.md` (the lifecycle UX) + `docs/ARCHITECTURE.md` (§ next — the lifecycle routes + the delete guards + the wipe list).

- [ ] **Step 1:** Extend ciSecretsAudit to the 3 new routes (no secret echoed). 
- [ ] **Step 2:** User Manual (archive/restore/delete + the removed-area + the typed-name confirm; archive=safe/reversible, delete=irreversible) + version bump; ARCHITECTURE § (routes + double-gate + exhaustive wipe). 
- [ ] **Step 3: Full gate** — `npm test && npm run test:components && npx tsc --noEmit && npm run lint` green; no-regression anchors + the live 3 stores byte-identical (they're active → untouched by archive/delete).
- [ ] **Step 4: Commit** `feat(stores): Phase 6b audit coverage + docs + full gate (lifecycle)` ; then a final adversarial review before the (operator-gated) push.

---

## Self-review
- **Spec coverage:** archive (T1) · restore (T1) · delete (T2) · removed-area (T3) · confirm-token (T2/T3) · audit+docs (T4). All §6b items mapped.
- **Safety:** delete is double-gated (archived-only + typed name), removed-area-only, exhaustive+FK-safe, destructive UI. Archive is reversible/data-retained. The live 3 (active) can't be deleted accidentally.
- **Zero-regression:** archive/restore only flip status (getStores/loadActiveStoreIds already exclude archived — Phases 1/4); no data touched; the 3 stores untouched.
- **No placeholders:** routes give the exact sequence + guards; the wipe list is grep-derived (not a stale hardcode); UI gives behaviors + the Radix-modal rule + tests.
- **Open for operator blessing:** the delete's archived-only gate + the exhaustive data wipe (it IS real, irreversible data loss for that store — intended, per the spec, but confirm before T2/T3 ship).
