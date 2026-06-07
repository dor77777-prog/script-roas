# Phase 6 — Store-Management UI (add / edit-creds / archive / restore / delete) Design

> Detailed design for **Phase 6** of the self-serve stores project (the operator-facing payoff). The umbrella feature spec is `2026-06-06-self-serve-store-management-design.md`; this refines Phase 6 against the reality shipped in Phases 1–5 (DB-backed store list, encrypted `store_secrets`, dynamic crons, RLS + service-role + fail-closed auth). Approved by the operator 2026-06-07.

## Goal
Let the operator **add a brand-new store, edit/rotate its credentials, archive, restore, and permanently delete stores — entirely from the dashboard `/operator` console, with NO Vercel env edits and NO code deploy.** A new store appears across the whole dashboard (home, campaigns, products, cohorts, payments, ad-state, WhatsApp) and enters every cron cycle automatically, exactly like the existing 3 — because Phases 1–5 already made the store list + secrets + crons DB-driven.

## Dominant constraint (unchanged): ZERO REGRESSION
The live 3-store dashboard keeps working identically. All Phase-6 writes are additive (new `stores`/`store_secrets`/`store_webhooks`/`store_ad_state` rows). Adding/archiving a store changes only the DB; the dashboard reflects it via the already-shipped `getStores()`/`loadActiveStoreIds()` seams. No change to the existing stores' data or behavior.

