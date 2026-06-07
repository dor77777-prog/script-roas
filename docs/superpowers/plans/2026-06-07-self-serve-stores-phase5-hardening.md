# Self-Serve Stores — Phase 5 (Security Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Harden the dashboard's security posture before Phase 6 exposes powerful add/archive/delete-store mutation routes — close the DB's fail-open data exposure (enable RLS + revoke the broad `anon` grants + route every read through service-role) and make the app-auth gates fail-CLOSED in production — with the operator's hard constraint: **nothing in the dashboard breaks and nothing in the database breaks.**

**Architecture:** Three sub-phases, ordered by risk. **5a** (reader cutover): switch every anon-client read (`getSupabase()`, 24 SELECT-only sites) to the service-role client (`getSupabaseAdmin()`); ship + verify the dashboard still shows data — no DB change yet. **5b** (DB lockdown): a single additive migration that ENABLEs RLS on all public tables, REVOKEs every `anon` grant (SELECT/ALL/EXECUTE on 20 tables + 6 functions + 3 views), and sets `security_invoker=on` on the enriched views; ship + verify. **5c** (app-auth): a `VERCEL_ENV==='production'` boot-guard so a missing auth secret fails the deploy loudly instead of silently opening the gate, plus a secret-echo CI test + a `maskSecret` helper (forward guards for Phase 6). Every step is independently shippable + reversible (RLS/grants never touch DATA).

**Tech Stack:** Supabase (PostgREST, RLS, GRANT/REVOKE), `getSupabaseAdmin()` service-role (BYPASSES RLS), Next.js middleware, Vitest. Grounded by two read-only Workflows (2026-06-07): app-auth (5 agents) + DB-layer RLS (4 agents).

---

## Why this is LOW-RISK (grounding-verified)

The DB exposure is real (RLS off + broad anon grants), but the *fix* is low-risk because the architecture is already clean:
- **The anon client is SELECT-only.** `getSupabase()` has **24 call sites, 100% reads, ZERO writes** (health ping, `getStores`, 19 `postgresReaders` functions, etc.). Every INSERT/UPDATE/UPSERT/DELETE already goes through `getSupabaseAdmin()` (~33 sites).
- **Every anon-granted RPC + view is already called via service-role** (the 6 `get_hot_*`/`agg_*`/`recompute_*` functions: callers in metaWorker/googleWorker/tiktokWorker/cronLive all use `getSupabaseAdmin()`). Revoking anon EXECUTE needs **zero code changes**.
- **The 2 "anon ALL" over-grants** (`customer_first_order`, `customer_cohort_monthly`) are written ONLY via `getSupabaseAdmin()` (cronCohortRefresh) — the anon write capability is unused.
- **`service_role` BYPASSES RLS** → once reads move to the admin client, RLS + revoked grants don't affect them.
- **No client-side Supabase, no realtime publication, anon key is server-only** (not `NEXT_PUBLIC`) → `anon` has **no legitimate use** anywhere. It can be fully revoked.
- **Already service-role-only (no change):** `store_secrets` (encrypted + ungranted), `store_webhooks`, `store_events`, `meta_buc_usage`, `data_freshness`.

So: switch 24 reads → admin (5a), then revoke-all-anon + RLS-on (5b). Reads are proven on service-role BEFORE anon is locked down → zero-downtime.

## Authoritative anon-grant inventory (to be revoked in 5b)
- **anon SELECT (20 tables/views):** `stores, manual_overrides, data_daily, products_daily, campaigns_daily, ads_daily, orders_attribution, product_catalog, dashboard_state, notification_config, token_failures, campaign_registry, adset_registry, ad_registry, campaign_status_events, cron_tick_snapshots, store_ad_state, campaigns_enriched, adsets_enriched, ads_enriched`.
- **anon ALL (2 tables — over-grant, writes via admin only):** `customer_first_order, customer_cohort_monthly`.
- **anon EXECUTE (6 functions — callers all service-role):** `get_hot_campaign_ids, get_hot_adset_ids, get_hot_ad_ids, recompute_data_daily_derived (dead/superseded), agg_data_daily_for_date, recompute_first_order_flags`.
- **enriched views** `ads_enriched/adsets_enriched/campaigns_enriched`: Supabase flags "Security Definer View" because they default to `security_invoker=off` (run as owner, bypass RLS) — set `security_invoker=on` + revoke anon SELECT.

