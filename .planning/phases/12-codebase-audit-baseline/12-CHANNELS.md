# Phase 12 — Inter-Component Channels Map

**Sources:** 144 raw-return JSON files (`.planning/phases/12-codebase-audit-baseline/raw-returns/*.json`) + graphify graph (7,625 nodes / 9,107 edges) in `.planning/graphs/graph.json`.
**Channel-type sections:** 7
**Total unique channels enumerated:** 428 import edges · 26 events emitted · 30 event consumers · 29 SWR keys · 25 Inngest triggers · 23 Supabase write tables · 27 Supabase read tables · 62 external API calls.

This document is a bird's-eye index. Every channel cites its source file (the writer/emitter/caller) and consumers. Use it to trace any cross-file impact in 1–2 hops. Findings that are CHANNEL-DRIVEN (not file-local) are listed in the final section with cross-refs into `AUDIT.md`.

> Reading guide: a "channel" is anything that crosses a TypeScript module boundary at runtime, including imports, props, custom `window` events, SWR-mutate predicates, Inngest event-bus payloads, Supabase tables, and external HTTP endpoints. Pure type-only edges are folded into Section 1 (imports) since the type author is the contract owner.

---

## Section 1: Module imports

High-level TS import graph aggregated by source directory. The graphify node enumeration confirms 9,107 directed edges; per-file reviewers surfaced 428 of those as cross-file business-logic edges (the rest are type-only or test-only).

### 1.1 Import volume by source directory

| Source dir              | Outgoing edges | Notable role                                                                                  |
| ----------------------- | -------------: | --------------------------------------------------------------------------------------------- |
| `components/**`         |            241 | Heavy consumers of `@/lib/*`, `@/app/api/**/route` (type-only response shapes), and siblings. |
| `lib/**`                |             72 | Algorithm + state modules; mostly intra-lib + `@/lib/types` + `@/lib/utils`.                  |
| `app/api/**/route.ts`   |             58 | Each route imports `@/lib/postgresReaders`, `@/lib/dateRange`, `@/lib/cacheConfig`, `@/lib/apiErrors`. |
| `inngest/**`            |             30 | Functions import `@/lib/fetchers/*`, `@/lib/supabaseAdmin`, `@/lib/platformConfig`.            |
| `lib/hooks/**`          |             13 | `useBilling*`, `useCampaign*` — fan in to `BillingSettings`, `CampaignsTable`, `CampaignDrawer`. |
| `lib/notifications/**`  |              8 | `sendDailySummary`, `whatsapp`, `summary`, `templateParams`, `tokenFailures` — chain inside notifications. |
| `lib/fetchers/**`       |              4 | Mostly intra-fetcher (`shopifyAuth → shopify`, `fx → meta/shopify/manualOverrides`).           |
| `components/operator/**`|              2 | Thin shells; most logic delegated to server routes via `fetch`.                                |

### 1.2 Top-frequency imported modules (consumer count)

| Importees                                    | Count | Pattern                                                              |
| -------------------------------------------- | ----: | -------------------------------------------------------------------- |
| `@/lib/utils`                                |    38 | `cn()` + small format helpers — used by ~every component.            |
| `@/lib/analytics`                            |    15 | `aggregate`, `aggregateByStore`, `dailySeries`, `filterRows`, `roasLabel`. |
| `@/lib/apiErrors (userFacingError)`          |    15 | Every API route normalises errors through this single helper.        |
| `@/lib/types`                                |    14 | `DailyRow`, `Filters`, `DateRange`, `PresetKey` shared everywhere.   |
| `@/lib/dateRange`                            |    10 | `buildDateRangeKey`, `parseRangeParams`, `RangeParamError`.          |
| `@/lib/cacheConfig (cacheControl)`           |    10 | Identical Cache-Control header construction across 10 API routes.    |
| `@/app/api/products/route`                   |     9 | Type-only import of `ProductsResponse` by frontend consumers.        |
| `@/app/api/campaigns/route`                  |     9 | Type-only import of `CampaignsResponse`.                             |
| `@/app/api/orders-attribution/route`         |     5 | Type-only import of `OrdersAttributionResponse`.                     |
| `@/inngest/client`                           |     5 | The `inngest` singleton used by every function + 3 operator routes.  |
| `@/lib/supabaseAdmin (getSupabaseAdmin)`     |     4 | Service-role writer; only Inngest functions + operator routes hold it.|
| `@/lib/attributionAnalysis`                  |     6 | Pearson, `analyzeAttribution`, `analyzeProductChannel` — drawer + AI chain.|
| `@/lib/campaignProductMap`                   |     6 | `campaignKey`, `ProductMap`, `allocateProductRevenue` — touched on every product↔campaign join. |
| `@/lib/campaignHealthScore`                  |     5 | `computeCampaignHealth`, `applyCohortAdjustmentOnce` — `CampaignsTable`, `CampaignDrawer`, `HealthScoreBadge`, `HealthScorePanel`, `aiReport`. |
| `@/lib/presets`                              |     4 | `Dashboard`, URL state helpers, `DateRangePicker`, `RangeSelector`.  |

### 1.3 Re-export / type-export edges worth knowing

These are "type-channel" edges that look load-bearing in graphify because the producer owns the response contract:

