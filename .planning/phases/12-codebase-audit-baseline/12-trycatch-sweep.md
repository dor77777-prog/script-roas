# Try/Catch Sweep — Phase 12

**Scanned:** 36 files, 134 catch sites (counted across both `catch (e)` and bare `catch {}` shapes; the original D-12 spec only captured the `catch (` shape — this sweep ran both for completeness).
**Verdict:** 133 intentional, 1 suspicious.
**Cross-validation:** confirmed INN-16 independently (orthogonal lens vs per-file reviewer).

---

## Suspicious catch sites (need attention)

### CAT-29: dashboard-web/src/inngest/functions/eventBackfill.ts:225 — MAJOR (cross-validates INN-16)

The per-pair catch in the backfill (date × storeId) loop swallows the error inside a typed result entry — `results.push({date, storeId, ok:false, error:message})` — and continues to the next pair.

**Problems:**
1. No `console.warn`/`console.error` — the error string only lives in the returned `results[i].error`, which Inngest does NOT log prominently.
2. The throw never reaches Inngest, so Inngest's per-step retry / dead-letter machinery never fires.
3. For systemic failures (schema-level RLS denial, missing migration, broken env var), the loop burns through all N pairs (default 63 for a 21-day × 3-store backfill) when it should abort after the first 2-3 same-message failures.

**Fix sketch:**
- Add `console.warn` inside the catch so the per-pair failure is visible in Inngest run logs without the operator having to inspect the results matrix.
- Add a "systemic-failure abort" guard: if the first 3 consecutive pairs fail with the same error message, throw to let Inngest retry the whole event instead of burning the exec budget.

**Cross-reference:** Already flagged as INN-16 in `raw-returns/inngest_eventBackfill.json`. The sweep cross-validates that finding via the orthogonal "all catches" lens.

---

## Intentional catch sites (for the record)

### API routes — S-2 soft-fail (status 200 + empty rows + error string)
- `dashboard-web/src/app/api/products/route.ts:56`
- `dashboard-web/src/app/api/ads/route.ts:52`
- `dashboard-web/src/app/api/dashboard-state/route.ts:43`
- `dashboard-web/src/app/api/product-catalog/route.ts:35`
- `dashboard-web/src/app/api/campaigns/route.ts:60`
- `dashboard-web/src/app/api/data/route.ts:68`
- `dashboard-web/src/app/api/store-meta/route.ts:26`
- `dashboard-web/src/app/api/orders-attribution/route.ts:59`
- `dashboard-web/src/app/api/operator/jobs/route.ts:179`
- `dashboard-web/src/app/api/operator/manual-overrides/route.ts:119` (GET-only)

### API routes — mutation 500 + sanitized error
- `dashboard-web/src/app/api/dashboard-state/route.ts:104`
- `dashboard-web/src/app/api/operator/sync-now/route.ts:98`
- `dashboard-web/src/app/api/operator/backfill/route.ts:155`
- `dashboard-web/src/app/api/operator/notifications/send/route.ts:53`
- `dashboard-web/src/app/api/operator/manual-overrides/route.ts:154/234/273`
- `dashboard-web/src/app/api/operator/reset/route.ts:175`
- `dashboard-web/src/app/api/operator/token-failures/route.ts:116/170` (operator-only — error message reaches body intentionally)

### parseRangeParams typed-error 400 branch
- `dashboard-web/src/app/api/products/route.ts:30`
- `dashboard-web/src/app/api/ads/route.ts:24`
- `dashboard-web/src/app/api/data/route.ts:36`
- `dashboard-web/src/app/api/campaigns/route.ts:34`
- `dashboard-web/src/app/api/orders-attribution/route.ts:28`

### Inngest cron-daily — per-platform HG-01 soft-fail pattern
- `dashboard-web/src/inngest/functions/cronDaily.ts:278` (Meta)
- `dashboard-web/src/inngest/functions/cronDaily.ts:313` (Google)
- `dashboard-web/src/inngest/functions/cronDaily.ts:357` (TikTok)