---

# SUB-PHASE 5a — Reader cutover: anon client → service-role (ships first, no DB change)

> Switch every `getSupabase()` read to `getSupabaseAdmin()` so reads work via service-role (which bypasses RLS), BEFORE 5b locks anon down. No behavior change today (both clients read the same rows while grants/RLS are unchanged); this is pure preparation. Missing a site = that read returns 0 rows after 5b, so be EXHAUSTIVE.

## Task 1: Inventory + cut over every anon read site

**Files:** `dashboard-web/src/lib/supabase.ts` (the anon client), every `getSupabase()` caller (≈24): `lib/getStores.ts`, `lib/postgresReaders.ts` (19 readers), `app/api/health/route.ts`, + any others grep surfaces. Tests: existing suites + a grep-guard.

- [ ] **Step 1: Exhaustive inventory.** `cd dashboard-web && grep -rn "getSupabase()" src | grep -v "getSupabaseAdmin"` → the COMPLETE list (expect ≈24, all reads). Cross-check against the grounding list (health ping, getStores, postgresReaders×19, …). Record each (file:line, table, it MUST be a SELECT — if any is a write, STOP: that contradicts the grounding, investigate).
- [ ] **Step 2: Decide the cleanest cutover mechanism.** TWO options — pick ONE:
  - **(A) Repoint the shared client (smallest diff, RECOMMENDED):** in `lib/supabase.ts`, make `getSupabase()` return the service-role client server-side. Simplest: `export { getSupabaseAdmin as getSupabase } from '@/lib/supabaseAdmin';` is too blunt (loses the name/semantics). Better: change `getSupabase()`'s body to read `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_ANON_KEY` (one key swap + update the file's header comment). Every existing caller is unchanged; all 24 reads instantly use service-role. **Verify there is NO client-side import of `getSupabase`** (grounding says none — confirm with `grep -rn "getSupabase" src/components src/app/**/page.tsx`); if any client-component imports it, option A would leak the service-role key to the browser → use option B instead.
  - **(B) Per-site swap:** replace each `getSupabase()` → `getSupabaseAdmin()` at all 24 sites (more diff, explicit). Use if option A's safety check finds any client-side usage.