| Type owner                              | Type exported                       | Type consumers                                                            |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `app/api/ads/route.ts`                  | `AdsResponse`                       | `AdsDrawer.tsx`, `AiReportButton.tsx`                                     |
| `app/api/campaigns/route.ts`            | `CampaignsResponse`                 | `CampaignsTable`, `CampaignDrawer`, `CommandPalette`, `InsightsBoard`, `HeroOverview`, `ProductCentricView`, `TodayLive`, `WhatsWorking`, `AiReportButton`, `useCampaignTrueRevenue` |
| `app/api/data/route.ts`                 | `DashboardData`                     | `Dashboard`, `KpiCards`, `GoalTracker`, `MonthlyTables`, `TodayLive`      |
| `app/api/orders-attribution/route.ts`   | `OrdersAttributionResponse`         | `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `CampaignDrawer`, `AdsDrawer`, `AiReportButton`, `CampaignsTable`, `TodayLive`, `Dashboard` |
| `app/api/product-catalog/route.ts`      | `ProductCatalogResponse`            | `ProductPickerModal`, `productCatalog.ts` downstream                      |
| `app/api/products/route.ts`             | `ProductsResponse`                  | `ProductsTable`, `ProductCentricView`, `CampaignsTable`, `CampaignDrawer`, `AiReportButton`, `CommandPalette`, `InsightsBoard`, `ProductPickerModal`, `WhatsWorking` |
| `app/api/health/route.ts`               | `HealthResponse`                    | `SyncIndicator` (SWR poll, 30 s)                                          |
| `app/api/store-meta/route.ts`           | `StoreMeta`                         | `BillingSettings`, `CampaignsTable`                                       |
| `lib/types.ts`                          | `DailyRow`, `Filters`, `DateRange`, `PresetKey` | broad (most lib/ + components)                                |
| `lib/campaignProductMap.ts`             | `ProductMap`, `campaignKey`, `allocateProductRevenue` | `CampaignsTable`, `CampaignDrawer`, `CampaignsTableRow`, `ProductCentricView`, `MetaShopifyReconciliation`, `aiReport`, `cannibalizationDetection`, `multiMappingCohort`, `productCentricView`, `hooks/useCampaignTrueRevenue` |
| `lib/campaignsAggregator.ts`            | `Aggregated`                        | `CampaignsTable`, `CampaignsTableRow`, `ProductCentricView`, `aiReport`, `campaignHealthScore`, `multiMappingCohort`, `productCentricView`, `useCampaignTrueRevenue` |
| `lib/attributionAnalysis.ts`            | `AttributionAnalysis`, `AttributionTrust` | `AdSetTable`, `AdsDrawer`, `AttributionAnalysisPanel`, `CampaignDrawer`, `CampaignsTableRow`, `MetaShopifyReconciliation`, `ProductChannelBreakdown`, `aiReport`, `useCampaignAttribution`, `useCampaignTrueRevenue` |
| `lib/platformConfig.ts` (NEW per U-01)  | `TIKTOK_ACTIVE_ENOUGH`              | `inngest/functions/cronLive.ts`, `lib/postgresReaders.ts` (the writer/reader symmetry single-source-of-truth) |

### 1.4 Critical convergence points (graphify communities)

`GRAPH_REPORT.md` lists 564 communities; the densest one for in-scope code is the `Campaigns ↔ Drawer ↔ HealthScore ↔ Cohort` cluster, which spans `CampaignsTable`, `CampaignsTableRow`, `CampaignDrawer`, `AdsDrawer`, `CohortComparisonPanel`, `HealthScorePanel`, `HealthScoreBadge`, plus `lib/campaignHealthScore`, `lib/campaignsAggregator`, `lib/cpmRoasAnalysis`, `lib/multiMappingCohort`, `lib/cannibalizationDetection`, `lib/attributionAnalysis`, `lib/campaignProductMap`. A change to any single one of those algorithm files will likely break tests in 3+ component files.

---

## Section 2: Component props drilling

These are the major parent → child prop chains. Custom DOM events are intentionally excluded here (covered in Section 3); a prop chain is data that flows down via JSX attributes only.

### 2.1 Root render tree (Dashboard.tsx fans out)

`src/app/page.tsx` mounts `<Dashboard />`. From `Dashboard.tsx`, the following components are direct children, all of which receive `data`, `range`, `filters` (and sometimes derived `ordersByStore`, `storeAggs`) via props:

```
Dashboard
├── Filters                        (state-up: filters)
├── KpiCards                       (data, ordersByStore, range, filters)
├── PerStoreCards                  (storeAggs, ordersByStore)
├── RoasChart                      (data, range, filters)
├── MonthlyTables                  (own SWR for 17-month history range; data prop on top)
├── DetailTable                    (rows derived from data)
├── TodayLive                      (independent SWR — operator-confirmed intentional duplicate)
├── ProductsTable                  (own SWR keyed by localRange)
├── ProductCentricView             (own SWR; gated on filters.store !== 'All')
├── CampaignsTable                 (own SWR for /api/campaigns + /api/products + /api/orders-attribution + /api/store-meta)
├── InsightsBoard                  (own SWR for /api/campaigns + /api/products)
├── GoalTracker                    (intentionally NO filters/range — operator constraint d/CR-04 revert)
├── AiReportButton                 (own SWR for /api/ads + /api/orders-attribution + /api/products + /api/campaigns)
├── HeroOverview                   (data, range, filters; own SWR for /api/campaigns prev period)
├── PnLBreakdown                   (data, range, billing — listens for roas-billing-changed)
├── BillingSettings                (no data prop; pulls /api/store-meta + cloud sync state)
├── AnnotationsPanel               (no data prop; listens for roas-annotations-changed)
├── CommandPalette                 (own SWR for /api/campaigns + /api/products; window keydown)
├── TabNav                         (state-up: activeTab, URL state)
├── CloudSync                      (mounted-once; no data prop; window focus + cloud rehydrate)
├── SyncIndicator                  (own SWR for /api/health + /api/cloud-state)
└── FreshnessChip / TabFreshnessHeader  (presentational; data freshness timestamps)
```

### 2.2 Campaigns ↔ Drawer ↔ AdsDrawer chain

This is the biggest prop chain by surface area (2275 LOC in `CampaignsTable.tsx`):

```
CampaignsTable                       (data, range, filters; SWR ×5)
├── CampaignsTableRow                (a, health, mappedCampaignKeys, columnOrder, optimized, today, … +N)
│   └── HealthScoreBadge             (health prop, derived from CampaignHealth type)
├── CampaignsColumnsMenu             (current visibility map; emits visibility-changed event)
├── CampaignDrawer                   (campaign, range, filters; own SWR ×4)
│   ├── AdSetTable                   (adSets prop from parent SWR; onSort/onToggleOptimized/onDrillAds callbacks)
│   │   └── ↑ onDrillAds → AdsDrawer
│   ├── ProductPickerModal           (productCatalog prop; own SWR for /api/product-catalog)
│   ├── HealthScorePanel             (health prop; renders CampaignHealth breakdown)
│   ├── AttributionAnalysisPanel     (pre-computed analysis prop; pure presentation)
│   ├── ProductChannelBreakdown      (pre-computed prop; pure presentation)
│   ├── MetaShopifyReconciliation    (uses lib/attributionAnalysis.pearson + pearsonWithLag)
│   └── CohortComparisonPanel        (cohort prop; emits onDrillCampaign)
└── AdsDrawer                        (ads, ordersByAd; own SWR ×2; emits onDrillCampaign back to parent)
```

Shared types crossing the chain: `CampaignHealth` (campaignHealthScore.ts), `Aggregated` (campaignsAggregator.ts), `ProductMap` (campaignProductMap.ts), `AttributionAnalysis` + `AttributionTrust` (attributionAnalysis.ts), `MultiMappingCohort` + `CohortMember` (multiMappingCohort.ts), `CannibalizationVerdict` (cannibalizationDetection.ts), `CpmRoasAnalysis` (cpmRoasAnalysis.ts).

### 2.3 Other notable prop chains

| Parent                    | Children                                                                            | Shared types                                |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `HeroOverview`            | `RollingNumber`, `Sparkline`, `MetricHelp`                                          | `Aggregate` (analytics.ts), geometry locals |
| `KpiCards`                | `RollingNumber`, `Sparkline`, `MetricHelp`                                          | `Aggregate`                                 |
| `MonthlyTables`           | `RefundIndicator`, `CollapsibleSection`                                             | row shape from `lib/types`                  |
| `DetailTable`             | `RefundIndicator`                                                                   | row shape from `lib/types`                  |
| `InsightsBoard`           | `InsightsPanel`, `WhatsWorking`, `CollapsibleSection`                               | `Insight` (insights.ts)                     |
| `BillingSettings`         | `BillingCsvImport`                                                                  | `SOURCE_LABEL`, `SOURCE_COLOR` re-export    |
| `Dashboard` (operator UI) | (operator route) mounts `BackfillPicker`, `JobsTable`, `ManualOverridesCrud`, `ResetData`, `SyncNowButtons`, `TokenFailuresTable`, `WhatsappTestButtons` | All operator components emit POST → API route → Inngest event (no prop chain) |

---

## Section 3: Custom DOM events

These are `CustomEvent`-typed `window.dispatchEvent` channels — implicit fan-out used to invalidate cached state across the React tree without a context provider.

| Event name                                  | Emitted by                                                                                                                                                              | Consumed by                                                                                                                                                              | Notes                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `roas-billing-changed`                      | `lib/billing.ts` (`writeRecurring`, `writeOneTime`); `lib/cloudSync.ts` (rehydrate path); `components/BillingSettings.tsx` (via the hooks)                              | `components/Dashboard.tsx` (billingTick → forces aggregate re-compute), `components/PnLBreakdown.tsx`, `lib/hooks/useBillingOneTime.ts`, `lib/hooks/useBillingRecurring.ts`, `components/BillingSettings.tsx` (self-consume via hooks) | Fan-out = 5 consumers. Audit fix CR-02/CRIT-3/HIGH-8: range now passed down so re-aggregate is correct.              |
| `roas-goal-changed`                         | `lib/insights.ts` (`writeGoal`); `lib/cloudSync.ts` (rehydrate); `components/GoalTracker.tsx` (writeGoal)                                                               | `components/GoalTracker.tsx` (self-consume; rebroadcasts to other tabs via storage)                                                                                       | Single-component channel today; goal is intentionally GLOBAL (no `filters.store`).                                   |
| `roas-annotations-changed`                  | `lib/annotations.ts`; `lib/cloudSync.ts` (rehydrate); `components/AnnotationsPanel.tsx`                                                                                  | `components/AnnotationsPanel.tsx`, `components/HeroOverview.tsx` (chart overlay)                                                                                          | 2 consumers — annotations panel refreshes its list, hero re-renders chart overlay.                                   |
| `roas-insight-states-changed`               | `lib/insights.ts` (`writeInsightStates`); `lib/cloudSync.ts` (rehydrate); `components/InsightsBoard.tsx`                                                                | `components/InsightsBoard.tsx`                                                                                                                                            | Single-component fan-out.                                                                                            |
| `roas-campaign-optimized-changed`           | `lib/campaignOptimized.ts`; `lib/cloudSync.ts` (rehydrate)                                                                                                              | `components/CampaignsTable.tsx`, `components/CampaignDrawer.tsx`, `components/AdsDrawer.tsx`                                                                              | 3 consumers — used by the user's "Mark optimized" toggle.                                                            |
| `roas-campaign-product-map-changed`         | `lib/campaignProductMap.ts` (via cloudSync; the file dispatches itself per its uncertainty notes); `lib/cloudSync.ts` (rehydrate)                                       | `components/CampaignsTable.tsx`, `components/CampaignDrawer.tsx`, `components/ProductCentricView.tsx`                                                                     | 3 consumers — re-runs `migrateProductMapKeys` (WR-02 invariant: runs on EVERY data change).                          |
| `roas-campaigns-column-visibility-changed`  | `lib/campaignsColumnPrefs.ts`; `lib/cloudSync.ts` (rehydrate); `components/CampaignsColumnsMenu.tsx` (toggle/move/reset/restore)                                         | `components/CampaignsColumnsMenu.tsx`, `components/CampaignsTable.tsx`                                                                                                    | Column reorder/visibility sync.                                                                                      |
| `roas-cloud-hydrated`                       | `lib/cloudSync.ts` (`hydrateFromCloud`); `components/CloudSync.tsx`                                                                                                     | `components/BillingSettings.tsx`                                                                                                                                          | Marker that initial cloud state has loaded — BillingSettings uses it to seed defaults.                               |
| `roas-cloud-sync-state`                     | `lib/cloudSync.ts`                                                                                                                                                       | `components/SyncIndicator.tsx`                                                                                                                                            | Pushes sync status ('synced' / 'pending' / 'error') to the header indicator.                                         |
| `roas-cloud-clear-conflict`                 | `lib/cloudSync.ts`                                                                                                                                                       | (no documented consumer in the per-file reviews — graph confirms zero readers)                                                                                            | Dispatched but unread. Possible cleanup target — see Section 8 finding CHN-04.                                       |

Other inline DOM-side channels surfaced by reviewers (kept for completeness — not custom events but window-level listeners):

| Listener                                    | Bound by                                          | Role                                                                                                       |
| ------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `window focus`                              | `components/CloudSync.tsx`                        | Re-hydrate cloud state when tab regains focus.                                                             |
| `window keydown` (global)                   | `lib/drawerStack.ts` (`useDrawerEsc`)             | Esc-to-close stack support for the drawer chain.                                                           |
| `window keydown` (Cmd+K, Esc, Arrow, Enter) | `components/CommandPalette.tsx`                   | Palette open/close + navigation.                                                                           |
| `unhandledrejection` / `error`              | (`lib/apiErrors.ts` not directly; only normalizes API responses) | Not currently wired; see CHN-05.                                                                |

---

## Section 4: SWR fetch keys

Every `useSWR` key the per-file reviewers surfaced. The same physical endpoint may appear under several distinct SWR keys because each consumer encodes its `from`/`to`/extra params differently.

### 4.1 By endpoint

| Endpoint                                    | SWR key forms in use                                                                              | Consumers                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/data`                             | `/api/data?from=&to=`; `/api/data?from=YYYY-MM-DD&to=YYYY-MM-DD`; `/api/data?from=&to= (history range — 17 months)`; `/api/data?from=today&to=today` | `components/Dashboard.tsx`, `components/MonthlyTables.tsx`, `components/TodayLive.tsx`                                                                                |
| `GET /api/campaigns`                        | `/api/campaigns`; `/api/campaigns?from=&to=`; `/api/campaigns?from=&to= (prev period)`; `/api/campaigns?from=&to= (prev)`; `/api/campaigns?from=today&to=today`; `/api/campaigns?from=YYYY-MM-DD&to=YYYY-MM-DD` | `components/CampaignsTable.tsx`, `components/CampaignDrawer.tsx`, `components/HeroOverview.tsx`, `components/ProductCentricView.tsx`, `components/AiReportButton.tsx`, `components/CommandPalette.tsx`, `components/InsightsBoard.tsx`, `components/WhatsWorking.tsx`, `components/TodayLive.tsx` |
| `GET /api/products`                         | `/api/products`; `/api/products?from=&to=`; `/api/products?from=&to= (range-keyed via localRange)` | `components/AiReportButton.tsx`, `components/CampaignDrawer.tsx`, `components/CampaignsTable.tsx`, `components/CommandPalette.tsx`, `components/InsightsBoard.tsx`, `components/ProductCentricView.tsx`, `components/ProductPickerModal.tsx`, `components/ProductsTable.tsx`, `components/WhatsWorking.tsx` |
| `GET /api/orders-attribution`               | `/api/orders-attribution?from=&to=`; `/api/orders-attribution?from=&to=&lineItems=true`; `/api/orders-attribution?from=today&to=today` | `components/Dashboard.tsx`, `components/AdsDrawer.tsx`, `components/AiReportButton.tsx`, `components/CampaignDrawer.tsx`, `components/CampaignsTable.tsx`, `components/TodayLive.tsx`            |
| `GET /api/ads`                              | `/api/ads?from=&to=`; `/api/ads?from=YYYY-MM-DD&to=YYYY-MM-DD via buildDateRangeKey`              | `components/AdsDrawer.tsx`, `components/AiReportButton.tsx`                                                                                                            |
| `GET /api/store-meta`                       | `/api/store-meta`                                                                                  | `components/BillingSettings.tsx`, `components/CampaignsTable.tsx`                                                                                                      |
| `GET /api/product-catalog`                  | `/api/product-catalog`                                                                             | `components/ProductPickerModal.tsx`                                                                                                                                    |
| `GET /api/dashboard-state`                  | `/api/dashboard-state`                                                                             | `lib/cloudSync.ts` (the only direct caller; behaves as a one-shot fetch on hydrate)                                                                                    |
| `GET /api/health`                           | `/api/health`                                                                                      | `components/SyncIndicator.tsx` (polled every 30 s)                                                                                                                      |
| `GET /api/operator/jobs`                    | `/api/operator/jobs?limit=50`; `/api/operator/jobs (mutate after success)`                         | `components/operator/JobsTable.tsx`, `components/operator/ResetData.tsx` (mutate-after-success)                                                                        |
| `GET /api/operator/manual-overrides`        | `/api/operator/manual-overrides`; `/api/operator/manual-overrides (mutate after success)`          | `components/operator/ManualOverridesCrud.tsx`, `components/operator/ResetData.tsx`                                                                                    |
| `GET /api/operator/token-failures`          | `/api/operator/token-failures`                                                                     | `components/operator/TokenFailuresTable.tsx`                                                                                                                            |
| Cross-cutting mutate predicate              | `() => true` (wildcard — refreshes EVERY SWR key)                                                  | `lib/useDashboardRefresh.ts` (the "Refresh" button hook)                                                                                                                |

