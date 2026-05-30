<!-- refreshed: 2026-05-24 -->
# Architecture

**Analysis Date:** 2026-05-24

**Post-Phase-11 state.** Single-tier Next.js + Inngest + Supabase Postgres. The Apps Script `.gs` data plane has been fully decommissioned (Phase 11 — landed in commit prior to b846ae7). There are no `.gs` files, no `clasp` config, no `lib/sheets.ts`, and no `READ_FROM` feature flag. Every read goes through Postgres; every write originates from an Inngest function or a server-side API route.

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                              │
│  Shopify Admin REST  │  Meta Marketing  │  Google Ads  │  TikTok Business   │
│   (3 stores)         │   Insights       │   GAQL       │   (uzoshop only)   │
│  Frankfurter FX      │  WhatsApp Cloud (Metacloud) — outbound notifications │
└──────────┬─────────────────┬─────────────────┬───────────────┬──────────────┘
           │                 │                 │               │
           ▼                 ▼                 ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  INNGEST CLOUD — 11 SCHEDULED + EVENT FUNCTIONS              │
│                                                                              │
│  cron-daily-{store}  × 3   00:05 IL  (writes "yesterday")                   │
│  cron-live-{store}   × 3   every 10min  (rolling 3-day Shopify + status)    │
│  whatsapp-noon             12:00 IL  (today snapshot)                       │
│  whatsapp-evening          18:00 IL  (today snapshot)                       │
│  whatsapp-eod              00:30 IL  (yesterday EOD)                        │
│  event/sync-now            on operator click                                 │
│  event/backfill            on operator range submit                          │
│  event/whatsapp.send-now   on operator "send WhatsApp now" click            │
│                                                                              │
│  All functions registered in `app/api/inngest/route.ts:112-121`             │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │  (service_role; bypasses RLS)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 SUPABASE POSTGRES — 11+ tables (see migrations)              │
│                                                                              │
│  data_daily            (date, store_id, fb_spend_cad, ga_spend_cad,         │
│                         tt_spend_cad, total_spend_cad, revenue, cogs,       │
│                         net_profit, gross_revenue, refund_deduction,         │
│                         updated_at)                                          │
│  products_daily        (date, store_id, product_id, units, orders, ...)     │
│  campaigns_daily       (date, store_id, platform, campaign_id, ad_set_id,   │
│                         spend_cad, conversions, conversion_value,            │
│                         effective_status, updated_at)                        │
│  ads_daily             (per-ad-level insights)                              │
│  orders_attribution    (per-order line items + click-id attribution)         │
│  product_catalog       (Shopify product snapshot)                            │
│  store_meta            (per-store last-fetch timestamps)                     │
│  manual_overrides      (operator-typed spend overrides; per platform)        │
│  notification_config   (WhatsApp template + recipients)                      │
│  token_failures        (per-provider auth-failure log + alert throttling)    │
│  dashboard_state       (cloud-synced operator state — 8 keys, JSONB)         │
│  stores                (3-row registry: uzoshop / zolplus / usmile360)       │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │  (anon role for SELECT; service_role for writes)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              NEXT.JS API ROUTES — Vercel serverless functions                │
│                                                                              │
│  Data reads:                                                                 │
│    /api/data                  → fetchDailyDataFromPostgres                   │
│    /api/campaigns             → fetchCampaignsFromPostgres                   │
│    /api/ads                   → fetchAdsFromPostgres                         │
│    /api/products              → fetchProductsFromPostgres                    │
│    /api/orders-attribution    → fetchOrdersAttributionFromPostgres           │
│    /api/product-catalog       → fetchProductCatalogFromPostgres              │
│    /api/store-meta            → fetchStoreMetaFromPostgres                   │
│    /api/dashboard-state       → fetchDashboardStateFromPostgres (GET +       │
│                                  upsertDashboardStateKeyPostgres on POST)    │
│    /api/health                → cross-system ping (Supabase availability)    │
│                                                                              │
│  Operator console writes:                                                    │
│    /api/operator/sync-now           → inngest.send('event/sync-now')         │
│    /api/operator/backfill           → inngest.send('event/backfill')         │
│    /api/operator/manual-overrides   → CRUD on `manual_overrides` table       │
│    /api/operator/jobs               → list Inngest run history               │
│    /api/operator/notifications/send → inngest.send('notifications/...')      │
│    /api/operator/token-failures     → list / acknowledge `token_failures`    │
│    /api/operator/reset              → wipe specific tables for re-backfill   │
│                                                                              │
│  Webhook entry:                                                              │
│    /api/inngest               → serve() for Inngest cloud (GET/POST/PUT)    │
│                                                                              │
│  OAuth callback:                                                             │
│    /api/oauth/tiktok/callback → exchange code → store refresh token         │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │  (SWR with revalidateOnFocus + 60s refresh)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              REACT UI — App Router (RTL Hebrew, single dashboard +           │
│                                      sibling /operator console)              │
│                                                                              │
│  /              → <Dashboard />                                              │
│                    6 tabs: בית / P&L / ניתוח / קמפיינים / מוצרים / פירוט    │
│                    (home / pnl / analysis / campaigns / products / detail)   │
│                                                                              │
│  /operator      → <OperatorPage />                                           │
│                    7 sections: SyncNow / Backfill / ManualOverrides /        │
│                    Jobs / WhatsappTest / TokenFailures / ResetData           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Inngest client singleton | Single `Inngest({id: 'roas-dashboard'})` instance; reads `INNGEST_EVENT_KEY` from env at runtime | `dashboard-web/src/inngest/client.ts` |
| Inngest serve() webhook | One `route.ts` exporting `{GET, POST, PUT}` from `inngest/next.serve()`; registers all 11 functions | `dashboard-web/src/app/api/inngest/route.ts` |
| `runDailyForStore` | Shared per-store daily handler (5 step.run: fetch-shopify / fetch-meta / fetch-google / apply-overrides / persist-batch) | `dashboard-web/src/inngest/functions/cronDaily.ts:212` |
| `runLiveForStore` | Per-store live handler (2 step.run: fetch-shopify-rolling-3day / persist-rolling-3day) | `dashboard-web/src/inngest/functions/cronLive.ts` |
| Cron daily factory | `makeCronDaily(storeId)` returns one Inngest function per store at `00:05 IL` | `dashboard-web/src/inngest/functions/cronDaily.ts:1165-1185` |
| Cron live factory | `makeCronLive(storeId)` returns one function per store at `*/10` IL (was `*/15`, dropped 2026-05-22) | `dashboard-web/src/inngest/functions/cronLive.ts:1202-1238` |
| Postgres readers | All `fetch*FromPostgres` functions return the SAME shape as the deleted Sheets readers | `dashboard-web/src/lib/postgresReaders.ts` |
| Supabase client (anon) | Read-only SELECT helper; lazy factory; throws inside `getSupabase()` on missing env | `dashboard-web/src/lib/supabase.ts` |
| Supabase admin (service_role) | Write helper used by all Inngest functions + dashboard-state writer; lazy factory | `dashboard-web/src/lib/supabaseAdmin.ts` |
| Cloud-sync layer | Mirrors 8 localStorage keys to `dashboard_state` table; 400ms debounce + 30s poll | `dashboard-web/src/lib/cloudSync.ts:47-58` |
| Platform config singleton | One source of truth for `TIKTOK_ACTIVE_ENOUGH` (writer ↔ reader symmetry — AUDIT U-01 fix) | `dashboard-web/src/lib/platformConfig.ts:40-46` |
| Dashboard shell | 6-tab orchestrator; renders `<CloudSync />`, SWR-fetches `/api/data` + `/api/orders-attribution` | `dashboard-web/src/components/Dashboard.tsx:89` |
| Operator page | Sibling Next.js route (NOT a tab in the main shell) | `dashboard-web/src/app/operator/page.tsx:41` |