- [ ] **Step 3: Implement the chosen option.** If (A): swap the key in `getSupabase()` + comment "Phase 5a: reads via service-role so RLS (Phase 5b) doesn't block server-side reads; never imported client-side." If (B): the 24 edits. Either way the anon key (`SUPABASE_ANON_KEY`) becomes unused by reads (leave the env var; cleanup is Phase 7).
- [ ] **Step 4: Verify.** `npx tsc --noEmit` → 0. `npm test && npm run test:components` → green (the existing postgresReaders/getStores tests still pass; they mock the client). Add/extend a guard test asserting `getSupabase()` (or the readers) use the service-role key (so a regression that reverts to anon is caught). Run `npm run lint`.
- [ ] **Step 5: Commit.** `git commit -m "refactor(security): route all server-side reads through service-role (Phase 5a — pre-RLS reader cutover)"` (+ trailing blank line + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

## Task 2: Ship 5a + verify (no DB change yet)
- [ ] **Step 1:** Full gate (`npm test && npm run test:components && npx tsc --noEmit && npm run lint`) green. Docs: ARCHITECTURE note (5a) — reads now via service-role, prep for RLS. (docs-currency: `lib/fetchers/*`/`postgresReaders.ts` may be touched → ARCHITECTURE required; no UX files → no User Manual.)
- [ ] **Step 2: GATED push** (operator OK) — `git push origin main`.
- [ ] **Step 3: Post-deploy verify (production):** the dashboard renders data for all 3 stores (reads now via service-role); `freshness-summary` healthy; a live tick still writes (`dataLastWriteAt` advances). **This proves reads work on service-role BEFORE 5b revokes anon.** Soak briefly.

---

# 🔒 GATE: 5a must be verified in prod before 5b

5b revokes anon + enables RLS. If a read still used the anon client (missed in 5a), it returns 0 rows after 5b. So 5a's prod verification (dashboard shows data) is the prerequisite.

---

# SUB-PHASE 5b — DB lockdown: enable RLS + revoke all anon grants (one migration)

> A single additive migration. `service_role` bypasses RLS, so all reads (now admin, per 5a) + writes (always admin) are unaffected. After this, `anon` has ZERO access. Fully reversible via a down-migration (RLS/grants never touch DATA).

## Task 3: Write the RLS + revoke migration

**Files:** Create `supabase/migrations/20260607HHMMSS_phase5_rls_revoke_anon.sql`. Test: a vitest asserting the migration's intent if practical (or rely on the post-deploy DB check).

- [ ] **Step 1: Write the migration.** Enable RLS on every public table (no policies → deny-all to anon; service_role bypasses), REVOKE all anon grants, set `security_invoker=on` on the views. Exact SQL:
```sql
-- Phase 5b — RLS lockdown + revoke all anon grants. service_role bypasses RLS,
-- so server-side reads (Phase 5a → admin) + writes (always admin) are unaffected.
-- anon has NO legitimate use (server-only key, no client Supabase, no realtime).
-- Reversible: see the down-migration note at the bottom. Touches NO data.

-- 1. Enable RLS on all public tables (deny-all to anon; service_role bypasses).
ALTER TABLE public.stores                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_overrides       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_daily             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_daily              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders_attribution     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_failures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_registry      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adset_registry         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_registry            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_tick_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_ad_state         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_first_order   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_cohort_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_secrets          ENABLE ROW LEVEL SECURITY;  -- already ungranted; RLS = 3rd wall
ALTER TABLE public.store_webhooks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_buc_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_freshness         ENABLE ROW LEVEL SECURITY;
-- (add any other public tables grep of \dt surfaces — Step 2 verifies completeness)

-- 2. Revoke every anon grant (SELECT on 20, ALL on 2, EXECUTE on 6 fns, SELECT on 3 views).
REVOKE ALL ON public.stores, public.manual_overrides, public.data_daily, public.products_daily,
  public.campaigns_daily, public.ads_daily, public.orders_attribution, public.product_catalog,
  public.dashboard_state, public.notification_config, public.token_failures,
  public.campaign_registry, public.adset_registry, public.ad_registry,
  public.campaign_status_events, public.cron_tick_snapshots, public.store_ad_state,
  public.customer_first_order, public.customer_cohort_monthly FROM anon;
REVOKE ALL ON public.campaigns_enriched, public.adsets_enriched, public.ads_enriched FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_hot_campaign_ids(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_hot_adset_ids(text, text)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_hot_ad_ids(text, text)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.agg_data_daily_for_date(date)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_first_order_flags(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_data_daily_derived(date) FROM anon; -- superseded; safe

-- 3. Enriched views: run as caller (clears Supabase "Security Definer View" lint).
ALTER VIEW public.campaigns_enriched SET (security_invoker = on);
ALTER VIEW public.adsets_enriched    SET (security_invoker = on);
ALTER VIEW public.ads_enriched       SET (security_invoker = on);

-- DOWN (manual revert if needed): DISABLE ROW LEVEL SECURITY on each table above +
-- re-GRANT the anon grants (copy from migrations 20260521075741 / 20260523080000 /
-- 20260530230000 / 20260530270000 / 20260606160000 / customer_* ledger migrations) +
-- ALTER VIEW ... SET (security_invoker = off). RLS/grants never touched DATA.
```
- [ ] **Step 2: Completeness check.** Before finalizing, list ALL public tables (the migration must RLS-enable every one, even service-role-only ones, so the advisor goes fully green). Cross-check the table list against `supabase/migrations` CREATE TABLE statements; add any missing. Confirm the function signatures match (arg types) so REVOKE doesn't error on a non-existent signature.
- [ ] **Step 3: Apply to prod** via the supervised migration procedure ([[supabase-migration-procedure]]: hide root `.env` + move the 2 duplicate-timestamp gap files, `npx supabase db push`, restore — use a trap). This is operator-gated.

## Task 4: Verify 5b in prod (nothing breaks)
- [ ] **Step 1:** Immediately after the migration: dashboard renders data for all 3 stores (reads via service-role bypass RLS); `freshness-summary` healthy; trigger a live tick / sync-now → it writes (admin bypasses RLS); `npm run audit:reconcile` parity unchanged.
- [ ] **Step 2:** Confirm anon is locked out: `curl "$SUPABASE_URL/rest/v1/data_daily?select=date&limit=1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"` → should now return `[]` / permission-denied (was rows before). This proves the exposure is closed.
- [ ] **Step 3:** Re-check the Supabase Advisor — "RLS Disabled" + "Security Definer View" + "Sensitive Columns Exposed" CRITICALs should clear.
- [ ] **Step 4:** If ANY dashboard read breaks → a reader was missed in 5a; the fastest fix is re-running 5a's grep + switching the missed site (not reverting the migration). Full revert = the down-migration (re-grant + disable RLS).

---

# SUB-PHASE 5c — App-auth fail-closed + secret-echo guards (small, mostly safety-net)

> All three auth env vars are already set in prod, so this is a safety net: convert the silent fail-OPEN (missing env → gate disabled) into a loud fail-CLOSED at deploy. Plus forward guards for Phase 6.

## Task 5: Secret-echo CI guard + `maskSecret` helper (zero-risk additions)
- [ ] **Step 1:** Add `maskSecret(value): string` (e.g. `'••••' + last4`) + `CLIENT_SAFE_SECRET_KEYS = ['TIKTOK_ADVERTISER_ID']` to `lib/secretsEncryption.ts`. No call-site change yet (forward guard for Phase 6 admin routes). Unit-test it.
- [ ] **Step 2:** Add `src/app/api/__tests__/ciSecretsAudit.test.ts`: stub every secret env var to a sentinel, invoke the secret-touching routes (store-meta GET, backfill-secrets POST, token-failures GET), read each response as text, assert it contains NO sentinel and matches no secret-shaped pattern (`/access_token|refresh_token|client_secret|Bearer\s+\S+|OPERATOR_SECRET|ENCRYPTION_MASTER_KEY|SUPABASE_SERVICE_ROLE_KEY|INNGEST_SIGNING_KEY|DASHBOARD_PASSWORD/i`). Generalizes the existing backfill-secrets assertion.
- [ ] **Step 3:** Run, commit. `git commit -m "feat(security): secret-echo CI audit + maskSecret helper (Phase 5c forward guards)"`.

## Task 6: Fail-closed auth in production
**Files:** `dashboard-web/src/middleware.ts` + `lib/middlewareHelpers.ts`. Test: extend `lib/__tests__/middleware.test.ts`.
- [ ] **Step 1:** Add a boot-guard at the top of `middleware.ts` (after imports), mirroring the Inngest `INNGEST_SIGNING_KEY` guard idiom (use `VERCEL_ENV`, NOT `NODE_ENV` — NODE_ENV is 'production' in Vercel preview too):
```ts
if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DASHBOARD_PASSWORD || !process.env.AUTH_SIGNING_SECRET) {
    throw new Error('DASHBOARD_PASSWORD + AUTH_SIGNING_SECRET are required in production (VERCEL_ENV=production).');
  }
  if (!process.env.OPERATOR_SECRET) {
    throw new Error('OPERATOR_SECRET is required in production (VERCEL_ENV=production).');
  }
}
```
- [ ] **Step 2 (defense-in-depth):** make the helpers force-enforce in prod: `shouldEnforceDashboardAuth` → `return (process.env.VERCEL_ENV === 'production') || (<existing config check>)`; `shouldEnforceSecret` → `return (process.env.VERCEL_ENV === 'production') || (typeof envSecret === 'string' && envSecret.length > 0)`.
- [ ] **Step 3:** Tests: helpers force-enforce when `VERCEL_ENV='production'` with envs unset; remain config-driven when `VERCEL_ENV` is unset/'preview'. **Do NOT rotate `AUTH_SIGNING_SECRET`** (would invalidate every live cookie).
- [ ] **Step 4: Pre-deploy:** confirm all 3 auth env vars are in the Vercel **Production** scope (they are) — else the next deploy boot-fails. Full gate green.
- [ ] **Step 5: Commit + GATED push.** `git commit -m "feat(security): fail-closed auth gates in production (VERCEL_ENV guard) (Phase 5c)"`. Post-deploy: an open tab still works (cookie survived — AUTH_SIGNING_SECRET unchanged); a fresh incognito hit 302s to /login; `/api/operator/*` 404s without the header, 200 with it.

## Task 7: Docs + close Phase 5
- [ ] **Step 1:** ARCHITECTURE — new section: Phase 5 hardening (reads via service-role; RLS on + anon revoked; the fail-closed contract; the secret-echo guard + maskSecret). User Manual: a 1-line operator note (auth now mandatory in prod; a missing secret fails the deploy loudly) — this IS operator-visible behavior, so the User Manual is warranted here.
- [ ] **Step 2:** Full gate + commit. Note the Phase-6 carry-overs: wire `maskSecret`/`CLIENT_SAFE_SECRET_KEYS` into the new admin store routes; the create-store route must reject reserved id `__global__` ([[reference-resume-state-2026-06-06]]); add a typed confirm-token (like the reset route) on delete-store; add per-tenant RLS policies if/when multi-tenant.

---

## Self-review
- **Spec coverage (P5):** operator-secret mandatory (5c fail-closed boot-guard) ✅; secrets-never-echoed (5c CI guard + maskSecret; already PASS today) ✅; **EXPANDED:** RLS + revoke anon grants + reads via service-role (5a+5b) ✅; careful rollout to avoid lockout (VERCEL_ENV guard, don't rotate AUTH_SIGNING_SECRET, login allowlisted) ✅; revert one-line/down-migration ✅.
- **Nothing-breaks guarantees:** 5a switches reads to service-role + is verified in prod BEFORE 5b locks anon; `service_role` bypasses RLS so reads+writes are unaffected; anon has no legitimate use (server-only key, no client Supabase, no realtime); the 2 anon-ALL tables + 6 functions + 3 views are all already accessed via service-role; RLS/grants never touch DATA so every step is reversible without data loss.
- **No placeholders:** the 5b migration SQL is complete (the exact 24 tables + 19 SELECT revokes + 2 ALL + 6 EXECUTE + 3 views) from the grant inventory; 5c guard code is exact; 5a gives the cutover mechanism + the exhaustive-grep contract.
- **Type/name consistency:** `getSupabase`/`getSupabaseAdmin`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`VERCEL_ENV`/`maskSecret`/`CLIENT_SAFE_SECRET_KEYS` consistent across tasks.
- **Open verifications for the implementer:** the EXACT count + list of `getSupabase()` sites (grep — must be exhaustive, ≈24, all reads); confirm NO client-component imports `getSupabase` (decides 5a option A vs B); the COMPLETE public-table list for RLS (every table, even service-role-only ones, for a fully-green advisor); the exact function signatures for REVOKE EXECUTE; that the enriched views accept `security_invoker=on` (Postgres 15+).
