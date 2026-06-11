# Self-Serve Stores — Phase 6a (Add-Store Wizard + Edit-Creds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the operator add a brand-new store (and edit/rotate its creds) entirely from a new `/operator` "חנויות" tab — a 3-step wizard that live-verifies the platform tokens, encrypts them to `store_secrets`, writes `stores`/`store_webhooks`/`store_ad_state`, and generates the embed snippet — so the store appears across the dashboard and enters every cron cycle with NO deploy. A new Google store works fully (live + nightly).

**Architecture:** Pure cred-verifiers (`credVerifiers.ts`, probe each platform with injected creds — no DB) + a pure snippet generator (`storeSnippets.ts`) underpin a `POST /api/operator/stores` add route (validate → live re-verify → encrypt to `store_secrets` → insert 4 tables → rollback-on-partial-failure → return masked) and a `verify-creds` route (✓/✗, no write). UI: a `StoresTab` in `/operator` with `AddStoreWizard` (also drives edit-creds) + `StoreList`. The nightly Google short-circuit (`STORES_WITH_GOOGLE_ADS`) is made DB-aware so a new Google store gets nightly data too.

**Tech Stack:** Next.js (operator route handlers + client components), Supabase service-role (`getSupabaseAdmin`), `encryptSecret`/`maskSecret` (AES-256-GCM), Node `crypto.randomBytes`, Vitest (node + jsdom). Grounded by the 2026-06-07 Phase-6a workflow (4 agents); the cart contract, store_webhooks schema, fetcher probes, and tab wiring were verified against real code.

---

## Decisions locked (operator, 2026-06-07)
1. **Sub-phase 6a** = add-store + edit-creds; **6b** (archive/restore/delete + removed-area) is a separate later plan.
2. **Live-verify every cred before saving** (✓/✗ per platform); the add/patch route re-verifies server-side before any write.
3. **Edit/rotate creds** for an existing store (same form, PATCH route).
4. **TikTok = shared account** — a new store sets `has_tiktok=true` only; NO TikTok creds, NO TikTok probe (it becomes a campaign-remap target like usmile360; remap happens later in the CampaignDrawer — the wizard states this).
5. **Google nightly = DB-aware** — replace the hardcoded `STORES_WITH_GOOGLE_ADS={uzoshop}` short-circuit with `isGoogleConfiguredForStoreAsync` so a new Google store gets live + nightly + historical data.
6. **Home cards UNCHANGED** — 6a touches only `/operator`; the home cards keep their exact current design (responsive reflow already shipped Phase 2).

## Grounding-verified facts (do not re-derive)
- **store_webhooks** (`migration 20260601120000:13-23`): `{id uuid default gen_random_uuid(), store_id→stores(id), shop_domain text NOT NULL UNIQUE, signing_secret text, cart_public_token text, allowed_origins text[] default '{}', enabled bool default true, created_at, updated_at}`. Readers exist (`lookupStoreByCartToken`, `lookupStoreByShopDomain` in `lib/webhooks/store.ts`) — no reader changes.
- **Cart beacon** (`app/api/events/cart/route.ts`): POST JSON `{store_token (req), event_id (req), product_title?, quantity?, occurred_at?, landing_site?, referring_site?}` → always 204; token is primary auth (origin check best-effort); dedupe `cart:{event_id}`.
- **Shopify webhook HMAC** (`lib/webhooks/shopifyHmac.ts`): `verifyShopifyHmac(raw, sig, signing_secret)` — for Shopify custom-app webhooks the signing secret is the app's **API secret key = `SHOPIFY_CLIENT_SECRET`**. So `store_webhooks.signing_secret = SHOPIFY_CLIENT_SECRET`. **(Implementer: confirm against an existing store's row before relying on it — `SELECT signing_secret FROM store_webhooks WHERE store_id='uzoshop'` vs its client secret. If Shopify auto-assigns instead, make signing_secret an edit-creds field.)**
- **cart_public_token** = freshly minted `randomBytes(24).toString('base64url')` (NOT the table's uuid default — that's the id PK).
- **Encrypt-to-store_secrets** pattern = `app/api/operator/backfill-secrets/route.ts` `upsertSecret` (encryptSecret → upsert `{store_id,secret_key,ciphertext,iv,tag,updated_at}` onConflict `store_id,secret_key` + decrypt-roundtrip verify, no plaintext echo).
- **secret keys** (`secretsRegistry.ts`): always `SHOPIFY_DOMAIN/SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET`; Meta `META_ACCESS_TOKEN/META_AD_ACCOUNT_ID`; Google `GOOGLEADS_CUSTOMER_ID/GOOGLEADS_REFRESH_TOKEN`; TikTok none. The global `GOOGLEADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET` live under `__global__` (not collected).
- **Reserved id** `__global__` (`RESERVED_STORE_IDS` in `storeSecretsReader.ts`).
- **Tab wiring** (`app/operator/page.tsx`): a `[key,label]` TABS tuple (lines ~41-47) + `<TabsContent>` blocks (~88-102) + sub-tab components; `operatorFetch` (`lib/operatorClient.ts`) auto-injects `x-operator-secret`; middleware gates `/api/operator/*`.