## Locked decisions (operator, 2026-06-07)
1. **Sub-phased: 6a (add-store + edit-creds) → 6b (archive / restore / delete + "חנויות שהוסרו" area).** 6a is the core payoff, shippable + testable alone; 6b is the lifecycle management.
2. **Live-verify every credential before saving** — the wizard calls each platform's API (a tiny probe) and shows ✓/✗ per platform; a bad/expired/under-scoped token is caught at entry, not later in the pipeline.
3. **Include edit/rotate creds for an existing store** — the same credential form, reachable from the store list, re-encrypts an updated token (fixes a `token-failure` alert from the UI instead of Vercel).
4. **TikTok = shared account by default** — a new store that advertises on TikTok uses the existing shared advertiser account (uzoshop's) via campaign-mapping (like usmile360 today): the wizard just sets `has_tiktok=true` and the store becomes a TikTok campaign-remap target. No per-store TikTok creds. (A separate per-store TikTok account is out of scope unless the model changes.)
5. **Delete is hard + confirm-token-gated** (type the store name); it wipes the store's config (`stores`/`store_secrets`/`store_webhooks`/`store_ad_state`) AND its data rows. **Archive** is the non-destructive default (data retained + tagged "הוסרה").

---

## Architecture

A new **"חנויות" (Stores) tab** in `/operator` (sibling to Sync/Health/Activity/Danger/מצב-פרסום), rendered by a `StoresTab` component. It shows: the active-store list (with edit/archive/delete actions + the "+ הוסף חנות" button) and the "חנויות שהוסרו" (archived) area. All mutations go through new `/api/operator/stores*` routes (behind the operator-secret + dashboard gates; secrets masked in responses per Phase 5).

### Data model — no new migrations needed
Everything already exists from Phases 1–3: `stores` (status/archived_at/brand_color/is_headless/has_tiktok/display_order/meta_ad_account_id/google_ads_customer_id), `store_secrets` (encrypted), `store_webhooks` (shop_domain/signing_secret/cart_public_token/allowed_origins/enabled), `store_ad_state`. Phase 6 only WRITES these via new routes.

### Credential model (per `secretsRegistry.ts`)
Per-store secret keys the wizard collects + encrypts to `store_secrets` (only for the platforms the store uses):
- **Shopify (always):** `SHOPIFY_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`.
- **Meta:** `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`.
- **Google:** `GOOGLEADS_CUSTOMER_ID`, `GOOGLEADS_REFRESH_TOKEN` (the global `GOOGLEADS_DEVELOPER_TOKEN`/`CLIENT_ID`/`CLIENT_SECRET` live under `__global__` and are shared — not re-collected).
- **TikTok:** none (shared account; `has_tiktok` flag only).

---

## 6a — Add-store wizard (+ edit-creds)

### Wizard (3 steps, in the "חנויות" tab)
**Step 1 · Store basics** — `storeId` (slug; lowercase `[a-z0-9_-]`; unique; **rejects reserved `__global__`** and any existing id); `storeName`; myshopify domain; `is_headless` toggle (themed vs headless/Lovable); `brand_color` (picker, default from `FALLBACK_PALETTE`); `display_order` (default = max+1); platform checkboxes (Meta / Google / TikTok).

**Step 2 · Credentials** (only the checked platforms; Shopify always) — paste fields per the credential model above. A **"בדוק" (Verify)** action calls `POST /api/operator/stores/verify-creds` which live-probes each platform server-side and returns `{platform: ok|fail, message}`; the UI shows ✓/✗ + the error. **Saving is blocked until all required platforms verify ✓** (operator can override with an explicit "save anyway" for edge cases). Verified values are sent to the add route, which **re-verifies server-side then encrypts to `store_secrets`** (never trusts the client's ✓). Secrets are write-only in responses (masked via `maskSecret`).

**Step 3 · Embed snippet + Shopify checklist** — the wizard generates the cart-tracking snippet with the store's freshly-minted `cart_public_token` pre-filled:
- **themed** → a Shopify **Custom Pixel** code block.
- **headless (Lovable)** → the fetch **beacon** snippet + the `roas-cart-event` edge-fn note.
Plus a copy-pasteable **checklist** of the irreducible operator steps (cannot be automated): create the Shopify custom app, grant scopes (`read_orders`, `read_products`, `read_customers`), register the order/refund webhook, paste the pixel/beacon. The route writes the `store_webhooks` row (shop_domain, signing_secret, cart_public_token, allowed_origins, enabled).

### On finish — `POST /api/operator/stores`
Server-side (service-role), in a fail-safe sequence: (1) validate (slug rules, uniqueness, reserved-id); (2) **re-verify each cred live** (reject on any failure — nothing written); (3) `encryptSecret` each cred → `store_secrets` rows; (4) insert the `stores` row (status=active, name, brand_color, is_headless, has_tiktok, display_order, meta_ad_account_id, google_ads_customer_id); (5) `store_webhooks` row; (6) `store_ad_state` defaults (on for the chosen platforms). On any step failure after partial writes, roll back the rows written so far (delete-by-store_id) so a failed add leaves no half-store. Returns the created store (secrets masked). The store then appears via `getStores()` and enters crons (Phase 4) on the next tick — **no deploy**.

### Edit-creds — `PATCH /api/operator/stores/[id]`
The same Step-2 form, opened from a store row. Live-verifies the new cred(s) then re-encrypts the changed `store_secrets` rows (UPSERT). Used for token rotation. Basics (name/color/order/headless/platforms) editable too.

---

## 6b — Lifecycle (archive / restore / delete)

- **Store list** (active) in the "חנויות" tab: each row shows name + brand color + platforms + status, with **edit · archive · delete** actions.
- **Archive — `POST /api/operator/stores/[id]/archive`:** sets `status='archived'`, `archived_at=now()`. The store drops from live surfaces + business totals/goal (getStores excludes archived by default — already shipped Phase 1/2) and from the cron loop (loadActiveStoreIds excludes archived — Phase 4). **Data retained**, queryable, tagged.
- **Restore — `POST /api/operator/stores/[id]/restore`:** sets `status='active'`, clears `archived_at`. Full restore, history intact.
- **Delete — `DELETE /api/operator/stores/[id]`:** **hard + irreversible**, gated by a **confirm-token** (the operator types the exact store name in the request, mirroring the reset route's `YES-DELETE-ALL-DATA` pattern). Wipes config (`stores`, `store_secrets`, `store_webhooks`, `store_ad_state`) AND the store's data rows (data_daily, products_daily, campaigns_daily, ads_daily, orders_attribution, registries, cohorts, etc. — all `WHERE store_id=`). 
- **"חנויות שהוסרו" area:** lists archived stores (tagged "הוסרה") with **restore** + **delete** actions. Keeps removed stores "not foreign to the dashboard" — their tagged data stays visible in this area.

---

## Components & routes (isolation)
- `app/operator/StoresTab.tsx` — the tab: active list + "+ הוסף חנות" + removed area.
- `components/operator/AddStoreWizard.tsx` — the 3-step wizard (also drives edit-creds via an `editStoreId` prop).
- `components/operator/StoreList.tsx` + `StoreRow.tsx` — active + archived rows with actions.
- `lib/storeSnippets.ts` — pure snippet generator (themed Custom Pixel / headless beacon) from `{storeId, cart_public_token, allowed_origins, is_headless}`.
- `lib/credVerifiers.ts` — per-platform live-probe functions (reuse the existing fetchers' auth paths) returning `{ok, message}`; used by both `verify-creds` and the add/patch routes.
- Routes under `app/api/operator/stores/`: `route.ts` (POST add, GET list), `verify-creds/route.ts` (POST), `[id]/route.ts` (PATCH edit, DELETE), `[id]/archive/route.ts`, `[id]/restore/route.ts`.

## Phase-5 carry-overs (enforced here)
- Reserved-id guard: the add route rejects `storeId === '__global__'` (and any `RESERVED_STORE_IDS`).
- `maskSecret` + `CLIENT_SAFE_SECRET_KEYS`: store routes NEVER echo a raw secret (only masked / status); the `ciSecretsAudit` CI test is extended to the new routes.
- Confirm-token on delete (typed store name).
- All new routes are `/api/operator/*` → behind the (now fail-closed) operator-secret + dashboard gates.

## Testing & guard strategy
- DOM tests: the wizard (3 steps, validation, ✓/✗ verify gating, edit mode); the store list + archive/restore/delete actions + confirm-token; the removed area.
- Route tests: add (validates, re-verifies, encrypts, writes 4 tables, rolls back on partial failure, masks secrets, rejects `__global__`/dup); verify-creds (✓/✗ per platform, no write); patch (re-verify + re-encrypt); archive/restore (status flip); delete (confirm-token required, wipes config + data).
- Pure unit: `storeSnippets` (themed vs headless output); `credVerifiers` (ok/fail per platform, mocked APIs).
- Extend `ciSecretsAudit` to the new routes (no secret echoed). Full suite + the existing no-regression anchors stay green; the live 3 stores byte-identical.

## Non-goals
Multi-tenant (accounts/login/tenant-isolation/RLS-policies/billing); auto-registering Shopify webhooks (operator does it — in the checklist); a per-store separate TikTok account (shared model stays); migrating Google's shared dev-token model; bulk import of stores.

## Risks & mitigations
- **Partial add (some rows written, then a failure)** → the add route rolls back by store_id; a failed add leaves no half-store. Live re-verify happens BEFORE any write where possible.
- **Bad creds saved** → live-verify (wizard + server) blocks it; edit-creds fixes it.
- **Accidental delete** → confirm-token (typed name) + archive is the default; delete is visibly separate + irreversible-labeled.
- **New store missed by a cron** → Phase 4 dynamic crons enumerate `loadActiveStoreIds()`; the new store joins on the next tick (verified Phase 4). The Decision-7 config gates (`isTikTok/isGoogleConfiguredForStore`) must read DB creds — the async DB-aware variants shipped in Phase 4b behind the worker injection seam; **activate + verify them as part of 6a** so a DB-only new store isn't skipped.