### 4.2 SWR key helper

All range-keyed consumers go through `buildDateRangeKey` in `lib/dateRange.ts`. That helper is the canonical place to look when a key form looks inconsistent across consumers — it normalises `from`/`to` to ISO YYYY-MM-DD before stringification.

---

## Section 5: Inngest event channels

The Inngest event bus is the system's only cross-process channel. Every event is either a cron tick or an operator-emitted `inngest.send` payload.

### 5.1 Cron triggers

| Cron expression                                                  | Function (file)                                                       | Per-store fan-out                                                       | Notes                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `TZ=Asia/Jerusalem 5 0 * * *` (00:05 IL daily)                   | `inngest/functions/cronDaily.ts`                                       | 3 functions: `cron-daily-uzoshop`, `cron-daily-zolplus`, `cron-daily-usmile360` | Pulls Shopify orders + Meta/Google/TikTok spend; writes 6 Supabase tables (see §6). |
| `TZ=Asia/Jerusalem */10 * * * *` (every 10 min)                  | `inngest/functions/cronLive.ts`                                        | 3 functions: `cron-live-uzoshop`, `cron-live-zolplus`, `cron-live-usmile360` | 144 ticks/day/store. **Note discrepancy:** `app/api/inngest/route.ts` reviewer documented `*/15`, but `cronLive.ts` reviewer documented `*/10` — verify in `inngest/route.ts` source. |
| `TZ=Asia/Jerusalem 0 12 * * *` (12:00 IL daily)                  | `inngest/functions/cronWhatsapp.ts` (`whatsappNoon`)                   | Single function                                                          | Sends WhatsApp noon summary via `lib/notifications/sendDailySummary`.          |
| `TZ=Asia/Jerusalem 0 18 * * *` (18:00 IL daily)                  | `inngest/functions/cronWhatsapp.ts` (`whatsappEvening`)                | Single function                                                          | Evening summary.                                                                |
| `TZ=Asia/Jerusalem 30 0 * * *` (00:30 IL daily)                  | `inngest/functions/cronWhatsapp.ts` (`whatsappEod`)                    | Single function                                                          | EOD summary. Fixed from `00:10` per HIGH-13.                                   |