## Pattern Overview

**Overall:** Layered serverless monolith with strict tier separation.

**Key Characteristics:**
- **Single tier post-Phase-11:** Only Inngest cron/event handlers write to Postgres; only API routes read from it; only the React UI calls API routes. No second-tier writer remains.
- **One source of truth per pipeline:** `runDailyForStore` is reused by `cron-daily`, `event/sync-now`, and `event/backfill` — a fix lands in one module, three triggers benefit.
- **Writer/reader symmetric sets:** Status taxonomies that drive both write-time enrollment and read-time visibility live in `lib/platformConfig.ts` so the two sides cannot drift.
- **URL-obscurity trust model:** No auth layer. `/operator` and `/api/operator/*` are reachable by anyone who knows the URL — accepted by operator per Phase 6 scope decision.
- **Single-operator concurrency model:** No `If-Match` headers, no row locking on `dashboard_state`. Last-write-wins per key.

## Layers

**Inngest workers (cron + event functions):**
- Purpose: All writes to Postgres. Fetch upstream APIs, merge manual overrides, persist with `ON CONFLICT` upsert.
- Location: `dashboard-web/src/inngest/functions/`
- Contains: 5 files (`cronDaily.ts`, `cronLive.ts`, `cronWhatsapp.ts`, `eventSyncNow.ts`, `eventBackfill.ts`) exporting 11 functions.
- Depends on: `lib/fetchers/*`, `lib/supabaseAdmin.ts`, `lib/notifications/*`, `lib/platformConfig.ts`.
- Used by: `app/api/inngest/route.ts` (the `serve()` registration).

