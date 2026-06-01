# Monthly tables — per-platform spend breakdown (design)

**Date:** 2026-06-01
**Status:** approved (mockup signed off by operator)
**Mockup:** `docs/superpowers/mockups/2026-06-01-monthly-tables-per-platform/mockup.html`

## Goal

In the Analysis→History monthly tables, show **one spend column per ad platform**
(Facebook/Meta, Google, TikTok) on every daily row — each column shown **only when
that platform spent money that month** — plus a **total-spend** column and a
**total-revenue** column. This must apply to BOTH the **per-store** tables and the
**general "סיכום כל החנויות" summary** table, so the operator reads per-platform
spend + totals per day at a glance.

## Current state (what exists)

`dashboard-web/src/components/MonthlyTables.tsx` (one file, ~626 lines) has two table
components:

- **`MonthBlock`** (per-store): ALREADY renders `פייסבוק / גוגל / טיקטוק` spend columns
  + `יצא סה"כ` + `נכנס` + `ROAS`. BUT the Facebook **and** Google columns are both gated
  by a single `hasGa = rows.some(r => r.gaSpend > 0)` flag. Bug: a store that spent on
  **Facebook but not Google** shows *neither* column (FB spend hidden inside the total).
  TikTok has its own independent `hasTt = ttSpend > 0`.
- **`MonthBlockSummary`** (general, all stores): aggregates only `{spend, revenue, gross,
  refund}` per day and renders `תאריך · יצא סה"כ · נכנס סה"כ · ROAS` — **no per-platform
  breakdown**. This is the main gap.

Data is already available: each `DailyRow` carries `fbSpend`, `gaSpend`, `ttSpend`
(nullable for tt), `totalSpend`, `revenue`, `grossRevenue`, `refundDeduction`, `roas`,
`date`. No new data plumbing or API change is needed.

## Design

### Shared rule — independent per-platform visibility
A platform column is shown **iff that platform spent > 0 over the month** in the table's
scope (per-store: that store; summary: across all stores). Three independent flags:
`hasFb = rows.some(r => r.fbSpend > 0)`, `hasGa = rows.some(r => r.gaSpend > 0)`,
`hasTt = rows.some(r => (r.ttSpend ?? 0) > 0)`. `anyPlatform = hasFb || hasGa || hasTt`.

Column order (both tables): `תאריך · [פייסבוק] · [גוגל] · [טיקטוק] · יצא(סה"כ) · נכנס(סה"כ) · ROAS`.
The total-spend header reads `יצא סה"כ` when `anyPlatform`, else `יצא` (matches the
existing per-store convention).

A shown platform column renders its per-day value via `formatNumber(...)`, including
`0` on days that platform didn't spend (consistent with the current per-store behavior);
empty days (no row) render blank. Revenue stays a **single** column (Shopify revenue is
not per-platform). All values CAD (unchanged).

### `MonthBlock` (per-store) — fix the bundling
Replace the single `hasGa`-gates-both with the three independent flags above. The
`פייסבוק` column now keys on `hasFb` (not `hasGa`); `גוגל` keys on `hasGa`; `טיקטוק` on
`hasTt`. Header/cell/total stay in lock-step (a column's `<th>`, its `<td>` per row, and
its total `<td>` are all gated by the same flag). The total-spend label uses
`anyPlatform ? 'יצא סה"כ' : 'יצא'`.

### `MonthBlockSummary` (general) — add per-platform
Extend the per-day aggregate from `{spend, revenue, gross, refund}` to also accumulate
`{fb, ga, tt}` (summing `r.fbSpend` / `r.gaSpend` / `r.ttSpend ?? 0` across all stores
for that date). Compute the three `has*` flags from the full `rows`. Render the platform
columns (each gated by its flag) before `יצא סה"כ`, in header, each day row, the empty-day
rows (blank), and the `סך הכל` total row (sum each platform). Revenue + ROAS + refund
indicator unchanged.

### Layout / mobile
More columns widen the table; `TableBase` already wraps in `overflow-auto` with a
`minWidth`. Bump the summary table's `minWidth` (500 → ~640) so the new columns don't
crush on phones; keep horizontal scroll. No other layout change.

## Files

- **Modify:** `dashboard-web/src/components/MonthlyTables.tsx`
  - `MonthBlock`: independent `hasFb/hasGa/hasTt`, FB column keys on `hasFb`, label via `anyPlatform`.
  - `MonthBlockSummary`: per-platform aggregate + flags + columns (header/rows/empty/total) + `minWidth`.
- **Test:** `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx` (new).

## Testing

DOM tests (vitest jsdom config) rendering both components with fixture rows:

1. **Summary shows a platform column iff it spent (across stores).** Rows where only
   FB + TikTok spent → summary has `פייסבוק` + `טיקטוק` headers, NOT `גוגל`.
2. **Summary per-day + total per-platform values are correct** (FB/GA/TT summed across
   stores per date; total row = column sums; `יצא סה"כ` = sum of platform totals).
3. **Per-store Facebook-only store shows only the `פייסבוק` column** (regression for the
   bundling bug) — no `גוגל`/`טיקטוק` headers, FB spend visible (not just in the total).
4. **Per-store independent flags**: a store with FB + Google (no TikTok) shows `פייסבוק` +
   `גוגל`, not `טיקטוק`.
5. **`יצא סה"כ` vs `יצא` label** flips correctly with `anyPlatform`.
6. **Empty days** render blank platform cells (no `0`, no crash); **0-spend day for a
   shown platform** renders `0`.

## Out of scope / non-goals

- No new API or DB changes (per-platform daily spend already on `DailyRow`).
- Revenue is not split per platform (single Shopify revenue column).
- No change to the ROAS badge colors (uses the existing `roasCell` tones, incl. the
  operator-locked bright `#EF9331` orange + white).
- No change to FX/currency handling (all CAD as today).