### 5.2 `inngest.send` event channels

| Event name                            | Sender                                                                                             | Handler                                                          | Operator UI entry point                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `event/sync-now`                      | `app/api/operator/sync-now/route.ts` (`POST`), with `× 1-3` fan-out per stores argument            | `inngest/functions/eventSyncNow.ts` (calls `runDailyForStore`)   | `components/operator/SyncNowButtons.tsx` → POST `/api/operator/sync-now`                  |
| `event/backfill`                      | `app/api/operator/backfill/route.ts` (`POST`)                                                       | `inngest/functions/eventBackfill.ts` (date×store double-loop)    | `components/operator/BackfillPicker.tsx` → POST `/api/operator/backfill`                  |
| `notifications/whatsapp.send-now`     | `app/api/operator/notifications/send/route.ts` (`POST`)                                             | `inngest/functions/cronWhatsapp.ts` (`eventWhatsappSendNow`)     | `components/operator/WhatsappTestButtons.tsx` → POST `/api/operator/notifications/send`   |
| `roas/sync.now` (wildcard refresh)    | `lib/useDashboardRefresh.ts` via POST `/api/operator/sync-now` with `scope='all'`                   | (delegates to `event/sync-now`)                                  | Refresh button in `TabHeader`/`RefreshButton`.                                            |

