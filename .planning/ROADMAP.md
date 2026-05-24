# Roadmap: ROAS Tracker

## Overview

Multi-store Shopify ROAS dashboard with deterministic per-order attribution. The roadmap below tracks the GSD-managed work. Phase 0 (foundation) was retroactive — captured the work done in ad-hoc mode before formal GSD adoption. Phase 1 added channel-level product attribution. Phases 2–8 are the "tech-debt cleanup + scalability" wave, derived from `.planning/codebase/CONCERNS.md`.

## Phases

- [x] **Phase 0: Foundation (retroactive)** — Apps Script collection + Next.js dashboard + 4 rounds of code review + orders-attribution pipeline + Round 5 fix-ups
- [x] **Phase 1: Channel-Level Product Attribution** — Per-product "came from Facebook" signal via order line items
- [ ] **Phase 2: Foundations** — Vitest + 09-50 unit tests for attributionAnalysis + Sentry/ErrorBoundary + cacheConfig + row-count guards + safeDecode utility
- [x] **Phase 3: CI/CD for Apps Script** — clasp setup + GitHub Action for auto-deploy of `.gs` files
- [ ] **Phase 4: Component Decomposition** — Split CampaignsTable / CampaignDrawer / BillingSettings to ≤500 lines each via hooks + sub-components
- [ ] **Phase 5: Scalability** — API pagination, per-store Apps Script triggers (6-min cap fix), data-daily / products-daily retention, lazy line-items
- [x] **Phase 05.2.3.0: Shopify revenue net-of-refunds** — URGENT bug-fix: store-level revenue across the dashboard is inflated when refunds happen on prior-day orders. Initial 7 plans shipped 2026-05-20; 2026-05-21 code review surfaced structural double-deduction bug (CR-01) — 3 gap-closure plans (08/09/10) pending: model change from current_total_price → total_price, drop cross-day filter, test gate + docs revision (INSERTED) (completed 2026-05-20)
- [ ] **Phase 05.4: Unmapped Active Campaigns Indicator** — Per-ad-manager (Meta/Google) chip in Campaigns view showing count of currently-active campaigns with no product mapping, drill-down to the list, green "all mapped" indicator when clean (INSERTED — FROZEN pending 05.2.3.0)
- [x] **Phase 05.5: v2.0 — Supabase Foundation + PROPS-MAP** — Stand up Supabase Postgres, classify all 40 env properties (SECRET / CONFIG / DATA), seed Vercel env vars + Supabase `stores` / `notification_config` tables, write `docs/PROPS-MAP.md` as the operator checklist gating cut-over. No fetcher work yet; Apps Script unchanged. (INSERTED 2026-05-21 — see `.planning/notes/v2-migration-exploration-2026-05-21.md`) (completed 2026-05-21)
- [x] **Phase 05.6: v2.0 — TS Port + Inngest + Operator Console** — Port 5 fetchers (Shopify / Meta / Google Ads / FX / ManualOverrides) from `.gs` to TS; set up Inngest cloud (daily cron + 15-min cron + sync-now + backfill events); new "ניהול" tab in dashboard with jobs table + backfill range picker + manual_overrides CRUD; one-off importer of 38 manual-spend rows; feature flag `READ_FROM=sheets|postgres` defaulting to sheets. (INSERTED 2026-05-21) (completed 2026-05-21)
- [ ] **Phase 05.7: v2.0 — Cut-over + Apps Script Decommission** — Verification harness (diff Sheets vs Postgres 14 days); flip dashboard flag to postgres; disable Apps Script triggers; monitor 7 days; delete `clasp` CI workflow; archive Sheets read-only. (INSERTED 2026-05-21)
- [ ] **Phase 6: Security & Cloud-Sync** — Service-account split (reader/writer), rate limiting on POST, audit log, cloud-sync If-Match + adaptive polling — **NEEDS RESCOPE post-v2.0** (current goals are Sheets-architecture-specific; reconsider after Phase 05.7 ships)
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
  - Install Vitest + write 09-50 unit tests covering `attributionAnalysis.ts` (analyzeAttribution / analyzeAttributionForAdSet / analyzeAttributionForAd / orderMatchesCampaign / analyzeProductChannel / detectOutlierDays / computeWindowStability)
  - Install Sentry SDK + global ErrorBoundary for client + edge function error reporting
  - Extract cache TTLs from per-route hardcodes into `dashboard-web/src/lib/cacheConfig.ts` with `cacheControl(key)` helper
  - Add row-count guards (`if (rows.length > 50000) console.warn(...)`) to every `/api/*` route
  - Create `safeDecode` utility in `dashboard-web/src/lib/utils.ts` (try/catch wrapper around `decodeURIComponent`)
