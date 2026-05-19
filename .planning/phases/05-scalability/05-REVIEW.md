---
phase: 05-scalability
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - DailyUpdate.gs
  - Main.gs
  - dashboard-web/src/app/api/campaigns/route.ts
  - dashboard-web/src/app/api/data/route.ts
  - dashboard-web/src/app/api/orders-attribution/route.ts
  - dashboard-web/src/app/api/products/route.ts
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/Dashboard.tsx
  - dashboard-web/src/components/ProductsTable.tsx
  - dashboard-web/src/lib/campaigns.ts
  - dashboard-web/src/lib/dateRange.ts
  - dashboard-web/src/lib/ordersAttribution.ts
  - dashboard-web/src/lib/products.ts
  - dashboard-web/src/lib/sheets.ts
findings:
  blocker: 2
  warning: 9
  total: 11
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 5 splits three concurrent concerns: per-store Apps Script triggers (05-01), range-keyed API pagination (05-02), opt-in line-items lazy loading (05-03), and the warm/archive split with destructive Apps Script archiving (05-04). The implementation is mostly sound — input validation on `?from/to/lineItems` is strict, the degraded-error 200 pattern is consistent across all four routes, the archive operation defaults to dry-run, and SWR keys correctly include the date range.

However, two BLOCKER issues escape: (1) the per-store trigger split silently drops summary-tab month-block creation, which the legacy `runUpdateForDate` path was responsible for, so the first day of any new month after Phase 5 deploys will arrive with no formula range on the summary tab until someone manually runs the legacy path; (2) `CampaignsTable` re-keys SWR on the GLOBAL `range` prop while its local toolbar lets the user pick a LOCAL range that can extend outside the global window — those out-of-window dates can never load data, even when an archive exists. Both regress observable user-facing behavior.

The remaining warnings are quality concerns: input validation accepts lexicographically-valid-but-semantically-invalid dates (e.g. `2026-99-99`), the destructive `archive18MonthsProduction` menu item sits one click away from the dry-run item with no confirm dialog, the 200-degraded-error path inherits ISR caching which can pin a transient error in CDN for 60+ seconds, and a handful of switch statements have no `default` arm so future enum additions silently produce `undefined` sort orderings. Details below with line numbers and concrete fixes.

## Blockers

### CR-01: Summary-tab month block never created under the per-store trigger split

**File:** `DailyUpdate.gs:53-79`, `Main.gs:54-68`

**Issue:** The new per-store wrappers `runDailyUpdateUzoshop / Zolplus / Usmile` call `runUpdateForSingleStore_`, which by design "DOES NOT touch the summary tab" (per the function-level comment, line 50-52). The legacy `runUpdateForDate` (line 81) called `writeDayRow(summarySheet, year, month, day, 0, 0, 0)` at line 114 — this triggers `getOrCreateMonthBlock_` inside `writeDayRow` (SheetBuilder.gs:336-338) and is the ONLY path that creates a new month block on the summary tab. After Phase 5 deploys, all three daily triggers go through `runUpdateForSingleStore_`. None of them touch the summary tab. The legacy `runUpdateForDate` is no longer scheduled.

Consequence: when the first IL midnight of a new month hits (e.g. 2026-06-01), the three per-store triggers run, but the summary tab's new-month block is never created. The summary tab's formula-driven sheet stays anchored to the previous month's block until someone manually runs `runDailyUpdate` from the editor — which the menu still wires to the legacy path (Main.gs:133), so a human-in-the-loop fix exists, but it's silent and undocumented for the human.

The comment at DailyUpdate.gs:50-52 says "the next store's run (or the next-day's run) will keep it consistent" — that was true with the OLD `runUpdateForDate` orchestrator, but the next-day's run under Phase 5 is ALSO three independent per-store wrappers, none of which write to the summary tab. The premise is wrong.

**Fix:** Install a fourth trigger that calls a new `ensureSummaryBlock_(dateStr)` helper after the per-store runs, OR have the LAST per-store wrapper (e.g. `runDailyUpdateUsmile` at 00:11) call `writeDayRow(summarySheet, year, month, day, 0, 0, 0)` after its update. Example:

```javascript
function runDailyUpdateUsmile() {
  runUpdateForSingleStore_('usmile360', yesterdayStr_());
  // Phase 5 — last store also refreshes the summary tab's month block.
  // The summary tab is formula-driven; we only need the block to exist.
  try {
    const ss = ensureSpreadsheet();
    const dateStr = yesterdayStr_();
    const [year, month, day] = dateStr.split('-').map(Number);
    const summarySheet = ss.getSheetByName(SUMMARY_TAB);
    writeDayRow(summarySheet, year, month, day, 0, 0, 0);
  } catch (e) {
    Logger.log(`[summary] block refresh failed: ${e && e.message ? e.message : e}`);
  }
}
```