### 5.3 Function `serve()` registry

`app/api/inngest/route.ts` registers every function in a single `serve()` call:

- imports `inngest` from `@/inngest/client`
- imports `cronDailyFunctions` from `inngest/functions/cronDaily.ts`
- imports `cronLiveFunctions` from `inngest/functions/cronLive.ts`
- imports `eventSyncNow` from `inngest/functions/eventSyncNow.ts`
- imports `eventBackfill` from `inngest/functions/eventBackfill.ts`
- imports `whatsappCronFunctions`, `eventWhatsappSendNow` from `inngest/functions/cronWhatsapp.ts`

The `GET`/`POST`/`PUT` handlers exported there are invoked by Inngest cloud. The operator's `/api/operator/jobs` route is a thin proxy to the Inngest REST API (`GET https://api.inngest.com/v1/events` + `…/runs`), not the bus itself.

### 5.4 Internal "cron channel" labels on fetchers

Several fetchers `import` the cron context label without `inngest.send`; reviewers tagged this as an inngest channel because the fetcher's retry policy depends on which cron triggered it:

| Fetcher                                                       | Cron context labels referenced |
| ------------------------------------------------------------- | ------------------------------ |
| `lib/fetchers/meta.ts`                                        | `cron/daily`, `cron/live`      |
| `lib/fetchers/shopify.ts`                                     | `cron/daily`, `cron/live`      |
| `lib/fetchers/tiktok.ts`                                      | `cron/daily`, `cron/live`      |
| `lib/fetchers/googleAds.ts`                                   | `cron/daily (Google Ads spend + ad-group insights + ad insights)`, `cron/live (ad-group statuses for placeholder UPSERT)` |
| `lib/notifications/sendDailySummary.ts`                       | `cron/noon`, `cron/evening`, `cron/eod` |

---

## Section 6: Supabase reads / writes

Aggregated per Postgres table. "Writers" indicate the file that owns the UPSERT/UPDATE/DELETE. "Readers" are every file that performs `.from(table).select()`.