**Success Criteria** (what must be TRUE):
  1. `npm run test` passes with 09-50 tests in `dashboard-web/src/lib/__tests__/`
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
- [x] 03-PLAN.md — root package.json + clasp + .clasp.json + deploy-gs workflow + SETUP/SYSTEM_OVERVIEW docs (single-plan phase; 6 sequential tasks including 2 operator checkpoints) — completed 2009-05-18 (Action run #26053537084 green)

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

### Phase 05.3: In-dashboard searchable user manual with live component examples (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 05.3 to break down)

### Phase 05.1: Per-store live-trigger split (gap-closure for 19% failure rate)

**Goal**: Apply the per-store split pattern from Phase 5 to `runLiveUpdate` (the 15-min trigger) — currently runs all 3 stores in a single 6-min execution and times out ~19% of the time. Discovered during UAT for Phase 5.
**Depends on**: Phase 5 (uses `runUpdateForSingleStore_` helper introduced in 05-01)
**Requirements**:
  - 3 new per-store live wrappers in DailyUpdate.gs:
    - `runLiveUpdateUzoshop()` → `runUpdateForSingleStore_('uzoshop', todayStr_())`
    - `runLiveUpdateZolplus()` → `runUpdateForSingleStore_('zolplus', todayStr_())`
    - `runLiveUpdateUsmile()` → `runUpdateForSingleStore_('usmile360', todayStr_())`
  - `installLiveTrigger` updated to install 3 separate triggers (every 15 min) with minute-offsets so they don't all fire at exactly the same instant
  - `removeLiveTrigger` updated to clean up old `runLiveUpdate` handler PLUS the 3 new handlers (idempotent re-install)
  - Existing `runLiveUpdate()` retained as manual entry point (backwards-compat with menu / direct editor runs)
**Success Criteria**:
  1. 3 separate live triggers visible in Apps Script Triggers UI (each every ~15 min)
  2. Old `runLiveUpdate` trigger gone after re-running `installLiveTrigger`
  3. Failure rate drops from 19% to <2% within 24 hours of redeploy (measured via Apps Script Executions tab)
  4. `runLiveUpdate()` (without store suffix) still callable manually for full-sequential runs

Plans:
- [x] 05.1-01-PLAN.md — single plan, 2 tasks (DailyUpdate.gs wrappers + Main.gs installLiveTrigger/removeLiveTrigger update)

### Phase 05.2: Multi-channel reconciliation chart (Google + Organic overlay)

**Goal**: Extend the existing Meta-vs-Shopify daily reconciliation chart to a 4-series chart that overlays Google-claimed sales and Organic/Direct sales for the SAME mapped products. Gives the user a complete picture of "what each platform claims sold vs. what Shopify actually recorded" per day.
**Depends on**: Phase 4 (CampaignDrawer infrastructure) + Phase 5 (paginated routes, no breaking changes there)
**Why now**: Discovered during Phase 5.1 UAT discussion (2026-05-19). The data already exists — Google Ads `conversionValue` is captured by `GoogleAds.gs:getGoogleAdsAdGroupInsights` and lands in `{store}-campaigns` tab with `platform='Google'`. Organic/direct sales are derivable from `OrderSource` classification (`meta-organic`, `direct`, etc.) in `{store}-orders-attribution`. The current `MetaShopifyReconciliation` panel only uses 2 of the 4 available data sources.
**Requirements**:
  - Extend `buildReconciliation` in `useCampaignTrueRevenue.ts` to compute 4 daily series instead of 2:
    1. Shopify actual revenue (mapped products) — already computed
    2. Meta-claimed (sum of `conversionValue` for Meta campaigns mapped to product) — already computed
    3. Google-claimed (sum of `conversionValue` for Google campaigns mapped to product) — NEW
    4. Organic/Direct (sum of order revenue for orders where `source ∈ {meta-organic, direct, organic-search, other}` AND order contains mapped product) — NEW
  - Add 3 additional Pearson correlations: Google-vs-Shopify, Organic-vs-Shopify, (Meta+Google+Organic)-vs-Shopify
  - Update `MetaShopifyReconciliation.tsx` to render 4 series with legend + colors (rename to `ChannelReconciliation.tsx` is optional)
  - "Coverage gap" indicator: if `Σ(Meta+Google+Organic) / Shopify_actual < 0.8` → render an amber chip "20%+ dark traffic — check attribution leakage"
**Success Criteria**:
  1. The reconciliation chart in CampaignDrawer renders 4 distinct series with clear legend
  2. For stores without Google Ads (zolplus, usmile360 today): Google series renders as flat 0 line, NOT broken
  3. All 4 series compute correctly: tested via existing fixtures + a new test case in `__tests__/`
  4. `npm run build` + `npm test` pass
  5. Eyeball on production: open CampaignDrawer for a mapped Meta campaign → see 4 lines

Plans:
- [x] 05.2-01-PLAN.md — extend buildReconciliation + chart UI + Pearson additions

### Phase 05.2.1: Algorithm correctness audit (Opus + codex cross-AI review) (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 5.2
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 05.2.1 to break down)

