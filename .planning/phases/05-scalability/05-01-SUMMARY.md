---
phase: 05-scalability
plan: "01"
subsystem: apps-script-triggers
tags: [trigger-split, daily-update, quota, scalability]
dependency_graph:
  requires: []
  provides: [runDailyUpdateUzoshop, runDailyUpdateZolplus, runDailyUpdateUsmile, runUpdateForSingleStore_, 4-trigger-installer]
  affects: [DailyUpdate.gs, Main.gs]
tech_stack:
  added: []
  patterns: [per-execution-quota-isolation, wrapper-entry-points]
key_files:
  created: []
  modified:
    - DailyUpdate.gs
    - Main.gs
decisions:
  - "Do not use runUpdateForDateForStores_ — it contains an inter-store sleep loop that contradicts the goal of single-store executions; a dedicated helper makes the contract explicit"
  - "installDailyTrigger no longer runs functions immediately — immediate sequential calls from inside the installer would defeat quota isolation"
  - "removeDailyTrigger cleans legacy runDailyUpdate handler to allow clean upgrade from pre-Phase-5 deployment"
metrics:
  duration_minutes: 2
  completed_date: "2026-05-19"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 2
---

# Phase 5 Plan 01: Per-store Apps Script trigger split — Summary

**One-liner:** Split single runDailyUpdate trigger into 4 independent per-store triggers (uzoshop/zolplus/usmile@00:05/08/11, store-meta@00:14) each with its own 6-min Apps Script budget.

## Objective

Eliminate the Apps Script 6-minute execution quota cascade where store 1's Sheets API writes saturated the short-window quota and caused stores 2 and 3 to time out. Each store now runs in its own independent execution with its own 6-min cap.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add 3 wrappers + runUpdateForSingleStore_ helper | 5b65657 | DailyUpdate.gs |
| 2 | Replace installDailyTrigger / removeDailyTrigger | 6cdef16 | Main.gs |

## What Was Built

### DailyUpdate.gs (Task 1)

Added after `runLiveUpdate`:

- `runDailyUpdateUzoshop()` — calls `runUpdateForSingleStore_('uzoshop', yesterdayStr_())`
- `runDailyUpdateZolplus()` — calls `runUpdateForSingleStore_('zolplus', yesterdayStr_())`
- `runDailyUpdateUsmile()` — calls `runUpdateForSingleStore_('usmile360', yesterdayStr_())`
- `runUpdateForSingleStore_(storeId, dateStr)` — shared helper that:
  - Validates date format, looks up store via `getStoreById`
  - Calls `ensureSpreadsheet` + `getFxRate` + `updateStoreForDate_`
  - Per-store try/catch with `notifyError_` on failure (mirrors `runUpdateForDate` error shape)
  - Does NOT touch summary tab (formula-driven, consistent across runs)

`runDailyUpdate()` (original), `runLiveUpdate`, `runUpdateForDate`, `updateStoreForDate_`, `runUpdateForDateForStores_`, `backfillRange`, `backfillRangeForStores`, `notifyError_` — all unchanged.

### Main.gs (Task 2)

Replaced `installDailyTrigger` and `removeDailyTrigger`:

- `installDailyTrigger()` — installs 4 time-based triggers:
  - `runDailyUpdateUzoshop` @ 00:05 Asia/Jerusalem
  - `runDailyUpdateZolplus` @ 00:08 Asia/Jerusalem
  - `runDailyUpdateUsmile` @ 00:11 Asia/Jerusalem
  - `refreshAllStoreMeta` @ 00:14 Asia/Jerusalem
- `removeDailyTrigger()` — removes all 5 handlers (4 new + legacy `runDailyUpdate`)
- No immediate execution on install (see decisions)

All other Main.gs functions unchanged: `setupAll`, `setupCreateSheet`, `installLiveTrigger`, `removeLiveTrigger`, `onOpen`, `promptRunForDate_`, `promptBackfill_`, `showSpreadsheetUrl_`, `showVerifyConfig_`.

## Checkpoint: Human Verification Pending

**Task 3 is a `checkpoint:human-verify` gate — it is NOT automated.** The code changes above are committed to git but NOT yet deployed to Apps Script production. The user must:

1. **Upload DailyUpdate.gs and Main.gs** to the Apps Script editor (replace existing files).
2. **Run each wrapper manually** from the editor — one at a time, not in parallel:
   - `runDailyUpdateUzoshop` — should complete within ~2 min, write a row to uzoshop tabs for yesterday
   - `runDailyUpdateZolplus` — ~1-2 min, row for Zol Plus
   - `runDailyUpdateUsmile` — ~1-2 min, row for 360usmile
3. **Only if all 3 wrappers complete without error**: run `installDailyTrigger` from the editor.
   - Log should say: "4 daily triggers installed: uzoshop@00:05, zolplus@00:08, usmile@00:11, store-meta@00:14 (Asia/Jerusalem)"
4. **Verify in Apps Script UI (Project Triggers)**: 4 new triggers visible + existing `runLiveUpdate` (5 total). Old `runDailyUpdate` trigger gone.
5. **After 24 hours**: confirm in Executions tab that all 4 ran independently between 00:05–00:14, each under 3 minutes.

If any wrapper fails during step 2, do NOT run `installDailyTrigger`. Fix the issue in DailyUpdate.gs first.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-05-01-01 (DoS via quota burst) | mitigate | Addressed: 3-min trigger spacing + no immediate run in installer |
| T-05-01-02 (Trigger tampering) | accept | Google IAM controls project access |
| T-05-01-03 (Repudiation) | accept | Apps Script Executions log auto-records |

## Known Stubs

None.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| DailyUpdate.gs exists | FOUND |
| Main.gs exists | FOUND |
| 05-01-SUMMARY.md exists | FOUND |
| Commit 5b65657 (Task 1) | FOUND |
| Commit 6cdef16 (Task 2) | FOUND |