| Table                  | Writers                                                                                                                                                                          | Readers                                                                                                                       | Conflict / cadence notes                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data_daily`           | `inngest/functions/cronDaily.ts` (UPSERT `date,store_id`); `inngest/functions/cronLive.ts` (UPSERT `date,store_id` — rolling 3-day refresh)                                       | `app/api/data/route.ts`, `lib/postgresReaders.ts` (`fetchDailyDataFromPostgres`), `lib/notifications/summary.ts` (per-store summary fields), `inngest/functions/cronLive.ts` (SELECT inside `persistDayForStore` AND duplicate SELECT inside `persist-rolling-3day` for the per-platform-preserve fallback) | **INN-10 hotspot** — the duplicate SELECT inside the step.run callback is non-idempotent on retries; see Section 8.                                                                            |
| `products_daily`       | `inngest/functions/cronDaily.ts` (UPSERT `date,store_id,product_id`); `inngest/functions/cronLive.ts` (UPSERT `date,store_id,product_id` — rolling 3-day refresh)                  | `app/api/products/route.ts`, `lib/postgresReaders.ts`, `lib/shopifyRevenueRefunds.ts` (indirect)                              | Rolling-3-day refresh on cron-live; full day write on cron-daily.                                                                                                                              |
| `campaigns_daily`      | `inngest/functions/cronDaily.ts` (UPSERT `date,store_id,platform,campaign_id,ad_set_id`); `inngest/functions/cronLive.ts` (UPSERT today placeholder enrollment; UPDATE `effective_status` only for past dates in lookback `[today-6, today-1]`) | `app/api/campaigns/route.ts`, `lib/postgresReaders.ts` (`fetchCampaignsFromPostgres`), `lib/notifications/summary.ts` (impressions for evening summary) | The UPDATE-only path on past dates is the **U-01 TIKTOK_ACTIVE_ENOUGH symmetry surface** — writer (cron-live) and reader (postgresReaders.ts) both import `TIKTOK_ACTIVE_ENOUGH` from `lib/platformConfig.ts` (single-source-of-truth fix). |
| `ads_daily`            | `inngest/functions/cronDaily.ts` (UPSERT `date,store_id,ad_id` — combined Meta + Google + TikTok)                                                                                 | `app/api/ads/route.ts` (via `fetchAdsFromPostgres` + `fetchAdsDailyLastWriteAt`), `lib/postgresReaders.ts`                    | Only cron-daily writes; cron-live does not touch ads_daily.                                                                                                                                    |
| `orders_attribution`   | `inngest/functions/cronDaily.ts` (UPSERT `store_id,order_id`); `inngest/functions/cronLive.ts` (UPSERT `store_id,order_id` — today only)                                         | `app/api/orders-attribution/route.ts`, `lib/postgresReaders.ts` (`fetchOrdersAttributionFromPostgres`), `lib/notifications/summary.ts` (per-store source filter) | Cron-live writes today's orders; cron-daily writes the full attribution window.                                                                                                                |
| `product_catalog`      | `inngest/functions/cronDaily.ts` (UPSERT `store_id,product_id`)                                                                                                                  | `app/api/product-catalog/route.ts`, `lib/postgresReaders.ts`                                                                  | Single writer; populated nightly.                                                                                                                                                              |
| `manual_overrides`     | `app/api/operator/manual-overrides/route.ts` (POST/PATCH/DELETE via `service_role`); `components/operator/ManualOverridesCrud.tsx` (proxy)                                       | `lib/fetchers/manualOverrides.ts` (`date,store_id,platform,spend,currency`), `app/api/operator/manual-overrides/route.ts`, `components/operator/ManualOverridesCrud.tsx`, `inngest/functions/cronDaily.ts` (indirect via `mergeOverridesFromSupabase`) | Reads happen at cron-daily time to override platform-reported spend.                                                                                                                           |
| `dashboard_state`      | `lib/postgresReaders.ts` (`upsertDashboardStateKeyPostgres` — service_role); `app/api/dashboard-state/route.ts` (POST); `lib/annotations.ts`, `lib/billing.ts`, `lib/campaignOptimized.ts`, `lib/campaignsColumnPrefs.ts` (all via `pushCloudKey`) | `lib/postgresReaders.ts` (`fetchDashboardStateFromPostgres`), `app/api/dashboard-state/route.ts` (GET)                        | Many writers ⇒ low key collision (each key is namespaced).                                                                                                                                     |
| `token_failures`       | `lib/notifications/tokenFailures.ts` (upsert + update on resolve); `app/api/operator/token-failures/route.ts` (POST resolve); `components/operator/TokenFailuresTable.tsx` (proxy) | `lib/notifications/tokenFailures.ts` (select for throttle decision), `app/api/operator/token-failures/route.ts` (GET), `components/operator/TokenFailuresTable.tsx`     | Throttle window read prevents duplicate WhatsApp notifications.                                                                                                                                |
| `stores`               | (no in-scope writers — schema-managed)                                                                                                                                            | `app/api/store-meta/route.ts`, `lib/postgresReaders.ts`, `app/api/health/route.ts` (HEAD count for health probe)              | Reference data only.                                                                                                                                                                            |
| `notification_config`  | (no in-scope writers — schema-managed)                                                                                                                                            | `lib/notifications/sendDailySummary.ts` (`loadActiveMetacloudConfig`), `lib/notifications/whatsapp.ts` (`loadActiveMetacloudConfig`)                                            | WhatsApp BSP credentials live here; both files share a single loader.                                                                                                                          |

**Bulk-DELETE chain (operator "Reset data" button):**

`components/operator/ResetData.tsx` (button click) → POST `/api/operator/reset` → `app/api/operator/reset/route.ts` (service_role DELETE on `data_daily, products_daily, campaigns_daily, ads_daily, orders_attribution, product_catalog, manual_overrides`) → SWR mutate `/api/operator/jobs` + `/api/operator/manual-overrides`.

---

## Section 7: External API calls

Every external HTTP call surfaced by the reviewers. Auth pattern and rate-limit consideration listed where the reviewer captured them.

| Service                | Endpoint(s)                                                                                                          | Caller                                                                                                          | Auth                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Shopify Admin API**  | `GET https://{domain}/admin/api/2026-04/orders.json` (paginated, two windows)                                         | `lib/fetchers/shopify.ts` (`fetchShopifyDayRows`)                                                                | OAuth access token via `lib/fetchers/shopifyAuth.ts`              |
|                        | `GET https://{domain}/admin/api/2026-04/orders.json` (single-window for attribution, paginated)                       | `lib/fetchers/shopify.ts` (`fetchShopifyOrdersAttribution`)                                                      | (same)                                                            |
|                        | `GET https://{domain}/admin/api/2026-04/products.json?status=active` (paginated)                                      | `lib/fetchers/shopify.ts`                                                                                        | (same)                                                            |
|                        | `GET https://{domain}/admin/api/2026-04/orders.json` (operator debug single-call)                                     | `app/api/debug/shopify-fetch/route.ts`                                                                           | (same)                                                            |
|                        | `POST https://{domain}/admin/oauth/access_token` (`grant_type=client_credentials`)                                    | `lib/fetchers/shopifyAuth.ts`                                                                                    | Client ID + client secret                                         |
|                        | (orchestrated) `Shopify REST orders.json (×2 windows + line items + catalog)`                                         | `inngest/functions/cronDaily.ts`                                                                                 | via fetchers above                                                |
|                        | (orchestrated) `Shopify REST orders.json (×3 dates rolling + ×1 today orders-attribution)`                            | `inngest/functions/cronLive.ts`                                                                                  | via fetchers above                                                |
| **Meta Marketing API** | `GET https://graph.facebook.com/v25.0/act_{id}/insights?level=account` (one-shot)                                     | `lib/fetchers/meta.ts`                                                                                            | Bearer (page access token)                                        |
|                        | `GET https://graph.facebook.com/v25.0/act_{id}/insights?level=adset` (paginated)                                     | `lib/fetchers/meta.ts`                                                                                            | Bearer                                                            |
|                        | `GET https://graph.facebook.com/v25.0/act_{id}/insights?level=ad` (paginated)                                        | `lib/fetchers/meta.ts`                                                                                            | Bearer                                                            |
|                        | `GET https://graph.facebook.com/v25.0/act_{id}/campaigns?fields=...` (paginated)                                     | `lib/fetchers/meta.ts`                                                                                            | Bearer                                                            |
|                        | `GET https://graph.facebook.com/v25.0/act_{id}/adsets?fields=...` (paginated)                                        | `lib/fetchers/meta.ts`                                                                                            | Bearer                                                            |
|                        | `GET https://graph.facebook.com/v25.0/act_{id}?fields=currency`                                                       | `lib/fetchers/meta.ts`                                                                                            | Bearer                                                            |
|                        | (orchestrated) `Meta Graph /insights (adset + ad level + spend) + /act_<id>/campaigns + /act_<id>/adsets (budgets)`   | `inngest/functions/cronDaily.ts`                                                                                 | via fetchers above                                                |
|                        | (orchestrated) `Meta Graph /insights (level=account, light) ×3 + /act_<id>/campaigns + /act_<id>/adsets (status refresh)` | `inngest/functions/cronLive.ts`                                                                                 | via fetchers above                                                |
| **Google Ads API**     | `POST https://googleads.googleapis.com/v24/customers/{customerId}/googleAds:search` (GAQL)                            | `lib/fetchers/googleAds.ts`                                                                                       | OAuth refresh → access token                                      |
|                        | `POST https://oauth2.googleapis.com/token` (OAuth refresh)                                                            | `lib/fetchers/googleAds.ts`                                                                                       | Refresh token                                                     |
|                        | (orchestrated) `Google Ads API GAQL (spend + ad-group insights + ad insights)`                                        | `inngest/functions/cronDaily.ts`                                                                                 | via fetcher above                                                 |
|                        | (orchestrated) `Google Ads API GAQL (spend ×3 + ad-group statuses ×1)`                                                | `inngest/functions/cronLive.ts`                                                                                  | via fetcher above                                                 |
| **TikTok Business API**| `GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/` (paginated)                                | `lib/fetchers/tiktok.ts`                                                                                          | Access token in header                                            |
|                        | `GET https://business-api.tiktok.com/open_api/v1.3/adgroup/get/` (paginated)                                          | `lib/fetchers/tiktok.ts`                                                                                          | (same)                                                            |
|                        | `GET https://business-api.tiktok.com/open_api/v1.3/advertiser/info/`                                                 | `lib/fetchers/tiktok.ts`                                                                                          | (same)                                                            |
|                        | (orchestrated) `TikTok Business API /report/integrated/get (spend + ad insights)`                                     | `inngest/functions/cronDaily.ts`                                                                                 | via fetcher above                                                 |
|                        | (orchestrated) `/report/integrated/get (spend ×3) + /adgroup/get (statuses ×1, uzoshop only)`                         | `inngest/functions/cronLive.ts`                                                                                  | via fetcher above                                                 |
| **TikTok OAuth callback** | `POST /api/oauth/tiktok/callback` (server-side exchange)                                                            | `app/api/oauth/tiktok/callback/route.ts`                                                                          | TikTok app credentials                                            |
| **Frankfurter FX**     | `GET https://api.frankfurter.dev/v1/{date}?base={from}&symbols={to}`                                                  | `lib/fetchers/fx.ts`                                                                                              | No auth; rate-limited via Next.js `revalidate=3600`               |
|                        | `GET https://api.frankfurter.dev/v1/latest?base=ILS&symbols=CAD` (with `next.revalidate=3600`)                        | `app/api/data/route.ts`                                                                                           | None                                                              |
|                        | (orchestrated) Frankfurter FX per-currency per-date (cached in `spendByDate` closure)                                 | `inngest/functions/cronDaily.ts`, `inngest/functions/cronLive.ts`                                                | via fetcher above                                                 |
| **WhatsApp Cloud API** | `POST https://graph.facebook.com/v25.0/{phoneNumberId}/messages` (allowlist-gated)                                    | `lib/notifications/whatsapp.ts`                                                                                  | Bearer (BSP token from `notification_config`)                     |
|                        | (orchestrated) `POST … /messages` via `sendWhatsAppTemplate`                                                          | `lib/notifications/sendDailySummary.ts`, `lib/notifications/tokenFailures.ts`                                    | via whatsapp.ts above                                             |
|                        | (orchestrated) `WhatsApp Cloud API (via sendDailySummary internals)`                                                  | `inngest/functions/cronWhatsapp.ts`                                                                              | via whatsapp.ts above                                             |
| **Inngest REST API**   | `GET https://api.inngest.com/v1/events` (Bearer)                                                                       | `app/api/operator/jobs/route.ts`                                                                                  | Bearer (Inngest signing key)                                      |
|                        | `GET https://api.inngest.com/v1/events/{id}/runs` (Bearer, fan-out)                                                   | `app/api/operator/jobs/route.ts`                                                                                  | Bearer                                                            |
| **Google Sheets API**  | `spreadsheets.values.batchGet`                                                                                          | `lib/ads.ts`, `lib/campaigns.ts`, `lib/ordersAttribution.ts`, `lib/productCatalog.ts`                            | googleapis service account                                        |
|                        | `spreadsheets.values.get`                                                                                              | `lib/products.ts`                                                                                                 | (same)                                                            |
| **Self-hosted (Next.js)** | All `/api/*` SWR keys in Section 4                                                                                  | Frontend components                                                                                              | Cookie/session                                                    |
| **External anchor links** | `https://business.facebook.com/...`, `https://ads.google.com/...`, `https://ads.tiktok.com/...` (operator "Open in Ads Manager" buttons) | `components/CampaignsTableRow.tsx` (via `lib/campaignsLinks.buildAdsManagerLink`)                              | n/a (new-tab open)                                                |

