---
status: partial
phase: 05-scalability
source: [05-VERIFICATION.md]
started: 2026-05-19T11:13:00Z
updated: 2026-05-19T11:13:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apps Script trigger split — manual deploy + run + install (05-01 checkpoint)
expected: Each wrapper (`runDailyUpdateUzoshop` / `runDailyUpdateZolplus` / `runDailyUpdateUsmile`) completes in <3 min, writes a row for yesterday to its store's tabs (data-daily / {store}-campaigns / {store}-ads / {store}-orders-attribution), no error email. `installDailyTrigger` log shows `4 daily triggers installed`. Project Triggers UI shows 4 new daily triggers + `runLiveUpdate` = 5 total. Old `runDailyUpdate` trigger gone.
result: [pending]

### 2. Production payload size (SC-5)
expected: `curl https://script-roas.vercel.app/api/data?from=2026-02-19&to=2026-05-19` returns HTTP 200 with payload < 500KB. Architectural intent: server-side pagination reduces response size vs. full history. Run AFTER Vercel auto-deploys on push to main.
result: [pending]

### 3. Archive spreadsheet setup + dry-run + production (05-04 checkpoint)
expected: Archive Google Sheet created, shared with `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com` as Editor. Script Property `archive.spreadsheet.id` set. From spreadsheet menu: `archive18MonthsDryRun` shows `[DRY-RUN]` prefix + 11-tab summary with oldest/newest dates, no writes. Then `archive18MonthsProduction` (after typing `ARCHIVE` to confirm) shows `appended N rows to archive` + `warm now has M rows (was M+N)` for each tab. Warm data-daily first row is ~18 months ago.
result: [pending]

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
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