---

## Task 1: Cred-verifiers (pure, injected creds)

**Files:** Create `dashboard-web/src/lib/credVerifiers.ts`; refactor pure helpers out of `shopifyAuth.ts`/`meta.ts`/`googleAds.ts`. Test: `dashboard-web/src/lib/__tests__/credVerifiers.test.ts`.

Each verifier ACCEPTS creds (never reads DB) → `{ ok: boolean; message: string; currency?: string }`. Probe calls (grounding-verified):
- `verifyShopify({domain, clientId, clientSecret})` — POST `https://{domain}/admin/oauth/access_token` `grant_type=client_credentials&client_id&client_secret`; ok = 200 + `access_token` present. (Extract `exchangeShopifyClientCredentials(domain,clientId,clientSecret)` from `shopifyAuth.ts` getShopifyAccessToken ~100-126 and reuse in both.)
- `verifyMeta({token, adAccountId})` — strip leading `act_` (meta.ts:269 regex); GET `https://graph.facebook.com/v25.0/act_{id}/insights?fields=spend,impressions,account_currency&level=account&time_range={"since":today,"until":today}&access_token=...`; ok = 200 + `body.data` is an array; `currency = body.data[0]?.account_currency ?? 'ILS'`. (Never log the full URL — token in query.)
- `verifyGoogle({customerId, refreshToken})` — reads GLOBAL `GOOGLEADS_CLIENT_ID/CLIENT_SECRET/DEVELOPER_TOKEN` via `getGlobalSecret` INSIDE the verifier (a missing dev-token → return `{ok:false, message:'הגדרות Google הגלובליות (developer token) חסרות'}`, not a generic fail). Two-step: (1) POST `https://oauth2.googleapis.com/token` refresh-token exchange → access_token; (2) POST `https://googleads.googleapis.com/v24/customers/{customerId-no-dashes}/googleAds:search` with `Authorization: Bearer`+`developer-token`(+login-customer-id) body `{query:"SELECT customer.currency_code FROM customer WHERE segments.date='today'"}`; ok = both 200. (Extract `refreshGoogleOAuthToken(clientId,clientSecret,refreshToken)` from googleAds.ts ~230-239; reuse `buildGoogleAdsHeaders`/`runGaqlQuery`.)
- **No `verifyTikTok`** (shared account).

- [ ] **Step 1: Failing tests** — `credVerifiers.test.ts`: mock `global.fetch`; for each platform assert ok on a 200-shaped response + fail on 401/error, and that the error message contains NO raw cred. Google: mock `@/lib/storeSecretsReader` `getGlobalSecret`; assert the specific "global dev-token missing" message when it returns null. Run → fail.
- [ ] **Step 2: Extract the pure helpers** (`exchangeShopifyClientCredentials`, `probeMetaAccount`/the meta URL builder, `refreshGoogleOAuthToken`) from the fetchers WITHOUT changing the fetchers' behavior (they call the new helper). Run the existing fetcher suites → still green.
- [ ] **Step 3: Implement `credVerifiers.ts`** using the helpers. Run → tests pass. `npx tsc --noEmit` → 0.
- [ ] **Step 4: Commit** `feat(stores): pure cred-verifiers (Shopify/Meta/Google, injected creds, no DB) (Phase 6a)`.

