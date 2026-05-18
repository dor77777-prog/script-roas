# Roadmap: ROAS Tracker

## Overview

Multi-store Shopify ROAS dashboard with deterministic per-order attribution. The roadmap below tracks the GSD-managed work. Phase 0 (foundation) was retroactive — captured the work done in ad-hoc mode before formal GSD adoption. Phase 1 added channel-level product attribution. Phases 2–8 are the "tech-debt cleanup + scalability" wave, derived from `.planning/codebase/CONCERNS.md`.

## Phases

- [x] **Phase 0: Foundation (retroactive)** — Apps Script collection + Next.js dashboard + 4 rounds of code review + orders-attribution pipeline + Round 5 fix-ups
- [x] **Phase 1: Channel-Level Product Attribution** — Per-product "came from Facebook" signal via order line items
- [ ] **Phase 2: Foundations** — Vitest + 30-50 unit tests for attributionAnalysis + Sentry/ErrorBoundary + cacheConfig + row-count guards + safeDecode utility
- [x] **Phase 3: CI/CD for Apps Script** — clasp setup + GitHub Action for auto-deploy of `.gs` files
- [ ] **Phase 4: Component Decomposition** — Split CampaignsTable / CampaignDrawer / BillingSettings to ≤500 lines each via hooks + sub-components
- [ ] **Phase 5: Scalability** — API pagination, per-store Apps Script triggers (6-min cap fix), data-daily / products-daily retention, lazy line-items
- [ ] **Phase 6: Security & Cloud-Sync** — Service-account split (reader/writer), rate limiting on POST, audit log, cloud-sync If-Match + adaptive polling
- [ ] **Phase 7: Observability** — Logs tab + structured logging, quota approach alerts, phantom-spreadsheet daily assertion, reconciliation date toggle, productId retroactive fix script
- [ ] **Phase 8: i18n** — Externalize Hebrew strings to `strings.he.ts` with type-safe key map

## Phase Details

### Phase 0: Foundation (retroactive)
**Status**: Complete (commits up through `1a26d29`)
**Goal**: Establish Apps Script collection + Next.js dashboard end-to-end + per-order attribution pipeline with click-id matching
**Depends on**: Nothing

### Phase 1: Channel-Level Product Attribution
**Status**: Complete (commits `ef327ec`..`6df56c3`)
**Goal**: Surface per-product channel-level signal ("X% of orders containing this product came from Facebook") independent of per-campaign utm_id matching
**Depends on**: Phase 0

### Phase 2: Foundations
**Goal**: Add the smallest-effort highest-leverage infrastructure to support all later phases — testing harness, observability, shared utilities. Without these, every subsequent phase ships blind.
**Depends on**: Phase 1
**Requirements**:
  - Install Vitest + write 30-50 unit tests covering `attributionAnalysis.ts` (analyzeAttribution / analyzeAttributionForAdSet / analyzeAttributionForAd / orderMatchesCampaign / analyzeProductChannel / detectOutlierDays / computeWindowStability)
  - Install Sentry SDK + global ErrorBoundary for client + edge function error reporting
  - Extract cache TTLs from per-route hardcodes into `dashboard-web/src/lib/cacheConfig.ts` with `cacheControl(key)` helper
  - Add row-count guards (`if (rows.length > 50000) console.warn(...)`) to every `/api/*` route
  - Create `safeDecode` utility in `dashboard-web/src/lib/utils.ts` (try/catch wrapper around `decodeURIComponent`)
**Success Criteria** (what must be TRUE):
  1. `npm run test` passes with 30-50 tests in `dashboard-web/src/lib/__tests__/`
  2. Sentry DSN env var documented in `dashboard-web/README.md`; uncaught client errors flow to Sentry dashboard
  3. All 8 `/api/*` routes import their cache config from `cacheConfig.ts` (no string literals like `s-maxage=300` in route handlers)
  4. Each API route logs a warning when its result set exceeds the row-count threshold
  5. `safeDecode` exported from `lib/utils.ts` with one or more existing call sites switched to use it
  6. `npm run build` passes with zero new TypeScript errors