### 7.1 Single-chokepoint observations (used in Section 8 findings)

- **Exactly ONE** `POST` to `graph.facebook.com/.../messages` exists in `dashboard-web/src/` — `lib/notifications/whatsapp.ts:131`. All WhatsApp send paths funnel through `sendWhatsAppTemplate` and its allowlist gate. See HR-05 verification → ✅ in Section 8.
- **Exactly ONE** Frankfurter FX caller (`lib/fetchers/fx.ts`) — the only external-API contract that the rest of the codebase reads through (every other consumer goes via `getFxRate`).
- **Exactly TWO** entry points to Inngest from the frontend: `inngest.send` inside the three operator-POST API routes, and the cron schedules registered in `app/api/inngest/route.ts`. No direct SDK use elsewhere.

---

## Section 8: Cross-cutting channel-driven findings (cross-ref `AUDIT.md`)

Findings that are about CHANNELS, not files. Each carries an `AUDIT.md` reference ID for the master document.

- **CHN-01 / U-01 TIKTOK_ACTIVE_ENOUGH writer↔reader symmetry** *(Section 2 props chain + Section 6 `campaigns_daily`)*
  Writer = `inngest/functions/cronLive.ts` (UPDATE `effective_status` on past dates using `TIKTOK_ACTIVE_ENOUGH`). Reader = `lib/postgresReaders.ts` (`fetchCampaignsFromPostgres` enrichment uses the same set). Both now import from `lib/platformConfig.ts` (single export — 5 entries). Verdict per Phase 12 review of `platformConfig.ts`: ✅ correct. Coverage gap: no INTEGRATION test that pins both call sites consume the same set instance. See `12-tests-needed.md` row "platformConfig symmetry integration test".