## Task 2: Snippet generator (pure)
**Files:** Create `dashboard-web/src/lib/storeSnippets.ts` + test. `generateStoreSnippet({storeId, cartPublicToken, allowedOrigins, isHeadless}) → {kind:'themed'|'headless', primary:string, secondary?:string, note?:string}`.
- **themed** → Shopify Custom Pixel verbatim from `docs/storefront-snippets/first-touch-attribution.md:17-61` with `<STORE_CART_TOKEN>` → cartPublicToken: `page_viewed` first-touch capture to `_ft_attr` localStorage + `product_added_to_cart` → `fetch(<prod>/api/events/cart, {store_token:CART_TOKEN, event_id:event.id, product_title, quantity, occurred_at, landing_site})`.
- **headless** → (A) `primary` = the token-FREE first-touch IIFE (doc 74-90) for Lovable client JS; (B) `note` = "set the `roas-cart-event` edge-fn `Deno.env ROAS_STORE_TOKEN` = {cartPublicToken}" — **token only in the edge-fn env, never client JS**.
- [ ] **Step 1: Failing snapshot tests** — themed output contains the token + the real endpoint + required fields; headless `primary` does NOT contain the token, `note` does. Run → fail.
- [ ] **Step 2: Implement.** Run → pass. tsc 0.
- [ ] **Step 3: Commit** `feat(stores): pure store-snippet generator (themed pixel / headless beacon) (Phase 6a)`.

## Task 3: Add route `POST /api/operator/stores` (+ GET list)
**Files:** Create `dashboard-web/src/app/api/operator/stores/route.ts` + test. `runtime='nodejs'`, `dynamic='force-dynamic'`, `getSupabaseAdmin`, `captureRouteError('operator/stores')`, `userFacingError`. Middleware already gates.

Sequence (rollback-on-partial-failure):
1. Validate: `storeId` matches `^[a-z0-9_-]+$`; **reject if ∈ RESERVED_STORE_IDS** → 400; reject if `stores` row exists → 409; `shop_domain` ends `.myshopify.com` + not in `store_webhooks` (UNIQUE) → 409; `display_order` default `max+1`.
2. **Live re-verify** each provided platform via `credVerifiers` (Shopify always; Meta/Google if provided). Any required fail → 400 with messages, **write nothing**.
3. Encrypt creds → `store_secrets` (reuse `upsertSecret` pattern; keys per registry; NO TikTok).
4. Insert `stores` (id, name, status='active', brand_color, is_headless, has_tiktok, has_google_ads, display_order, meta_ad_account_id, google_ads_customer_id — write the legacy columns too, but `store_secrets` is authoritative).
5. Insert `store_webhooks` (shop_domain, signing_secret=`SHOPIFY_CLIENT_SECRET`, cart_public_token=`randomBytes(24).base64url`, allowed_origins=themed?`['https://{shop_domain}']`:`[]`, enabled=true).
6. Insert `store_ad_state` rows (per chosen platform, enabled=true).
- ROLLBACK: on any error after step 3, DELETE-by-store_id from store_ad_state, store_webhooks, store_secrets, stores (reverse) → 500.
- RETURN created store, secrets MASKED (never echo).
- GET = `getStores({includeArchived:true})` mapped to display rows + per-store configured-platforms (from store_secrets presence); NO raw secrets.

- [ ] **Step 1: Failing route tests** — mock getSupabaseAdmin + credVerifiers + secretsEncryption + getStores. Assert: rejects `__global__` (400) + dup id (409) + dup domain (409); on a verify-fail writes nothing (400); on success writes stores+store_secrets(encrypted)+store_webhooks(token+secret)+store_ad_state, returns masked (no plaintext); rollback deletes all on a mid-write failure. Run → fail.
- [ ] **Step 2: Implement.** Run → pass. tsc 0. `npm run lint`.
- [ ] **Step 3: Commit** `feat(stores): POST /api/operator/stores add route (verify→encrypt→write 4 tables→rollback) + GET list (Phase 6a)`.

