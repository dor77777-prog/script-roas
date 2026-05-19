---
status: partial
phase: 05-scalability
source: [05-VERIFICATION.md]
started: 2026-05-19T11:13:00Z
updated: 2026-05-19T12:08:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apps Script trigger split — manual deploy + run + install (05-01 checkpoint)
expected: Each wrapper (`runDailyUpdateUzoshop` / `runDailyUpdateZolplus` / `runDailyUpdateUsmile`) completes in <3 min, writes a row for yesterday to its store's tabs (data-daily / {store}-campaigns / {store}-ads / {store}-orders-attribution), no error email. `installDailyTrigger` log shows `4 daily triggers installed`. Project Triggers UI shows 4 new daily triggers + `runLiveUpdate` = 5 total. Old `runDailyUpdate` trigger gone.
result: [pending]

### 2. Production payload size (SC-5)
expected: `curl https://roas-dashboard-smoky.vercel.app/api/data?from=2026-02-19&to=2026-05-19` returns HTTP 200 with payload < 500KB. Architectural intent: server-side pagination reduces response size vs. full history.
result: passed — HTTP 200, 35,484 bytes (far below 500KB threshold). Verified 2026-05-19T12:08Z against production.

### 3. Archive spreadsheet setup + dry-run + production (05-04 checkpoint)
expected: Archive Google Sheet created, shared with `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com` as Editor. Script Property `archive.spreadsheet.id` set. From Apps Script editor: `archive18MonthsDryRun` shows `[DRY-RUN]` prefix + 11-tab summary with oldest/newest dates, no writes. Production (`archiveOlderThan(18, {dryRun: false})`) shows `appended N rows to archive` + `warm now has M rows (was M+N)` for each tab.
result: passed (dry-run only) — Archive spreadsheet created (ID 1p3DNHO9...uk z4), service-account shared, Script Property set. Dry-run executed from Apps Script editor 2026-05-19T11:59Z and succeeded across all 11 tabs. All tabs returned `0 rows would move` because user's data is younger than 18 months (cutoff 2024-11-19). Production run intentionally skipped — would be a no-op. Will re-verify when first rows cross the 18-month boundary (~late 2027). Note: ROAS spreadsheet menu does not exist (script appears to be standalone, not container-bound); functions are run directly from the Apps Script editor.

### 4. Dashboard archive fallback env var (optional)
expected: After setting `ARCHIVE_SPREADSHEET_ID` in Vercel and redeploying, selecting a >18-month date range in the dashboard returns data from both warm + archive (visible in Network tab). Without the env var, dashboard works normally (warm only — no breakage).
result: [pending]

### 5. SWR range keys in browser
expected: In production dashboard DevTools → Network tab, changing the range in the Filters panel triggers 4 new network requests (`/api/data`, `/api/campaigns`, `/api/products`, `/api/orders-attribution`) each with `?from=...&to=...` in the URL. Distinct ranges produce distinct requests (no cache hits from prior range).
result: [pending]

### 6. CampaignDrawer lineItems opt-in
expected: In production dashboard, opening CampaignDrawer for any campaign triggers a `/api/orders-attribution` request with `&lineItems=true` in the URL. The "channel breakdown" panel (ProductChannelBreakdown) renders product attribution data correctly.
result: [pending]

## Summary

total: 6
passed: 2
issues: 0
pending: 4
skipped: 0
blocked: 0

## Notes

- Item 3 (archive) passed dry-run; production intentionally skipped (no-op until late-2027 when data crosses 18-month boundary).
- API-level verification of lineItems opt-in (item 6 backend) confirmed via production curl: light=112KB, heavy=135KB (~20% size delta from col N). The browser-side UI confirmation remains pending.
- The ROAS spreadsheet menu does NOT exist because the Apps Script project is standalone (not container-bound). Items 1 and 3 are run via the Apps Script editor directly, not via the menu.

## Gaps