### Phase 05.2.1.1: Algorithm correctness fixes (codex via GSD cross-AI)

**Goal**: Apply 23 fixes identified by the Opus+codex algorithm audit (Phase 5.2.1) before starting Phase 6. Executed via codex (GPT-5) through GSD's cross-AI execution mechanism — codex receives each plan via stdin, produces SUMMARY.md output, fully audited as commits in main.
**Why now**: Phase 5.2.1 audit surfaced concrete bugs: (a) ORGANIC_SOURCES silently drops YouTube/Google-organic orders, (b) hardcoded `+03:00` in Shopify.gs corrupts winter daily windows by 1 hour, (c) products-daily shared-tab race, (d) Phase 5.2 Meta series asymmetric with Google, (e) true revenue allocation changes with UI platform filter. Phase 6 (security) cannot safely build on this stack until fixed.
**Depends on**: Phase 5.2.1 (audit + peer review)
**Execution**: All 3 plans have `cross_ai: true`. Run `/gsd-execute-phase 05.2.1.1 --cross-ai` — GSD pipes each task prompt to `codex exec -s workspace-write --skip-git-repo-check -`, captures SUMMARY.md, commits per fix.
**Requirements** (23 items, see SYNTHESIS.md):
  - FIX-01..FIX-07: P0/P1 critical — Plan 05.2.1.1-01
  - FIX-08..FIX-15: P2 secondary — Plan 05.2.1.1-02
  - TEST-01..TEST-08: regression coverage — Plan 05.2.1.1-03
**Success Criteria**:
  1. All 23 fixes committed atomically with `fix(05.2.1.1-NN): ...` prefix
  2. `npm test` count rises from 89 → ~100-105
  3. `npm run build` + `tsc --noEmit` green
  4. Apps Script `.gs` syntax-clean
  5. SUMMARY.md per plan documents deviations + user-action items
  6. Post-deploy production check: 4-channel chart includes google-organic orders correctly

Plans:
- [x] 05.2.1.1-01-PLAN.md — P0/P1 critical (7 tasks: ORGANIC predicate, Shopify TZ, products-daily LockService, symmetric Meta series, allocation-filter independence, channel-aware narrative, pearson zero-variance)
- [x] 05.2.1.1-02-PLAN.md — P2 secondary (8 tasks: ID text format + migration, consistent date range, robust outlier detection, productMap freshness chip, canonical revenue basis, ad-set docstring, campaignKey platform namespace, Bayesian Bessel correction)
- [x] 05.2.1.1-03-PLAN.md — test coverage (8 tasks: OrderSource contract, darkTraffic boundary, signed revenue, cross-store hook, Google primary path, lineItemsCad, whitespace+long-ID, OrderSource sweep)

### Phase 05.2.3.0: Shopify revenue net-of-refunds (URGENT BUG-FIX — INSERTED)

