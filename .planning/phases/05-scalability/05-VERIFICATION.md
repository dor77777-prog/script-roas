---
phase: 05-scalability
verified: 2026-05-19T10:00:00Z
status: human_needed
score: 12/12
overrides_applied: 0
human_verification:
  - test: "Upload DailyUpdate.gs + Main.gs to Apps Script editor. Run runDailyUpdateUzoshop, runDailyUpdateZolplus, runDailyUpdateUsmile each manually. Then run installDailyTrigger. Verify 4 triggers visible in Project Triggers UI."
    expected: "Each wrapper completes in <3 min, writes a row for yesterday to its store's tabs, no error email. installDailyTrigger log shows '4 daily triggers installed'. Project Triggers shows 4 new triggers + runLiveUpdate = 5 total. Old runDailyUpdate trigger absent."
    why_human: "Apps Script execution environment — cannot run .gs code in CI. User explicitly deferred this (checkpoint:human-verify in 05-01 Task 3)."
  - test: "After Vercel auto-deploys on push to main: curl https://script-roas.vercel.app/api/data?from=2026-02-19&to=2026-05-19 and check response size."
    expected: "HTTP 200, payload < 500KB (SC-5: server-side pagination reduces response vs full history)."
    why_human: "Production-only check — no localhost. Requires live Vercel deployment with env vars. Memory rule: no localhost in verify checks."
  - test: "Create archive Google Sheets, share with roas-dashboard-reader service account, set archive.spreadsheet.id Script Property. Upload updated DailyUpdate.gs + Main.gs. Run archive18MonthsDryRun from the menu. Verify dry-run log shows [DRY-RUN] prefix + 11-tab summary. Then run archive18MonthsProduction (type ARCHIVE to confirm). Verify warm tabs shrink, archive tabs grow."
    expected: "Dry-run: no writes, summary shows oldest/newest dates per tab. Production: log shows 'appended N rows to archive' + 'warm now has M rows (was M+N)' for each tab. warm data-daily starts from ~18 months ago."
    why_human: "Requires Google Drive + Apps Script + spreadsheet production setup. User explicitly deferred (checkpoint:human-verify in 05-04 Task 2)."
  - test: "Set ARCHIVE_SPREADSHEET_ID env var in Vercel. In dashboard, select a date range spanning >18 months. Observe Network tab: /api/data should reflect data from both warm and archive."
    expected: "Dashboard loads old data (>18 months) when range extends back that far. Without env var set, dashboard works normally (warm only, no breakage)."
    why_human: "Requires production Vercel env var + archive spreadsheet with historical data. Optional fallback env var."
  - test: "In production dashboard, open DevTools Network tab. Change range in Filters panel. Verify each range change triggers 4 new network requests with ?from=...&to=... in the URL."
    expected: "Fetch URLs include date range params; different ranges produce distinct requests (no cache hits from prior range)."
    why_human: "Visual browser interaction — cannot verify SWR key behavior programmatically without a running browser session."
  - test: "In production dashboard, open CampaignDrawer for any campaign. Observe Network tab for the /api/orders-attribution request."
    expected: "Request URL contains &lineItems=true. Channel breakdown panel (ProductChannelBreakdown) shows product attribution data."
    why_human: "Requires browser + live data. Ensures CampaignDrawer opts into lineItems and breakdown renders correctly."
---

# Phase 5: Scalability Verification Report

