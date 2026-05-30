# Architecture & Refactoring Audit

**Track 4 — Architecture & Refactoring Opportunities**
**Baseline:** HEAD = `4c3f7e9` (post Phase 12.5.x)
**Scope:** structure, layering, dead code, decomposition, Apps Script residue, doc drift.

## Summary

The post-Phase-11 layering is well-defined and almost entirely honored: every external API call goes through `lib/fetchers/*`, every Postgres read goes through `lib/postgresReaders.ts`, every Postgres write originates inside `inngest/functions/*`, and no component imports `supabaseAdmin` or a fetcher. Three real layer crossings exist (`/api/data` direct Frankfurter fetch, `/api/operator/jobs` direct Inngest API fetch, `/api/debug/shopify-fetch` direct Shopify fetch) — none constitutes a P0 bug, but the FX one is the most easily fixed.

The biggest structural risk is concentration: `aiReport.ts` (2,496 LOC), `CampaignsTable.tsx` (2,464 LOC), `cronLive.ts` (1,427 LOC), `CampaignDrawer.tsx` (1,413 LOC), `cronDaily.ts` (1,277 LOC), `attributionAnalysis.ts` (1,234 LOC), `BillingSettings.tsx` (1,164 LOC), and `postgresReaders.ts` (1,040 LOC) together account for ~17% of all source. Each is a single-concern god-module that has grown organically; none has internal section markers (no `// ===` dividers in `aiReport.ts` or the big components) so navigating them is friction-heavy.

Vestigial Apps Script residue is small but real: root `package.json` still declares `deploy:gs`/`@google/clasp`; `.claspignore` still exists; `SYSTEM_OVERVIEW.md` is 99% Apps-Script-era prose (with a top banner acknowledging that). Inside `dashboard-web/src/`, every "sheets/clasp/READ_FROM" hit is in a historical comment — fine.

Doc drift on the `.planning/codebase/*` files is the most surprising finding: STRUCTURE.md cites "235 TS/TSX" (actual 263), "54 components" (actual 46+7=53), "54 non-test lib" (actual 50+hooks+notifications+fetchers=67), "5K+ lines cronDaily" (actual 1,277), "144 lib specs" (actual 89), "8 inngest specs" (actual 13). ARCHITECTURE.md cites "11 Inngest functions" (actual 12: 3+3+1+1+3+1). `app/api/inngest/route.ts:69` comment says "8 functions total" (actual 12). None of this breaks anything, but every track that reads the codebase docs will start from wrong totals.

Constant duplication is the only structural pattern worth refactoring in the small-app sense: `['uzoshop','zolplus','usmile360']` is redeclared in **8** places under three names (`STORES`, `ALL_STORES`, `VALID_STORES`), and `STORES_WITH_TIKTOK` is redeclared in `cronDaily.ts` and `cronLive.ts` (already flagged in CONVENTIONS but still drifted). One-page `lib/platformConfig.ts` would absorb both.

No circular imports, no `BaseXxx` abstractions, no DI containers. Tests do reach across the layer boundary (`@/components/MetaShopifyReconciliation` exports pure helpers consumed by `lib/__tests__/*`), but that is co-location of pure logic with its consumer, not a structural cycle.

---

## P0 (broken layering, circular deps, large-blast-radius coupling)

**None at file:line level.** No component imports `supabaseAdmin`, no `lib/*` imports `components/*` (except tests), no production cycle. The closest-to-P0 items:

### P0-1 — `lib/hooks/useCampaignTrueRevenue.ts:11-13` imports types from `@/app/api/*/route`
- **Violation:** Pure-logic hook imports `ProductsResponse`, `OrdersAttributionResponse`, `CampaignsResponse` types from API-route modules.
- **Why it's borderline:** App-router files load Edge/Node runtime decorators (`export const dynamic`, `export const maxDuration`, etc.) on the route. Importing a *type* is technically erased at compile time, but every consumer of `useCampaignTrueRevenue.ts` (Vitest test, Next.js bundler) now indirectly walks the route file. If a route ever inadvertently exports a value alongside the type, the bundle pulls in the server-only code path.
- **Same pattern:** `useCampaignAttribution.ts:7`, `lib/hooks/useCampaignTrueRevenue.ts:11-13`, `lib/__tests__/healthRouteRevalidateSync.test.ts:20` (test of a route — acceptable), `lib/__tests__/tiktokCallbackCsp.test.ts:2`.
- **Fix:** Move the three `*Response` types into `lib/types.ts` (or per-resource type modules), and have the route file `export type { ProductsResponse } from '@/lib/...'`. Effort: **M** (touches 4 files).

