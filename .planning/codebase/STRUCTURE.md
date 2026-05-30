# Codebase Structure

**Analysis Date:** 2026-05-24

**Post-Phase-11 state.** The Apps Script `.gs` tier has been fully removed — no `*.gs` files, no `appsscript.json`, no `.clasp.json`, no `.clasprc.json`. The repo is now a single-tier Next.js + Inngest + Supabase Postgres codebase. All historical references to `lib/sheets.ts`, `READ_FROM=sheets`, or `clasp push` are gone.

## Directory Layout

```text
script-roas/
├── COGS_SETUP.md          # Operator runbook for per-store COGS env vars
├── README.md              # Top-level project overview
├── SYSTEM_OVERVIEW.md     # Pipeline architecture summary for operators
├── WELCOME.md             # First-touch operator onboarding
├── package.json           # Root package (planning + dev tooling only)
├── package-lock.json
├── .env                   # Local-only env file (gitignored)
├── .gitignore
├── .claspignore           # Vestigial — Phase 11 left this file but it has no effect now
├── dashboard-web/         # ── Next.js app (the entire deployable codebase)
├── supabase/              # ── DB schema + migrations (source of truth for tables)
├── docs/                  # ── Operator-facing docs (User Manual, Quick Start)
└── .planning/             # ── GSD planning workspace (out-of-band, not deployed)
```

### dashboard-web/

