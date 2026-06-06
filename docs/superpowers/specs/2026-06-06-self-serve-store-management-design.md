# Self-Serve Store Management (Option C) — Design Spec

**Date:** 2026-06-06
**Status:** Approved (design) — ready for implementation-plan authoring.
**Author:** brainstorming session (grounded in two read-only mapping Workflows: store-onboarding surface + C-feasibility/safe-migration).

---

## Goal

Let the operator **add, archive, restore, and permanently delete stores entirely from the dashboard UI** — with **no Vercel env edits and no per-store code deploy** — so a new store appears fully across the dashboard exactly like the existing ones, and a removed store either keeps its (tagged) data or is wiped. This is also the architectural **foundation** for a future multi-tenant project (which is explicitly NOT built here).

## The dominant constraint — ZERO REGRESSION

> The live 3-store dashboard (uzoshop, zolplus, usmile360) must keep working **identically** throughout the entire migration — zero downtime, zero behavior change until each new path is verified.

This is the highest-priority non-functional requirement. It is satisfied by one principle applied everywhere:

**Every change is dual-read / fallback / additive.** The system keeps reading the OLD source (hardcoded store lists, Vercel env secrets) and only ADDS a new source (the DB) that is preferred when present and verified. The old source remains the FALLBACK. The hardcoded lists and the per-store Vercel env vars are removed **LAST** (final phase), only after 1+ week of verified stable operation. Each phase is independently deployable, reversible, and guarded.

---

## Locked decisions