### Inngest cron-daily — FX-failure null sentinel (CRIT-5 / a/WARN-3)
- `dashboard-web/src/inngest/functions/cronDaily.ts:419` (TikTok FX)
- `dashboard-web/src/inngest/functions/cronDaily.ts:496` (per-row Meta FX)

### Inngest cron-live — Phase 10 HIGH-12/HIGH-NEW-4 sequential for-of + try/catch + result.error
- `dashboard-web/src/inngest/functions/cronLive.ts:1120` (campaigns_daily status UPDATE per ad-set)

### Inngest cron-live — per-fetcher `.catch(() => null)` + per-platform preserve (CR-02, a/WARN-3)
- `dashboard-web/src/inngest/functions/cronLive.ts:567` (Shopify 3-day → __shopifyFailed sentinel)
- `dashboard-web/src/inngest/functions/cronLive.ts:644` (FX → null)
- `dashboard-web/src/inngest/functions/cronLive.ts:661` (Meta light spend)
- `dashboard-web/src/inngest/functions/cronLive.ts:671` (Google spend)
- `dashboard-web/src/inngest/functions/cronLive.ts:682` (TikTok spend)
- `dashboard-web/src/inngest/functions/cronLive.ts:725` (orders-attribution today)
- `dashboard-web/src/inngest/functions/cronLive.ts:909/919/930` (per-platform status refresh)

### Per-table destructive operator reset (file-level comment justifies)
- `dashboard-web/src/app/api/operator/reset/route.ts:143`

### Legacy Sheets-only paths — typed empty-array sentinel on missing-tab + re-throw on anything else
- `dashboard-web/src/lib/ordersAttribution.ts:223`
- `dashboard-web/src/lib/campaigns.ts:109`
- `dashboard-web/src/lib/products.ts:82`
- `dashboard-web/src/lib/productCatalog.ts:73`
- `dashboard-web/src/lib/ads.ts:86`

### postgresReaders — re-throw with module-prefix
- `dashboard-web/src/lib/postgresReaders.ts:284/512/599/721/797/855`

### postgresReaders — freshness-lookup typed null
- `dashboard-web/src/lib/postgresReaders.ts:234`

### cloudSync — documented quota / private-mode / dispatch-loop fallbacks
- `dashboard-web/src/lib/cloudSync.ts:91/100/420/437/451/492/497/521/533`
- `dashboard-web/src/lib/cloudSync.ts:264` (defensive arrow `.catch` on res.json())
- `dashboard-web/src/lib/cloudSync.ts:294/338` (retry + sync-state error surface)

### notifications/tokenFailures — log+continue with typed result fields
- `dashboard-web/src/lib/notifications/tokenFailures.ts:188` (select-failed → continue)
- `dashboard-web/src/lib/notifications/tokenFailures.ts:234` (WhatsApp-send-failed → records sendError)
- `dashboard-web/src/lib/notifications/tokenFailures.ts:303` (upsert-failed → result.dbWritten=false sentinel)

### notifications/sendDailySummary — per-recipient try/catch (HR-04 / T3.5)
- `dashboard-web/src/lib/notifications/sendDailySummary.ts:83`

### fetchers — soft-fail on non-critical sub-fetches
- `dashboard-web/src/lib/fetchers/meta.ts:693` (currency fetch — parity with MetaAds.gs:197-203)
- `dashboard-web/src/lib/fetchers/tiktok.ts:361` (no creds → empty map)
- `dashboard-web/src/lib/fetchers/tiktok.ts:396` (partial map > throw — same as Meta budgets)