```text
dashboard-web/
├── README.md
├── package.json           # The deployable package manifest
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── vitest.config.ts
├── instrumentation.ts            # Sentry init hook
├── sentry.client.config.ts
├── sentry.server.config.ts
├── sentry.edge.config.ts
└── src/
    ├── app/                      # Next.js App Router
    │   ├── layout.tsx
    │   ├── page.tsx              # → renders <Dashboard />
    │   ├── globals.css
    │   ├── operator/             # /operator sibling route
    │   │   ├── layout.tsx
    │   │   └── page.tsx          # ניהול console (7 sections)
    │   └── api/                  # 19 route.ts files (data + operator + webhook)
    │       ├── ads/route.ts
    │       ├── campaigns/route.ts
    │       ├── dashboard-state/route.ts
    │       ├── data/route.ts
    │       ├── debug/shopify-fetch/route.ts
    │       ├── health/route.ts
    │       ├── inngest/route.ts          # Inngest serve() webhook
    │       ├── oauth/tiktok/callback/route.ts
    │       ├── operator/
    │       │   ├── backfill/route.ts
    │       │   ├── jobs/route.ts
    │       │   ├── manual-overrides/route.ts
    │       │   ├── notifications/send/route.ts
    │       │   ├── reset/route.ts
    │       │   ├── sync-now/route.ts
    │       │   └── token-failures/route.ts
    │       ├── orders-attribution/route.ts
    │       ├── product-catalog/route.ts
    │       ├── products/route.ts
    │       └── store-meta/route.ts
    │
    ├── inngest/                  # 11 Inngest functions
    │   ├── client.ts             # Inngest singleton ({id: 'roas-dashboard'})
    │   └── functions/
    │       ├── cronDaily.ts      # 3 cron-daily-{store} functions @ 00:05 IL
    │       ├── cronLive.ts       # 3 cron-live-{store} functions @ */10 IL
    │       ├── cronWhatsapp.ts   # 3 whatsapp-{noon|evening|eod} + 1 event
    │       ├── eventBackfill.ts  # event/backfill — operator backfill picker
    │       ├── eventSyncNow.ts   # event/sync-now — operator sync button
    │       └── __tests__/        # Vitest specs for each function
    │
    ├── components/               # 54 React components (PascalCase.tsx)
    │   ├── Dashboard.tsx                 # 6-tab shell
    │   ├── CloudSync.tsx                 # mounts hydrate + 30s poll
    │   ├── SyncIndicator.tsx             # status pill
    │   ├── KpiCards.tsx, PerStoreCards.tsx, RoasChart.tsx, ...
    │   ├── CampaignsTable.tsx, CampaignDrawer.tsx, CampaignsTableRow.tsx
    │   ├── ProductsTable.tsx, ProductCentricView.tsx, ProductChannelBreakdown.tsx
    │   ├── BillingSettings.tsx, BillingCsvImport.tsx
    │   ├── InsightsBoard.tsx, InsightsPanel.tsx, WhatsWorking.tsx
    │   ├── operator/                     # 7 operator-console components
    │   │   ├── BackfillPicker.tsx
    │   │   ├── JobsTable.tsx
    │   │   ├── ManualOverridesCrud.tsx
    │   │   ├── ResetData.tsx
    │   │   ├── SyncNowButtons.tsx
    │   │   ├── TokenFailuresTable.tsx
    │   │   └── WhatsappTestButtons.tsx
    │   └── __tests__/                    # Vitest component specs
    │
    └── lib/                              # Domain logic + shared utilities
        ├── analytics.ts                  # aggregate, aggregateByStore, dailySeries
        ├── apiErrors.ts                  # userFacingError sanitiser
        ├── attributionAnalysis.ts        # click-id matching, cohort detection
        ├── billing.ts                    # recurring + one-time cost model
        ├── cacheConfig.ts                # Cache-Control config per route
        ├── campaignHealthScore.ts        # cohort-aware health-score algorithm
        ├── campaignOptimized.ts          # operator-typed "optimized" flag
        ├── campaignProductMap.ts         # campaign → product mapping
        ├── campaigns.ts                  # CampaignRow type
        ├── campaignsAggregator.ts        # cross-platform aggregation
        ├── cannibalizationDetection.ts   # multi-mapping cohort overlap
        ├── chartColors.ts                # Recharts palette
        ├── cloudSync.ts                  # localStorage ↔ /api/dashboard-state
        ├── constants.ts
        ├── costs.ts
        ├── cpmRoasAnalysis.ts
        ├── dashboardStateKeys.ts         # ALLOWED_STATE_KEYS (Phase 11 home)
        ├── dateRange.ts                  # parseRangeParams, isInRange
        ├── dateValidation.ts             # isDate helper
        ├── drawerStack.ts                # nested drawer ESC handling
        ├── drillFilter.ts
        ├── format.ts                     # number / currency / percent formatters
        ├── insights.ts                   # insights engine (anomalies, opps)
        ├── lineItems.ts                  # Shopify line-item helpers
        ├── multiMappingCohort.ts         # cohort ranking with Bayesian shrinkage
        ├── operatorReset.ts              # reset payload validator
        ├── ordersAttribution.ts          # OrderAttributionRow type
        ├── platformConfig.ts             # TIKTOK_ACTIVE_ENOUGH (writer ↔ reader)
        ├── platformsByStore.ts           # store → active platforms map
        ├── postgresReaders.ts            # 8 fetch*FromPostgres + 1 writer
        ├── presets.ts                    # date-range presets
        ├── productCatalog.ts             # CatalogProduct type
        ├── productCentricView.ts         # product-centric pivot logic
        ├── products.ts                   # ProductRow type
        ├── rangeClamp.ts                 # clamp ranges to data availability
        ├── sessionKeys.ts
        ├── shopifyRevenueRefunds.ts      # canonical refund-correction algorithm
        ├── sparklineGeometry.ts
        ├── supabase.ts                   # anon client (read-only SELECT)
        ├── supabaseAdmin.ts              # service_role client (Inngest writes)
        ├── types.ts                      # DailyRow, DashboardData, Filters
        ├── urlState.ts                   # readDashboardState, syncUrl
        ├── useDashboardRefresh.ts        # global SWR mutate hook
        ├── utils.ts                      # safeDecode + misc helpers
        ├── ads.ts, aiReport.ts, annotations.ts
        ├── campaignsColumnPrefs.ts, campaignsLinks.ts
        ├── fetchers/                     # 7 external-API HTTP wrappers
        │   ├── fx.ts                     # Frankfurter currency conversion
        │   ├── googleAds.ts              # GAQL queries
        │   ├── manualOverrides.ts        # Supabase manual_overrides merger
        │   ├── meta.ts                   # Meta Marketing Insights
        │   ├── shopify.ts                # Admin REST orders + products
        │   ├── shopifyAuth.ts            # multi-store credential router
        │   └── tiktok.ts                 # TikTok Business API
        ├── hooks/                        # React hooks split from large components
        │   ├── useBillingOneTime.ts
        │   ├── useBillingRecurring.ts
        │   ├── useCampaignAttribution.ts
        │   └── useCampaignTrueRevenue.ts
        ├── notifications/                # WhatsApp + token-failure plumbing
        │   ├── sendDailySummary.ts       # Orchestrator for the 3 cron flows
        │   ├── summary.ts                # buildStoreSummary
        │   ├── templateParams.ts         # 5-slot template parameter builder
        │   ├── tokenFailures.ts          # notifyTokenFailure + throttle
        │   └── whatsapp.ts               # sendWhatsAppTemplate + config loader
        └── __tests__/                    # 144 Vitest specs (one file per unit)
```

