<!-- refreshed: 2026-05-18 -->
# Architecture

**Analysis Date:** 2026-05-18

## System Overview

Multi-store Shopify ROAS dashboard. Three layers connected uni-directionally for telemetry, with a single reverse write-path for user-facing state.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  🌐 Dashboard layer (Next.js 15.5 + React 19 on Vercel)                  │
│  Entry: `dashboard-web/src/app/page.tsx` → `components/Dashboard.tsx`    │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐          │
│  │   HomeTab    │    PnLTab    │ AnalysisTab  │ CampaignsTab │   …      │
│  │              │              │              │   + Drawer   │          │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘          │
│         │              │              │              │                   │
│         └──────────────┴──────────────┴──────────────┘                   │
│                              │                                            │
│                  SWR + fetch + 8 API routes                              │
│                              │                                            │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │ GET (read)                ▲ POST (write)
                               ▼                           │
┌──────────────────────────────────────────────────────────┴───────────────┐
│  🔌 API routes — `dashboard-web/src/app/api/*/route.ts`                   │
│  `data/` `campaigns/` `products/` `ads/` `orders-attribution/`           │
│  `product-catalog/` `store-meta/` `dashboard-state/`                     │
│                              │                                            │
│                 Service Account auth (googleapis)                        │
│                 read scope: `spreadsheets.readonly`                      │
│                 write scope (state only): `spreadsheets`                 │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  📊 Data store — single Google Sheets workbook (`SPREADSHEET_ID`)        │
│  8 tab types:                                                            │
│   data-daily · products-daily · {store}-campaigns · {store}-ads          │
│   {store}-orders-attribution · {store}-products-catalog                  │
│   store-meta · dashboard-state                                           │
│  Also legacy formula-driven tabs visible to operator:                    │
│   `סיכום` (summary) + per-store summary tabs + `manual-spend`             │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ writes
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🔧 Collection layer — Google Apps Script V8                             │
│  Entry points (root `.gs` files): `Main.gs` · `DailyUpdate.gs`           │
│  Triggers: `runDailyUpdate` @ 00:05 IL · `runLiveUpdate` every 15 min    │
│  Modules: `Shopify.gs` · `MetaAds.gs` · `GoogleAds.gs` · `FX.gs`         │
│  Sheet plumbing: `SheetBuilder.gs` · `Config.gs` · `ManualOverrides.gs`  │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ HTTPS (fetchWithRetry_)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🌍 External APIs                                                         │
│  Shopify Admin (REST + GraphQL) · Meta Marketing v20.0 ·                 │
│  Google Ads v20 · Frankfurter FX                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Reverse write path (cloud-sync state).** The Dashboard is the only consumer that *writes* to Sheets. Seven `localStorage` keys are mirrored to the `dashboard-state` tab via `POST /api/dashboard-state` (debounced 400ms in `dashboard-web/src/lib/cloudSync.ts`). Apps Script never reads from this tab — it is operator/UI state, not telemetry.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Daily orchestrator | Loops over 3 stores, calls every collector, writes every tab type for one date | `DailyUpdate.gs` |
| Sheet plumbing | Creates/maintains 8 tab types, idempotent migrations, chunked writes, phantom-spreadsheet protection | `SheetBuilder.gs` |
| Constants + retry | `STORES`, `COGS_RATE_OF_REVENUE`, `fetchWithRetry_`, `getProp`/`setProp`, spreadsheet-ID safety helpers | `Config.gs` |
| Shopify collector | revenue, products, orders attribution, plan, catalog; auto-bootstrap on 401 | `Shopify.gs` |
| Meta collector | account/adset/ad insights + CBO/ABO budget state | `MetaAds.gs` |
| Google Ads collector | spend + ad-group insights, OAuth refresh | `GoogleAds.gs` |
| FX | ILS/USD/EUR → CAD via Frankfurter with daily cache | `FX.gs` |
| Manual overrides | Operator-written spend overrides per (store, channel, date) | `ManualOverrides.gs` |
| Trigger setup | `setupAll`, `installDailyTrigger`, `installLiveTrigger`, custom menu | `Main.gs` |
| Dashboard root | Tab routing, SWR setup, URL state hydration, Header (CommandPalette + SyncIndicator) | `dashboard-web/src/components/Dashboard.tsx` |
| Cloud-sync engine | Push/pull, debounce, retry, last-write-wins, hydrate-grace | `dashboard-web/src/lib/cloudSync.ts` |
| Server Sheets I/O | Auth, read parsers, `upsertDashboardStateKey` (dedup + last-write-wins), allowlist guard | `dashboard-web/src/lib/sheets.ts` |
| Attribution engine | Click-id deterministic match + Bayesian CI + window stability + outlier detection | `dashboard-web/src/lib/attributionAnalysis.ts` |
| Product map | Many-to-many campaign→product mapping + proportional revenue allocation | `dashboard-web/src/lib/campaignProductMap.ts` |
| Drawer stack | Single shared Esc listener — pops top-most drawer only | `dashboard-web/src/lib/drawerStack.ts` |
| Drawer (campaign) | Hero stats, daily chart, attribution panel, Meta↔Shopify reconciliation, ad-sets table | `dashboard-web/src/components/CampaignDrawer.tsx` |
| Drawer (ads) | Ad-level drilldown — per-ad trust chip + sortable table | `dashboard-web/src/components/AdsDrawer.tsx` |
| Modal (product picker) | Multi-select of catalog products to map to a campaign | `dashboard-web/src/components/ProductPickerModal.tsx` |