### CR-02: `CampaignsTable` SWR key is bound to global `range`, not `localRange`

**File:** `dashboard-web/src/components/CampaignsTable.tsx:258-262, 350-361, 572-614`

**Issue:** The component declares an in-toolbar date-range picker (lines 568-614) that mutates `localRange` independently from the global `range` prop. The user-facing intent is clearly "zoom into a sub-window or pick any window I want for this table." However, the SWR fetch is keyed by the GLOBAL `range`:

```typescript
const { data, error, isLoading } = useSWR<CampaignsResponse>(
  buildDateRangeKey('/api/campaigns', range),   // ← global, NOT localRange
  fetcher,
  { refreshInterval: 120_000, revalidateOnFocus: false },
);
```

`aggregate()` (called at line 367-371) filters with `localRange`. So when the user picks `localRange` with a `from` earlier than `range.from` (or a `to` later than `range.to`), the aggregator filters against dates that were never fetched. Result: empty table, no error, no "expand the global range" hint.

This regresses against the Phase 5 stated benefit: range-keyed pagination should make the table fetch exactly what the user asked for. The companion `ProductsTable.tsx` got this right at line 279 (`buildDateRangeKey('/api/products', localRange)`); `CampaignsTable` did not.

There is no `min` attribute on the date inputs (lines 572-604) to constrain the user to the global window. They can freely pick out-of-window dates.

**Fix:** Re-key the campaigns SWR on `localRange`, matching the `ProductsTable.tsx` pattern. The drilldown drawer at line 870 already passes `localRange.from / .to`, so this completes the contract.

```typescript
const { data, error, isLoading } = useSWR<CampaignsResponse>(
  buildDateRangeKey('/api/campaigns', localRange),
  fetcher,
  { refreshInterval: 120_000, revalidateOnFocus: false },
);
```

Also re-key the dependent `productsResp` and `ordersAttrResp` fetches (currently lines 287, 297) on `localRange` for the same reason — otherwise the trust chip and Shopify-ROAS columns lag the active range. The `useCampaignTrueRevenue` hook on line 380 already receives `localRange`, so its internal filter uses the right window, but the underlying data must match.

## Warnings

### WR-01: `parseRangeParams` accepts lexicographically-valid but semantically-invalid dates

**File:** `dashboard-web/src/lib/dateRange.ts:22, 40-46`

**Issue:** The validator is only a format regex (`/^\d{4}-\d{2}-\d{2}$/`). Strings like `2026-99-99`, `2026-02-30`, or `9999-12-31` pass without error. The downstream `isInRange` comparison is lexicographic (`date >= range.from && date <= range.to`), so `from=2026-99-99` would let every row through (since `"99-99"` sorts after `"12-31"`); a sentinel like `from=0001-01-01&to=9999-12-31` would unconditionally read the entire archive + warm. With archive-fallback at sheets.ts:127, this means a malformed query can trigger a 100k-row archive read.

**Fix:** After regex validation, construct a `Date` and verify round-trip equality:

```typescript
function isRealDate(s: string): boolean {
  const d = new Date(s + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}
// In parseRangeParams:
if (!isRealDate(from) || !isRealDate(to)) {
  throw new RangeParamError('from/to must be a real YYYY-MM-DD date.');
}
```

### WR-02: Degraded-error 200 responses inherit ISR caching, pinning transient errors

**File:** `dashboard-web/src/app/api/data/route.ts:71-80`, `dashboard-web/src/app/api/campaigns/route.ts:51-58`, `dashboard-web/src/app/api/orders-attribution/route.ts:68-75`, `dashboard-web/src/app/api/products/route.ts:51-58`

**Issue:** All four routes return the "degraded" error response with status 200 + empty rows + `{error}` field. The error responses do NOT set `headers: { 'Cache-Control': 'no-store' }`. Because the route module declares `export const revalidate = 60` (or 300 for ordersAttribution), Next.js applies ISR semantics by default. Per Next.js docs, the absence of an explicit Cache-Control on the response means the route-level `revalidate` governs the CDN behavior — meaning a transient Sheets API hiccup at second T will cause every consumer until T+60s to see the degraded error response.

Contrast with the `RangeParamError` 400 path which explicitly sets `'Cache-Control': 'no-store'`. The degraded path needs the same treatment: an upstream blip should not be CDN-cached.

**Fix:** Add `headers: { 'Cache-Control': 'no-store' }` to all four degraded-error returns, mirroring the 400 path:

```typescript
return NextResponse.json(
  { rows: [], lastUpdated: new Date().toISOString(), error: userFacingError(message) } satisfies CampaignsResponse,
  { status: 200, headers: { 'Cache-Control': 'no-store' } },
);
```