## Task 4: verify-creds route + secret-echo guard
**Files:** Create `dashboard-web/src/app/api/operator/stores/verify-creds/route.ts` + test; extend `app/api/__tests__/ciSecretsAudit.test.ts`.
- POST `{platform:'shopify'|'meta'|'google', creds}` → calls the matching verifier → `{platform, ok, message, currency?}`. **NO DB write.**
- [ ] **Step 1: Failing tests** — ✓ on good creds, ✗ on bad, no DB call; extend `ciSecretsAudit` COVERED to `stores` + `verify-creds` (+ later patch) asserting no sentinel/secret-shaped value in the body. Run → fail.
- [ ] **Step 2: Implement.** Run → pass. tsc 0.
- [ ] **Step 3: Commit** `feat(stores): verify-creds route + extend secret-echo CI audit (Phase 6a)`.

## Task 5: AddStoreWizard component
**Files:** Create `dashboard-web/src/components/operator/AddStoreWizard.tsx` + DOM test. `'use client'`; `operatorFetch`; props `{ onDone, editStoreId? }`.
3 steps: (1) basics (storeId slug + uniqueness/reserved client-validation, name, myshopify domain, is_headless toggle, brand_color picker, display_order, platform checkboxes); (2) creds (paste per checked platform; a "בדוק" button → `verify-creds` per platform → ✓/✗ + message; **Save disabled until all required platforms ✓**, with an explicit "שמור בכל זאת" override); (3) snippet (render `generateStoreSnippet` in copy blocks) + the irreducible Shopify checklist (custom app; scopes read_orders/products/customers; register order/refund webhook with the generated signing_secret; paste pixel/beacon; note TikTok remap is manual in the CampaignDrawer). Finish → `POST /api/operator/stores` → `onDone`.
- [ ] **Step 1: Failing DOM test** — renders 3 steps; slug validation blocks bad/`__global__`; verify shows ✓/✗; Save disabled until ✓ (+ override enables); finish POSTs the right body. Mock operatorFetch. Run → fail.
- [ ] **Step 2: Implement.** Run → pass (`npm run test:components`). tsc 0. designColorGuard green (token-driven; no raw colors).
- [ ] **Step 3: Commit** `feat(stores): AddStoreWizard (3 steps, live-verify gating, edit mode) (Phase 6a)`.

## Task 6: StoreList + StoreRow
**Files:** Create `dashboard-web/src/components/operator/StoreList.tsx` + `StoreRow.tsx` + DOM test. Active rows: name + brand-color swatch + platforms + status + an **edit** action (opens the wizard in editStoreId mode). (Archive/delete deferred to 6b.)
- [ ] **Step 1: Failing DOM test** — renders rows from a mocked list; edit opens the wizard. Run → fail.
- [ ] **Step 2: Implement.** Run → pass. tsc 0.
- [ ] **Step 3: Commit** `feat(stores): StoreList + StoreRow (active stores, edit action) (Phase 6a)`.

## Task 7: StoresTab + tab wiring
**Files:** Create `dashboard-web/src/app/operator/StoresTab.tsx`; modify `dashboard-web/src/app/operator/page.tsx` (3 edits: import StoresTab; add `['stores','חנויות']` to TABS; add `<TabsContent value="stores"><StoresTab/></TabsContent>`). DOM test for StoresTab.
- StoresTab: loads GET `/api/operator/stores` via operatorFetch (throw on !ok → Hebrew error, mirror AdStateTab), renders `<StoreList>` + "+ הוסף חנות" → `<AddStoreWizard>`.
- [ ] **Step 1: Failing DOM test** — StoresTab loads + lists; "+ הוסף חנות" opens the wizard. Run → fail.
- [ ] **Step 2: Implement** + the 3 page.tsx edits. Run → pass; confirm the operator page renders all 6 tabs. tsc 0.
- [ ] **Step 3: Commit** `feat(stores): חנויות operator tab + wiring (Phase 6a)`.

## Task 8: Edit-creds — `PATCH /api/operator/stores/[id]`
**Files:** Create `dashboard-web/src/app/api/operator/stores/[id]/route.ts` (PATCH) + test. (DELETE/archive/restore are 6b.)
- PATCH: edit basics and/or rotate creds — re-verify the changed platform (live) → re-encrypt `store_secrets` (UPSERT) → update `stores`/`store_webhooks` basics. Masked return.
- [ ] **Step 1: Failing tests** — rotating a Meta token re-verifies + re-encrypts; bad new token → 400, no write; basics update; masked. Run → fail.
- [ ] **Step 2: Implement** + wire the wizard's editStoreId mode to PATCH. Run → pass. tsc 0. Add `[id]` route to ciSecretsAudit.
- [ ] **Step 3: Commit** `feat(stores): PATCH edit/rotate creds route + wizard edit mode (Phase 6a)`.