**Phase Goal:** Prepare the system for 5x growth (more stores, more orders, multi-year history) without hitting Apps Script timeouts or Sheets cell caps.
**Verified:** 2026-05-19T10:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 3 separate daily triggers: runDailyUpdateUzoshop (00:05), runDailyUpdateZolplus (00:08), runDailyUpdateUsmile (00:11) | VERIFIED | `Main.gs:57-62` — ScriptApp.newTrigger for each at correct nearMinute. DailyUpdate.gs:35-60 has all 3 wrapper functions. |
| 2 | 4th trigger refreshAllStoreMeta @ 00:14 | VERIFIED | `Main.gs:63-64` — ScriptApp.newTrigger('refreshAllStoreMeta').nearMinute(14). |
| 3 | Each per-store wrapper calls updateStoreForDate_ for one store only via runUpdateForSingleStore_ | VERIFIED | `DailyUpdate.gs:35-60` — each wrapper calls runUpdateForSingleStore_ with a single storeId. Helper at line 89 validates storeId, calls ensureSpreadsheet + getFxRate + updateStoreForDate_ for that store only. |
| 4 | Original runDailyUpdate retained as manual entry point | VERIFIED | `DailyUpdate.gs:10-12` — function still present, unchanged. `Main.gs:133` — menu item "הרץ עדכון ליום אתמול" still wired to it. |
| 5 | Summary-tab month-block created under per-store trigger split (CR-01 fix) | VERIFIED | `DailyUpdate.gs:41-60` — runDailyUpdateUsmile (last per-store wrapper) calls ensureSummaryMonthBlock_(dateStr) after runUpdateForSingleStore_. Helper at line 69-78 calls writeDayRow with zero values to force getOrCreateMonthBlock_. |
| 6 | installDailyTrigger installs exactly 4 triggers | VERIFIED | `Main.gs:54-68` — installs runDailyUpdateUzoshop, runDailyUpdateZolplus, runDailyUpdateUsmile, refreshAllStoreMeta. removeDailyTrigger also cleans legacy 'runDailyUpdate' handler. |
| 7 | GET /api/data?from=&to= returns server-filtered rows; defaults to last 90 days | VERIFIED | `dashboard-web/src/app/api/data/route.ts:29-41` — parseRangeParams called on req.url searchParams. `dateRange.ts:48-67` — defaults to 90-day range via defaultRange(). `sheets.ts:177` — isInRange filter applied per row. |
| 8 | All 4 API routes return 400 for malformed ?from/?to params | VERIFIED | `route.ts` files for data, campaigns, products, orders-attribution all import RangeParamError and return status 400 + Cache-Control: no-store. `dateRange.ts:34-38` — isRealDate round-trip check (WR-01 fix) rejects 2026-99-99-style inputs. |
| 9 | SWR keys include from+to; changing range triggers fresh fetch | VERIFIED | `Dashboard.tsx:94-95` — buildDateRangeKey('/api/data', filters.range). `CampaignsTable.tsx:279-321` — all 3 SWR keys use buildDateRangeKey with localRange (CR-02 fix). `CampaignDrawer.tsx:125-140` — both SWR keys use drawerRange. `ProductsTable.tsx:278-279` — keyed on localRange. |
| 10 | CampaignDrawer requests ?lineItems=true; CampaignsTable uses light default | VERIFIED | `CampaignDrawer.tsx:138-140` — ordersAttrBaseKey appended with &lineItems=true. `CampaignsTable.tsx:320-321` — SWR key uses buildDateRangeKey only (no lineItems suffix). `ordersAttribution.ts:228-230` — includeLI drives lastCol 'N' vs 'M'. |
| 11 | archiveOlderThan(months, {dryRun}) exists in DailyUpdate.gs, defaults to dryRun | VERIFIED | `DailyUpdate.gs:654-691` — function present with `const dryRun = !opts \|\| opts.dryRun !== false`. Throws on missing archive.spreadsheet.id. archive18MonthsProduction wraps with confirmation prompt (WR-03 fix). |
| 12 | Dashboard /api/data checks both warm + archive when from < 18 months; fail-safe without ARCHIVE_SPREADSHEET_ID | VERIFIED | `sheets.ts:23` — ARCHIVE_FALLBACK_MONTHS=18 exported. Lines 125-127 — needsArchive = archiveId && range.from < archiveCutoff. Conditional push to reads[] only when needsArchive. Without ARCHIVE_SPREADSHEET_ID env var, archiveId is null and needsArchive=false (warm-only read). |