### WR-03: Destructive archive menu item is one click away from dry-run with no confirmation

**File:** `Main.gs:145-146`, `DailyUpdate.gs:732-733`

**Issue:** The two menu items live adjacent:
```
.addItem('ארכוב יבש: dry-run 18 חודש (Phase 5)', 'archive18MonthsDryRun')
.addItem('ארכוב production 18 חודש (אחרי dry-run!)', 'archive18MonthsProduction')
```

`archive18MonthsProduction` calls `archiveOlderThan(18, {dryRun: false})` which deletes ~6-18 months of rows from 5 tabs WITHOUT any UI confirmation prompt. The label warns "אחרי dry-run!" but the menu item itself has no `SpreadsheetApp.getUi().alert(... ButtonSet.OK_CANCEL ...)` gate. A misclick or fat-finger on this single menu item triggers an irreversible operation.

By Apps Script convention, destructive menu items should `Browser.msgBox` / `ui.alert` for confirmation. The Phase 5 plan calls this out (the user_setup section mentions dry-run-first as a workflow expectation, not as code-enforced).

**Fix:** Wrap `archive18MonthsProduction` with a confirmation prompt that requires typing a magic word:

```javascript
function archive18MonthsProduction() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'ארכוב לפרודקשן',
    'פעולה הרסנית. הזן ARCHIVE לאישור.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  if (res.getResponseText().trim() !== 'ARCHIVE') {
    ui.alert('הפעולה בוטלה — לא הוזנה אישור תקין.');
    return;
  }
  archiveOlderThan(18, {dryRun: false});
}
```

### WR-04: Switch statements in `sortAggregated` and `CampaignDrawer.sortedAdSets` have no `default` arm

**File:** `dashboard-web/src/components/CampaignsTable.tsx:200-231`, `dashboard-web/src/components/CampaignDrawer.tsx:308-324`

**Issue:** Both `valueOf()` (CampaignsTable) and the inline comparator in `sortedAdSets` (CampaignDrawer) switch on a string-union type and rely on the union being exhaustive at compile time. Neither has a `default` clause. If a future `SortKey` or `AdSetSortKey` value is added but a case is forgotten, the function returns `undefined`. `Array.prototype.sort` then receives `NaN`/non-numeric comparator results and produces an arbitrary order — silently wrong, no runtime error.

TypeScript's strictness can catch this with `noFallthroughCasesInSwitch`, but the project's tsconfig isn't audited here. Belt-and-suspenders is cheap.

**Fix:** Add an exhaustiveness check after the switch:

```typescript
switch (sortKey) {
  // ... cases ...
}
const _exhaustive: never = sortKey;
throw new Error(`Unhandled sort key: ${_exhaustive}`);
```

Or for the comparator, return 0 in the default branch so undefined sort behavior collapses to "stable":

```typescript
default: return 0;
```

### WR-05: `displaySource` `mapped` tie-break ignores sort direction

**File:** `dashboard-web/src/components/CampaignsTable.tsx:415-418`

**Issue:** When sorting by `shopifyRoas`, the comparator pushes unmapped rows to the bottom:

```typescript
withRoas.sort((x, y) => {
  if (x.mapped !== y.mapped) return x.mapped ? -1 : 1;
  return sign * (x.roas - y.roas);
});
```

`x.mapped ? -1 : 1` is hard-coded — it ignores `sign`. So even with `sortDir='asc'`, mapped rows always come BEFORE unmapped rows. The intent ("mapped first, sort within group by ROAS") is reasonable but the UX is asymmetric: clicking the ROAS-Shopify header to toggle asc/desc rotates within-group ordering but never moves unmapped rows to the top. The header arrow flips while the unmapped block stays pinned at the bottom — confusing.

If the design intent IS "always mapped first regardless of direction," document it in a comment. Otherwise, fix the tie-break to honor `sign`.

**Fix:** Either explicitly comment the intent, or:

```typescript
if (x.mapped !== y.mapped) return sign * (x.mapped ? -1 : 1);
```

so direction flips the group order along with within-group order.

### WR-06: `fetchDailyData` archive read silently caps at 100k rows

**File:** `dashboard-web/src/lib/sheets.ts:141`

**Issue:** The archive `values.get` reads `A2:K100000`. If the archive ever grows past 100k rows (plausible at scale — 3 stores × 365 days × multi-year retention × multiple per-day rows), older rows silently disappear from dashboard queries with no log or warning. The warm-spreadsheet limit at line 132 (`A2:K10000`) has the same shape but is intentional (10k * 3 stores * 1-day rows = ~30 store-days/sheet, fine for 18 months).