## Task 9: Google nightly DB-aware + Decision-7 gate verification
**Files:** `dashboard-web/src/lib/fetchers/googleAds.ts` (`STORES_WITH_GOOGLE_ADS` short-circuit ~line 76, used ~381/429) + the `cronDaily` Google call sites + tests.
- Replace the hardcoded `STORES_WITH_GOOGLE_ADS = new Set(['uzoshop'])` short-circuit with the DB-aware `isGoogleConfiguredForStoreAsync(storeId)` (from `googleAccountConfig.ts`, shipped Phase 4b). The fetchers' guard sites become `await isGoogleConfiguredForStoreAsync(storeId)` (they're in async contexts — confirm + await; tsc guards floating promises). Preserve the zero/empty short-circuit behavior for a NON-Google store (gate=false → same skip as today). uzoshop keeps working (gate=true via its creds).
- Add a regression test: a DB-only-cred Google store resolves `isGoogleConfiguredForStoreAsync=true` → the fetcher does NOT short-circuit; a no-Google store → still short-circuits. Plus confirm the worker async gates are the live default (a DB-only store is not skipped by googleWorker/tiktokWorker).
- [ ] **Step 1: Failing tests** (the regression above). Run → fail.
- [ ] **Step 2: Implement** the DB-aware swap. Run the google + cron suites → green; tsc 0. **Verify uzoshop's path unchanged** (gate=true).
- [ ] **Step 3: Commit** `feat(stores): nightly Google path DB-aware (a new Google store gets daily data) (Phase 6a)`.

## Task 10: Docs + full gate
**Files:** `docs/ROAS-Dashboard-User-Manual.md` (operator-facing: the new חנויות tab + add-store/edit-creds flow + the irreducible Shopify steps), `docs/ARCHITECTURE.md` (§48: the add route + cred-verifier seam + snippet gen + the Google DB-aware change).
- [ ] **Step 1:** Write both docs. (docs-currency: components + a `lib/fetchers/*` change → BOTH User Manual [new operator UX] AND ARCHITECTURE required — both updated.)
- [ ] **Step 2: Full gate** — `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` → all green; the no-regression anchors + the live 3 stores byte-identical.
- [ ] **Step 3: Commit.** (Ship = `git push`, GATED on operator OK.)

---

## Self-review
- **Spec coverage (6a):** wizard 3 steps (T5) · live-verify (T1,T4) · encrypt-to-store_secrets + 4-table write + rollback (T3) · snippet gen + Shopify checklist (T2,T5) · edit-creds (T8) · tab (T7) · store list (T6) · Google nightly so a new Google store fully works (T9, operator-chosen) · Phase-5 carry-overs: reject `__global__` (T3), maskSecret/secret-echo audit (T3,T4,T8), no plaintext echo. 6b (archive/restore/delete + removed-area) explicitly deferred.
- **No placeholders:** verifier probe calls, snippet contract, add-route sequence, store_webhooks shape, encrypt pattern, tab edits — all from grounding with file:line. UI tasks give structure + behaviors + the exact route contracts + DOM tests that pin behavior.
- **Type/name consistency:** `verifyShopify/Meta/Google`, `generateStoreSnippet`, `/api/operator/stores[/verify-creds][/[id]]`, `RESERVED_STORE_IDS`, `maskSecret`, `isGoogleConfiguredForStoreAsync`, `cart_public_token`/`signing_secret` consistent across tasks.
- **Open verifications for the implementer:** confirm `store_webhooks.signing_secret` for an existing store == its `SHOPIFY_CLIENT_SECRET` (the app-webhook HMAC model) before relying on it (Task 3) — if Shopify auto-assigns, make it an edit-creds field; confirm the exact Custom Pixel snippet text in `docs/storefront-snippets/first-touch-attribution.md` (Task 2); confirm the `cronDaily` Google call sites are async before awaiting the gate (Task 9); confirm no new `/api/operator/stores*` route needs an allowlist entry (it doesn't — operator-gated, not webhook/Inngest).