**Goal:** [Urgent bug-fix — to be planned. Store-level revenue across the dashboard (home page KPI cards, PerStoreCards, GoalTracker, daily P&L) is inflated when refunds happen on prior-day orders. Two root causes: (1) `getShopifyRevenue` in `Shopify.gs:90` queries by `created_at` window only, so refunds processed today on yesterday's order never appear; yesterday's sheet row stays frozen with pre-refund total. (2) The code relies on `current_total_price` alleged to "deduct refunds" — but in API 2024-10 this is unreliable for refund-without-restock + 15-min sync lag. Per-product path at `Shopify.gs:220-246` already does refunds correctly (subtracts per-line-item from `o.refunds[]`); store-level path does not. Fix: compute revenue per day as `sum(orders.current_total_price created on day D) − sum(refunds.transactions.amount processed on day D)` so refunds appear on the day they were issued, regardless of original order date. Includes regression test using a known refund event and a documented operator runbook on how to refresh historical sheet rows after deploy.]
**Requirements**: TBD (run /gsd-discuss-phase 05.2.3.0)
**Depends on:** Phase 05.2.1.1 (last stable Shopify-side fix set; FIX-26 lastActiveDate convention reused for the refund-day aggregation)
**Why now (URGENT):** Discovered 2026-05-20 — operator reported that today's refunds do not show up in any "revenue" surface in the dashboard. Affects trust in every KPI that reads from `{store}-daily` sheet. Blocks Phase 05.4 (Unmapped Active Campaigns Indicator) until corrected — 05.4 surfaces operator UX about campaigns vs. revenue, and if revenue itself is wrong, the indicator's trust signal is compromised.
**Plans:** 10/10 plans complete

Plans:
- [x] 05.2.3.0-01-PLAN.md — Read-only Shopify refund-contract probe (probeRefundContract_ in Main.gs + ROAS menu item) + operator checkpoint that writes 05.2.3.0-PROBE-EVIDENCE.md. Wave 1, autonomous: false (D-B1..D-B4).
- [x] 05.2.3.0-02-PLAN.md — Shared cross-day refund fetcher getShopifyRefundsForDay_ in Shopify.gs (updated_at-windowed orders.json, D-A2 cross-day filter, D-C1+D-C2 field reads) + previousDayStr_ helper in Config.gs. Wave 2, autonomous: true.
- [x] 05.2.3.0-03-PLAN.md — Wire getShopifyRefundsForDay_ into getShopifyRevenue and getShopifyProductSalesForDay (subtract cross-day refunds) + update Shopify.gs file header docstring. Wave 3, autonomous: true. Depends on 02.
- [x] 05.2.3.0-04-PLAN.md — Pure-TS mirror dashboard-web/src/lib/shopifyRevenueRefunds.ts + 4 D-C3 invariant tests with fixtures from PROBE-EVIDENCE.md (D-C4, NO fictional fixtures). Wave 2, autonomous: true, type: tdd. Depends on 01.
- [x] 05.2.3.0-05-PLAN.md — Rolling 3-day backfill in 3 per-store live wrappers + legacy runLiveUpdate manual entry (DailyUpdate.gs D-D1). Wave 3, autonomous: true. Depends on 02.
- [x] 05.2.3.0-06-PLAN.md — 3 per-store 20-day cleanup menu items in Main.gs (D-D2 verbatim Hebrew strings: רענן הכנסות (20 ימים) — uzoshop / Zol Plus / 360usmile) + refreshRevenue20Days*_ handlers. Wave 3, autonomous: true. Depends on 01.
- [x] 05.2.3.0-07-PLAN.md — User Manual §16.11 Refund-Day Attribution (refund-day model + canonical PROBE-EVIDENCE-derived example + 3 cleanup menu items verbatim + negative-revenue policy per D-D3 + 3 Shopify Admin verification URLs). Wave 4, autonomous: true. Depends on 01-06.
- [x] 05.2.3.0-08-PLAN.md — GAP CLOSURE (CR-01..CR-04, WR-04): Model change — switch getShopifyRevenue from current_total_price (live) to total_price (immutable) + drop cross-day filter in getShopifyRefundsForDay_ + processed_at filter on intra-order refundByLineId + remove Math.max(0) clamp + refactor updateStoreForDate_ to one-fetch-two-consumers + update TS mirror with KEEP-IN-SYNC docstring listing 3 invariants. Wave 1 (gap-closure), autonomous: true. Files: Shopify.gs, DailyUpdate.gs, dashboard-web/src/lib/shopifyRevenueRefunds.ts. 5 tasks.
- [x] 05.2.3.0-09-PLAN.md — GAP CLOSURE (WR-01 / Gap 5 + Gap 2): Add 5th D-C3 invariant (period reconciliation: Σ storeNetCad over relevant days == Σ total_price − Σ refund_line_items[].subtotal) + 6th invariant (per-product cross-day same-day-order with future refund) + sameDayOrderWithFutureRefund synthetic fixture. Wave 2 (gap-closure), autonomous: true, type: tdd. File: dashboard-web/src/lib/__tests__/shopifyRevenueRefunds.test.ts. Depends on 08.
- [x] 05.2.3.0-10-PLAN.md — GAP CLOSURE (WR-05 / Gap 7): Rewrite User Manual §16.11.1 to remove the false 'שורת D-3 תישאר' claim + refresh §16.11.2 canonical example table for total_price model + verify §16.11.5 no-clamping covers all 3 levels + revise CONTEXT.md D-A1/D-A2/D-A3/D-C3 to document gap-closure 08 with ORIGINAL/superseded markers. Wave 2 (gap-closure), autonomous: true. Files: docs/ROAS-Dashboard-User-Manual.md, .planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/05.2.3.0-CONTEXT.md. Depends on 08.

