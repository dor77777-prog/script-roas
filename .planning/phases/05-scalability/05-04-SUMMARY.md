---
phase: 05-scalability
plan: "04"
subsystem: archive-retention
tags: [archive, retention, apps-script, dashboard, fallback, sheets-api]
dependency_graph:
  requires: [05-01, 05-02]
  provides: [archive-retention-script, dashboard-archive-fallback]
  affects: [DailyUpdate.gs, Main.gs, dashboard-web/src/lib/sheets.ts]
tech_stack:
  added: []
  patterns: [append-then-delete-safety, dual-spreadsheet-parallel-read, fail-safe-env-var, dry-run-default]
key_files:
  created: []
  modified:
    - DailyUpdate.gs
    - Main.gs
    - dashboard-web/src/lib/sheets.ts
decisions:
  - "dryRun=true by default in archiveOlderThan — explicit opt-in required for destructive production run"
  - "Append-then-delete order: rows land in archive before removal from warm — crash leaves recoverable duplicates, not unrecoverable gaps"
  - "ARCHIVE_FALLBACK_MONTHS=18 in dashboard aligned with Apps Script cutoff — both sides enforce same boundary"
  - "ARCHIVE_SPREADSHEET_ID as optional env var — fail-safe: without it, dashboard reads warm only (no breakage)"
  - "Task 2 (human-verify checkpoint) deferred — requires manual creation of archive Google Sheets and Script Property configuration"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-19"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 3
  files_created: 0
---

# Phase 05 Plan 04: Archive Retention + Dashboard Fallback Summary

Apps Script archive engine with dry-run-by-default safety, plus conditional dual-spreadsheet read in `fetchDailyData` that activates only when range crosses 18-month boundary and `ARCHIVE_SPREADSHEET_ID` env var is set.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | archiveOlderThan + helpers in DailyUpdate.gs + 2 menu items | ba7b060 | DailyUpdate.gs, Main.gs |
| 2 | **PENDING** — archive spreadsheet creation + Script Property | — | User action required (see below) |
| 3 | Dashboard archive fallback in fetchDailyData | e1db3e1 | dashboard-web/src/lib/sheets.ts |

## What Was Built

### Task 1 — DailyUpdate.gs (Apps Script side)

6 new functions added after `notifyError_`:

**`monthsAgoStr_(months)`** — Returns `YYYY-MM-DD` that is `months` months before today in `TZ` (Asia/Jerusalem). Uses `Utilities.formatDate` for correct timezone handling.

**`ARCHIVE_TAB_SPECS_()`** — Returns an array of 11 tab specs (2 shared: `data-daily`, `products-daily` + 3 per store: `{store}-campaigns`, `{store}-ads`, `{store}-orders-attribution` × 3 stores = 9). Expands at runtime from `STORES`.

**`archiveOlderThan(months, opts?)`** — Public entry point. `dryRun=true` by default. Throws with a clear message if `archive.spreadsheet.id` Script Property is not set. Validates `months` is a positive finite number. Iterates all tab specs, calls `archiveTabRows_` for each, prints a summary log. Production mode uses append-then-delete ordering.

**`archiveTabRows_(warm, archive, spec, cutoff, dryRun)`** — Per-tab worker. Reads all data rows, splits into toMove (date < cutoff) and toKeep. Logs `(label, count, oldest, newest)` before any write. In production mode: (1) ensures archive tab exists with copied header, (2) appends moved rows + sets date format, (3) clears warm and rewrites kept rows. Rows with unparseable dates are preserved in warm (conservative).

**`archive18MonthsDryRun()`** — Menu helper: calls `archiveOlderThan(18, {dryRun: true})`.

**`archive18MonthsProduction()`** — Menu helper: calls `archiveOlderThan(18, {dryRun: false})`.

**Main.gs menu additions** — 2 new items added to `onOpen` after "הצג טאבים עזריים (debug)", in their own separator group:
- `ארכוב יבש: dry-run 18 חודש (Phase 5)` → `archive18MonthsDryRun`
- `ארכוב production 18 חודש (אחרי dry-run!)` → `archive18MonthsProduction`

### Task 2 — PENDING USER ACTION

Task 2 is a `checkpoint:human-verify` gate. The executor paused here. See "Checkpoint Details" below for the full procedure.

### Task 3 — dashboard-web/src/lib/sheets.ts

Three additions at the top of the file (after existing tab-name constants):