**Fetcher layer (HTTP wrappers):**
- Purpose: Pure I/O against external APIs; throws on non-200 (Inngest's 4× exponential retry handles transient failures).
- Location: `dashboard-web/src/lib/fetchers/`
- Contains: `shopify.ts`, `shopifyAuth.ts`, `meta.ts`, `googleAds.ts`, `tiktok.ts`, `fx.ts`, `manualOverrides.ts`.
- Algorithm parity: `shopify.ts` delegates net-revenue math to the pure `shopifyRevenueRefunds.ts` module to keep one canonical refund-correction implementation.

**Postgres reader layer:**
- Purpose: Single boundary between Postgres rows and the API-route response shape.
- Location: `dashboard-web/src/lib/postgresReaders.ts`
- Contains: 8 reader functions + 1 writer (`upsertDashboardStateKeyPostgres`).
- Invariant: every reader returns the SAME shape its pre-Phase-11 Sheets counterpart did. Drift = silent regression.

**API route layer:**
- Purpose: HTTP boundary; range validation, error sanitisation, CDN cache-control headers.
- Location: `dashboard-web/src/app/api/`
- Contains: 19 `route.ts` files across 11 top-level endpoints (some have nested children like `/operator/manual-overrides`, `/oauth/tiktok/callback`).
- Pattern: All data-read routes degrade with `status 200 + rows: [] + error: "..."` so SWR consumers stay uniform.

**State / cloud-sync layer:**
- Purpose: Reconcile browser-side localStorage with server-side `dashboard_state` rows.
- Location: `dashboard-web/src/lib/cloudSync.ts`
- 8 state keys (one per `STATE_KEYS` entry): `billing-recurring`, `billing-onetime`, `annotations`, `monthly-revenue-goal`, `insight-states`, `campaign-optimized`, `campaign-product-map`, `campaigns-column-visibility`.
- Write-through: 400ms debounce (or `{immediate: true}` for explicit saves like product mapping); hydrate-grace = 8s.

**React UI layer:**
- Purpose: Single-page dashboard + operator console. SWR-driven, RTL Hebrew, Tailwind tokens.
- Location: `dashboard-web/src/components/` (54 components) + `dashboard-web/src/app/` (3 page routes: `/`, `/operator`, `layout.tsx`).
- Contains: 6 dashboard tabs (home / pnl / analysis / campaigns / products / detail) + 7 operator sub-views.

## Data Flow

### Primary daily write flow (00:05 IL per store)

1. Inngest cloud fires `cron-daily-{store}` at `TZ=Asia/Jerusalem 5 0 * * *` (`dashboard-web/src/inngest/functions/cronDaily.ts:1172`).
2. Handler calls `runDailyForStore(storeId, yesterdayJerusalem(), {step})` (`cronDaily.ts:1175`).
3. Step 1 `fetch-shopify`: Promise.all → `fetchShopifyDayRows` (revenue + per-product rows) + `fetchShopifyOrdersAttribution` + `fetchShopifyProductsCatalog` (`cronDaily.ts:232-242`).
4. Step 2 `fetch-meta`: Promise.all → `fetchMetaSpendForDay` + `fetchMetaAdSetInsights` + `fetchMetaAdInsights` + `fetchMetaBudgets`, wrapped in try/catch that zeros Meta contribution on failure (HG-01 audit fix, `cronDaily.ts:269-296`).
5. Step 3 `fetch-google`: ad-group + ad-level GAQL queries (short-circuits to 0 for non-uzoshop stores).
6. Step 4 `apply-manual-overrides`: reads `manual_overrides` rows + `getFxRate` → overrides REPLACE the fetched spend per platform (`lib/fetchers/manualOverrides.ts:21-30`).
7. Step 5 `persist-batch`: ON-CONFLICT upserts to `data_daily` + `products_daily` + `campaigns_daily` + `ads_daily` + `orders_attribution` + `product_catalog`.

### Primary live write flow (every 10min per store)

1. Inngest cloud fires `cron-live-{store}` at `TZ=Asia/Jerusalem */10 * * * *` (`cronLive.ts:1213`; was `*/15`, reduced 2026-05-22 in Phase 05.7.6).
2. Step 1 `fetch-shopify-rolling-3day`: Promise.all over `today`, `today-1`, `today-2` in Asia/Jerusalem (captures cross-day refund mutations).
3. Step 2 `persist-rolling-3day`: SELECT existing `fb_spend_cad`/`ga_spend_cad`/`total_spend_cad` → compute derived columns → UPSERT with payload OMITTING spend columns (so daily cron's writes are preserved on conflict).
4. Same step also refreshes `effective_status` on `campaigns_daily` rows by calling `fetchMetaAdGroupStatuses` / `fetchGoogleAdsAdGroupStatuses` / `fetchTikTokAdGroupStatuses`.

### Primary read flow (operator opens dashboard)

1. `app/page.tsx` renders `<Dashboard />` (`dashboard-web/src/app/page.tsx:4`).
2. `Dashboard.tsx:115` SWR-fetches `/api/data?from=X&to=Y` (the date-range key changes when the operator picks a new range).
3. `/api/data/route.ts:46-51`: Promise.all → `fetchDailyDataFromPostgres({range})` + `fetchTodayFx()` (live Frankfurter call) + `fetchDataDailyLastWriteAt({range})`.
4. `postgresReaders.fetchDailyDataFromPostgres` SELECTs from `data_daily`, hydrates `storeName` via in-memory map.
5. Response cached via `Cache-Control: cacheControl('data')` from `lib/cacheConfig.ts`.

### WhatsApp summary flow (12:00 / 18:00 / 00:30 IL)

1. Inngest fires `whatsapp-{noon|evening|eod}` at the respective IL time (`cronWhatsapp.ts:52`, `:70`, `:104`).
2. Handler calls `sendDailySummary(dateStr, title)` (`sendDailySummary.ts:37`).
3. Reads `notification_config` (active metacloud row) → builds per-store summary from `data_daily` + totals → builds 5-element template params → posts to WhatsApp Cloud per recipient.
4. EOD runs at 00:30 (not 00:10) to clear cron-daily's 7.5-min retry budget — fix HIGH-13 (`cronWhatsapp.ts:81-97`).

### Cloud-sync write flow (operator edits billing/annotations/etc.)

1. UI component (e.g., `BillingSettings.tsx`) writes localStorage AND fires `pushCloudKey(lsKey, value)` (`cloudSync.ts:178`).
2. Default: 400ms debounce. Explicit saves use `{immediate: true}` to bypass.
3. `postWithRetry` POSTs to `/api/dashboard-state` (`cloudSync.ts:251`); on failure, retries once after 5s.
4. Server: `/api/dashboard-state/route.ts:73` POST validates key against `ALLOWED_STATE_KEYS` (`lib/dashboardStateKeys.ts:25-34`), enforces 64KB value limit, calls `upsertDashboardStateKeyPostgres`.
5. `hydrateFromCloud()` (`cloudSync.ts:325`) polls every 30s; honours `HYDRATE_GRACE_MS = 8s` to avoid stomping in-flight local edits.

## Key Abstractions

**Inngest function factory:**
- Purpose: Generate N functions sharing one handler body (parameterised by `storeId`).
- Examples: `dashboard-web/src/inngest/functions/cronDaily.ts:1165` (`makeCronDaily`), `cronLive.ts:1202` (`makeCronLive`).
- Pattern: `inngest.createFunction({id: 'cron-daily-${storeId}', triggers: [{cron: '...'}]}, handler)` — v4 2-arg API.

**Per-store COGS rate:**
- Purpose: Override the default 25% revenue→COGS rate via env vars.
- Convention: `${STORE_UPPERCASE}_COGS_RATE` (e.g., `UZOSHOP_COGS_RATE=0.25`, `ZOLPLUS_COGS_RATE=0.30`).
- Read at write time so a Vercel env-var update takes effect on the next cron tick — no redeploy.
- Symmetric in `cronDaily.ts:109-121` AND `cronLive.ts:183-195` — both must agree or `cogs_cad` drifts every 10min.

**Per-store TX fees env var:**
- Purpose: Per-store transaction-fee percentage applied at read time.
- Convention: `${STORE_UPPERCASE}_TX_FEES_RATE` (similar pattern to COGS).
- Used by `analytics.ts` and `PnLBreakdown.tsx`.

**Shared step-runner type:**
- Purpose: Decouple test mocks from Inngest SDK's `Jsonify<T>` return shape.
- Pattern: Each Inngest handler accepts `{step: {run: <T>(id, fn) => Promise<unknown>}}` (e.g., `cronDaily.ts:RunDailyStep` at line 161).
- Tests inject plain `{run: vi.fn()}` stubs; production casts the real Inngest `step` to the structural type.

## Entry Points

**Inngest cloud webhook:**
- Location: `dashboard-web/src/app/api/inngest/route.ts`
- Triggers: Inngest cloud POSTs each function invocation here; PUT on every Vercel deploy to re-register functions; GET for the dev landing page.
- Responsibilities: Validates `X-Inngest-Signature` (via `INNGEST_SIGNING_KEY` env), routes to the right function from the 11-element `functions` array.
- `maxDuration = 60` (Vercel Pro ceiling) per `app/api/inngest/route.ts:110`.

**Dashboard root:**
- Location: `dashboard-web/src/app/page.tsx`
- Triggers: Operator visits `/`.
- Responsibilities: Renders `<Dashboard />` — the 6-tab shell.

**Operator console:**
- Location: `dashboard-web/src/app/operator/page.tsx`
- Triggers: Operator visits `/operator`.
- Responsibilities: 7 control sections (Sync now, Backfill, Manual overrides, Jobs, WhatsApp test, Token failures, Reset).

**Operator sync-now / backfill:**
- Location: `dashboard-web/src/app/api/operator/sync-now/route.ts` + `app/api/operator/backfill/route.ts`
- Triggers: POST from operator UI.
- Responsibilities: Validate payload (storeId enum + date range guards), fire `inngest.send('event/sync-now' | 'event/backfill')`, return 202 Accepted.

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop on Vercel serverless. Each Inngest function runs in its own invocation; no shared in-memory state across invocations.
- **Global state:** Module-level lazy singletons in `supabase.ts` (`cached: SupabaseClient`), `supabaseAdmin.ts` (same), and `inngest/client.ts`. Reset on every cold start.
- **Cron timezone discipline:** Every cron expression MUST be prefixed with `TZ=Asia/Jerusalem`. Without the prefix, schedules drift 2-3 hours twice a year on DST transitions. Enforced by reading-discipline (no programmatic guard).
- **Step ID uniqueness:** Inngest step IDs must be unique per function invocation. `eventBackfill.ts` uses a step-prefix shim (`{date}-{storeId}-fetch-shopify`) to avoid collisions when iterating date × store inside one outer step.
- **No client-side service_role:** `supabaseAdmin.ts` MUST NEVER be imported by a client component. There is no `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`.
- **Algorithm parity:** Net-revenue math (refund correction) lives in ONE module: `lib/shopifyRevenueRefunds.ts`. The fetcher `lib/fetchers/shopify.ts` is the I/O wrapper around it.
- **Free-tier budget:** Inngest free tier = 50K execs/month. Current load: cron-live ≈ 26K/month + cron-daily ≈ 540/month + events ≈ 9K/month ≈ ~36K/month (~72% headroom-aware).

## Anti-Patterns

### Writer/reader status taxonomy drift

**What happens:** A status-set check (e.g., "is this TikTok ad-group active enough to render?") gets duplicated as inline literals — once in the writer (`cronLive.ts`) and once in the reader (`postgresReaders.ts`).
**Why it's wrong:** Pre-AUDIT-U-01 fix, the writer's 5-element `TIKTOK_ACTIVE_ENOUGH` set was paired with a 1-element reader check (`statusNorm === 'ADGROUP_STATUS_DELIVERY_OK'`). Operator saw rows enrolled by cron-live disappear from the dashboard mid-day because the reader silently filtered them.
**Do this instead:** Add the set to `lib/platformConfig.ts` and import from both sides (`platformConfig.ts:40-46`).

### Single-tier failure cascade in `runDailyForStore`

**What happens:** A single platform's token expiry throws inside Promise.all → Inngest retries 4× → final failure kills the whole `runDailyForStore` (all 3 platforms + Shopify skipped for that store/day).
**Why it's wrong:** Operator loses an entire store-day of data because one provider's token died.
**Do this instead:** Wrap each platform fetch in its own try/catch with a zero-spend sentinel (HG-01 audit fix; pattern at `cronDaily.ts:269-296`). Combine with `notifyTokenFailure` for operator visibility.

### Hardcoded COGS rate in only one writer

**What happens:** Before BL-COGS audit fix, `cronLive.ts` had a hardcoded `0.25` while `cronDaily.ts` already read per-store env vars.
**Why it's wrong:** Stores that calibrate COGS via `ZOLPLUS_COGS_RATE=0.30` saw the right number for ~10 min at 00:05 IL, then drifted back to 25% every 10min as cron-live silently overwrote it.
**Do this instead:** Symmetric `getCogsRateForStore(storeId)` helper in BOTH writers, reading the same env var convention (`cronLive.ts:183` + `cronDaily.ts:109`).

### Sheets-named modules in post-Phase-11 code

**What happens:** A new route or library imports something named after the dead Sheets tier (`lib/sheets.ts`, `READ_FROM` flag, `clasp` references).
**Why it's wrong:** Phase 11 removed all these symbols. Any new import would re-introduce the very dependency that Phase 11 deleted.
**Do this instead:** Import from `lib/dashboardStateKeys.ts` (key allowlist relocated here in Phase 11) and from `lib/postgresReaders.ts` (the only data-read boundary post-Phase-11).

## Error Handling

**Strategy:** Server-side errors are SANITISED before reaching the UI; raw messages logged via `console.error` for ops.

**Patterns:**
- API routes use `userFacingError(message)` from `lib/apiErrors.ts` to strip Postgres column names, service-account emails, etc. from the response body.
- Data routes degrade with `status 200 + rows: [] + error: "..."` (not 500) so SWR consumers handle errors uniformly via `data.error` checks.
- Inngest functions throw on irrecoverable errors → Inngest retries 4× with exponential backoff → final failure dead-letters to the jobs table (operator sees in `/operator > ריצות אחרונות`).
- Cloud-sync push retries once after 5s; final failure surfaces in `SyncIndicator` pill via `syncState.lastError`.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.warn` / `console.error`. Vercel captures + retains them. No structured logger (planned for Phase 7).

**Validation:** Network boundaries validate runtime input (`ALL_STORES` Set in `/api/operator/sync-now`, `isAllowedStateKey` in `/api/dashboard-state`). Internal-only types lean on TypeScript.

**Authentication:** None. URL-obscurity trust model (Phase 6 decision). `/operator` and `/api/operator/*` are unauthenticated.

**Notifications:** Token failures fan in to `lib/notifications/tokenFailures.ts` (one source of truth). WhatsApp alerts throttled to once per 6h per (provider, store, operation) key, always sent to `+972524809540` only.

---

*Architecture analysis: 2026-05-24*