### Defensive `res.json().catch(() => ({}))` / `res.text().catch(() => '')` for error-body parsing
- `dashboard-web/src/components/Dashboard.tsx:53/70`
- `dashboard-web/src/components/HeroOverview.tsx:42`
- `dashboard-web/src/components/ProductsTable.tsx:33`
- `dashboard-web/src/components/CampaignsTable.tsx:102`
- `dashboard-web/src/components/TodayLive.tsx:16/25/40`
- `dashboard-web/src/components/MonthlyTables.tsx:78`
- `dashboard-web/src/components/operator/SyncNowButtons.tsx:102`
- `dashboard-web/src/components/operator/ResetData.tsx:173`
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx:156/183`
- `dashboard-web/src/components/operator/WhatsappTestButtons.tsx:43`
- `dashboard-web/src/components/operator/BackfillPicker.tsx:112`
- `dashboard-web/src/components/operator/TokenFailuresTable.tsx:96`
- `dashboard-web/src/lib/fetchers/meta.ts:452`
- `dashboard-web/src/lib/fetchers/shopify.ts:480/712/1041`
- `dashboard-web/src/lib/fetchers/shopifyAuth.ts:89`
- `dashboard-web/src/lib/fetchers/tiktok.ts:158`
- `dashboard-web/src/lib/notifications/whatsapp.ts:161/170`
- `dashboard-web/src/app/api/operator/reset/route.ts:110`
- `dashboard-web/src/app/api/operator/jobs/route.ts:161`
- `dashboard-web/src/app/api/operator/notifications/send/route.ts:28`

### Component UI-state surface (operator-visible setError)
- `dashboard-web/src/components/operator/SyncNowButtons.tsx:114`
- `dashboard-web/src/components/operator/ResetData.tsx:191`
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx:166/188`
- `dashboard-web/src/components/operator/WhatsappTestButtons.tsx:51`
- `dashboard-web/src/components/operator/BackfillPicker.tsx:124`

### localStorage UI-pref read/write quota fallbacks (all typed sentinels)
- `dashboard-web/src/components/CollapsibleSection.tsx:41/53`
- `dashboard-web/src/components/InsightsBoard.tsx:122/136`
- `dashboard-web/src/components/AiReportButton.tsx:125`
- `dashboard-web/src/lib/campaignsColumnPrefs.ts:139/217`
- `dashboard-web/src/lib/insights.ts:606/630/707/718`
- `dashboard-web/src/lib/annotations.ts:79/90`
- `dashboard-web/src/lib/campaignProductMap.ts:47/67`
- `dashboard-web/src/lib/billing.ts:68/82`
- `dashboard-web/src/lib/campaignOptimized.ts:28/41`
- `dashboard-web/src/lib/postgresReaders.ts:160` (inline JSON.parse for line_items column)
- `dashboard-web/src/lib/ordersAttribution.ts:166` (inline JSON.parse)
- `dashboard-web/src/app/api/data/route.ts:27` (fetchTodayFx → null)

### decodeURIComponent fallback (return raw input)
- `dashboard-web/src/lib/utils.ts:78`
- `dashboard-web/src/lib/fetchers/shopify.ts:811`

### Polling loop tolerant catches (documented in code)
- `dashboard-web/src/lib/useDashboardRefresh.ts:104/123`

### Debug-only route
- `dashboard-web/src/app/api/debug/shopify-fetch/route.ts:96`

---

## Cross-validation against the audit corpus

1. **INN-16** (eventBackfill.ts:225) — sweep catches it independently of the `inngest_eventBackfill` reviewer's per-file report. Confirmed SUSPICIOUS.
2. **HIGH-12 + HIGH-NEW-4** (cronLive.ts:1120) — sweep confirms INTENTIONAL (the sequential for-of + try/catch + `result.error` check is exactly the AGENT-A-REPORT-confirmed correct pattern). Logged + continues; no throw escapes.
3. **a/WARN-3** (FX-failure pattern) — sweep confirms INTENTIONAL at every site that follows the pattern (cronDaily.ts:419/496, cronLive.ts:644, /api/data/route.ts:27). Each returns `null` (typed sentinel) and propagates to the persister which OMITS the CAD-denominated columns so ON CONFLICT preserves prior values.

*Generated 2026-05-24 by Plan-agent task 12.H1 per CONTEXT.md decision D-12.*