## Pattern Overview

**Overall:** Three-tier batch pipeline with reverse cloud-sync.

**Key Characteristics:**
- Push-mode collection (cron in Apps Script) ↔ pull-mode rendering (SWR on dashboard) — no live socket; Sheets is the durable store of record
- Strict separation: Apps Script writes telemetry tabs; Dashboard reads everything but only writes `dashboard-state`
- Idempotent writes — every `write*ForDay` function filters rows for the target date and overwrites only that slice
- Soft-fail (per-section try/catch) so a single API outage degrades but never blocks
- Defense-in-depth on the cloud-sync allowlist: client `STATE_KEYS` ↔ server `ALLOWED_STATE_KEYS` mirror each other; the `isAllowedStateKey` boundary check at `dashboard-web/src/lib/sheets.ts:242` prevents prototype-pollution writes
- TypeScript path alias `@/*` → `dashboard-web/src/*` (per `dashboard-web/tsconfig.json`)

## Layers

**Collection (Apps Script):**
- Purpose: Pull telemetry from Shopify/Meta/Google and serialize to Sheets
- Location: project root `*.gs` files (9 files + `appsscript.json`)
- Contains: trigger handlers, REST clients with retry, sheet writers, manual-override resolver
- Depends on: external HTTPS APIs, `PropertiesService` (auth tokens), `SpreadsheetApp`
- Used by: Google Sheets (writes only)

**Data store (Google Sheets):**
- Purpose: Single source of truth — durable, queryable from anywhere with the service-account key
- Location: One workbook (id stored in Apps Script `spreadsheet.id` property + Vercel `SPREADSHEET_ID` env var; the two **must** match or data forks)
- Contains: 8 hidden data tabs + 4 visible formula-driven legacy tabs + 1 hidden state tab
- Depends on: nothing (passive)
- Used by: Apps Script (writes telemetry), Dashboard API routes (reads telemetry + r/w state)