**Score:** 12/12 truths verified (all automated checks passed)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `DailyUpdate.gs` | runDailyUpdateUzoshop/Zolplus/Usmile + runUpdateForSingleStore_ helper + archive functions | VERIFIED | All 4 per-store wrappers present. ensureSummaryMonthBlock_ present (CR-01). archiveOlderThan, archiveTabRows_, ARCHIVE_TAB_SPECS_, monthsAgoStr_, archive18MonthsDryRun, archive18MonthsProduction all present. |
| `Main.gs` | installDailyTrigger installs 4 triggers + archive menu items | VERIFIED | 4 newTrigger calls for per-store + meta at correct nearMinute values. 2 archive menu items in onOpen. removeDailyTrigger covers legacy + 4 new handlers. |
| `dashboard-web/src/lib/dateRange.ts` | parseRangeParams + DEFAULT_RANGE_DAYS=90 + buildDateRangeKey + defaultRange TZ-anchored (WR-09) | VERIFIED | All exports present. isRealDate helper (WR-01) present. defaultRange uses Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Jerusalem'}) — IL-anchored. |
| `dashboard-web/src/lib/sheets.ts` | fetchDailyData accepts range + ARCHIVE_FALLBACK_MONTHS=18 + conditional archive read | VERIFIED | ARCHIVE_FALLBACK_MONTHS=18 exported at line 23. getArchiveSpreadsheetId() reads env var at line 25-28. monthsAgoUtcStr helper present. needsArchive logic at lines 125-127. Dual parallel reads with truncation warning (WR-06). |
| `dashboard-web/src/lib/ordersAttribution.ts` | fetchOrdersAttribution with includeLineItems opt-in + parseLineItems type-guard (WR-08) | VERIFIED | includeLineItems param in opts. includeLI drives lastCol 'N'/'M'. parseLineItems pre-filter requires typeof it.p === 'string' (WR-08). lineItems always [] when includeLI=false. |
| `dashboard-web/src/app/api/data/route.ts` | parseRangeParams + 400 on RangeParamError + Cache-Control: no-store on degraded path (WR-02) | VERIFIED | parseRangeParams called on searchParams. 400 + no-store on RangeParamError. Degraded catch path returns status 200 + no-store header (WR-02 fix). |
| `dashboard-web/src/app/api/orders-attribution/route.ts` | parseLineItemsParam + RangeParamError path + degraded 200 preserved | VERIFIED | searchParams.get('lineItems') === 'true' strict check. parseRangeParams for range. Degraded catch returns 200 + no-store. |
| `dashboard-web/src/components/CampaignsTable.tsx` | 3 SWR keys use localRange (CR-02 fix) | VERIFIED | Lines 279-321: all 3 useSWR calls use buildDateRangeKey with localRange. localRange declared before useSWR calls (line 274). |
| `dashboard-web/src/components/CampaignDrawer.tsx` | lineItems=true appended to /api/orders-attribution SWR key | VERIFIED | Lines 138-140: ordersAttrBaseKey suffixed with &lineItems=true. drawerRange constructed from rangeFrom/rangeTo props. |
| `dashboard-web/src/components/Dashboard.tsx` | buildDateRangeKey on filters.range | VERIFIED | Line 94-95: useSWR key = buildDateRangeKey('/api/data', filters.range). filters declared before useSWR (line 72 note). |
| `dashboard-web/src/components/ProductsTable.tsx` | buildDateRangeKey on localRange | VERIFIED | Lines 278-279: useSWR key = buildDateRangeKey('/api/products', localRange). localRange declared before useSWR (line 270 note). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| runDailyUpdateUzoshop | updateStoreForDate_ | runUpdateForSingleStore_('uzoshop', ...) | VERIFIED | DailyUpdate.gs:36 calls runUpdateForSingleStore_('uzoshop', ...). Helper at line 103 calls updateStoreForDate_. |
| installDailyTrigger | all 4 trigger functions | ScriptApp.newTrigger(name).nearMinute(N) | VERIFIED | Main.gs:57-64 — all 4 newTrigger calls present with correct handler names and nearMinute values (5, 8, 11, 14). |
| Dashboard.tsx useSWR key | /api/data?from=&to= | buildDateRangeKey(filters.range) | VERIFIED | Dashboard.tsx:94-95 — key = buildDateRangeKey('/api/data', filters.range). |
| CampaignsTable.tsx useSWR keys | /api/campaigns?from=&to= + /api/products?from=&to= + /api/orders-attribution?from=&to= | buildDateRangeKey(localRange) | VERIFIED | CampaignsTable.tsx:279-321 — all 3 SWR keys use buildDateRangeKey with localRange (CR-02 fix confirmed). |
| CampaignDrawer.tsx /api/orders-attribution key | ?lineItems=true | ordersAttrBaseKey + &lineItems=true | VERIFIED | CampaignDrawer.tsx:138-140 — ordersAttrBaseKey appended with &lineItems=true only when open. |
| archiveOlderThan | archive spreadsheet 11 tabs | archiveTabRows_ iterating ARCHIVE_TAB_SPECS_ | VERIFIED | DailyUpdate.gs:676-690 — iterates ARCHIVE_TAB_SPECS_(), calls archiveTabRows_ per spec. ARCHIVE_TAB_SPECS_ returns 2+9=11 specs. |
| fetchDailyData | archive spreadsheet (conditional) | ARCHIVE_SPREADSHEET_ID env + range.from < archiveCutoff | VERIFIED | sheets.ts:125-154 — conditional second read pushed into reads[] only when needsArchive=true. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Dashboard.tsx | data (DashboardData) | useSWR → /api/data → fetchDailyData → Google Sheets | sheets.ts reads data-daily tab; isInRange filters per row | FLOWING |
| CampaignsTable.tsx | data (CampaignsResponse) | useSWR → /api/campaigns → fetchCampaignsData → Google Sheets | keyed on localRange; real batchGet call | FLOWING |
| CampaignDrawer.tsx | ordersAttrData | useSWR → /api/orders-attribution?lineItems=true → fetchOrdersAttribution → Google Sheets | includeLI=true reads col A:N; parseLineItems on row[13] | FLOWING |
| ProductsTable.tsx | data (ProductsResponse) | useSWR → /api/products → fetchProductsData → Google Sheets | keyed on localRange | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry points without a live Vercel deployment and service-account credentials. Production-only per user memory rule (no localhost).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| P5-TRIGGER-SPLIT | 05-01 | Per-store trigger split: 3 stores + meta at staggered minutes | SATISFIED | Main.gs:57-64; DailyUpdate.gs:35-78. 4 wrapper functions + installDailyTrigger wiring confirmed. |
| P5-API-PAGINATION | 05-02 | /api/* routes accept ?from=&to=, default 90 days, 400 on error | SATISFIED | All 4 routes verified; dateRange.ts parseRangeParams with isRealDate check. |
| P5-SWR-KEYS | 05-02 | SWR keys include date range; range change triggers fresh fetch | SATISFIED | All 4 components confirmed using buildDateRangeKey with their respective range state. |
| P5-LAZY-LINEITEMS | 05-03 | /api/orders-attribution?lineItems=true/false; CampaignDrawer opts in | SATISFIED | ordersAttribution.ts includeLineItems param; CampaignDrawer appends &lineItems=true; CampaignsTable uses light default. |
| P5-ARCHIVE-SCRIPT | 05-04 | archiveOlderThan(months, {dryRun}) in DailyUpdate.gs with menu items | SATISFIED (code) / NEEDS HUMAN (execution) | DailyUpdate.gs:654-801 — all 6 functions present. Main.gs:145-146 — 2 menu items present. Actual execution requires human action (see human_verification items 3-4). |
| P5-ARCHIVE-FALLBACK | 05-04 | fetchDailyData reads archive when from < 18 months; fail-safe without env var | SATISFIED | sheets.ts:23-154 — ARCHIVE_FALLBACK_MONTHS=18, conditional dual-read logic, fail-safe when archiveId=null. |

---

### ROADMAP Success Criteria Coverage

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | 3 separate daily triggers installed; logs show each runs in <3 min independently | NEEDS HUMAN | Code is wired (Main.gs). Trigger installation and runtime verification require user to run installDailyTrigger and check Executions tab after 24h. |
| SC-2 | All 4 API routes accept and honor ?from=&to= params | VERIFIED | All 4 routes parse searchParams and pass range to lib functions. isRealDate validation in parseRangeParams. |
| SC-3 | SWR keys include date range; switching range triggers fetch (not cache hit) | VERIFIED (code) / NEEDS HUMAN (browser) | buildDateRangeKey confirmed in all 4 components. Browser network-tab check deferred to human. |
| SC-4 | Archive function tested on a stub year (2023 data moved successfully) | NEEDS HUMAN | archiveOlderThan code verified. Actual run requires archive spreadsheet setup and execution by user (checkpoint:human-verify deferred). |
| SC-5 | Dashboard loads in <2 sec for default 90-day range even on slow connection | NEEDS HUMAN | Server-side filtering is in place. Wall-clock check requires production deployment + network measurement. |
| SC-6 | CampaignDrawer still gets full line-items data when opened | VERIFIED (code) / NEEDS HUMAN (visual) | CampaignDrawer.tsx:138-140 appends &lineItems=true. Visual channel-breakdown check deferred to human. |

---

### Anti-Patterns Found

No blockers found. All 11 code review findings from 05-REVIEW.md were fixed per 05-REVIEW-FIX.md:

| Finding | File(s) | Severity | Status |
|---------|---------|----------|--------|
| CR-01: Summary tab month-block never created | DailyUpdate.gs | Blocker | FIXED — ensureSummaryMonthBlock_ in runDailyUpdateUsmile (commit 33ecbc9) |
| CR-02: CampaignsTable SWR keyed on global range not localRange | CampaignsTable.tsx | Blocker | FIXED — all 3 SWR keys use localRange (commit 0965d40) |
| WR-01: parseRangeParams accepts invalid dates like 2026-99-99 | dateRange.ts | Warning | FIXED — isRealDate round-trip check (commit 5cb7d8c) |
| WR-02: Degraded-error 200 responses ISR-cacheable | 4 route files | Warning | FIXED — Cache-Control: no-store on all degraded paths (commit 5158f61) |
| WR-03: archive18MonthsProduction no confirmation | DailyUpdate.gs | Warning | FIXED — SpreadsheetApp.getUi().prompt requiring 'ARCHIVE' (commit 1ef3957) |
| WR-04: Switch no default arm | CampaignsTable.tsx, CampaignDrawer.tsx | Warning | FIXED — exhaustiveness checks added (commit 07becd7) |
| WR-05: mapped tie-break ignores sort direction | CampaignsTable.tsx | Warning | FIXED — design-intent comment added (commit d92ec2a) |
| WR-06: archive read silently caps at 100k | sheets.ts | Warning | FIXED — ARCHIVE_MAX_ROWS constant + truncation console.warn (commit 15b0415) |
| WR-07: archiveTabRows_ reformats entire col A on each run | DailyUpdate.gs | Warning | FIXED — firstNewArchRow scopes format to new rows only (commit 6f6d508) |
| WR-08: parseLineItems accepts non-string productId | ordersAttribution.ts | Warning | FIXED — typeof it.p === 'string' pre-filter (commit 548bb00) |
| WR-09: defaultRange UTC causes stale "today" in IL | dateRange.ts | Warning | FIXED — Intl.DateTimeFormat Asia/Jerusalem anchor (commit 97e90bb) |

---

### Human Verification Required

#### 1. Apps Script deployment and trigger installation

**Test:** Upload `DailyUpdate.gs` and `Main.gs` to the Apps Script editor. Run `runDailyUpdateUzoshop`, `runDailyUpdateZolplus`, `runDailyUpdateUsmile` one at a time from the editor. After all 3 succeed, run `installDailyTrigger`.

**Expected:** Each wrapper completes within ~2 minutes. Rows written to each store's tabs for yesterday. No error notification email. `installDailyTrigger` log: "4 daily triggers installed: uzoshop@00:05, zolplus@00:08, usmile@00:11, store-meta@00:14 (Asia/Jerusalem)". Project Triggers UI shows 4 new triggers + existing `runLiveUpdate` (5 total). Old `runDailyUpdate` trigger absent.

**Why human:** Apps Script execution environment. Cannot run `.gs` code in CI. User explicitly deferred this (05-01 Task 3 checkpoint:human-verify).

#### 2. Production payload size sanity (SC-5 architectural intent)

**Test (production only — no localhost):**
```bash
PROD_URL="https://script-roas.vercel.app"
curl -fsS -o /tmp/p5-data.json -w 'HTTP %{http_code} size=%{size_download}\n' \
  "$PROD_URL/api/data?from=2026-02-19&to=2026-05-19"
SIZE=$(wc -c </tmp/p5-data.json | tr -d ' ')
echo "payload bytes=$SIZE"
[ "$SIZE" -lt 512000 ] && echo "OK: 90-day payload < 500KB" || echo "FAIL: >= 500KB"
```

**Expected:** HTTP 200, payload < 500KB (SC-5: server-side range filter is effective).

**Why human:** Production-only per memory rule (no localhost/dev-server runtime checks). Requires live Vercel deployment with production environment variables.

#### 3. Archive script setup and execution

**Test:** (1) Create "ROAS Tracker — Archive" Google Sheet. (2) Share with `roas-dashboard-reader` service account as Editor. (3) Set Script Property `archive.spreadsheet.id`. (4) Upload `.gs` files. (5) Run `archive18MonthsDryRun` — verify [DRY-RUN] + 11-tab summary with no writes. (6) Run `archive18MonthsProduction` — type ARCHIVE to confirm — verify data moves.

**Expected:** Dry-run shows row counts + date ranges per tab, no changes to spreadsheets. Production: each tab log shows "appended N rows to archive" + "warm now has M data rows". warm data-daily starts from ~November 2024 (18 months before May 2026).

**Why human:** Requires real Google Drive + Apps Script + production spreadsheet operations. Cannot be automated. User explicitly deferred (05-04 Task 2 checkpoint:human-verify).

#### 4. Dashboard archive fallback (optional)

**Test:** Set `ARCHIVE_SPREADSHEET_ID` in Vercel environment variables (after archive spreadsheet is created and populated per item 3). In dashboard, select a date range extending >18 months back. Verify old data appears.

**Expected:** Dashboard shows historical data beyond 18 months when range is extended. Without env var, dashboard still works (warm-only, no breakage).

**Why human:** Requires Vercel env var configuration + populated archive spreadsheet. Optional fail-safe feature.

#### 5. SWR range-key browser verification

**Test:** On production dashboard `https://script-roas.vercel.app`, open DevTools Network tab. Change the date range in the Filters panel. Observe network requests.

**Expected:** Each range change triggers 4 new fetch requests with `?from=...&to=...` in the URL. Different ranges produce distinct request URLs (no stale cache serving).

**Why human:** Requires browser session with real SWR state. Cannot verify SWR key behavior without a live browser.

#### 6. CampaignDrawer line-items opt-in verification

**Test:** On production dashboard, open the CampaignDrawer for any campaign with orders. In DevTools Network, observe the `/api/orders-attribution` request URL. Check the ProductChannelBreakdown panel.

**Expected:** Request URL contains `&lineItems=true`. Channel breakdown panel shows product attribution (not empty). Confirms CampaignDrawer opts in and breakdown data flows through.

**Why human:** Requires browser + live data with orders. Visual check of rendered breakdown.

---

### Gaps Summary

No gaps. All 12 must-have truths are VERIFIED in the codebase. All 11 code review findings are fixed. All 6 requirement IDs (P5-TRIGGER-SPLIT, P5-API-PAGINATION, P5-SWR-KEYS, P5-LAZY-LINEITEMS, P5-ARCHIVE-SCRIPT, P5-ARCHIVE-FALLBACK) have implementation evidence.

The 6 human_needed items are intentionally deferred production operations and browser-based checks that the user explicitly chose to verify after automated phases completed. They are not code gaps — the code is present, substantive, and wired.

---

_Verified: 2026-05-19T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