- **CHN-02 / ALG-04, ALG-05, ALG-06 — `aiReport` storeId-cluster bleed** *(Section 1 imports — `lib/aiReport.ts` consumes `Aggregated` from `lib/campaignsAggregator.ts` which drops `storeId` on the All-stores aggregation)*
  `lib/aiReport.ts:1299-1303` (ALG-04), `:842-853 + :1083-1092` (ALG-05), `:1124-1131 + :1492-1494 + :1588-1589` (ALG-06). Channel: the cross-file edge from `lib/campaignsAggregator.ts` → `lib/aiReport.ts` carries an `Aggregated` row that LOST its `storeId` during aggregation. When two stores have collisions on `campaignId + platform` or `campaignName`, the report's key lookups (`ordersByCampaignId`, `ordersByCampaignName`, `dailyByKey`) silently merge rows across stores. The fix is to thread `storeId` through `Aggregated` (composite key `${storeId}::${platform}::${campaignId}`) so every downstream consumer is store-scoped. This is a CHANNEL fix because the contract owner is `campaignsAggregator.ts`, not `aiReport.ts`.

- **CHN-03 / INN-10 cron-live persist-rolling-3day non-idempotent on retry** *(Section 6 `data_daily` writer + SELECT inside the same step.run)*
  `inngest/functions/cronLive.ts:746-823` performs SELECT-then-UPSERT inside ONE `step.run` callback. On Inngest retry, the SELECT reads its own first-attempt UPSERT instead of the original pre-step value. Channel diagnosis: the SELECT and UPSERT cross the Supabase boundary (Section 6) twice in the same logical step, and the Inngest contract (D-B5 idempotency) is the channel constraint they violate. Fix is to move the SELECT into a separate `step.run('select-prior-spend', ...)` so its result is memoized across retries. Production scale: 432 ticks/day × ~1% retry rate ≈ 4 silent corruptions/day.

- **CHN-04 / INN-16 eventBackfill catch-and-continue swallows Inngest retry signal** *(Section 5 `event/backfill` channel)*
  `inngest/functions/eventBackfill.ts:215-234` catches `runDailyForStore` errors inside the per-pair loop and continues. Inngest's own retry policy (4× exponential per D-B6) is bypassed because the error never escapes the handler. Channel diagnosis: the `event/backfill` channel HAS a built-in retry contract that the handler defeats. Fix: wrap each pair in its own `step.run('backfill-${date}-${storeId}', …)` so each pair has its own retry envelope. Note: this conflicts with the W6 step-ID prefix shim documented in the file comment at line 30-48 — operator decision required (logged in `12-DISCUSSION-LOG.md`).

- **CHN-05 / HR-05 WhatsApp single-chokepoint verification** *(Section 7 — exactly one POST to Meta's `/messages` endpoint)*
  Initially `⚠️ Uncertain`; resolved to ✅ Verified. Every send path funnels through `lib/notifications/whatsapp.ts:131` and is gated by `NOTIFICATION_RECIPIENT_ALLOWLIST` at lines 124-130. The channel diagnosis confirms: 0 direct callers of `graph.facebook.com/.../messages` outside `whatsapp.ts`; both `sendDailySummary.ts:76` and `tokenFailures.ts:227` funnel through `sendWhatsAppTemplate`; recipient normalization is symmetric between allowlist and recipient (same regex). The `/api/operator/notifications/send` route dispatches an Inngest event (no direct send) and the event handler routes through `sendDailySummary`. CAVEAT: the allowlist is permissive when the env var is unset — deployment-config requirement, NOT a code bug.

- **CHN-06 / cron-live status refresh vs. postgres reader symmetry** *(Section 6 `campaigns_daily` UPDATE channel)*
  Wave A reviewers (`cronLive.ts`) flagged the per-row sequential UPDATE loop (INN-08); Wave C reviewers (`postgresReaders.ts`) flagged that the read-side `isCurrentlyActive` matrix is only partially tested (4 of 7 statuses pinned across Meta/Google/TikTok). Channel diagnosis: the UPDATE writer and the SELECT reader BOTH derive a "currently active" verdict from the same `effective_status` column, but the verdict computation lives in two places (cronLive writer uses platform-config sets; postgresReaders reader uses inline status checks). Coverage gap: no integration test that pins writer + reader agreement across all 7 statuses. Open item — see `12-tests-needed.md`.

- **CHN-07 / `roas-cloud-clear-conflict` event has no documented consumers** *(Section 3)*
  `lib/cloudSync.ts` dispatches the event but reviewers did not find any `addEventListener('roas-cloud-clear-conflict', …)` call. Likely dead code. Action: confirm via `grep -rn "roas-cloud-clear-conflict"` (READ-ONLY check); if confirmed dead, document as backlog cleanup (cosmetic, not blocking).

- **CHN-08 / SWR key namespace drift — `/api/data`, `/api/campaigns`, `/api/orders-attribution`** *(Section 4)*
  Same physical endpoint appears under 4 distinct SWR key shapes for `/api/data` (`?from=&to=`, the prev variant, the today variant, the 17-month-history variant). Each consumer encodes its range slightly differently, and `buildDateRangeKey` is the contract. Channel diagnosis: a refactor of `buildDateRangeKey` would silently invalidate or merge any of those caches with no test coverage. Coverage gap: no test pinning every key shape against `buildDateRangeKey` output.

- **CHN-09 / Refresh-button wildcard mutate predicate** *(Section 4 + Section 5)*
  `lib/useDashboardRefresh.ts` calls `mutate(() => true)` — invalidates EVERY SWR key in the dashboard tree, then POSTs `/api/operator/sync-now scope='all'` which fires `event/sync-now` × N stores. This is a fan-out of 29 SWR keys × 3 stores × M cron-daily steps. Channel diagnosis: by far the largest single fan-out in the dashboard, but documented intentional. Not a bug; documented here for visibility.

- **CHN-10 / `inngest/route.ts` cron cadence documented as `*/15`, `cronLive.ts` documented as `*/10`** *(Section 5)*
  Reviewer for `app/api/inngest/route.ts` wrote `3× cron-live (TZ=Asia/Jerusalem */15 * * * *)`; reviewer for `inngest/functions/cronLive.ts` wrote `*/10`. Need to verify against the actual `cron:` schedule string in `cronLive.ts` source. This is a reviewer-doc inconsistency, not a code bug — but if real, INN-10's production-shape math (432 ticks/day) changes to 288 ticks/day or vice versa, and the operator should know the actual cadence.

---

*Generated 2026-05-24 from 144 raw-return JSON files in `.planning/phases/12-codebase-audit-baseline/raw-returns/` plus `.planning/graphs/graph.json` (commit `b846ae7d`). Phase 12 cross-cutting deliverable per SPEC requirement 3 and CONTEXT.md decision DP-04.*