### Phase 05.4: Unmapped Active Campaigns Indicator (INSERTED — FROZEN pending 05.2.3.0)

**Status:** FROZEN as of 2026-05-20 until Phase 05.2.3.0 (Shopify revenue refund bug-fix) ships. Reason: 05.4 surfaces an indicator over per-(store, platform) campaign data that the operator implicitly trusts against revenue; while store-level revenue is inflated by un-deducted refunds, building MORE operator-trust surfaces would compound the problem. Re-thaw by removing this status line and the FROZEN tag from the heading after 05.2.3.0 lands.

**Goal:** [Urgent work — to be planned. Operator-facing UX in the Campaigns view: per-ad-manager (Meta/Google) live count of active campaigns that have no product mapping in ManualOverrides, click-through to the list, green ✓ chip when all active campaigns are mapped.]
**Requirements**: TBD (run /gsd-discuss-phase 05.4)
**Depends on:** Phase 5 (latest stable campaigns data path); independent of 05.3 (manual tab); now also depends on 05.2.3.0 (revenue trust restored before this indicator ships)
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 05.4 to break down) — blocked until 05.2.3.0 ships

### Phase 05.5: Supabase foundation + PROPS-MAP — v2.0 stack — INSERTED 2026-05-21

**Context (2026-05-21):** After Phase 05.2.3.0 shipped, three frictions hit at once — Sheets API short-window quota saturation, 6-min Apps Script cap forcing artificial chunking, and `clasp push` slowing every iteration. Operator chose Supabase Postgres + Inngest cloud + Vercel as the v2.0 stack via `/gsd-explore` (2026-05-21). This phase is the runway — no fetcher work yet, just stand up Supabase + classify properties + verify connectivity. Full exploration record: `.planning/notes/v2-migration-exploration-2026-05-21.md`.

**Goal:** Stand up Supabase Postgres (free tier) with initial schema; classify all 40 properties from `.env` into SECRET / CONFIG / DATA; seed Vercel env vars + Supabase `stores` + `notification_config` tables; produce `docs/PROPS-MAP.md` as the operator checklist that will gate cut-over (Phase 05.7); verify dashboard can connect to Supabase end-to-end. **No production behavior change.**
**Requirements**: TBD (run /gsd-discuss-phase 05.5)
**Depends on:** Phase 05.2.3.0 complete (stable algorithm before we replicate it in TS) + `.env` populated with all 40 properties (done 2026-05-21)
**Plans:** 3/3 plans complete