The archive limit was likely picked as "10× warm" without a numeric basis. Worth either:
1. Bumping to `A2:K1000000` (Sheets' hard cap is 10M cells per spreadsheet, so 1M rows × 11 cols = 11M — would exceed, but a single tab can hold ~5M rows comfortably), OR
2. Detecting truncation and logging.

**Fix:** Either raise the cap or detect truncation. Minimal:

```typescript
const ARCHIVE_MAX_ROWS = 500_000;
// ...
range: `${DATA_TAB}!A2:K${ARCHIVE_MAX_ROWS + 1}`,
// after read:
if ((res.data.values?.length ?? 0) >= ARCHIVE_MAX_ROWS) {
  console.warn(`/lib/sheets archive read hit row cap of ${ARCHIVE_MAX_ROWS}; older rows excluded.`);
}
```

### WR-07: `archiveTabRows_` re-applies date format to entire archive col A on every run

**File:** `DailyUpdate.gs:716-717`

**Issue:**

```javascript
archSheet.getRange(2, 1, archSheet.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
```

This formats from row 2 to the last row, INCLUDING all pre-existing archive rows. On the second archive run, the format is reapplied to rows that already had it. On the 12th run with an archive of 200k rows, this is a wasted full-column setNumberFormat call that contributes to the Sheets API quota burn the Phase 5 trigger split was designed to avoid.

Same shape at line 724 (warm sheet) but warm is bounded by retention so it's fine there.

**Fix:** Apply format ONLY to newly-appended rows:

```javascript
const firstNewRow = archSheet.getLastRow() - toMove.length + 1;
archSheet.getRange(firstNewRow, 1, toMove.length, 1).setNumberFormat('yyyy-mm-dd');
```

### WR-08: `parseLineItems` accepts non-finite `units` / `revenueCad` via `Number()` coercion bypass

**File:** `dashboard-web/src/lib/ordersAttribution.ts:154-176`

**Issue:** The validator filter at line 168-172:

```typescript
.filter(li =>
  li.productId &&
  Number.isFinite(li.units) &&
  Number.isFinite(li.revenueCad),
);
```

correctly drops items with NaN/Infinity. But the `map` BEFORE the filter (lines 163-167):

```typescript
.map(it => ({
  productId: String(it.p ?? ''),
  units: Number(it.u ?? 0),
  revenueCad: Number(it.r ?? 0),
}))
```

uses `Number(it.u ?? 0)` — `Number(undefined)` is `NaN`, but `it.u ?? 0` defaults to `0` first, then `Number(0)` = `0`. So missing fields become 0. Fine. But for explicitly-`null` or non-coercible values like `{u: "abc"}`, `Number("abc")` returns NaN — then the filter catches it. Net: looks safe.

However, the wider issue: `productId: String(it.p ?? '')` will accept any object that has a `toString()` — `{p: [1,2,3]}` becomes `productId="1,2,3"`. Phase 1's writer guarantees `p` is a string per-row, but a malformed sheet edit could slip in a non-string and the dashboard would happily emit a synthetic product ID.

**Fix:** Require `typeof it.p === 'string'` and reject otherwise:

```typescript
.filter((it): it is { p: string; u: unknown; r: unknown } =>
  typeof it === 'object' && it !== null && typeof it.p === 'string' && it.p.length > 0
)
.map(it => ({ productId: it.p, units: Number(it.u ?? 0), revenueCad: Number(it.r ?? 0) }))
.filter(li => Number.isFinite(li.units) && Number.isFinite(li.revenueCad));
```

### WR-09: `defaultRange` uses UTC midnight; Israel-TZ users in early hours get a stale "today"

**File:** `dashboard-web/src/lib/dateRange.ts:64-70`

**Issue:**

```typescript
export function defaultRange(): DateRange {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - DEFAULT_RANGE_DAYS * 86400 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}
```

`toISOString()` returns UTC. The dashboard's data rows are stamped in Asia/Jerusalem (UTC+2/+3). At 02:00 IL on a day boundary (UTC = previous day 23:00), `to` becomes yesterday-UTC = day-before-yesterday-IL. The default range excludes the current IL day entirely until UTC ticks over.

The window is 90 days so the analytical effect is small, but the "to" boundary is observable in the UI as "today" being absent on a 91-day-aware dashboard.

**Fix:** Anchor on Israel TZ, matching the spreadsheet's TZ:

```typescript
export function defaultRange(): DateRange {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // e.g. "2026-05-19"
  const todayMs = Date.UTC(...today.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const fromDate = new Date(todayMs - DEFAULT_RANGE_DAYS * 86400 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  return { from: from, to: today };
}
```

(Or import the existing `todayInIsrael` pattern that `CampaignsTable.tsx:77-82` and `ProductsTable.tsx:88-93` already use — and lift it into a shared helper.)

---

_Reviewed: 2026-05-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