### Phase 3: CI/CD for Apps Script
**Goal**: Eliminate the manual upload step for `.gs` files. Every `git push` to main automatically deploys to script.google.com via clasp.
**Depends on**: Phase 2
**Requirements**:
  - Install `@google/clasp` as a dev dependency in the root (NOT inside `dashboard-web`)
  - Configure `.clasp.json` (script ID) + `.clasprc.json` (in `.gitignore`)
  - Add `package.json` script: `"deploy:gs": "clasp push --force"`
  - GitHub Action that runs `clasp push` on push to `main` when any `*.gs` file changed
  - Store `CLASPRC_JSON` as a GitHub Secret
  - Pre-commit hook (optional) that validates local `.gs` files have no syntax errors
**Success Criteria**:
  1. `npm run deploy:gs` from local pushes all `.gs` files to Apps Script project
  2. GitHub Action runs successfully on a test commit that touches a `.gs` file (verified in Actions tab)
  3. Manual upload to script.google.com is no longer needed for deployment
  4. SETUP.md updated with new deployment instructions
  5. `.clasprc.json` is gitignored; only `.clasp.json` is committed
  6. SYSTEM_OVERVIEW.md notes the new CI/CD path
**Plans:** 1/1 plans executed
Plans:
- [x] 03-PLAN.md — root package.json + clasp + .clasp.json + deploy-gs workflow + SETUP/SYSTEM_OVERVIEW docs (single-plan phase; 6 sequential tasks including 2 operator checkpoints) — completed 2026-05-18 (Action run #26053537084 green)

### Phase 4: Component Decomposition
**Goal**: Reduce cognitive load + IDE pressure by splitting the three 1300+ line components into focused ≤500-line modules with extracted hooks.
**Depends on**: Phase 2 (need tests to verify no regression)
**Requirements**:
  - `CampaignsTable.tsx` (1732 lines) → split into:
    - `CampaignsTable.tsx` (≤500 lines — orchestration + table shell)
    - `useCampaignTrueRevenue.ts` (hook — proportional revenue allocation)
    - `useCampaignAttribution.ts` (hook — analyzeAttribution + memoization)
    - `CampaignsTableRow.tsx` (component — single row render with chips)
  - `CampaignDrawer.tsx` (1440 lines) → split into:
    - `CampaignDrawer.tsx` (≤500 lines — drawer shell + tab routing)
    - `AttributionAnalysisPanel.tsx` (component — already partially separated)
    - `MetaShopifyReconciliation.tsx` (component — Pearson r + lag detection panel)
    - `ProductChannelBreakdown.tsx` (component — the Phase 1 section)
    - `AdSetTable.tsx` (component — ad-sets table inside drawer)
  - `BillingSettings.tsx` (1328 lines) → split into:
    - `BillingSettings.tsx` (≤500 lines — modal shell + tab routing)
    - `useBillingRecurring.ts` (hook — recurring CRUD)
    - `useBillingOneTime.ts` (hook — one-time CRUD)
    - `BillingCsvImport.tsx` (component — CSV import surface)
**Success Criteria**:
  1. All 3 original components ≤500 lines after refactor
  2. `npm run build` passes
  3. `npm run test` passes (no behavioral regression — tests added in Phase 2 catch any drift)
  4. Manual smoke: open dashboard → all 3 tabs (Campaigns / Drawer / Billing) render + drill down works
  5. Trust chip in CampaignsTable still renders correctly with all 4 levels + fallback
  6. CampaignDrawer's 3 panels (attribution / reconciliation / channel-breakdown) all still render

Plans:
- [x] 04-01-PLAN.md — single phase plan, 12 tasks (T-A..T-L) + 3 human-verify checkpoints. CampaignsTable group (T-A useCampaignTrueRevenue + T-B useCampaignAttribution + T-C CampaignsTableRow + T-D shell shrink). CampaignDrawer group (T-E AttributionAnalysisPanel + T-F MetaShopifyReconciliation incl. pearson exports + T-G ProductChannelBreakdown + T-H AdSetTable + T-I shell shrink). BillingSettings group (T-J useBillingRecurring + useBillingOneTime + T-K BillingCsvImport + T-L shell shrink). Sequential execution per D-06; per-task atomic commits per D-07.

### Phase 5: Scalability
**Goal**: Prepare the system for 5x growth (more stores, more orders, multi-year history) without hitting Apps Script timeouts or Sheets cell caps.
**Depends on**: Phase 4 (cleaner code = safer refactor)
**Requirements**:
  - Apps Script per-store trigger split:
    - 3 separate triggers: `runDailyUpdateUzoshop` (00:05), `runDailyUpdateZolplus` (00:08), `runDailyUpdateUsmile` (00:11)
    - Each gets its own 6-min budget, eliminates quota cascade risk
    - `installDailyTrigger` updated to install 3 triggers + `refreshAllStoreMeta` on a 4th
  - API pagination:
    - `/api/data?from=&to=` (defaults to last 90 days)
    - `/api/campaigns?from=&to=` (defaults to last 90 days)
    - `/api/products?from=&to=`
    - `/api/orders-attribution?from=&to=`
    - SWR cache keys include the date range so wider selections trigger fresh fetches
  - Retention/archive:
    - Apps Script function `archiveOlderThan(months)` that moves rows from `data-daily` and `products-daily` to a separate `*-archive` spreadsheet
    - Dashboard `/api/data` checks both warm + archive when user picks a range > 18 months old
  - Lazy line-items parsing:
    - `/api/orders-attribution?lineItems=false` returns rows without line items (lighter payload)
    - `/api/orders-attribution?lineItems=true` returns full data (used only by CampaignDrawer)
**Success Criteria**:
  1. 3 separate daily triggers installed; logs show each runs in <3 min independently
  2. All 4 API routes accept and honor `?from=&to=` params (verified by curling with each combination)
  3. SWR keys include date range; switching range triggers fetch (not cache hit)
  4. Archive function tested on a stub year (year 2023 → moved to archive successfully)
  5. Dashboard loads in <2 sec for default 90-day range even on a slow connection
  6. CampaignDrawer still gets full line-items data when opened

### Phase 6: Security & Cloud-Sync
**Goal**: Harden the writable surfaces against credential leak + brute-force + race conditions.
**Depends on**: Phase 2 (need tests to verify) + Phase 5 (cleaner API surface)
**Requirements**:
  - Service-account split:
    - Create new service-account `roas-dashboard-writer@...` with `spreadsheets` scope, restricted to write only `dashboard-state` + `dashboard-state-audit` tabs
    - Existing service-account becomes read-only (`spreadsheets.readonly`)
    - Two env var sets in Vercel: `GOOGLE_READER_EMAIL`/`GOOGLE_READER_KEY` + `GOOGLE_WRITER_EMAIL`/`GOOGLE_WRITER_KEY`
    - `sheets.ts` uses reader for all GETs and writer only for `upsertDashboardStateKey`
  - Rate limiting on POST `/api/dashboard-state`:
    - Use Upstash Redis (free tier) or Vercel Edge Config for IP-based rate limit (10/min/IP)
    - Server-side debounce of 1s per key (if 2 POSTs for same key within 100ms, only last applied)
  - Audit log:
    - New tab `dashboard-state-audit` with 4 columns: `timestamp`, `key`, `old_value` (truncated to 500 chars), `new_value` (truncated)
    - Every POST writes one row before updating `dashboard-state`
    - 30-day retention; older rows pruned in a scheduled cleanup
  - Cloud-sync If-Match:
    - Client tracks `updatedAt` per key; sends `If-Match: <updatedAt>` header on POST
    - Server rejects with 412 Precondition Failed if `updatedAt` mismatches → client re-hydrates + retries
  - Adaptive polling:
    - Visible tab: 30s poll
    - Hidden tab (`document.visibilityState === 'hidden'`): 5min poll
    - Page idle > 10min: stop polling until next focus
**Success Criteria**:
  1. Service-account split deployed; reader returns 403 if attempting to write
  2. Rate limit middleware rejects >10 POSTs/min/IP with 429
  3. `dashboard-state-audit` tab populates with one row per POST; verified after a billing edit
  4. Concurrent edit from 2 browsers → second one gets 412 → silently retries → both edits land correctly
  5. Hidden tab polling rate drops to 1/5min (verified via Network panel)
  6. SYSTEM_OVERVIEW.md security section updated

### Phase 7: Observability
**Goal**: Long-tail debugging and proactive alerting. Logs that survive past 30 days, alerts before quota is hit, scripts to fix the one-off data corruptions.
**Depends on**: Phase 3 (CI/CD lets us update Apps Script easily)
**Requirements**:
  - Logs tab in spreadsheet:
    - New tab `logs` with columns: `timestamp`, `level` (INFO/WARN/ERROR), `source` (DailyUpdate.gs / Shopify.gs / etc.), `message`, `context` (JSON)
    - All `Logger.log` calls in Apps Script wrapped in `logEvent(level, source, message, context)` that appends to the tab
    - Retention: keep last 6 months, prune older rows in a weekly trigger
  - Quota approach alerts:
    - Measure duration of `runDailyUpdate` (already partially logged) — alert email if duration > 4.5 min for 3 consecutive days
    - Count `429` responses from external APIs per day; alert if > 5% of total requests
  - Phantom-spreadsheet daily assertion:
    - At start of every `runDailyUpdate`, log the current `spreadsheet.id` to the logs tab
    - Daily summary email includes "Spreadsheet ID: X" so any drift is visible at a glance
  - Reconciliation date toggle:
    - Add a toggle in `MetaShopifyReconciliation` panel: "ימים פעילים בלבד" vs "כל הטווח"
    - Default = active-only (current behavior)
    - When toggled = all days, Pearson r still computes on active days only (statistical correctness) but the table + chart show all days
  - Product ID retroactive fix script:
    - One-off Apps Script function `fixProductIdPrecision()` that:
      - Reads every row in `products-daily` and `{store}-products-catalog`
      - Re-writes column 4 (products-daily) and column 1 (catalog) as text via `setNumberFormat('@')`
      - Run manually once after deploy
**Success Criteria**:
  1. `logs` tab populates with structured entries from at least 3 different Apps Script files
  2. Manual trigger of `notifyError_` (with a fake long-duration log) sends a quota-warning email
  3. Daily email summary includes the current spreadsheet ID
  4. Reconciliation toggle works (user can switch between modes; both render correctly)
  5. `fixProductIdPrecision()` runs successfully on a test sheet; column types become text
  6. No regression in `runDailyUpdate` runtime (still <5 min)

### Phase 8: i18n
**Goal**: Externalize all UI Hebrew strings to a single source-of-truth file. Sets the foundation for future English support without committing to it now.
**Depends on**: Phase 4 (smaller components = easier codemod)
**Requirements**:
  - Create `dashboard-web/src/lib/strings.he.ts` with type-safe key map (e.g., `s.campaigns.title`, `s.campaigns.empty`, etc.)
  - Codemod script (one-off) that scans `dashboard-web/src/components/**/*.tsx` for Hebrew string literals and replaces them with `s.X.Y` references
  - Manual review of codemod output (some strings are dynamic like `${storeName} ROAS`)
  - Both root-level `strings.he.ts` and the components use a single shared type so missing keys are TypeScript errors
**Success Criteria**:
  1. `dashboard-web/src/lib/strings.he.ts` exists with all UI strings (at least 200 keys based on grep)
  2. No Hebrew string literals remain in `dashboard-web/src/components/**/*.tsx` (verified by grep)
  3. `npm run build` passes (TypeScript catches any missing key)
  4. Manual smoke: dashboard renders identically before/after (no missed translations)
  5. Adding a new key requires editing `strings.he.ts` (the type system enforces this — no inline literals possible)