**`ARCHIVE_FALLBACK_MONTHS = 18`** — Exported constant aligned with Apps Script cutoff. Consumers can import it for display or configuration.

**`getArchiveSpreadsheetId()`** — Reads `process.env.ARCHIVE_SPREADSHEET_ID`. Returns `null` if not set (enables fail-safe behavior).

**`monthsAgoUtcStr(months)`** — Returns `YYYY-MM-DD` that is `months` months before today (UTC). Used for the archive boundary comparison — UTC avoids TZ-dependent boundary drift between client and server.

**`fetchDailyData` updated** — Now computes `archiveCutoff = monthsAgoUtcStr(18)` and `needsArchive = archiveId && range.from < archiveCutoff`. When `needsArchive` is true: fires two parallel `sheets.spreadsheets.values.get` calls (warm `A2:K10000` + archive `A2:K100000`), merges all values into a single `allValues` array, then runs the same row-parsing + `isInRange` filter loop as before. When `needsArchive` is false: single warm read (unchanged from Phase 5 Plan 02 behavior).

## Verification Results

| Check | Result |
|-------|--------|
| `node -e` DailyUpdate.gs function checks | PASS — all 6 functions present |
| `node -e` Main.gs menu item check | PASS — both items present |
| `archive.spreadsheet.id` Script Property reference | PASS |
| `dryRun` guard present | PASS |
| `npx tsc --noEmit` | PASS — 0 errors |
| `grep -c ARCHIVE_SPREADSHEET_ID\|ARCHIVE_FALLBACK_MONTHS` | 6 matches |
| `npm run build` | PASS |

## Task 2 — Pending User Action (Checkpoint)

**What still needs to happen before the archive is operational:**

1. **Create archive spreadsheet in Google Drive**: New > Google Sheets > name it "ROAS Tracker — Archive". Copy the Spreadsheet ID from the URL (`/d/<ID>/edit`).

2. **Share with service-account**: Share the new spreadsheet with `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com` as **Editor** (write access needed for both Apps Script writes and Vercel reads).

3. **Set Script Property**: Apps Script editor > Project Settings > Script Properties > Add:
   - Property: `archive.spreadsheet.id`
   - Value: the Spreadsheet ID from step 1

4. **Upload .gs files**: Upload the updated `DailyUpdate.gs` and `Main.gs` to the Apps Script project.

5. **Run dry-run first**: From the Apps Script editor (or the Google Sheets menu), run `archive18MonthsDryRun`. Verify in Logs:
   - "[DRY-RUN]" prefix appears
   - Summary of 11 tabs with row counts and oldest/newest dates
   - No actual changes to any spreadsheet

6. **Validate dry-run output**: Check that row counts and date ranges are sensible. `data-daily` should show rows from before 18 months ago (before ~November 2024). Tabs not yet in warm will log "warm tab missing — skipping" — that is expected.

7. **Run production (only after dry-run looks correct)**: Run `archive18MonthsProduction`. Verify in Logs:
   - "[PRODUCTION]" prefix
   - Per tab: "appended N rows to archive" and "warm now has M data rows (was M+N)"

8. **Verify warm**: `data-daily` tab in warm spreadsheet should now start from ~18 months ago.

9. **Verify archive**: Archive spreadsheet should contain `data-daily`, `products-daily`, and 9 store-specific tabs with header rows and historical data.

**Optional follow-up**: Set `ARCHIVE_SPREADSHEET_ID` in Vercel Environment Variables to activate the dashboard fallback (shows data older than 18 months when user selects a 2-year range). Without this env var, the dashboard remains fully operational — it just won't surface very old archived rows.

**Recovery note**: If the production run fails mid-way, the moved rows are still in the archive (written before deletion). Recovery path: copy/paste from archive back to warm via Google Sheets UI. The operation is idempotent — re-running will skip rows already absent from warm.

## Deviations from Plan

None — plan executed as written. Task 2 is a checkpoint that was documented rather than executed (it requires user action in Google Sheets/Apps Script, which an automated executor cannot perform).

## Known Stubs

None — all code paths are wired. The archive fallback activates conditionally via env var (not a stub — this is intentional fail-safe behavior).

## Threat Surface Scan

No new network endpoints introduced. `ARCHIVE_SPREADSHEET_ID` is server-only (never exposed to browser). The `getArchiveSpreadsheetId()` function uses `process.env` directly — server-side only in Next.js. No new trust boundaries beyond what the plan's threat model already covers (T-05-04-04).

## Self-Check: PASSED
