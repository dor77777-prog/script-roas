---
phase: 05-scalability
fixed_at: 2026-05-19T08:10:13Z
review_path: .planning/phases/05-scalability/05-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-05-19T08:10:13Z
**Source review:** `.planning/phases/05-scalability/05-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 11 (2 blockers + 9 warnings)
- Fixed: 11
- Skipped: 0

**Verification:**

- TypeScript: `tsc --noEmit` clean on every fix (entire dashboard-web compiles).
- Tests: `vitest run` → 84/84 passing after final fix.
- Build: `next build` → all 12 routes generated successfully.
- Apps Script (`.gs`): syntax-checked via `node -c` after copying to `.js` (Apps Script files are JS dialect; node parses them clean).
- Production-only verification (per user rule): no localhost / no dev-server runtime checks were performed. Compile/build/unit-tests only.

## Fixed Issues

### CR-01: Summary-tab month block never created under the per-store trigger split

**Files modified:** `DailyUpdate.gs`
**Commit:** `33ecbc9`
**Applied fix:** Added a new helper `ensureSummaryMonthBlock_(dateStr)` that wraps `writeDayRow(summarySheet, year, month, day, 0, 0, 0)`. The LAST per-store wrapper (`runDailyUpdateUsmile`, @ 00:11 IL) now calls this helper after `runUpdateForSingleStore_`. The summary tab is formula-driven, so writing zeros is harmless — but it forces `getOrCreateMonthBlock_` to fire and create the new-month block when needed. Errors are swallowed (Logger.log) since a missed month-block refresh is a UX glitch on day 1 of the month, not data loss. Picked option 1 from REVIEW.md (last-per-store-wrapper) rather than option 2 (00:14 refreshAllStoreMeta trigger) because the reviewer documented option 1 with a concrete code example.

### CR-02: CampaignsTable SWR key bound to global `range`, not `localRange`

**Files modified:** `dashboard-web/src/components/CampaignsTable.tsx`
**Commit:** `0965d40`
**Applied fix:** Moved `const [localRange, setLocalRange] = useState<DateRange>(range)` and its sync-effect to the TOP of the component body (before the three `useSWR` calls). All three SWR keys (`/api/campaigns`, `/api/products`, `/api/orders-attribution`) now use `localRange`, matching the `ProductsTable.tsx:273` pattern. The OLD `useState`/`useEffect` pair at the original position was removed and replaced with a pointer comment. Hooks-ordering: the change is a one-time rewrite where the new order is consistent across all renders going forward — no Rules-of-Hooks regression. TypeScript and full vitest suite pass.

### WR-01: `parseRangeParams` accepts lexicographically-valid but semantically-invalid dates

**Files modified:** `dashboard-web/src/lib/dateRange.ts`
**Commit:** `5cb7d8c`
**Applied fix:** Added `isRealDate(s: string): boolean` helper that constructs a Date from `"${s}T00:00:00Z"` and verifies `toISOString().slice(0,10) === s`. `parseRangeParams` now rejects `2026-99-99`, `2026-02-30`, `9999-13-31`, etc., with a `RangeParamError('from/to must be a real calendar date (YYYY-MM-DD).')`. Closes the malformed-query → archive-read DoS path the reviewer flagged.

### WR-02: Degraded-error 200 responses inherit ISR caching

**Files modified:** `dashboard-web/src/app/api/data/route.ts`, `dashboard-web/src/app/api/campaigns/route.ts`, `dashboard-web/src/app/api/orders-attribution/route.ts`, `dashboard-web/src/app/api/products/route.ts`
**Commit:** `5158f61`
**Applied fix:** Added `headers: { 'Cache-Control': 'no-store' }` to all four degraded-error returns. Now transient upstream Sheets API blips no longer pin in the CDN for 60s (or 300s for ordersAttribution). Mirrors the existing 400 RangeParamError path.

### WR-03: Destructive archive menu item one click away from dry-run with no confirmation

**Files modified:** `DailyUpdate.gs`
**Commit:** `1ef3957`
**Applied fix:** Wrapped `archive18MonthsProduction` in a confirmation prompt that requires typing `ARCHIVE` to proceed. Cancel returns silently; typing anything else shows a Hebrew alert and aborts. The dry-run path is untouched.

### WR-04: Switch statements in `sortAggregated` and `CampaignDrawer.sortedAdSets` have no `default` arm

**Files modified:** `dashboard-web/src/components/CampaignsTable.tsx`, `dashboard-web/src/components/CampaignDrawer.tsx`
**Commit:** `07becd7`
**Applied fix:** Added exhaustiveness checks via `const _exhaustive: never = sortKey` assignment. CampaignsTable's `valueOf` throws on unhandled (should never fire because the union is exhaustive). CampaignDrawer's inline comparator returns 0 in the default branch so sort collapses to "stable" rather than crashing a render path. Either way, adding a new SortKey/AdSetSortKey value without updating the switch now fails TypeScript compilation.

### WR-05: `displaySource` `mapped` tie-break ignores sort direction

**Files modified:** `dashboard-web/src/components/CampaignsTable.tsx`
**Commit:** `d92ec2a`
**Applied fix:** Added a DESIGN INTENT comment explaining the direction-independent tie-break. Chose the comment-only resolution (one of the reviewer's two suggestions) because changing the UX risks confusing existing users — unmapped rows have `roas=0` and would visually dominate the table on asc if mixed with the directional sort. The comment makes the intent explicit so future maintainers don't try to "fix" it.

### WR-06: `fetchDailyData` archive read silently caps at 100k rows

**Files modified:** `dashboard-web/src/lib/sheets.ts`
**Commit:** `15b0415`
**Applied fix:** Extracted `ARCHIVE_MAX_ROWS = 100_000` as a named constant. Added a post-read check: when the archive read returns full to the cap, `console.warn` so ops can see truncation instead of having to read a missing-data ticket cold. Did NOT bump the cap because the reviewer correctly flagged that requires profiling (wire-level cost scales linearly with cap size) — the truncation warning is the safe defensive variant.

### WR-07: `archiveTabRows_` re-applies date format to entire archive col A on every run

**Files modified:** `DailyUpdate.gs`
**Commit:** `6f6d508`
**Applied fix:** Captured `firstNewArchRow = archSheet.getLastRow() + 1` BEFORE the `setValues` append. The `setNumberFormat('yyyy-mm-dd')` call is now scoped to ONLY the newly-appended rows. Existing archive rows already have the format from prior runs — no need to refresh.

### WR-08: `parseLineItems` accepts non-finite `units` / `revenueCad` via `Number()` coercion bypass

**Files modified:** `dashboard-web/src/lib/ordersAttribution.ts`
**Commit:** `548bb00`
**Applied fix:** Tightened the pre-map filter to require `typeof it.p === 'string' && it.p.length > 0`. The post-map filter now only checks units/revenueCad finiteness (productId truthiness is guaranteed by the pre-map filter). `{p: [1,2,3]}` no longer slips through as `productId="1,2,3"`. All 84 existing unit tests pass.

### WR-09: `defaultRange` uses UTC midnight; Israel-TZ users in early hours get a stale "today"

**Files modified:** `dashboard-web/src/lib/dateRange.ts`
**Commit:** `97e90bb`
**Applied fix:** Switched `defaultRange()` to anchor both boundaries on `Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Jerusalem'})`. The `from` arithmetic stays in UTC milliseconds anchored on the IL `to` date string (constructing a Date at `${to}T00:00:00Z`) — this avoids DST edge-cases where 24h-ms subtraction across an IDT/IST shift would duplicate or skip a day. Re-formatting via the same IL formatter yields the canonical IL calendar date. Did NOT lift the existing `todayInIsrael` helpers in CampaignsTable / ProductsTable into a shared module — that's a touches-3-files refactor and out of scope for this finding.

## Skipped Issues

None — all findings in scope were fixed cleanly.

---

_Fixed: 2026-05-19T08:10:13Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