### P0-2 — `app/api/data/route.ts:21` direct Frankfurter fetch
- **Violation:** API route calls `fetch('https://api.frankfurter.dev/...')` instead of using `lib/fetchers/fx.ts::fetchTodayFx`.
- **Concrete code:** `const r = await fetch('https://api.frankfurter.dev/v1/latest?base=ILS&symbols=CAD', ...)`.
- **Why it's wrong:** CONVENTIONS says "lib/fetchers/* → external HTTP only" and the route should delegate. `lib/fetchers/fx.ts` already exposes `getFxRate` but no `fetchTodayFx` — extract one.
- **Fix:** Add `fetchTodayFx()` to `lib/fetchers/fx.ts`, replace inline fetch with the call. Effort: **S**.

### P0-3 — `app/api/operator/jobs/route.ts:132,165` direct Inngest API fetch
- **Violation:** Two direct `fetch(...)` calls to the Inngest REST API for run-history listing.
- **Why it's defensible:** No `lib/fetchers/inngest.ts` exists; this is the only consumer; adding a wrapper for one use site is over-engineering for a 1-2-human team.
- **Fix:** Leave as-is, OR extract `listInngestRuns()` into a tiny `lib/fetchers/inngest.ts` (no third caller justifies it). Effort: **S** if extracted; **0** if kept.

---

## P1 (file-size hotspots, decomposition opportunities)

### P1-1 — `lib/aiReport.ts` (2,496 LOC, 0 section markers, 16% comments)
- **Reality:** One exported function `generateAiReport` from line 105 to line 2,491. Single concern (build the AI markdown report) but bundled with: (1) numeric formatters, (2) date helpers, (3) stat helpers (CV / median / MAD / momentum — duplicated from `attributionAnalysis.ts`), (4) per-store narratives, (5) cross-store narratives, (6) status freshness section, (7) tiktok budget section, (8) markdown escapers.
- **Recommended split:**
  - `lib/aiReport/stats.ts` — pull stat helpers; consolidate with the duplicates in `attributionAnalysis.ts` (the CONCERNS doc already flags "no `lib/stats.ts`").
  - `lib/aiReport/sections/` — one file per narrative section.
  - Keep the `generateAiReport` orchestrator as a thin composer in `lib/aiReport.ts`.
- **Why now:** every new audit finding cycles through this file; the lack of section markers makes diff review slow. Extracting `stats.ts` also closes CONCERNS "variance convention inconsistency."
- **Effort:** **L** (touches ~30 tests, but each test file targets a small slice).