### supabase/

```text
supabase/
├── config.toml                  # Supabase CLI project link
├── MIGRATION-DISCIPLINE.md      # Additive-only migration rules (Phase 05.5 doc)
└── migrations/                  # 11 SQL migrations (idempotent, additive)
    ├── 20260521063112_initial_schema.sql
    ├── 20260521063301_seed_stores.sql
    ├── 20260521075741_add_constraints_and_grants.sql
    ├── 20260521075829_make_seeds_idempotent.sql
    ├── 20260521192312_add_data_daily_gross_refund_columns.sql
    ├── 20260522002225_add_data_daily_tiktok_spend.sql
    ├── 20260522010146_add_data_daily_updated_at.sql
    ├── 20260522015042_add_updated_at_to_3_dailies.sql
    ├── 20260522102151_add_tiktok_platform_check.sql
    ├── 20260522180000_add_campaigns_daily_effective_status.sql
    └── 20260523080000_add_token_failures.sql
```

### docs/

```text
docs/
├── ARCHITECTURE.md                  # Operator-facing pipeline doc (Hebrew)
├── PROPS-MAP.md                     # 43-row env-var classification (Phase 05.5)
├── ROAS-Dashboard-Quick-Start.md
└── ROAS-Dashboard-User-Manual.md    # 14k+ lines, single source of truth for UX
```

### .planning/

```text
.planning/
├── STATE.md                     # GSD progress tracker (auto-managed)
├── ROADMAP.md                   # Phase index (manually curated)
├── HANDOFF-2026-05-22.md
├── config.json
├── codebase/                    # ← this folder (the 7 mapping docs)
│   ├── ARCHITECTURE.md
│   ├── CONCERNS.md
│   ├── CONVENTIONS.md
│   ├── INTEGRATIONS.md
│   ├── STACK.md
│   ├── STRUCTURE.md
│   └── TESTING.md
├── phases/                      # One folder per GSD phase
├── audit-2026-05-23/            # Algorithmic audit run 1
├── audit-2026-05-23-v2/         # Algorithmic audit run 2
├── audit-2026-05-23-v3/         # Algorithmic audit run 3
├── features/                    # Cross-phase feature notes
├── notes/                       # Free-form exploration notes
└── reviews/                     # Cross-AI code review outputs
```

## File-Count Snapshot

| Directory | TS/TSX files |
|-----------|--------------|
| `dashboard-web/src/` (total) | 235 |
| `dashboard-web/src/app/` | 23 |
| `dashboard-web/src/components/` | 54 |
| `dashboard-web/src/lib/` | 54 (non-test) |
| `dashboard-web/src/inngest/` | 14 |
| `dashboard-web/src/lib/__tests__/` | 144 specs |
| `dashboard-web/src/components/__tests__/` | 1 spec |
| `dashboard-web/src/inngest/functions/__tests__/` | 8 specs |
| `supabase/migrations/` | 11 SQL files |

## Directory Purposes

**`dashboard-web/`:**
- Purpose: The entire deployable Next.js application. Vercel watches this subdirectory.
- Contains: All app code, configs, Sentry init, Tailwind theme, Vitest config.
- Key files: `package.json` (deployable manifest), `next.config.ts`, `vitest.config.ts`, `instrumentation.ts`.

**`dashboard-web/src/app/`:**
- Purpose: Next.js App Router — page routes + API routes only.
- Contains: 3 page routes (`/`, `/operator`, `layout.tsx`) + 19 API `route.ts` files.
- Key files: `app/page.tsx` (root), `app/operator/page.tsx` (sibling console), `app/api/inngest/route.ts` (Inngest webhook).

**`dashboard-web/src/inngest/`:**
- Purpose: All Inngest cron + event function definitions.
- Contains: `client.ts` (singleton) + 5 function files exporting 11 functions total.
- Key files: `inngest/functions/cronDaily.ts` (5K+ lines incl. shared handler), `inngest/functions/cronLive.ts`, `inngest/functions/cronWhatsapp.ts`.

**`dashboard-web/src/components/`:**
- Purpose: React UI components (PascalCase). 54 in the flat root + 7 in `operator/` subdirectory.
- Contains: Dashboard shell, 6 tab views, drawers, tables, charts, panels.
- Key files: `Dashboard.tsx` (orchestrator), `CampaignsTable.tsx`/`CampaignDrawer.tsx` (deepest interactive surface), `CloudSync.tsx` (mounts cloud-sync).