Plans:
- [x] 05.5-01-PLAN.md — Supabase CLI init + cloud project link + 0001_initial_schema.sql (10-table DDL — D-A5) + 0002_seed_stores.sql (3 stores + 2 notification_config rows) + MIGRATION-DISCIPLINE.md (D-B4 additive-only tripwire) + [BLOCKING] `supabase db push` checkpoint. Wave 1, autonomous: false (1 human-action for Supabase project creation + 1 human-verify for db push).
- [x] 05.5-02-PLAN.md — docs/PROPS-MAP.md (43-row classification table — D-C1..D-C5) + .env Section 5 with 3 new Supabase keys (D-C5) + Vercel production env-var seeding (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY). Wave 2 (depends on plan 01 for the 3 Supabase keys to exist), autonomous: false (1 human-verify for `vercel env add` checkpoint).
- [x] 05.5-03-PLAN.md — @supabase/supabase-js install + dashboard-web/src/lib/supabase.ts (server-only client) + cacheConfig.ts `health:` entry + dashboard-web/src/app/api/health/route.ts (Promise.allSettled, D-D2 ping) + SyncIndicator.tsx ternary extension via SWR (Option A — does NOT touch cloudSync.ts) + User Manual update for ternary states + RLS-off lint expectation + production curl smoke test against Vercel-deployed /api/health. Wave 3 (depends on plans 01 + 02), autonomous: false (1 human-verify for production deploy + curl smoke).

### Phase 05.6: TS port + Inngest + operator console (v2.0 stack — INSERTED 2026-05-21)

**Context (2026-05-21):** Active migration phase. Port the 5 Apps Script fetchers (Shopify / Meta / Google Ads / FX / ManualOverrides) to TS, set up Inngest cloud (daily cron + 15-min cron + on-demand events), build the operator console UI in dashboard. Apps Script continues running in parallel writing to Sheets — the two systems are independent (no dual-write), both reading from the same upstream APIs. Dashboard reads via feature flag (`READ_FROM=sheets|postgres`, defaults to sheets).

**Goal:** Replace Apps Script's data-plane responsibility with Inngest jobs writing to Supabase, and add operator-facing UI surfaces to the dashboard: sync now button, jobs table, backfill range picker, manual_overrides CRUD. One-off importer ports the 38 existing manual-spend rows. **Production reads still come from Sheets** until Phase 05.7 flips the flag.
**Requirements**: TBD (run /gsd-discuss-phase 05.6)
**Depends on:** Phase 05.5 (Supabase + PROPS-MAP must exist) + Phase 05.2.3.0 (algorithm correctness — TS port must mirror the corrected `getShopifyRefundsForDay_` model from Phase 05.2.3.0-08)
**Plans:** 22/22 plans complete

Plans:
- [ ] TBD (run /gsd-plan-phase 05.6) — TS ports of 5 fetchers, Inngest setup + 3 cron functions + 2 event functions, "ניהול" tab UI, manual_overrides CRUD UI, 38-row importer, feature flag in dashboard `/api/*` routes

### Phase 05.7: Cut-over + Apps Script decommission (v2.0 stack — INSERTED 2026-05-21)

**Context (2026-05-21):** The "point of no return" phase. Run verification harness that diffs Sheets-side numbers vs Supabase-side numbers for the last 14 days (acceptable delta: zero modulo the Phase 05.2.3.0 algorithm-correction delta — Sheets retains old algorithm artifacts, Supabase reflects corrected algorithm). Once verified, flip the dashboard feature flag from `READ_FROM=sheets` to `postgres`, monitor production for 7 days, then disable Apps Script triggers and delete the `clasp` CI workflow. Sheets get archived read-only.

**Goal:** Cut over the dashboard's read path from Sheets to Supabase; decommission Apps Script as the active data-plane writer (keep project as a frozen archive); delete `clasp` CI; archive Sheets to read-only snapshot. After this phase, Sheets + Apps Script are completely out of the active dependency graph.
**Requirements**: TBD (run /gsd-discuss-phase 05.7)
**Depends on:** Phase 05.6 complete (Inngest jobs writing real data to Supabase for at least 7 days before cut-over)
**Plans:** 0 plans (run /gsd-plan-phase 05.7 to break down — expect 4-5 plans)