### P1-2 — `components/CampaignsTable.tsx` (2,464 LOC)
- **Reality:** Main `<CampaignsTable />` body spans lines 231–2,134 (~1,900 LOC of JSX + handlers). Embeds 4 inline sub-components afterward (`AttributionGapPanel`, `ColumnHeaderTh`, `SortHeader`, `Stat`). The pure-logic helpers (`sortAggregated`, `todayInIsrael`) sit at the top — those belong in `lib/`.
- **Recommended split:**
  - Move `AttributionGapPanel`, `ColumnHeaderTh`, `SortHeader`, `Stat` to sibling files under `components/campaigns/` (folder mirrors the dashboard's existing `components/operator/` pattern).
  - Extract the sort/filter state into `lib/hooks/useCampaignsTableState.ts` (mirrors the existing `useBillingRecurring` extraction pattern).
  - Move `sortAggregated` to `lib/campaignsAggregator.ts` (already its natural home).
- **Effort:** **L**.

### P1-3 — `inngest/functions/cronLive.ts` (1,427 LOC, 48% comments — 687 comment lines)
- **Reality:** `runLiveForStore` body is lines 588–1,348 (~760 LOC). The comment density is unusually high — many of the 687 comment lines are inline derivations of audit fixes. That's deliberate per CONVENTIONS but it pushes the actual code into one big procedural block.
- **Recommended split:** factor `runLiveForStore` into 3 helpers:
  - `fetchLiveRollingShopify(storeId, dates)` — wraps step 1.
  - `refreshLiveStatuses(storeId, platform)` — wraps the per-platform status refresh logic (currently a single 200+ LOC block).
  - `persistLiveBatch(rows)` — wraps the upsert payload-omission logic that preserves daily-cron spend.
- **Why:** the same 3 chunks already exist as step.run labels; promoting them to top-level functions reduces the indent depth and makes the per-platform retries individually unit-testable (today they're tested via `cronLive.test.ts` driving the full handler).
- **Effort:** **M**.

### P1-4 — `inngest/functions/cronDaily.ts` (1,277 LOC, 36% comments)
- **Reality:** `runDailyForStore` (lines 219–1,240) is a 5-step orchestrator + helpers. Mostly fine — well-commented, single clear concern. The pre-step helpers (`getCogsRateForStore`, `yesterdayJerusalem`) are pure and should be shared with `cronLive.ts` (both have their OWN `getCogsRateForStore` — see P1-7).
- **Recommended split:** marginal. Pull `getCogsRateForStore` + `yesterdayJerusalem` into `lib/storeCogs.ts` (or extend `lib/analytics.ts::getCogsRateForStore` which already exists at the read side — see P1-7 below).
- **Effort:** **S**.

### P1-5 — `components/CampaignDrawer.tsx` (1,413 LOC, single component + 1 sub)
### P1-6 — `components/BillingSettings.tsx` (1,164 LOC, 4 inline sub-components)
- Both are candidates for the same "extract inline sub-components + hook out heavy state" pattern as P1-2. BillingSettings has the natural split already (`RecurringTab` + `RecurringEditForm` + `OneTimeTab` + `OneTimeEditForm`) — each could live in `components/billing/`.
- **Effort:** **M** each.

### P1-7 — Triple-declared `getCogsRateForStore`
- **Reality:** `cronDaily.ts:116`, `cronLive.ts:189`, and `analytics.ts:31` all declare a `getCogsRateForStore(storeId)` reading `${STORE_UPPERCASE}_COGS_RATE`. The write-side pair (cronDaily / cronLive) is symmetric (good), but the read side (`analytics.ts`) is an independent third copy.
- **Fix:** keep one in `lib/storeCogs.ts`; cron functions import from it. (Currently they don't because `analytics.ts` lives in lib and lib is "UI-side" via its other helpers — but `getCogsRateForStore` is pure and env-driven so it's safe everywhere.)
- **Effort:** **S**.

### P1-8 — Duplicated `STORES_WITH_TIKTOK` (acknowledged but unresolved)
- **Reality:** `cronDaily.ts:93`, `cronLive.ts:145` declare identical `new Set(['uzoshop'])`. CONVENTIONS.md already flags this; no action taken.
- **Fix:** add to `lib/platformConfig.ts` next to `TIKTOK_ACTIVE_ENOUGH`. Effort: **S** (5-min change).

### P1-9 — `['uzoshop','zolplus','usmile360']` declared in 8 places
- **Sites:** `app/api/operator/sync-now/route.ts:58`, `app/api/operator/backfill/route.ts:55`, `inngest/functions/cronDaily.ts:84`, `inngest/functions/cronLive.ts:125`, `components/operator/BackfillPicker.tsx:52`, `components/operator/ManualOverridesCrud.tsx:73`, `components/operator/SyncNowButtons.tsx:64`, `lib/operatorManualOverrides.ts:18`.
- **Why it matters:** adding a 4th store today requires 8 edits. The CONCERNS "outstanding drift" entry only flags the cron pair.
- **Fix:** export `const STORES = ['uzoshop','zolplus','usmile360'] as const` + `type StoreId = (typeof STORES)[number]` from `lib/platformConfig.ts`; replace all 8 sites.
- **Effort:** **S**.

---

## P2 (dead code, vestigial files, doc drift)

### P2-1 — Apps Script residue at repo root
- **`package.json` (root)** declares `"deploy:gs": "clasp push --force"` and `devDependencies: { "@google/clasp": "^2.4.2" }`. Both should be deleted post-Phase-11.
- **`.claspignore`** (29 bytes, content `**/**\n!*.gs\n!appsscript.json`) is meaningless without `clasp` + `.clasp.json`. Delete.
- **Fix:** `git rm .claspignore` + remove the two `package.json` entries + `package-lock.json` regenerate. Effort: **S**.

### P2-2 — `SYSTEM_OVERVIEW.md` is 99% stale (banner-aware)
- Top of file has a Hebrew "historical doc — Phase 11 removed Apps Script" banner, then the next ~62 KB describes the Apps Script architecture. Operators or future Claude scanning the file will read most of it as truth and only the banner as warning.
- **Fix:** either truncate to just the banner + "see `.planning/codebase/ARCHITECTURE.md`", or rewrite for the post-Phase-11 single tier. Effort: **M** if rewritten, **S** if truncated.

### P2-3 — `app/api/inngest/route.ts:69` comment block drift
- Comment says "8 functions total"; actual count is 12 (3 cron-daily + 3 cron-live + sync + backfill + 3 whatsapp + 1 whatsapp send-now). Line 75 also still says "every 15 minutes" — the cron is `*/10` since Phase 05.7.6.
- **Fix:** edit lines 69–86. Effort: **S**.

### P2-4 — `.planning/codebase/STRUCTURE.md` numeric claims drift
- Says "**235** TS/TSX files" → actual **263**.
- Says "**54** components" in flat root → actual **46** (with 7 in `operator/`).
- Says "**54** (non-test) lib" → actual **50** (in `lib/` root) + 4 hooks + 5 notifications + 7 fetchers = **67** non-test under `lib/`.
- Says "`cronDaily.ts` (5K+ lines)" → actual **1,277** (the line `inngest/functions/cronDaily.ts (5K+ lines incl. shared handler)` is wrong by ~4x).
- Says "**144** specs" under `lib/__tests__/` → actual **89**.
- Says "**8** Inngest function tests" → actual **13**.
- **Why:** STRUCTURE.md table at line 226-235 is outdated; same numbers cited again in narrative at line 253.
- **Fix:** re-run `find ... | wc -l`, update both the table and the narrative. Effort: **S** (template-only).

### P2-5 — `.planning/codebase/ARCHITECTURE.md` registration drift
- Header diagram says "INNGEST CLOUD — 11 SCHEDULED + EVENT FUNCTIONS"; actual = 12.
- The narrative correctly lists `cron-daily × 3`, `cron-live × 3`, `whatsapp-noon`, `whatsapp-evening`, `whatsapp-eod`, `event/sync-now`, `event/backfill`, `event/whatsapp.send-now` — that totals 11 displayed events but `whatsappCronFunctions` exports 3 (noon, evening, eod) PLUS `eventWhatsappSendNow` = 4 from cronWhatsapp. So the count 12 includes: 3+3+1+1+3+1.
- **Fix:** update the "11" → "12" in line 20. Effort: trivial.

### P2-6 — `lib/useDashboardRefresh.ts` lives at `lib/` root, but it's a hook
- Per CONVENTIONS "Hooks (`lib/hooks/*.ts`)" the file belongs in `lib/hooks/`. The other 4 hooks (`useBillingOneTime`, `useBillingRecurring`, `useCampaignAttribution`, `useCampaignTrueRevenue`) all live in `lib/hooks/`. Lone outlier.
- **Fix:** `git mv lib/useDashboardRefresh.ts lib/hooks/useDashboardRefresh.ts` + update 1 component import (`TabFreshnessHeader.tsx:5`). Effort: **S**.

### P2-7 — `lib/constants.ts` stale comment
- Lines 11-12: "the dashboard's actual ad-spend conversion uses the live FX rate from Apps Script (`getFxRate`)". Post-Phase-11 `getFxRate` lives in `lib/fetchers/fx.ts` and calls Frankfurter, not Apps Script.
- **Fix:** swap "Apps Script" → "the Frankfurter fetcher (`lib/fetchers/fx.ts`)". Effort: trivial.

### P2-8 — Stale TODOs (none verifiably > 30 days, but useful list)
- `lib/lineItems.ts:26` — "TODO (future phase): extract a shared revenue-allocation schema" — broad, no phase number.
- `lib/utils.ts:53` — "TODO(phase-5): wire safeDecode() into useSearchParams() consumers for UTM" — Phase 5 work was about cloud sync and is closed.
- `lib/notifications/tokenFailures.ts:33` — "Operator UI: `/operator > בעיות טוקן` (TODO follow-up commit)" — operator UI is now live (see `components/operator/TokenFailuresTable.tsx`); the TODO is done, just not deleted.
- **Fix:** delete the last two (work shipped). Effort: trivial.

### P2-9 — Apps Script comment refs in inngest functions
- `cronDaily.ts` has 8 inline `.gs:` line-number refs (e.g., `// Config.gs:6`, `// MetaAds.gs:157`). `cronLive.ts` has 2. These are "code archaeology" pointers to files that no longer exist post-Phase-11.
- **Not a bug** — they document the algorithm origin. But operator/Claude reading the file will look for files that aren't there.
- **Fix:** sweep on next touch — replace `.gs:LINE` with a Git tag or commit ref where the old file last existed. Effort: **S** (and only when convenient).

### P2-10 — Dead-ish exports
- `lib/sessionKeys.ts` exports only `PRODUCT_MAP_CHIP_KEY`, used in 2 components + 1 test. Module is only 1-key; could be inlined into one of the components OR kept (current state is fine).
- `lib/operatorManualOverrides.ts` is a server-only validator imported once (`app/api/operator/manual-overrides/route.ts:48`); naming is heavy but its `VALID_STORES` duplicates `ALL_STORES` (see P1-9).
- No truly unused exports found in a sweep of the lib root.

---

## File-size table (top 20 with LOC)

| Rank | LOC   | File                                                                                          |
|------|-------|-----------------------------------------------------------------------------------------------|
| 1    | 2,496 | `dashboard-web/src/lib/aiReport.ts`                                                           |
| 2    | 2,464 | `dashboard-web/src/components/CampaignsTable.tsx`                                             |
| 3    | 1,427 | `dashboard-web/src/inngest/functions/cronLive.ts`                                             |
| 4    | 1,413 | `dashboard-web/src/components/CampaignDrawer.tsx`                                             |
| 5    | 1,277 | `dashboard-web/src/inngest/functions/cronDaily.ts`                                            |
| 6    | 1,234 | `dashboard-web/src/lib/attributionAnalysis.ts`                                                |
| 7    | 1,164 | `dashboard-web/src/components/BillingSettings.tsx`                                            |
| 8    | 1,090 | `dashboard-web/src/lib/fetchers/shopify.ts`                                                   |
| 9    | 1,067 | `dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts`                                 |
| 10   | 1,040 | `dashboard-web/src/lib/postgresReaders.ts`                                                    |
| 11   | 1,013 | `dashboard-web/src/lib/fetchers/__tests__/meta.test.ts`                                       |
| 12   | 933   | `dashboard-web/src/components/ProductsTable.tsx`                                              |
| 13   | 877   | `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`                             |
| 14   | 869   | `dashboard-web/src/lib/__tests__/cannibalizationDetection.test.ts`                            |
| 15   | 850   | `dashboard-web/src/components/CampaignsTableRow.tsx`                                          |
| 16   | 848   | `dashboard-web/src/components/MetaShopifyReconciliation.tsx`                                  |
| 17   | 824   | `dashboard-web/src/lib/fetchers/__tests__/shopify.test.ts`                                    |
| 18   | 793   | `dashboard-web/src/lib/__tests__/multiMappingCohort.test.ts`                                  |
| 19   | 791   | `dashboard-web/src/lib/fetchers/meta.ts`                                                      |
| 20   | 781   | `dashboard-web/src/lib/insights.ts`                                                           |

**Total `dashboard-web/src`:** 76,123 LOC across 263 files. Top-20 = ~30% of LOC.

---

## Layer-violation list

| Severity | File:line | Violation | Fix |
|----------|-----------|-----------|-----|
| Medium | `dashboard-web/src/app/api/data/route.ts:21` | Direct `fetch(frankfurter)` from API route — bypasses `lib/fetchers/fx.ts`. | Extract `fetchTodayFx()` into `lib/fetchers/fx.ts`. |
| Low | `dashboard-web/src/app/api/operator/jobs/route.ts:132,165` | Direct `fetch(inngest API)` from API route. | Acceptable (single use site, no fetcher exists). |
| Low | `dashboard-web/src/app/api/debug/shopify-fetch/route.ts:90` | Direct Shopify `fetch` from a debug route. | Acceptable (debug-only, intentionally bypasses fetcher). |
| Low | `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:11-13` | Hook imports types from `@/app/api/*/route`. | Move `*Response` types to `lib/types.ts` or per-resource type modules. |
| Low | `dashboard-web/src/lib/hooks/useCampaignAttribution.ts:7` | Same pattern. | Same fix. |
| Test-only | `dashboard-web/src/lib/__tests__/*.test.ts` (9 files) | Tests import exported helpers from `@/components/*` (e.g., `buildReconciliation`, `computeKpiSparkData`, `_isoMonthsAgoFromIlParts`). | Acceptable per CONVENTIONS — pure helpers are co-located with their consumer; tests pin them. The convention is "components only export their UI; pure helpers should live in `lib/`" — these 9 helpers are quiet violations of that convention. Effort to extract: **M**. |
| Test-only | `dashboard-web/src/lib/__tests__/{healthRouteRevalidateSync,tiktokCallbackCsp}.test.ts` | Tests of API routes co-located in `lib/__tests__/`. | Acceptable for routes; could move to `app/api/__tests__/` if a convention emerged. |

No `lib/*` imports from `components/*` in production code. No component imports `inngest/*`. No component or API route imports `cloudSync.ts` (cloud-sync is browser-only). No `supabaseAdmin` import outside `inngest/` and 2 server-only operator API routes. No production cycle.

---

## Dead code list

| Item | Status | Action |
|------|--------|--------|
| `.claspignore` (29 bytes at repo root) | Vestigial; pointless without `clasp`. | Delete. |
| Root `package.json::scripts.deploy:gs` + `devDependencies.@google/clasp` | Vestigial Phase-11 residue. | Remove both keys + `npm install` at root to regenerate lockfile. |
| `SYSTEM_OVERVIEW.md` (62 KB Apps-Script-era prose) | Stale; only the top banner is current. | Truncate or rewrite. |
| `lib/useDashboardRefresh.ts` (at lib root) | Misplaced — should be in `lib/hooks/`. | Move + update 1 import. |
| `lib/lineItems.ts:26` TODO + `lib/utils.ts:53` TODO + `lib/notifications/tokenFailures.ts:33` TODO | Two of three reference work already shipped. | Delete the two stale TODOs. |
| 8 inline `.gs:LINE` archaeology refs in `cronDaily.ts` + 2 in `cronLive.ts` | Reference deleted files. | Replace with Git ref or delete on next touch. |

**No exported-but-unused symbols** in lib root that survived a cross-check. Every export I sampled (`computeSparklineGeometry`, `useDrawerEsc`, `filterDrillRows`, `PRODUCT_MAP_CHIP_KEY`, all `campaignProductMap` / `campaignOptimized` exports, all 16 `postgresReaders` exports) has at least one importer outside its own module.

**All inngest functions are registered.** `app/api/inngest/route.ts:112-121` registers `cronDailyFunctions` (3) + `cronLiveFunctions` (3) + `eventSyncNow` (1) + `eventBackfill` (1) + `whatsappCronFunctions` (3 — noon, evening, eod) + `eventWhatsappSendNow` (1) = 12. Every exported `createFunction` instance is reachable.

---

## Apps Script residue list

| File | Status | Action |
|------|--------|--------|
| `package.json` (root) — `scripts.deploy:gs`, `devDependencies.@google/clasp` | Live (still in package manifest). | Remove. |
| `.claspignore` (root) | Live (file present). | Delete. |
| `SYSTEM_OVERVIEW.md` body | Stale (banner-only acknowledgment). | Truncate or rewrite. |
| `lib/constants.ts:11-12` comment ("live FX rate from Apps Script") | Stale comment. | Update wording to Frankfurter. |
| `app/api/inngest/route.ts:69-77` "8 functions" + "every 15 minutes" comment | Stale (12 functions, `*/10` cadence). | Update. |
| `inngest/functions/cronDaily.ts` — 8 inline `.gs:LINE` refs (Config.gs, MetaAds.gs, GoogleAds.gs, Shopify.gs) | Stale archaeology pointers (files removed). | Sweep on next touch. |
| `inngest/functions/cronLive.ts` — 2 similar refs | Stale. | Same. |
| `inngest/functions/cronWhatsapp.ts:5` — "`Notifications.gs:setupNotificationTriggers`" | Stale. | Same. |

**No `.gs` / `.clasp.json` / `appsscript.json` / `clasp.json` files exist anywhere in the tree.** Confirmed via `find -name '*.gs' -o -name '.clasp*' -o -name 'appsscript.json'`.

**Inside `dashboard-web/src/`** every "lib/sheets / READ_FROM / clasp / appsscript" hit is in a historical comment (`lib/dashboardStateKeys.ts:21`, `lib/ads.ts:2`, `lib/products.ts:2`, etc.) — those comments correctly document the Phase-11 relocation and should stay.

---

## Refactoring opportunities ranked by ROI

| Rank | Item | Effort | Payoff |
|------|------|--------|--------|
| 1 | **P1-9** — extract `STORES`/`StoreId` to `lib/platformConfig.ts`; replace 8 sites. | S | Reduces "add a 4th store" to 1 edit instead of 8. |
| 2 | **P2-1** — delete `.claspignore` + remove `deploy:gs` + `@google/clasp` from root `package.json`. | S | Closes the most-visible Phase-11 residue. Root npm install drops `@google/clasp` and its deps. |
| 3 | **P1-8** — extract `STORES_WITH_TIKTOK` to `lib/platformConfig.ts`. | S | Already acknowledged in CONVENTIONS; closes outstanding drift. |
| 4 | **P0-2** — extract `fetchTodayFx()` into `lib/fetchers/fx.ts`; replace `app/api/data/route.ts:21`. | S | Fixes layer crossing + makes the FX call testable. |
| 5 | **P2-4 + P2-5** — sync `.planning/codebase/STRUCTURE.md` + `ARCHITECTURE.md` numbers + drop stale "5K+ lines cronDaily" claim. | S | Future audits start from correct totals. |
| 6 | **P2-2** — truncate `SYSTEM_OVERVIEW.md` to banner + redirect. | S | Removes the largest stale doc. |
| 7 | **P1-7** — consolidate `getCogsRateForStore` triple-declaration into `lib/storeCogs.ts`. | S | Closes one bug-class (BL-COGS) for good — the three copies are *currently* in sync but the cost of next drift is high. |
| 8 | **P2-6** — move `useDashboardRefresh.ts` into `lib/hooks/`. | S | Matches CONVENTIONS, surfaces the file alongside its peers. |
| 9 | **P1-3** — factor `runLiveForStore` into 3 named helpers; unit-test each. | M | Enables per-platform retry tests + flattens indent depth. |
| 10 | **P1-2** — pull 4 inline sub-components out of `CampaignsTable.tsx` into `components/campaigns/`. | L | Major navigation win; the 2,464-LOC file becomes ~1,200 LOC orchestrator + 4 modular subs. |
| 11 | **P1-1** — split `aiReport.ts` (extract `lib/aiReport/stats.ts` + per-section files). | L | Closes CONCERNS "variance convention" + dedupes math with `attributionAnalysis.ts`. |
| 12 | **P1-5 / P1-6** — same extraction pattern for `CampaignDrawer.tsx` + `BillingSettings.tsx`. | M each | Linear payoff. |

**Recommended cherry-pick batch for the next "polish PR":** items 1–8 (all `S`-effort). One commit per item per CONVENTIONS atomic-commit discipline. Total token cost ~1 hr of refactor + test runs.

---

## Notes for other tracks

- **Track 1 (correctness):** The `getCogsRateForStore` triple-declaration (P1-7) is currently in sync — but if a future fix touches only one or two of the three, you'll get the BL-COGS drift class back. Look for any branch where the value is hardcoded vs. computed.
- **Track 2 (security):** No new findings. `supabaseAdmin` access is correctly walled. The URL-obscurity trust model on `/operator/*` is documented in CONCERNS as "ACCEPTED."
- **Track 3 (perf):** The 2,496-LOC `aiReport.ts` is regenerated on every operator click — splitting it (P1-1) would let Next.js code-split the markdown sections that aren't always needed. Same for `CampaignsTable.tsx` — the inline `AttributionGapPanel`, `Stat`, etc. are bundled even when the campaigns tab is closed.
- **Track 5 (UX):** `SYSTEM_OVERVIEW.md` is referenced from `WELCOME.md` (operator onboarding) — if Track 5 touches operator-facing docs, the stale Apps-Script prose is what a new operator reads on day one. Truncate first.
- **Track 6 (testing):** STRUCTURE.md says `lib/__tests__/` has 144 specs; actual is 89. That's a 55-file gap — verify whether the doc was wrong from the start or whether a 2x test-file deletion happened (the latter would be a Track-6 finding).
- **Track 7 (build/deploy):** Removing `@google/clasp` from root `package.json` (P2-1) shrinks `node_modules` by ~30 MB and removes one transitive-dependency vector.
- **Track 8 (ops):** The "Inngest function registrations" sanity check is fragile because the `app/api/inngest/route.ts` comment counts ("8 functions total") drift from reality. A test asserting `serve()`-args length === expected count would catch future drift cheaply.

---

*Architecture & Refactoring audit: 2026-05-24 — Track 4 of 8.*