**`dashboard-web/src/lib/`:**
- Purpose: Pure-logic modules and shared utilities. Most files are ≤200 lines.
- Contains: Domain algorithms (`attributionAnalysis.ts`, `multiMappingCohort.ts`, `shopifyRevenueRefunds.ts`), HTTP fetchers, type definitions, Postgres readers, cloud-sync, formatting.
- Subdirectories: `fetchers/` (external-API I/O), `hooks/` (React hooks split from big components), `notifications/` (WhatsApp + token-failure), `__tests__/` (Vitest).

**`supabase/`:**
- Purpose: Database source of truth. CLI project link + additive migrations.
- Contains: `config.toml`, 11 SQL migrations, `MIGRATION-DISCIPLINE.md` (additive-only tripwire).
- Generated: No. Hand-edited. Every migration is committed and applied via `supabase db push`.
- Committed: Yes.

**`docs/`:**
- Purpose: Operator-facing documentation.
- Contains: `ROAS-Dashboard-User-Manual.md` (canonical UX doc, Hebrew), `ARCHITECTURE.md` (operator-readable pipeline diagram), `PROPS-MAP.md` (env-var matrix), Quick Start.
- Note: Per project memory ("Keep docs current — split by audience"), UX changes go to User Manual; architecture changes go to `docs/ARCHITECTURE.md`. The `.planning/codebase/ARCHITECTURE.md` you are reading is a separate internal-only doc for Claude.

**`.planning/`:**
- Purpose: GSD workspace (Get Stuff Done planning system). Not deployed.
- Contains: Roadmap, state, phase folders, codebase mapping (this folder), audit run outputs, cross-AI reviews.

## Key File Locations

**Entry Points:**
- `dashboard-web/src/app/page.tsx`: Dashboard root (renders `<Dashboard />`).
- `dashboard-web/src/app/operator/page.tsx`: Operator console (`/operator`).
- `dashboard-web/src/app/api/inngest/route.ts`: Inngest webhook — registers all 11 functions.

**Configuration:**
- `dashboard-web/package.json`: Deployable manifest (Next 15, React 19, Inngest 4.4, Supabase 2.106, Vitest 2.1).
- `dashboard-web/next.config.ts`: Sentry wrapping + Vercel build config.
- `dashboard-web/vitest.config.ts`: Vitest with jsdom for component tests.
- `dashboard-web/tailwind.config.ts`: RTL-aware design tokens.
- `supabase/config.toml`: Supabase project link (cloud-hosted).
- `.env`: Local-only env. **Never read by Claude.** Reference template lives in `docs/PROPS-MAP.md`.

**Core Logic:**
- `dashboard-web/src/inngest/functions/cronDaily.ts`: `runDailyForStore` shared handler.
- `dashboard-web/src/inngest/functions/cronLive.ts`: `runLiveForStore` 3-day rolling window.
- `dashboard-web/src/lib/postgresReaders.ts`: All Postgres SELECT helpers + dashboard-state writer.
- `dashboard-web/src/lib/shopifyRevenueRefunds.ts`: Canonical refund-correction algorithm.
- `dashboard-web/src/lib/cloudSync.ts`: Browser-side state mirror.
- `dashboard-web/src/lib/platformConfig.ts`: Writer↔reader symmetric sets.

**Testing:**
- `dashboard-web/src/lib/__tests__/`: 144 unit-test files.
- `dashboard-web/src/inngest/functions/__tests__/`: 8 Inngest function tests.
- `dashboard-web/src/components/__tests__/`: 1 component-level test (most logic is in `lib/`).

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `CampaignsTable.tsx`, `KpiCards.tsx`).
- Lib modules: `camelCase.ts` (e.g., `cloudSync.ts`, `multiMappingCohort.ts`, `shopifyRevenueRefunds.ts`).
- Hooks: `use*.ts` in `lib/hooks/` (e.g., `useCampaignAttribution.ts`).
- Inngest functions: `camelCase.ts` matching the function group (e.g., `cronDaily.ts`, `eventBackfill.ts`).
- API routes: always `route.ts` inside a folder named after the URL segment.
- Tests: `<sourceFile>.test.ts` co-located in `__tests__/` next to the source folder.

**Directories:**
- App router segments: kebab-case (`dashboard-state/`, `orders-attribution/`, `product-catalog/`, `manual-overrides/`).
- Lib subgroups: camelCase (`fetchers/`, `hooks/`, `notifications/`).
- Tests: `__tests__/` (one per peer source directory).