Plans:
- [ ] TBD (run /gsd-plan-phase 05.7) — verification harness (Sheets vs Postgres diff per-day per-store per-metric), feature flag flip + monitor, Apps Script trigger disable, `clasp` workflow deletion, Sheets archive snapshot, CLAUDE.md / SYSTEM_OVERVIEW.md updates

### Phase 6: Security & Cloud-Sync (SLIMMED — single-user internal context)

**Context (added 2026-05-19)**: After Phase 5 we revisited scope. The dashboard is a SINGLE-USER INTERNAL tool with at most one user editing at a time. Multi-user concerns (rate-limit-against-DDoS, optimistic-concurrency If-Match) and auth gating were intentionally dropped — user accepted URL-obscurity as the trust boundary.

**Goal**: Defense in depth for credential leak + self-forensics + quota efficiency. NOT multi-user concurrency, NOT rate-limit, NOT auth.
**Depends on**: Phase 2 (need tests to verify) + Phase 5 (cleaner API surface)
**Requirements** (slim):
  - Service-account split:
    - Create new service-account `roas-dashboard-writer@...` with `spreadsheets` scope, restricted to write only `dashboard-state` + `dashboard-state-audit` tabs
    - Existing service-account becomes read-only (`spreadsheets.readonly`)
    - Two env var sets in Vercel: `GOOGLE_READER_EMAIL`/`GOOGLE_READER_KEY` + `GOOGLE_WRITER_EMAIL`/`GOOGLE_WRITER_KEY`
    - `sheets.ts` uses reader for all GETs and writer only for `upsertDashboardStateKey`
  - Audit log:
    - New tab `dashboard-state-audit` with 4 columns: `timestamp`, `key`, `old_value` (truncated to 500 chars), `new_value` (truncated)
    - Every POST writes one row before updating `dashboard-state`
    - 30-day retention; older rows pruned in a scheduled cleanup
  - Adaptive polling:
    - Visible tab: 30s poll
    - Hidden tab (`document.visibilityState === 'hidden'`): 5min poll
    - Page idle > 10min: stop polling until next focus
**Dropped (rationale)**:
  - ❌ Rate limiting — single user, no DDoS surface. URL obscurity is the access boundary.
  - ❌ If-Match (optimistic concurrency) — single user means no concurrent edits, no race condition risk.
  - ❌ Auth layer — user explicitly accepts URL-obscurity as the trust model (2026-05-19); not retrofitting a login flow.
**Success Criteria**:
  1. Service-account split deployed; reader credentials return 403 if attempting to write
  2. `dashboard-state-audit` tab populates with one row per POST; verified after a billing edit
  3. Hidden tab polling rate drops to 1/5min (verified via Network panel)
  4. SYSTEM_OVERVIEW.md security section updated to reflect single-user trust model
**Plans:** 4 plans
Plans:
- [ ] 06-PLAN.md — outline document mapping plans to waves (Wave 1: 06-01 + 06-02 parallel; Wave 2: 06-03; Wave 3: 06-04)
- [ ] 06-01-PLAN.md — Service-account split (reader/writer) + .env.example + SETUP.md runbook. 2 tasks: refactor + checkpoint:human-verify (operator runs the SA split in Google Cloud + Vercel). Wave 1, autonomous: false.
- [ ] 06-02-PLAN.md — Adaptive polling hook (useAdaptivePolling.ts) + CloudSync.tsx rewire. 1 task. Wave 1, autonomous: true (parallel with 06-01).
- [ ] 06-03-PLAN.md — Audit log: `dashboard-state-audit` tab auto-creation + appendAuditRow + POST handler wiring. 2 tasks. Wave 2 (depends on 06-01 for writer auth), autonomous: true.
- [ ] 06-04-PLAN.md — Retention cleanup: Apps Script `pruneAuditLogOlderThan` + weekly `pruneAuditLogTrigger` (Sunday 03:00) + `installAuditPruneTrigger` installer + SYSTEM_OVERVIEW.md Phase 6 section. 2 tasks. Wave 3 (depends on 06-03), autonomous: true.

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

### Phase 9: Pre-Conversion Algorithmic Audit

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 9 to break down)

### Phase 10: Pre-Conversion Algorithmic Fixes

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 9
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 10 to break down)

### Phase 11: Decommission Apps Script tier

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 10
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 11 to break down)