1. **Option C** — full self-serve: store config + secrets live in the DB; crons are dynamic (DB-loop); no Vercel/deploy per store.
2. **Secrets in the DB, encrypted** — app-level AES-256-GCM (Web Crypto, Edge-safe). ONE master key in Vercel env (`ENCRYPTION_MASTER_KEY`). Per-store secrets move from Vercel env → an encrypted `store_secrets` table, read at runtime via `getStoreSecret()` with **DB → env fallback**. Secrets are **never** returned by any API (server-only; admin routes mask them).
3. **Data-driven store list** — a single `getStores()` reads active stores from the `stores` table, with the current hardcoded list as fallback. Consolidates the ~11 hardcoded `STORES` lists + ~8 component display-name maps. `StoreId` union → `string` (types only; no runtime change).
4. **Dynamic crons** — the per-store Inngest factories (cronDaily / cronLive / cronYesterdayRefresh / cronCohortRefresh) become a single generic loop over `loadActiveStores()` (DB) at run time, so a new store is picked up on the next tick with no deploy. (`cronTickOrchestrator` already proves the runtime fan-out pattern.)
5. **Auth hardening** — once secrets live in the DB, the operator-secret gate becomes **mandatory** (not optional), and encryption is defense-in-depth (a DB/anon read can't decrypt without the master key). Reversible rollout (no lockout).
6. **Store lifecycle:** `active → archived (reversible, data retained + tagged) → re-activate (full restore, history intact)`; plus `delete` (hard, irreversible, confirm-token). Archived stores live in a separate **"חנויות שהוסרו"** area; excluded from live surfaces + business totals/goal; data retained and queryable, tagged with the store name + "הוסרה".
7. **Responsive layout for N stores** — the home per-store-cards grid (currently `md:grid-cols-3`) becomes responsive to the store count (auto-fit). All other per-store surfaces already `map` over the store list and reflow for free. The only fixed-count external constraint is the WhatsApp Meta template (3 slots) — handled by a rule (below).
8. **Irreducible operator steps (any model):** Shopify custom app + scopes (`read_orders`, `read_products`, `read_customers`) + webhook registration + pasting the cart pixel/beacon snippet. The wizard generates the exact snippet (token pre-filled). These cannot be done remotely.
9. **Multi-tenant is OUT of scope** — C is the foundation; true multi-tenant (multiple accounts, login, tenant isolation/RLS, billing) is a separate future project.

---

## Architecture

### Data model (additive migrations)
- `stores` (existing) gains: `status TEXT NOT NULL DEFAULT 'active'` (`active`|`archived`), `archived_at TIMESTAMPTZ`, `brand_color TEXT`, `is_headless BOOLEAN DEFAULT FALSE`, `has_tiktok BOOLEAN DEFAULT FALSE`, `display_order INT`. (meta_ad_account_id / google_ads_customer_id already exist.)
- `store_secrets` (new): `(store_id TEXT, secret_key TEXT, ciphertext TEXT, iv TEXT, tag TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (store_id, secret_key))`. **anon: NO grant** (encrypted + ungranted = two walls). Writes via service-role only.
- `store_webhooks` (existing): `shop_domain`, `signing_secret`, `cart_public_token`, `allowed_origins`, `enabled`.

### Core seams (single source of truth, dual-read)
- `lib/getStores.ts` → `getStores()`: active stores from DB `{storeId, storeName, brandColor, isHeadless, hasTikTok, status}[]`, **fallback** to the hardcoded 3 if the read fails/empty. Used by every store-list site.
- `lib/secretsEncryption.ts` → `encryptSecret()/decryptSecret()` (AES-256-GCM, master key from env; throws on missing key / bad tag; never logs plaintext).
- `lib/storeSecretsReader.ts` → `getStoreSecret(storeId, key)`: DB `store_secrets` (decrypt) → `process.env` fallback → null. Logs when it falls back (so the operator sees migration progress).
- `lib/inngest/loadStores.ts` → `loadActiveStores()`: the cron-side DB store list (fallback to hardcoded).

### Credential read points refactored to `getStoreSecret` (research-confirmed)
`lib/fetchers/shopifyAuth.ts` (3 secrets), `meta.ts` + `metaAccountConfig.ts` (2 + global fallback), `tiktok.ts` (2), `googleAds.ts` (4 global + 2 per-store). Each keeps its **exact current error messages** (env-var NAME, never value) and its missing/bad-secret degradation behavior.

### Auth
`middleware.ts` + `middlewareHelpers.ts` make the operator-secret **mandatory** for the app (currently optional). Secrets never echoed by any route (admin store routes return masked values). Careful rollout to avoid lockout (the dashboard-password cookie path stays; revert is a one-line middleware change).

---

## Phased build (each phase deployable + reversible + zero-regression-guarded)

| Phase | What ships | Behavior change? | Guard / rollback |
|---|---|---|---|
| **P1 — Foundations** | migrations (stores columns + `store_secrets`); `secretsEncryption`, `getStoreSecret` (DB→env), `getStores` (DB→hardcoded), `loadActiveStores`. Nothing consumes the new path yet. | **None** | unit tests for encrypt round-trip + dual-read fallback; revert = drop migrations |
| **P2 — Data-driven cutover** | point the ~11 lists + ~8 maps + cron factories at `getStores()`/`loadActiveStores()` (fallback intact); `StoreId`→`string`; responsive home grid | **None** (DB seeded == hardcoded) | **equality test: `getStores()` ⊇ the 3 with identical name/color/order**; full suite; reconcile harness; revert = flip back to hardcoded |
| **P3 — Secrets backfill** | encrypt + backfill the 3 stores' secrets into `store_secrets`; verify each store's Meta/Google/TikTok/Shopify fetch succeeds reading from DB | **None** (env still fallback) | per-store fetch smoke test from DB; revert = delete `store_secrets` rows (env fallback resumes) |
| **P4 — Dynamic crons** | cron factories → `loadActiveStores()` DB-loop; run with no double-run | **None** (same work enqueued) | "same fan-out" test (DB-loop enqueues identical jobs to the old factory for the 3); idempotent persist (`ON CONFLICT`); revert = flip back to factory |
| **P5 — Auth hardening** | operator-secret mandatory; secrets-never-echoed assertions | gate becomes required | careful rollout + status-pill GREEN check; revert = make optional again |
| **P6 — UI** | Add-store wizard (writes stores + encrypted `store_secrets` + `store_webhooks` + `store_ad_state`; generates snippet + Shopify checklist) · Archive · Restore · Delete (confirm-token) · "חנויות שהוסרו" area | adds capability | DOM tests; confirm-token on delete; archive excludes from live + totals |
| **P7 — Cleanup (LAST)** | remove the hardcoded store lists; **operator removes the per-store Vercel env vars**; `getStoreSecret` becomes DB-only | env reliance ends | only after 1+ week stable; the equality/fetch guards must be green; this is the one less-reversible step |

> Phases 1–4 establish the foundation with a graceful fallback at every step (zero breakage). Phase 6 (the wizard/UI) is the operator-facing payoff. Phase 7 is deferred until everything is proven in production.

---

## Responsive / N-store details
- **Home per-store cards** (`PerStoreRow.tsx` `md:grid-cols-3`) → responsive (auto-fit / count-aware: 2→2-up, 3→3-up, 4→2×2 or 4-up, 5+→flowing). Mobile carousel already dynamic.
- **Store colors** → `stores.brand_color` (operator-chosen in the wizard) with the existing `FALLBACK_PALETTE` for any extra store.
- **Already dynamic (map over the list, reflow for free):** comparative table, monthly tables, DetailTable, campaigns, products, customers/cohorts, payments, the ads-off "מצב פרסום" matrix, the store filter/pills.
- **WhatsApp daily report** — Meta templates are fixed-slot (3 stores). Rule: ≤3 → as today; **4+** → show the business totals + top-3 stores by revenue + a "+N נוספות בדשבורד" line. A larger Meta template can be submitted later if 4+ becomes permanent.
- **TikTok shared-account mapping dropdown** (`campaign-drawer`) → list active stores from `getStores()` so a new store appears as a remap target.

## What stays operator-side (irreducible)
Shopify custom app + scopes + webhook registration + pasting the cart pixel/beacon. The wizard generates the exact snippet with the store's `cart_public_token` pre-filled (themed → Shopify Custom Pixel; headless → Lovable fetch beacon + `roas-cart-event` edge-fn note).

## Testing & guard strategy
- Reuse the existing infra: vitest (node + dom), the reconcile/coverage-parity live harness, `designColorGuard`, the pre-push gate.
- New guards: encrypt round-trip; `getStoreSecret` dual-read; `getStores()` == hardcoded for the 3 (the no-regression anchor); cron "same fan-out" equality; archive-excludes-from-totals; delete confirm-token; secrets-never-in-API-response; responsive-grid DOM test at 2/4/5 stores.
- Every phase must keep the full suite green + the 3 existing stores byte-identical.

## Non-goals
Multi-tenant (auth accounts, tenant isolation/RLS, billing); a generic multi-platform plugin system; migrating Google's shared dev token model; auto-registering Shopify webhooks (operator does it — flagged in the wizard checklist).

## Key risks & mitigations
- **Secrets loss during backfill** → backfill in a transaction; verify all stores before removing any env var; env fallback stays until P7.
- **Empty/unreachable store list** → `getStores()` fallback to hardcoded 3; a deploy-time health check asserts `getStores().length ≥ 3`.
- **Cron double-run / missed-run** → ship the DB-loop alongside, verify identical fan-out, then cut over; persist is idempotent (`ON CONFLICT`).
- **Auth lockout** → reversible middleware; keep the dashboard-password path; roll out behind a check.
- **Secret in DB under URL-obscurity** → encryption (master key in env) is the second wall even if the DB/anon read leaks; `store_secrets` has no anon grant; mandatory operator-secret gate.