**Symbols inside files:**
- React components: `PascalCase` (matches filename).
- Functions and hooks: `camelCase` (`fetchDailyDataFromPostgres`, `pushCloudKey`, `useBillingRecurring`).
- Types: `PascalCase` (`DailyRow`, `CampaignRow`, `MultiMappingCohort`).
- Constants: `SCREAMING_SNAKE_CASE` (`STATE_KEYS`, `TIKTOK_ACTIVE_ENOUGH`, `ROLLING_WINDOW_DAYS`).

## Where to Add New Code

**New Inngest cron / event function:**
- Implementation: `dashboard-web/src/inngest/functions/<groupName>.ts`. If it belongs in an existing group (cron-daily, cron-live, cron-whatsapp), extend that file; otherwise create a new file.
- Registration: add to the `functions: [...]` array in `dashboard-web/src/app/api/inngest/route.ts:112-121`. Without this, the function is invisible to Inngest cloud.
- Tests: `dashboard-web/src/inngest/functions/__tests__/<name>.test.ts` using the `StepRunner` stub pattern from `cronDaily.test.ts`.

**New API route:**
- Implementation: `dashboard-web/src/app/api/<segment>/route.ts`. Export `GET` / `POST` / `PUT` / `DELETE` handlers.
- For data reads: import from `lib/postgresReaders.ts`. Use `parseRangeParams` for `?from=&to=` validation. Use the `status 200 + rows: [] + error: "..."` degraded path.
- For operator writes: validate payload against runtime allowlists (NOT TypeScript only). Fire `inngest.send(...)` for async work; return 202.
- Cache control: import from `lib/cacheConfig.ts` (`cacheControl('keyName')`).

**New React component:**
- Implementation: `dashboard-web/src/components/<PascalCaseName>.tsx`.
- For operator-only components: place in `components/operator/`.
- Use existing design tokens from `tailwind.config.ts` — no inline hex colors. RTL is the default direction (`dir="rtl"` on the root). All operator-facing text in Hebrew.
- Hook out heavy state to `lib/hooks/use<Name>.ts` if the component exceeds ~500 lines.

**New Postgres reader:**
- Implementation: add to `dashboard-web/src/lib/postgresReaders.ts` following the existing pattern (anon client for SELECT, service_role only for writes).
- Return shape: ALWAYS return the same shape as any existing UI consumer expects. Drift will silently regress the UI.

**New external-API fetcher:**
- Implementation: `dashboard-web/src/lib/fetchers/<provider>.ts`. Pure HTTP wrapper that throws on non-200.
- Caller pattern: only Inngest functions should call fetchers directly. UI/API routes read from Postgres via `postgresReaders.ts`.
- Token failures: wrap calls in try/catch and call `notifyTokenFailure(...)` from `lib/notifications/tokenFailures.ts`.

**New DB column or table:**
- Migration: create `supabase/migrations/YYYYMMDDhhmmss_<description>.sql` following the additive-only convention (see `supabase/MIGRATION-DISCIPLINE.md`).
- Apply: `supabase db push` against the linked cloud project.
- Reader update: extend the relevant function in `lib/postgresReaders.ts`. Bump the `select(...)` projection; cast row shape.
- Writer update: extend the relevant `runDailyForStore` / `runLiveForStore` step.

**Utilities (shared helpers):**
- Pure functions used in >1 place: `dashboard-web/src/lib/utils.ts` or a new `lib/<name>.ts` if domain-specific.
- React hooks: `dashboard-web/src/lib/hooks/`.
- Type-only modules: still goes under `lib/` (`lib/types.ts` is the catch-all).

## Special Directories

**`dashboard-web/src/components/__tests__/`:**
- Purpose: Component-level test specs (rare; most logic lives in `lib/`).
- Generated: No.
- Committed: Yes.
- Current count: 1 spec.

**`dashboard-web/src/lib/__tests__/`:**
- Purpose: Vitest specs for every pure-logic module. The bulk of the suite (144 specs).
- Generated: No.
- Committed: Yes.

**`.planning/audit-2026-05-23*/`:**
- Purpose: Cross-AI audit outputs (codex + opus reviewing each other's plans).
- Generated: By GSD audit phases.
- Committed: Yes (decision records).

**`.planning/phases/`:**
- Purpose: One subfolder per phase with PLAN.md / RESEARCH.md / SUMMARY.md / CHECK.md as needed.
- Generated: By GSD commands (`/gsd-plan-phase`, `/gsd-execute-phase`).
- Committed: Yes.

**`node_modules/` (top-level + `dashboard-web/`):**
- Purpose: Dependencies installed by npm.
- Generated: Yes.
- Committed: No (gitignored).

---

*Structure analysis: 2026-05-24*
