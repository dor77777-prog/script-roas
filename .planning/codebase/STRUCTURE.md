# Codebase Structure

**Analysis Date:** 2026-05-18

## Directory Layout

```text
script-roas/
├── *.gs                          # Apps Script collection layer (V8 runtime)
├── appsscript.json               # Apps Script manifest (timezone, OAuth scopes)
├── README.md                     # Quick-start
├── WELCOME.md                    # Onboarding doc
├── SETUP.md                      # Full setup walk-through
├── SYSTEM_OVERVIEW.md            # End-to-end system architecture (canonical)
├── COGS_SETUP.md                 # COGS rate explanation
├── .planning/                    # GSD command output (plans, reviews, codebase maps)
│   ├── ROADMAP.md                # Phase tracker
│   ├── phases/                   # Phase-specific plan + research docs
│   │   └── 01-channel-level-product-attribution/
│   │       ├── 01-CONTEXT.md
│   │       ├── 01-PATTERNS.md
│   │       ├── 01-PLAN.md
│   │       ├── 01-PLAN-REVIEW.md
│   │       └── 01-RESEARCH.md
│   ├── reviews/                  # Post-execution code reviews
│   │   ├── REVIEW.md
│   │   ├── REVIEW-2.md
│   │   ├── REVIEW-3.md
│   │   ├── REVIEW-4.md
│   │   └── REVIEW-5.md
│   └── codebase/                 # GSD codebase maps (this file lives here)
└── dashboard-web/                # Next.js 15 dashboard (App Router)
    ├── package.json
    ├── tsconfig.json             # Path alias `@/*` → `./src/*`
    ├── next.config.ts
    ├── postcss.config.mjs
    ├── tailwind.config.ts
    └── src/
        ├── app/                  # App Router root
        │   ├── layout.tsx        # RTL <html dir="rtl"> + Heebo font
        │   ├── page.tsx          # Mounts <Dashboard />
        │   ├── globals.css
        │   └── api/              # 8 API routes
        ├── components/           # 31 React components
        └── lib/                  # 24 modules (parsers, attribution, sync, utils)
```

## Directory Purposes

**`/` (project root):**
- Purpose: Apps Script source files + global project docs
- Contains: 9 `.gs` files + `appsscript.json` manifest + setup/architecture markdowns
- Key files: `DailyUpdate.gs`, `SheetBuilder.gs`, `Config.gs`, `SYSTEM_OVERVIEW.md`

**`/dashboard-web/`:**
- Purpose: Next.js 15.5 dashboard app — separate deployment from Apps Script
- Contains: React 19 components, App Router pages, Tailwind, googleapis service-account integration
- Key files: `package.json`, `tsconfig.json`, `src/app/page.tsx`, `src/components/Dashboard.tsx`

**`/dashboard-web/src/app/`:**
- Purpose: Next.js App Router roots
- Contains: top-level layout, home page, 8 API route handlers
- Key files: `layout.tsx` (RTL config), `api/{route}/route.ts`

**`/dashboard-web/src/components/`:**
- Purpose: All UI React components (`.tsx`)
- Contains: 31 components — tabs, drawers, charts, modals, controls
- Key files: `Dashboard.tsx` (root), `CampaignsTable.tsx` (1732 lines — core surface), `CampaignDrawer.tsx` (1440), `BillingSettings.tsx` (1328)

**`/dashboard-web/src/lib/`:**
- Purpose: All non-React TypeScript modules — data parsers, business logic, sync engine, utilities
- Contains: 24 modules grouped by concern (data layer, attribution, cloud-sync, formatters)
- Key files: `sheets.ts` (server-side Sheets I/O), `cloudSync.ts` (write-through engine), `attributionAnalysis.ts` (trust-ladder engine), `analytics.ts` (aggregators)

**`/.planning/`:**
- Purpose: GSD command output — plans, reviews, codebase analyses
- Contains: `ROADMAP.md` + `phases/` + `reviews/` + `codebase/`
- Key files: `ROADMAP.md` (current phase tracker), `phases/01-channel-level-product-attribution/01-PLAN.md`

## Apps Script Files (project root, 9 `.gs` + manifest)

| File | Lines | Purpose |
|------|------:|---------|
| `Main.gs` | 132 | UI menu + setup helpers: `setupAll`, `installDailyTrigger`, `installLiveTrigger`, `onOpen` menu hook |
| `Config.gs` | 305 | Constants (`STORES`, `COGS_RATE_OF_REVENUE=0.25`), `getProp`/`setProp`, `fetchWithRetry_`, `verifyConfig`, `resetSpreadsheetIdToKnownGood`, `printCurrentSpreadsheetId`, tab-name helpers (`campaignTabName_`, `adsTabName_`, `ordersAttributionTabName_`) |
| `DailyUpdate.gs` | 614 | **Orchestration**: `runDailyUpdate`, `runLiveUpdate`, `runUpdateForDate`, `backfillRange`, `backfillRangeForStores`, `runUpdateForDateForStores_`, `updateStoreForDate_`, `updateCampaignDataForStoreDate_`, `updateAdDataForStoreDate_`, `writeDailyFlatRow_`, `writeProductSalesForDay_`, `notifyError_` (3-tier resolver) |
| `Shopify.gs` | 992 | Shopify REST + GraphQL clients: `getShopifyRevenue`, `getShopifyProductSalesForDay`, `getShopifyPlan` (GraphQL), `getShopifyProductsCatalog`, `getShopifyOrdersAttribution`, `classifyOrderAttribution_` (per-order source classification), `bootstrapShopifyTokenForStore_` (auto-bootstrap on 401), `safeDecode_` (URI guard) |
| `MetaAds.gs` | 580 | Meta Marketing API v20.0: `getMetaSpend` (account level), `getMetaAdSetInsights` (adset level), `getMetaAdInsights` (ad level), `getMetaBudgets` (CBO/ABO state) |
| `GoogleAds.gs` | 281 | Google Ads API v20: `getGoogleAdsSpend`, `getGoogleAdsAdGroupInsights`, OAuth refresh-token flow |
| `FX.gs` | 38 | `getFxRate(from, to, dateStr)` — Frankfurter API, daily cache in `PropertiesService` |
| `ManualOverrides.gs` | 379 | Read `manual-spend` tab — operator-written overrides that take precedence over API calls |
| `SheetBuilder.gs` | 2200+ | **Sheet plumbing**: `ensureSpreadsheet` (with retry + phantom protection), `getLayout_`, `getOrCreateMonthBlock_`, `createMonthBlock_`, `ensureDailyFlatTab_`, `ensureStoreMetaTab_`, `ensureCampaignTabHeaders_`, `ensureAdsTabHeaders_`, `ensureOrdersAttributionTab_`, `writeDayRow`, `writeCampaignRowsForDay`, `writeAdsRowsForDay`, `writeOrdersAttributionForDay`, `refreshAllProductCatalogs`, `catalogNeedsRefresh_`, `refreshAllStoreMeta`, chunked writes |
| `appsscript.json` | 14 | Manifest: timezone `Asia/Jerusalem`, V8 runtime, OAuth scopes (script.external_request, spreadsheets, drive, script.scriptapp, script.send_mail, userinfo.email), Stackdriver exception logging |

## Dashboard `src/app/api/` (8 routes)

```text
src/app/api/
├── ads/route.ts                 # GET — 300s s-maxage, graceful empty-on-error
├── campaigns/route.ts           # GET — 60s s-maxage, force-dynamic
├── dashboard-state/route.ts     # GET + POST — 10s s-maxage, no force-dynamic
├── data/route.ts                # GET — 60s s-maxage, also fetches FX (1h cache)
├── orders-attribution/route.ts  # GET — 300s s-maxage, graceful empty-on-error
├── product-catalog/route.ts     # GET — 60s s-maxage, 300s SWR
├── products/route.ts            # GET — 60s s-maxage, force-dynamic
└── store-meta/route.ts          # GET — 3600s s-maxage, 86400s SWR
```

## Dashboard `src/components/` (31 components)

### Tab + drawer tier (>200 lines)

| File | Lines | Role |
|------|------:|------|
| `CampaignsTable.tsx` | 1732 | Core surface — Meta + Google rows, sortable, attribution chip + fallback, opens CampaignDrawer |
| `BillingSettings.tsx` | 1328 | Modal — 3 tabs (recurring / one-time / CSV import) + Shopify-plan auto-detect |
| `CampaignDrawer.tsx` | 1440 | Drill-down — hero stats, daily chart, AttributionAnalysisPanel, MetaShopifyReconciliation, ad-sets table; z-50 |
| `ProductsTable.tsx` | 884 | Products tab table |
| `InsightsBoard.tsx` | 707 | Collapsable insights surface — anomalies / recommendations / forecasts + InsightHero (headline view) |
| `CommandPalette.tsx` | 626 | Cmd-K navigator |
| `AdsDrawer.tsx` | 586 | Ad-level drill-down from CampaignDrawer; z-60; per-ad trust chip |
| `Dashboard.tsx` | 545 | Root component — SWR setup, URL state, tab routing, header (CommandPalette + SyncIndicator) |
| `HeroOverview.tsx` | 525 | ROAS chart + annotation reference lines (HomeTab hero) |
| `PnLBreakdown.tsx` | 442 | Hero strip + Waterfall (Revenue → -Ad Spend → -COGS → -Tx Fees → -Fixed → True Net) |
| `ProductPickerModal.tsx` | 368 | Multi-select modal — campaign↔product mapping; z-[70] |
| `MonthlyTables.tsx` | 349 | Monthly per-store + combined summary tables |
| `AnnotationsPanel.tsx` | 347 | Annotation CRUD (8 event types) |
| `GoalTracker.tsx` | 335 | Monthly revenue goal + projected EoM |
| `KpiCards.tsx` | 327 | 4-column KPI strip with comparison-to-previous |
| `TodayLive.tsx` | 298 | Live tile — current day's snapshot (refreshed by 15-min Apps Script trigger) |
| `WhatsWorking.tsx` | 292 | Top-performers card |
| `AiReportButton.tsx` | 240 | Prompt assembly + copy-to-clipboard |

### Supporting tier (<200 lines)

| File | Lines | Role |
|------|------:|------|
| `RoasChart.tsx` | 178 | Multi-line trend chart per store |
| `MetricHelp.tsx` | 177 | Glossary tooltips |
| `Filters.tsx` | 172 | Date range + preset + store selector |
| `PerStoreCards.tsx` | 144 | 3 per-store summary cards |
| `SyncIndicator.tsx` | 127 | Cloud sync status pill in header (idle/syncing/ok/error) |
| `DetailTable.tsx` | 127 | DetailTab raw table |
| `Sparkline.tsx` | 108 | Inline mini-chart |
| `RollingNumber.tsx` | 102 | Animated number transition |
| `CollapsibleSection.tsx` | 96 | Reusable collapse primitive |
| `InsightsPanel.tsx` | 94 | Lightweight insights subset (legacy) |
| `TabNav.tsx` | 89 | Top tab strip |
| `SectionIntro.tsx` | 77 | Section header + description |
| `CloudSync.tsx` | 34 | Invisible mount that drives `hydrateFromCloud()` lifecycle |

## Dashboard `src/lib/` (24 modules)

### Data layer (parsers + server I/O)

| File | Lines | Role |
|------|------:|------|
| `sheets.ts` | 470 | Server-side Sheets I/O — `getAuth`, `fetchDailyData`, `fetchStoreMeta`, `fetchDashboardState`, `upsertDashboardStateKey`, `ALLOWED_STATE_KEYS` + `isAllowedStateKey` |
| `campaigns.ts` | 182 | Parse `{store}-campaigns` → `CampaignRow[]`; `fetchCampaignsData` batch across 3 stores |
| `ads.ts` | 150 | Parse `{store}-ads` → `AdRow[]`; `fetchAdsData` batch |
| `products.ts` | 123 | Parse `products-daily` → `ProductRow[]`; `fetchProductsData` |
| `productCatalog.ts` | 106 | Parse `{store}-products-catalog` → `CatalogProduct[]`; `fetchProductCatalog` |
| `ordersAttribution.ts` | 238 | Parse `{store}-orders-attribution` → `OrderAttributionRow[]`; includes `Line Items (JSON)` column parsing |

### Attribution + analytics layer

| File | Lines | Role |
|------|------:|------|
| `attributionAnalysis.ts` | 878 | **Core**: `analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd` + shared `buildAnalysis`; Bayesian CI, window stability, outlier detection, trust ladder; `orderMatchesCampaign` (utm_id authoritative) |
| `campaignProductMap.ts` | 157 | Many-to-many mapping + `allocateProductRevenue` (proportional split by spend) |
| `analytics.ts` | 176 | Aggregators — `aggregate`, `aggregateByStore`, `dailySeries`, `deltaPct`, `forecastMonthEnd`, `filterRows`, `COGS_RATE_OF_REVENUE=0.25` |
| `insights.ts` | 671 | InsightsBoard engine — anomalies (z-score), recommendations, forecasts; 5 severity levels; insight-states lifecycle (handled/hidden) |
| `aiReport.ts` | 564 | AI prompt assembly across all data in selected range |
| `billing.ts` | 561 | Recurring + one-time costs + CSV importer + `billingForRange` proration; CSV classifier heuristic + `findMatchingRecurring` dedup |

### Cloud sync layer

| File | Lines | Role |
|------|------:|------|
| `cloudSync.ts` | 413 | `STATE_KEYS` (7), `CHANGE_EVENTS`, `pushCloudKey` (debounced 400ms), `hydrateFromCloud` (30s poll), `postWithRetry`, `SyncState`, `HYDRATE_GRACE_MS=8000` |
| `annotations.ts` | 113 | Annotation CRUD + scope filtering; 8 event types |
| `campaignOptimized.ts` | 61 | Optimization marks `Set<storeId::platform::campaignId::adSetId::adId>` + toggle/clear |

### UI helpers + state

| File | Lines | Role |
|------|------:|------|
| `drawerStack.ts` | 62 | `useDrawerEsc(open, onClose)` — single shared Esc listener over nested drawer stack |
| `urlState.ts` | 110 | URL ↔ `{tab, filters}` serialization for refresh/bookmark restore |
| `presets.ts` | 85 | Date-range presets (`this_month`, `last_7_days`, `last_30_days`, …) + `previousRange` |
| `campaignsLinks.ts` | 100 | `buildAdsManagerLink` — `act=` / `__c=` / `selected_ad_ids=` deep links |
| `format.ts` | 164 | Extra formatters (Hebrew labels, compact numbers) |
| `utils.ts` | 36 | `formatCurrency`, `formatNumber`, `formatDate`, `cn` (clsx + twMerge) |
| `constants.ts` | 24 | `FROZEN_USD_TO_CAD` fallback rate |
| `costs.ts` | 112 | `TRANSACTION_FEES_RATE=0.065` + cost-line helpers |
| `types.ts` | 41 | Shared types: `DailyRow`, `DashboardData`, `DateRange`, `PresetKey`, `Filters` |

## `.planning/` structure

```text
.planning/
├── ROADMAP.md                                 # Current phase + status tracker
├── phases/
│   └── 01-channel-level-product-attribution/  # Per-product channel breakdown work
│       ├── 01-CONTEXT.md                      # Background + goal
│       ├── 01-PATTERNS.md                     # Patterns to follow
│       ├── 01-PLAN.md                         # Atomic task list
│       ├── 01-PLAN-REVIEW.md                  # Review of plan
│       └── 01-RESEARCH.md                     # Research notes
├── reviews/                                   # Post-execution code reviews (5 rounds)
│   ├── REVIEW.md
│   ├── REVIEW-2.md
│   ├── REVIEW-3.md
│   ├── REVIEW-4.md
│   └── REVIEW-5.md
└── codebase/                                  # GSD codebase maps (auto-generated)
    ├── ARCHITECTURE.md
    └── STRUCTURE.md
```

**Phase numbering convention** (per `ROADMAP.md`):
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Phase 0 (retroactive): Foundation (Apps Script + Dashboard + 5 rounds of code review)

## Key File Locations

**Entry Points:**
- `Main.gs:9` (`setupAll`): One-time Apps Script setup — creates spreadsheet, builds tabs, installs triggers
- `DailyUpdate.gs:10` (`runDailyUpdate`): Daily trigger entry — 00:05 IL
- `DailyUpdate.gs:18` (`runLiveUpdate`): Live trigger entry — every 15 min
- `dashboard-web/src/app/page.tsx`: Dashboard root route → mounts `<Dashboard />`
- `dashboard-web/src/components/Dashboard.tsx:67`: Dashboard component root

**Configuration:**
- `Config.gs:6-26`: `TZ`, `SUMMARY_TAB`, `DAILY_FLAT_TAB`, `COGS_RATE_OF_REVENUE`, `STORES` array
- `appsscript.json`: Apps Script manifest (V8, timezone, OAuth scopes)
- `dashboard-web/package.json`: Dependencies — Next 15.5, React 19, googleapis 144, swr 2.3, recharts 2.15, date-fns 4.1, tailwind 3.4
- `dashboard-web/tsconfig.json`: Strict TypeScript + `@/*` path alias
- `dashboard-web/next.config.ts`: Next config
- `dashboard-web/tailwind.config.ts`: Tailwind config (RTL via `dir="rtl"` in `app/layout.tsx`)
- Vercel env: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`
- Apps Script `PropertiesService.ScriptProperties`: `spreadsheet.id`, `{storeId}.shopify.token`, `{storeId}.meta.account`, `{storeId}.google.customer`, `notification.email`

**Core Logic:**
- `DailyUpdate.gs:74` (`updateStoreForDate_`): Single-store daily sweep — orchestrates all 8 tab writes
- `SheetBuilder.gs:79` (`ensureSpreadsheet`): Phantom-spreadsheet protection
- `dashboard-web/src/lib/cloudSync.ts:143` (`pushCloudKey`): Write-through to cloud
- `dashboard-web/src/lib/sheets.ts:348` (`upsertDashboardStateKey`): Server-side cloud-state writer with dedup
- `dashboard-web/src/lib/attributionAnalysis.ts`: Trust-ladder engine

**Testing:**
- No automated test directory exists. Manual verification is via dashboard hard-refresh + Apps Script `Logger.log` traces.

## Naming Conventions

**Files:**
- Apps Script: PascalCase `.gs` (`DailyUpdate.gs`, `SheetBuilder.gs`)
- React components: PascalCase `.tsx` (`CampaignsTable.tsx`, `CampaignDrawer.tsx`)
- TypeScript lib modules: camelCase `.ts` (`cloudSync.ts`, `attributionAnalysis.ts`)
- API routes: Next convention `route.ts` inside lowercase-kebab dir (`api/orders-attribution/route.ts`)

**Directories:**
- Sheet tabs: kebab-case for shared tabs (`data-daily`, `products-daily`, `store-meta`, `dashboard-state`)
- Sheet tabs: `{storeId}-{kind}` for per-store tabs (`uzoshop-campaigns`, `zolplus-ads`, `usmile360-orders-attribution`)
- Phase dirs: numeric prefix + kebab-case (`.planning/phases/01-channel-level-product-attribution/`)

**Functions (Apps Script):**
- Public (callable from menu/trigger): camelCase (`runDailyUpdate`, `setupAll`, `refreshAllProductCatalogs`)
- Private (internal helpers): trailing underscore (`_`) — `updateStoreForDate_`, `notifyError_`, `safeDecode_`, `classifyOrderAttribution_`, `ensureSpreadsheet`

**Functions (TypeScript):**
- camelCase exports (`fetchDailyData`, `pushCloudKey`, `analyzeAttribution`, `allocateProductRevenue`)
- React component exports: PascalCase (`<Dashboard />`, `<CampaignsTable />`)
- Hooks: `use` prefix (`useDrawerEsc`, `useSWR`)

**Types:**
- PascalCase: `DailyRow`, `CampaignRow`, `OrderAttributionRow`, `AttributionAnalysis`, `StateKey`

**Constants:**
- UPPER_SNAKE_CASE for module-level (`STATE_KEYS`, `ALLOWED_STATE_KEYS`, `COGS_RATE_OF_REVENUE`, `HYDRATE_GRACE_MS`, `STORES`, `TZ`)

## Where to Add New Code

**New API route (Dashboard reads a new sheet tab):**
- Add tab parser: `dashboard-web/src/lib/{newTab}.ts` (export `fetchXxx`, `XxxRow` type)
- Add route: `dashboard-web/src/app/api/{kebab-name}/route.ts` — copy from `dashboard-web/src/app/api/ads/route.ts` for the soft-fail-on-error pattern
- Set explicit `revalidate` + `Cache-Control: s-maxage=...` based on update frequency (compare to existing routes)
- Do **not** add `force-dynamic` if you also set `Cache-Control` (IN-04 anti-pattern)

**New Apps Script collector (new external API):**
- New file at root: `{Provider}.gs` (PascalCase, no underscore — globals export to all `.gs` files)
- Helper-style functions use trailing `_` (e.g. `fetchProviderData_`)
- Call from `updateStoreForDate_` (`DailyUpdate.gs:74`) wrapped in try/catch
- Use `fetchWithRetry_` from `Config.gs` for HTTPS

**New sheet tab type:**
- Add tab-name helper to `Config.gs` (e.g. `myNewTabName_(storeId)`)
- Add `ensureMyNewTab_(ss)` + headers in `SheetBuilder.gs` (idempotent: check existence then ensure headers)
- Add `writeMyNewTabForDay(ss, storeId, dateStr, rows)` — filter rows for date first, then append (idempotent invariant)
- Wire into `updateStoreForDate_` in `DailyUpdate.gs` between try/catch
- Dashboard side: parser in `dashboard-web/src/lib/`, route in `dashboard-web/src/app/api/`

**New component:**
- Place in `dashboard-web/src/components/{NewName}.tsx`
- Import via `@/components/NewName` (path alias)
- Add `'use client';` directive if it uses state/hooks
- Tab-level components compose into `dashboard-web/src/components/Dashboard.tsx`
- Drawer-level components register `useDrawerEsc(open, onClose)` from `@/lib/drawerStack`

**New cloud-sync key:**
- Append to `STATE_KEYS` (`dashboard-web/src/lib/cloudSync.ts:47`)
- Append to `ALLOWED_STATE_KEYS` (`dashboard-web/src/lib/sheets.ts:231`) — **must** stay in sync
- Append to `CHANGE_EVENTS` (`dashboard-web/src/lib/cloudSync.ts:58`) with a unique event name
- Add read/write helpers in a dedicated module (e.g. `dashboard-web/src/lib/myFeature.ts`)
- Read path: `localStorage.getItem` + `JSON.parse`
- Write path: `localStorage.setItem` + `window.dispatchEvent(new Event(CHANGE_EVENTS[key]))` + `pushCloudKey(key, value)`

**Utilities:**
- Pure formatters/helpers → `dashboard-web/src/lib/utils.ts` or `dashboard-web/src/lib/format.ts`
- Type-only exports → `dashboard-web/src/lib/types.ts`

**New phase plan:**
- `.planning/phases/{NN-kebab-name}/` directory
- Files: `NN-CONTEXT.md`, `NN-RESEARCH.md`, `NN-PLAN.md`, `NN-PLAN-REVIEW.md`, `NN-PATTERNS.md` (driven by GSD commands)
- Update `.planning/ROADMAP.md` checkbox state

## Special Directories

**`/dashboard-web/node_modules/`:**
- Purpose: npm install output
- Generated: Yes
- Committed: No (gitignored)

**`/dashboard-web/.next/`:**
- Purpose: Next.js build output (cached incrementally via `tsconfig.tsbuildinfo`)
- Generated: Yes (on `npm run build` / `npm run dev`)
- Committed: No (gitignored)

**`/.vercel/`:**
- Purpose: Vercel CLI link to project
- Generated: Yes
- Committed: No

**`/.planning/`:**
- Purpose: GSD command output — plans, reviews, codebase maps
- Generated: Yes (by GSD commands)
- Committed: Yes (long-lived project record)

**`/.git/`:**
- Purpose: Git internals
- Committed: No (managed by git)

---

*Structure analysis: 2026-05-18*