**API routes (Next.js):**
- Purpose: Thin server-side adapter — auth + Sheets read + cache headers
- Location: `dashboard-web/src/app/api/{route}/route.ts`
- Contains: `GET` handlers (and `POST` only on `dashboard-state`), explicit `Cache-Control: s-maxage=...` per route
- Depends on: `googleapis` SDK, env vars (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`)
- Used by: Dashboard components via SWR

**Dashboard (React):**
- Purpose: Render 6 tabs + drawers; manage URL state + localStorage state + cloud-sync state
- Location: `dashboard-web/src/components/` + `dashboard-web/src/lib/`
- Contains: 31 components, 24 lib modules
- Depends on: API routes, browser `localStorage`
- Used by: end-user browser

## Data Flow

### Primary Request Path (Dashboard render)

1. Browser loads `/` (`dashboard-web/src/app/page.tsx`) → mounts `<Dashboard />` (`dashboard-web/src/components/Dashboard.tsx:67`)
2. `Dashboard` instantiates SWR hook on `/api/data` (60s refresh) and reads URL state via `readDashboardState` (`dashboard-web/src/lib/urlState.ts`)
3. `<CloudSync />` (`dashboard-web/src/components/CloudSync.tsx`) calls `hydrateFromCloud()` once + every 30s + on focus (`dashboard-web/src/lib/cloudSync.ts:250`)
4. Active tab triggers its own SWR fetches (e.g. CampaignsTab → `/api/campaigns`, `/api/orders-attribution` when drawer opens)
5. API route → `googleapis` service-account auth → `sheets.spreadsheets.values.get` → returns row arrays
6. Lib parsers (`dashboard-web/src/lib/{campaigns,products,ads,...}.ts`) normalize raw values into typed rows
7. Components render with formatters from `dashboard-web/src/lib/format.ts` / `utils.ts`

### Daily Run (`runDailyUpdate`, 00:05 IL)

`DailyUpdate.gs:10` → `runUpdateForDate(yesterdayStr_())`:

1. `ensureSpreadsheet()` opens existing workbook with retry-on-timeout — never creates phantom (`SheetBuilder.gs:79`)
2. `getFxRate('ILS','CAD',dateStr)` pulls + caches today's FX (`FX.gs`)
3. Loops `STORES` (`Config.gs:22`), sleeping 1500ms between stores for quota relief (`DailyUpdate.gs:42`)
4. For each store, `updateStoreForDate_` (`DailyUpdate.gs:74`):
   - `getShopifyRevenue` → `getMetaSpend` (or override) → `getGoogleAdsSpend` (if `hasGoogleAds`) → `writeDayRow` to per-store + summary tabs
   - try: `updateCampaignDataForStoreDate_` — Meta adset insights + budgets + Google ad-group insights → `{store}-campaigns`
   - `writeDailyFlatRow_` → `data-daily` (with COGS = revenue × 0.25 + netProfit)
   - `getShopifyProductSalesForDay` → `writeProductSalesForDay_` → `products-daily`
   - try: `updateAdDataForStoreDate_` — Meta ad-level insights → `{store}-ads`
   - try: `getShopifyOrdersAttribution` + `writeOrdersAttributionForDay` → `{store}-orders-attribution` (idempotent: clears that date's rows, appends new)
   - Warn (don't run) if catalog > 14 days stale; refresh is manual via `refreshAllProductCatalogs`
5. `refreshAllStoreMeta()` updates `store-meta` (plan + Meta/GA IDs)
6. Errors aggregate → `notifyError_(dateStr, msg)` sends email via 3-tier resolver (`DailyUpdate.gs:502`)

### Live Update (`runLiveUpdate`, every 15 min)

`DailyUpdate.gs:18` → `runUpdateForDate(todayStr_())`. Same path as daily, but for today's date — refreshes `TodayLive` panel in dashboard. Catalog/store-meta refresh skipped.

### Backfill (`backfillRange` / `backfillRangeForStores`)

```text
backfillRange(start, end):
  cur = start
  while cur <= end:
    runUpdateForDate(cur)
    cur = nextDayStr_(cur)
```

Each `runUpdateForDate` consumes ~3-4 minutes for 3 stores. Apps Script execution limit is **6 minutes per run** → caller must split into 1-2 day chunks across separate executions. `backfillRangeForStores(start, end, storeIds)` narrows to a subset of stores (faster per-run, allows more days per chunk).

### Cloud-Sync Write-Through (user action → other devices)

```text
User edits BillingSettings:
  writeRecurring(items)                                  # lib/billing.ts
    ↓
    localStorage.setItem(key, JSON.stringify(items))     # synchronous
    ↓
    window.dispatchEvent('roas-billing-changed')         # in-tab listeners re-read
    ↓
    pushCloudKey('roas-dashboard:billing-recurring', items)
      (lib/cloudSync.ts:143 — debounced 400ms)
      ↓
      POST /api/dashboard-state { key, value }
        ↓
        isAllowedStateKey(body.key) gate (sheets.ts:242)
        ↓
        upsertDashboardStateKey                          # sheets.ts:348
          - read all key matches, pick newest by updatedAt
          - update-in-place (with RAW write of "" to dedupe stale duplicates)
          - new key → spreadsheets.values.append (atomic server-side row alloc)

Other device polls (every 30s + on focus):
  CloudSync.hydrateFromCloud                             # cloudSync.ts:250
    ↓
    fetch /api/dashboard-state (cache: 'no-store')
    ↓
    for each STATE_KEYS: if cloud value differs && no pending push:
      writeLocal(key, value)
      dispatchEvent(CHANGE_EVENTS[key])
      ↓
      components re-read localStorage and re-render
```

**State Management:**
- **URL state**: tab + filter range (encoded by `dashboard-web/src/lib/urlState.ts`)
- **`localStorage`**: 7 sync'd keys + ephemeral UI state
- **SWR cache**: dedupe + revalidation per API route
- **Cloud (Sheets)**: 7 keys mirrored via `dashboard-state` tab — see `STATE_KEYS` (`dashboard-web/src/lib/cloudSync.ts:47`) and `ALLOWED_STATE_KEYS` (`dashboard-web/src/lib/sheets.ts:231`)

## Key Abstractions

**`STATE_KEYS` (the cloud-sync contract):**
- Purpose: enumerates the 7 localStorage keys that round-trip through `dashboard-state`
- Source of truth: `dashboard-web/src/lib/cloudSync.ts:47` — re-exported as `StateKey` union
- Mirror: `ALLOWED_STATE_KEYS` (`dashboard-web/src/lib/sheets.ts:231`) used by POST allowlist gate
- Keys: `billing-recurring`, `billing-onetime`, `annotations`, `monthly-revenue-goal`, `insight-states`, `campaign-optimized`, `campaign-product-map`

**`AttributionAnalysis` (deterministic + Bayesian + stability):**
- Purpose: convert per-order Shopify rows + per-campaign Meta claim into a 4-level trust verdict
- Source: `dashboard-web/src/lib/attributionAnalysis.ts:23`
- Outputs: `deterministicRevenue`, `coverage`, `trust: {level, label, score}`, `roasInterval`, `windowStability`, `outlierDays`
- Entry points: `analyzeAttribution` (campaign), `analyzeAttributionForAdSet`, `analyzeAttributionForAd` — share `buildAnalysis`
- Match key precedence: `utm_id` (Tier 1, authoritative — CR5-01) > `utm_campaign` (Tier 2 name match)

**Drawer stack:**
- Purpose: nested drawers (Campaign → Ad-Set → Product Picker) need single Esc listener
- Source: `dashboard-web/src/lib/drawerStack.ts`
- Pattern: `useDrawerEsc(open, onClose)` pushes/pops a module-level array; the lazy-installed `keydown` listener calls only `stack[stack.length-1]`

**Per-store layout (`getLayout_`):**
- Purpose: legacy summary tabs branch on whether a store has Google Ads
- Source: `SheetBuilder.gs:15` — returns `{type, cols, headers, totalCol, revenueCol, roasCol, ...}`
- Types: `summary` (4 cols, formula-driven), `split` (6 cols — has Google Ads), `unified` (4 cols)

## Entry Points

**`runDailyUpdate` (`DailyUpdate.gs:10`):**
- Triggered by: Apps Script time-based trigger at 00:05 Asia/Jerusalem (created by `installDailyTrigger` in `Main.gs:33`)
- Responsibilities: close yesterday's data — full per-store sweep across all 8 telemetry tabs

**`runLiveUpdate` (`DailyUpdate.gs:18`):**
- Triggered by: Apps Script time-based trigger every 15 minutes (created by `installLiveTrigger` in `Main.gs:70`)
- Responsibilities: refresh today's row in `data-daily` + campaigns/ads so the dashboard's `TodayLive` panel stays current

**`/` (`dashboard-web/src/app/page.tsx`):**
- Triggered by: end-user navigation to Vercel deployment
- Responsibilities: render `<Dashboard />`. The route is a server component but `Dashboard` is `'use client'` (`dashboard-web/src/components/Dashboard.tsx:1`)

**API routes (`dashboard-web/src/app/api/*/route.ts`):**
- Triggered by: SWR + `fetch` from dashboard
- Pattern: each exports `GET` (and `dashboard-state` also exports `POST`) + `revalidate` + sets explicit `Cache-Control`

## 8 Sheet Tab Types

| Tab | Granularity | Source code | Used by |
|-----|-------------|-------------|---------|
| `data-daily` | (date, store) — 13 cols incl. fb/ga/total spend, revenue, ROAS, COGS, netProfit | written by `writeDailyFlatRow_` (`DailyUpdate.gs`) · read by `fetchDailyData` (`dashboard-web/src/lib/sheets.ts:72`) | `/api/data` |
| `products-daily` | (date, store, productId) — units, revenue (CAD), netRevenue | written by `writeProductSalesForDay_` · read by `dashboard-web/src/lib/products.ts` | `/api/products` |
| `{store}-campaigns` | (date, store, campaignId, adSetId) — spend, conversionValue, conversions, impressions, clicks, daily budget, CBO/ABO type, platform | written by `writeCampaignRowsForDay` (`SheetBuilder.gs`) · read by `dashboard-web/src/lib/campaigns.ts` | `/api/campaigns` |
| `{store}-ads` | (date, store, campaignId, adSetId, adId) — Meta level=ad only | written by `writeAdsRowsForDay` · read by `dashboard-web/src/lib/ads.ts` | `/api/ads` |
| `{store}-orders-attribution` | (date, orderId) — 14 cols: source classification, UTM tags, click-id booleans, referrer, utmId, utmTerm, **Line Items (JSON)** (col N) | written by `writeOrdersAttributionForDay` (`SheetBuilder.gs`) + `classifyOrderAttribution_` (`Shopify.gs`) · read by `dashboard-web/src/lib/ordersAttribution.ts` | `/api/orders-attribution` |
| `{store}-products-catalog` | (storeId, productId, title, status, …) — full catalog incl. unsold products | written by `refreshAllProductCatalogs` (manual, `SheetBuilder.gs`) · read by `dashboard-web/src/lib/productCatalog.ts` | `/api/product-catalog` |
| `store-meta` | (storeId) — Shopify plan name, Meta ad-account ID, Google customer ID, last-error timestamp | written by `refreshAllStoreMeta` (`SheetBuilder.gs`) · read by `fetchStoreMeta` (`dashboard-web/src/lib/sheets.ts`) | `/api/store-meta` |
| `dashboard-state` | (key, value, updatedAt) — 7 cloud-sync keys | written **only** by `upsertDashboardStateKey` (`dashboard-web/src/lib/sheets.ts:348`) · read by `fetchDashboardState` | `/api/dashboard-state` |

**Idempotency invariant:** Every `write*ForDay` function (campaigns, ads, products, orders-attribution) first removes rows whose date matches the target date, then appends fresh rows. Rows with un-parseable dates (`key === null`) are preserved (WR5-02 fix).

## 8 API Routes & Cache TTLs

| Route | File | `revalidate` | `Cache-Control: s-maxage=` | `stale-while-revalidate=` | Notes |
|-------|------|-------------:|---------------------------:|--------------------------:|-------|
| `/api/data` | `dashboard-web/src/app/api/data/route.ts` | 60 | 60 | 120 | Also fetches FX (1h cache) |
| `/api/campaigns` | `dashboard-web/src/app/api/campaigns/route.ts` | 60 | 60 | 120 | |
| `/api/products` | `dashboard-web/src/app/api/products/route.ts` | 60 | 60 | 120 | |
| `/api/ads` | `dashboard-web/src/app/api/ads/route.ts` | 300 | 300 | 900 | Empty rows on error (graceful degrade) |
| `/api/orders-attribution` | `dashboard-web/src/app/api/orders-attribution/route.ts` | 300 | 300 | 900 | Returns `lastUpdated` even on error path so consumers don't crash |
| `/api/product-catalog` | `dashboard-web/src/app/api/product-catalog/route.ts` | 60 | 60 | 300 | Tight TTL so manual `refreshAllProductCatalogs` reflects within a minute |
| `/api/store-meta` | `dashboard-web/src/app/api/store-meta/route.ts` | 3600 | 3600 | 86400 | `userFacingError` sanitizes Sheets messages |
| `/api/dashboard-state` | `dashboard-web/src/app/api/dashboard-state/route.ts` | (none) | 10 | 60 | GET + POST; `isAllowedStateKey` allowlist on POST; no `force-dynamic` (would conflict with `Cache-Control`) |

**Note:** `/api/data`, `/api/campaigns`, `/api/products` carry `export const dynamic = 'force-dynamic'`. `/api/dashboard-state` and `/api/store-meta` explicitly do **not** — IN-04 fix; `force-dynamic` overrides the explicit `Cache-Control` for CDN edge caching.

## Drawer Z-Stack Hierarchy

```text
┌───────────────────────────────────────────────────────────────┐
│ ProductPickerModal (`dashboard-web/src/components/             │
│   ProductPickerModal.tsx:207`)            z-[70]               │
│ ─────────────────────────────────────────────                  │
│   AdsDrawer (`dashboard-web/src/components/AdsDrawer.tsx:291`) │
│                                            z-[60]               │
│   ───────────────────────────────────────                       │
│     CampaignDrawer                                              │
│     (`dashboard-web/src/components/                             │
│      CampaignDrawer.tsx:493`)              z-50                 │
└───────────────────────────────────────────────────────────────┘

Esc handling: a single shared `keydown` listener in
`dashboard-web/src/lib/drawerStack.ts` pops only the top-most open
drawer. Each drawer registers via `useDrawerEsc(open, onClose)`.
```

Opening order: row click in `CampaignsTable` → `CampaignDrawer` → ad-set click → `AdsDrawer` → "ערוך מיפוי" → `ProductPickerModal`. Each Esc closes one level.

## Architectural Constraints

- **Apps Script 6-minute limit**: every execution must finish within 360s. `runUpdateForDate` consumes 3-4 minutes for 3 stores → backfill of multi-day ranges must be chunked at 1-2 days per execution.
- **Sheets API short-window quota**: `Utilities.sleep(1500)` between stores (`DailyUpdate.gs:42`) and `Utilities.sleep(500)` between major writes within a store (`DailyUpdate.gs:122,142,151`) prevent cascade timeouts. Catalog refresh is **explicitly excluded** from the daily run (quota cascade — Round 4) and runs only via the manual `refreshAllProductCatalogs` entry.
- **Single workbook, two sources of ID**: `SPREADSHEET_ID` in Vercel env + `spreadsheet.id` in Apps Script `PropertiesService` **must match**, or telemetry forks to a phantom workbook. Helpers: `printCurrentSpreadsheetId` / `resetSpreadsheetIdToKnownGood` (`Config.gs`).
- **No phantom-spreadsheet on timeout**: `ensureSpreadsheet` (`SheetBuilder.gs:79`) retries 3× on transient errors and **throws** on persistent timeout rather than falling through to `SpreadsheetApp.create` (the original failure mode that silently forked data).
- **Service Account scope segregation**: `getAuth(write?: boolean)` (`dashboard-web/src/lib/sheets.ts:9`) returns a `readonly` token for telemetry reads; only `upsertDashboardStateKey` requests the full `spreadsheets` scope.
- **POST allowlist**: `/api/dashboard-state` POST is gated by `isAllowedStateKey` (`dashboard-web/src/lib/sheets.ts:242`) — prevents prototype-pollution rows from entering the sheet. `fetchDashboardState` further uses `Object.create(null)` for the kv map.
- **Last-write-wins** semantics for cloud-sync (low-edit-frequency data: billing, annotations, goals, insight states, optimization marks, campaign-product map). 8-second `HYDRATE_GRACE_MS` window prevents poll-overwrite of a just-pushed value.
- **Apps Script global namespace**: no ES modules — all `.gs` files share a single global scope. Function ordering doesn't matter (hoisted globals).
- **Single-spreadsheet workbook for everything**: read-only `googleapis` clients re-instantiated per request (no connection pool — stateless serverless route handlers).
- **TypeScript path alias**: `@/*` → `dashboard-web/src/*` (`dashboard-web/tsconfig.json:18`). Always prefer alias imports across modules.

## Anti-Patterns

### Reading both halves of `dashboard-state` from the client

**What happens:** Client code directly fetches `/api/dashboard-state` and writes to localStorage outside `cloudSync.ts`.
**Why it's wrong:** Bypasses the debounce, the `lastPushAt` grace, and the `STATE_KEYS` allowlist. Concurrent local edits + poll-overwrite race ensues, losing user input mid-typing.
**Do this instead:** All round-trips go through `pushCloudKey` / `readLocal` (`dashboard-web/src/lib/cloudSync.ts`). Add new keys by appending to `STATE_KEYS` *and* `ALLOWED_STATE_KEYS` *and* `CHANGE_EVENTS` (single edit point — symmetric by construction).

### Per-drawer `keydown` listener

**What happens:** A drawer registers its own `window.addEventListener('keydown', ...)` for Esc.
**Why it's wrong:** With nested drawers (Campaign → Ads → Picker), every listener fires on one Esc keystroke → entire stack collapses (#WR-01).
**Do this instead:** Use `useDrawerEsc(open, onClose)` from `dashboard-web/src/lib/drawerStack.ts` — single shared listener routes Esc to top-of-stack only.

### Setting `force-dynamic` *and* an explicit `Cache-Control`

**What happens:** Route exports `export const dynamic = 'force-dynamic'` while *also* returning `Cache-Control: public, s-maxage=...`.
**Why it's wrong:** `force-dynamic` instructs Next to bypass CDN caching — the `Cache-Control` header becomes a no-op and every request reaches the Sheets API. Bills quota for no benefit (IN-04).
**Do this instead:** Use one or the other. `/api/dashboard-state` and `/api/store-meta` rely on `revalidate` + `Cache-Control` only. Routes that legitimately need always-fresh data (e.g. `/api/data` for the live tile) keep `force-dynamic` and accept the cost.

### Catalog refresh inside `runDailyUpdate`

**What happens:** Catalog write (~200-500 rows × 9 cols per store) sequenced with campaign + ads + products + orders-attribution writes in a single 6-minute execution.
**Why it's wrong:** Saturates Sheets API short-window quota → store 2 and 3 timeout cascade.
**Do this instead:** `runDailyUpdate` only **warns** (`DailyUpdate.gs:181`) when catalog is >14 days stale. Operator runs `refreshAllProductCatalogs` (`SheetBuilder.gs`) as a standalone execution.

### Creating a new spreadsheet on `SpreadsheetApp.openById` timeout

**What happens:** Catch block on `openById` falls through to `SpreadsheetApp.create('...')` and writes the new ID to Script Properties.
**Why it's wrong:** Silently forks data on every transient Sheets-API outage — operator wakes up to "phantom spreadsheet" with one day of data and an empty original.
**Do this instead:** `ensureSpreadsheet` (`SheetBuilder.gs:79`) retries 3× with backoff. If still timing out, **throws** to abort the run; only treats permanent "not found / no permission" errors as a legitimate reason to recreate.

### Fetching the Sheets API per-component-instance

**What happens:** A component calls `fetch('/api/data')` outside SWR (e.g. inside an `onClick`).
**Why it's wrong:** Loses SWR's request dedupe, cache, and refresh interval. Multiplies API calls by component count.
**Do this instead:** Hoist to a `useSWR` at the parent (`Dashboard.tsx` pattern) and pass `data`/`mutate` down via props.

## Error Handling

**Strategy:** Defense-in-depth, soft-fail per layer.

**Layers:**

1. **HTTP fetch retry** — `fetchWithRetry_` (`Config.gs:115`) wraps every external API call. Exponential backoff on 429/5xx with jitter. Throws after exhaustion.
2. **Per-store try/catch** — `runUpdateForDate` (`DailyUpdate.gs:43`) catches per-store errors so one failing store doesn't block the other two. Errors accumulate into `errors[]`.
3. **Per-section try/catch** — `updateStoreForDate_` wraps each major section (campaigns, products, ads, orders-attribution, store-meta) so one Meta 5xx doesn't drop the entire store's day (`DailyUpdate.gs:114, 129, 136, 146, 158`).
4. **Catalog age check (best-effort)** — `if (catalogNeedsRefresh_) Logger.log(warning)` wrapped in `try/_/` (`DailyUpdate.gs:180`).
5. **Email notification** — `notifyError_(dateStr, message)` (`DailyUpdate.gs:502`) sends via 3-tier resolver: Script Property `notification.email` → `Session.getActiveUser().getEmail()` → `Session.getEffectiveUser().getEmail()`.
6. **Phantom-spreadsheet protection** — `ensureSpreadsheet` (`SheetBuilder.gs:79`) only creates a new workbook on permanent errors; transient errors throw to abort the run, preserving data.
7. **Token bootstrap** — Shopify 401 triggers `bootstrapShopifyTokenForStore_` (Client Credentials Grant flow) inside `Shopify.gs`; subsequent retry of the failing request uses the fresh token.
8. **URI guard** — `safeDecode_` (`Shopify.gs`) wraps every `decodeURIComponent` against bot-injected invalid percent-escapes (CR5-02).
9. **API route soft-fail** — most routes return `200 { rows: [], error }` rather than `500` so the dashboard renders empty rather than crashing (`/api/ads`, `/api/orders-attribution`, `/api/product-catalog`, `/api/store-meta`).
10. **Error sanitization** — `userFacingError` (in `dashboard-web/src/app/api/dashboard-state/route.ts:18` and `dashboard-web/src/app/api/store-meta/route.ts:10`) translates raw Google API errors (which embed spreadsheet ID + service-account email) into Hebrew operator messages; raw logged server-side only.
11. **SyncIndicator surfacing** — `setSyncState({status: 'error', lastError})` (`dashboard-web/src/lib/cloudSync.ts:226`) drives the popover with sanitized error + remediation checklist.

## Cross-Cutting Concerns

**Logging:**
- Apps Script: `Logger.log(...)` → Stackdriver (configured in `appsscript.json:4`)
- Dashboard server: `console.error(...)` → Vercel logs
- Dashboard client: `console.warn` for sync failures (last-resort visibility on top of `SyncIndicator`)

**Validation:**
- Date format: `/^\d{4}-\d{2}-\d{2}$/.test(dateStr)` in `runUpdateForDate` (`DailyUpdate.gs:23`)
- Cloud-sync keys: `isAllowedStateKey` allowlist on POST (`dashboard-web/src/lib/sheets.ts:242`)
- Parser tolerance: `parseNumber` / `parseDate` (`dashboard-web/src/lib/sheets.ts:41-67`) return safe defaults for missing/malformed values

**Authentication:**
- Apps Script: runs as operator account; tokens in `PropertiesService.ScriptProperties`
- Dashboard server: Service Account via `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` env vars (`dashboard-web/src/lib/sheets.ts:9`)
- Dashboard client: no auth — open URL relies on Vercel deployment privacy + sheet visibility

**Caching:**
- Server: `Cache-Control` per route (see table above)
- Client: SWR dedupe interval 30s-300s
- FX: Frankfurter response cached 1h client-side (`fetchTodayFx` in `dashboard-web/src/app/api/data/route.ts:10`) + 24h server-side in Apps Script Script Properties

---

*Architecture analysis: 2026-05-18*
