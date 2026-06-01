# Monthly Tables — Per-Platform Spend Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one spend column per ad platform (Facebook/Google/TikTok, each shown only when it spent that month) + total-spend + total-revenue on each daily row, in BOTH the per-store monthly tables and the general all-stores summary table.

**Architecture:** Pure presentational change in one file (`MonthlyTables.tsx`). The per-store `MonthBlockPerStore` already renders per-platform columns but gates Facebook+Google together under one flag — split into independent `hasFb`/`hasGa`/`hasTt`. The general `MonthBlockSummary` currently has no per-platform columns — extend its per-day aggregate to accumulate per-platform spend and render the columns. All data (`fbSpend`/`gaSpend`/`ttSpend`) already lives on `DailyRow`; no API/DB change.

**Tech Stack:** Next.js + React + TypeScript, Tailwind (token-driven), vitest (DOM tests via `vitest.config.dom.ts`).

**Spec:** `docs/superpowers/specs/2026-06-01-monthly-tables-per-platform-design.md`
**Mockup:** `docs/superpowers/mockups/2026-06-01-monthly-tables-per-platform/mockup.html`

---

## File structure

- **Modify:** `dashboard-web/src/components/MonthlyTables.tsx`
  - `MonthBlockPerStore` (line ~377): independent `hasFb`/`hasGa`/`hasTt`; Facebook column keys on `hasFb`; total-spend label via `anyPlatform`. Add `export`.
  - `MonthBlockSummary` (line ~505): per-platform aggregate + flags + columns (header / day rows / empty days / total row); bump `minWidth`. Add `export`.
- **Create test:** `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`

## Conventions (read before starting)

- DOM tests run with: `npx vitest run --config vitest.config.dom.ts <file>` (jsdom).
- `DailyRow` (from `@/lib/types`) required fields for a fixture: `date, storeId, storeName, fbSpend, gaSpend, ttSpend, totalSpend, revenue, roas, grossProfit, cogs, netProfit, hasCogs, grossRevenue, refundDeduction, fbImpressions, gaImpressions, ttImpressions`. Use the `makeRow` helper below so every test row is valid.
- Both `MonthBlockPerStore` and `MonthBlockSummary` accept `defaultOpen` — pass `defaultOpen` so the table body renders (the collapsible starts open).
- Hebrew column headers: `פייסבוק` (Facebook/Meta), `גוגל` (Google), `טיקטוק` (TikTok), `יצא סה"כ`/`יצא` (total spend), `נכנס סה"כ`/`נכנס` (revenue).

---

### Task 1: Make the sub-components testable

**Files:**
- Modify: `dashboard-web/src/components/MonthlyTables.tsx` (lines ~377, ~505)

- [ ] **Step 1: Export `MonthBlockPerStore`**

Change line ~377 from:

```tsx
function MonthBlockPerStore({
```

to:

```tsx
export function MonthBlockPerStore({
```

- [ ] **Step 2: Export `MonthBlockSummary`**

Change line ~505 from:

```tsx
function MonthBlockSummary({
```

to:

```tsx
export function MonthBlockSummary({
```

- [ ] **Step 3: Verify it still compiles**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/MonthlyTables.tsx
git commit -m "refactor(monthly-tables): export MonthBlockPerStore + MonthBlockSummary for direct DOM testing"
```

---

### Task 2: General summary — per-platform columns (TDD)

**Files:**
- Create: `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`
- Modify: `dashboard-web/src/components/MonthlyTables.tsx` (`MonthBlockSummary`, lines ~505-612)

- [ ] **Step 1: Write the failing test file (summary cases)**

Create `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`:

```tsx
// Per-platform spend columns in the Analysis→History monthly tables.
// Spec: docs/superpowers/specs/2026-06-01-monthly-tables-per-platform-design.md
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';
import {
  MonthBlockSummary,
  MonthBlockPerStore,
} from '@/components/MonthlyTables';

// Build a valid DailyRow with sane defaults; override only what a test cares about.
function makeRow(over: Partial<DailyRow>): DailyRow {
  const fb = over.fbSpend ?? 0;
  const ga = over.gaSpend ?? 0;
  const tt = over.ttSpend ?? 0;
  const totalSpend = over.totalSpend ?? fb + ga + tt;
  const revenue = over.revenue ?? 0;
  return {
    date: '2026-06-01',
    storeId: 'store-1',
    storeName: 'store-1',
    fbSpend: fb,
    gaSpend: ga,
    ttSpend: tt,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
  };
}

// Read the <thead> header texts of the first table in the container.
function headerTexts(container: HTMLElement): string[] {
  const ths = container.querySelectorAll('thead th');
  return Array.from(ths).map((th) => th.textContent?.trim() ?? '');
}

describe('MonthBlockSummary — per-platform spend columns', () => {
  it('shows a platform column ONLY for platforms that spent that month (FB + TikTok, not Google)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'a', fbSpend: 100, ttSpend: 50, revenue: 400 }),
      makeRow({ date: '2026-06-02', storeId: 'b', fbSpend: 200, ttSpend: 0, revenue: 500 }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');
    expect(headers).toContain('טיקטוק');
    expect(headers).not.toContain('גוגל'); // Google never spent → no column
  });

  it('sums each platform across stores per day AND in the total row', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'a', fbSpend: 100, gaSpend: 10, revenue: 300 }),
      makeRow({ date: '2026-06-01', storeId: 'b', fbSpend: 200, gaSpend: 20, revenue: 600 }),
      makeRow({ date: '2026-06-02', storeId: 'a', fbSpend: 50, gaSpend: 5, revenue: 150 }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
    );
    // Total row (tfoot-equivalent last <tr>) carries the column sums.
    // FB total = 100+200+50 = 350; GA total = 10+20+5 = 35; spend total = 385.
    const totalRow = container.querySelector('tbody tr:last-child')!;
    const cells = within(totalRow as HTMLElement).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells).toContain('350'); // FB total
    expect(cells).toContain('35');  // GA total
    expect(cells).toContain('385'); // total spend (יצא סה"כ)
  });

  it('labels total-spend "יצא סה\\"כ" when any platform column shows', () => {
    const rows: DailyRow[] = [makeRow({ fbSpend: 100, revenue: 300 })];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a']} defaultOpen />,
    );
    expect(headerTexts(container)).toContain('יצא סה"כ');
  });
});
```

- [ ] **Step 2: Run the summary tests, verify they FAIL**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`
Expected: FAIL — headers do not yet contain `פייסבוק`/`טיקטוק`; total row has no `350`/`35`.

- [ ] **Step 3: Implement the per-platform aggregate in `MonthBlockSummary`**

In `MonthlyTables.tsx`, replace the `Agg` type + aggregation loop (currently ~522-533):

```tsx
  type Agg = { spend: number; revenue: number; gross: number; refund: number };
  const byDate = new Map<string, Agg>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { spend: 0, revenue: 0, gross: 0, refund: 0 });
    const e = byDate.get(r.date)!;
    e.spend += r.totalSpend;
    e.revenue += r.revenue;
    e.gross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      e.refund += r.refundDeduction;
    }
  }
```

with (adds `fb`/`ga`/`tt` per-day + the visibility flags):

```tsx
  type Agg = { fb: number; ga: number; tt: number; spend: number; revenue: number; gross: number; refund: number };
  const byDate = new Map<string, Agg>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { fb: 0, ga: 0, tt: 0, spend: 0, revenue: 0, gross: 0, refund: 0 });
    const e = byDate.get(r.date)!;
    e.fb += r.fbSpend;
    e.ga += r.gaSpend;
    e.tt += r.ttSpend ?? 0;
    e.spend += r.totalSpend;
    e.revenue += r.revenue;
    e.gross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      e.refund += r.refundDeduction;
    }
  }
  // Per-platform column visibility — show a platform iff it spent this month
  // anywhere across the stores in scope (independent per platform).
  const hasFb = rows.some(r => r.fbSpend > 0);
  const hasGa = rows.some(r => r.gaSpend > 0);
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
  const anyPlatform = hasFb || hasGa || hasTt;
```

- [ ] **Step 4: Add the per-platform month totals**

Immediately after the existing summary totals loop (the `for (const r of rows) { totalSpend += ... }` block that ends ~543), add the per-platform totals. Replace:

```tsx
  let totalSpend = 0, totalRev = 0, totalGross = 0, totalRefund = 0;
  for (const r of rows) {
    totalSpend += r.totalSpend;
    totalRev += r.revenue;
    totalGross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      totalRefund += r.refundDeduction;
    }
  }
```

with:

```tsx
  let totalFb = 0, totalGa = 0, totalTt = 0;
  let totalSpend = 0, totalRev = 0, totalGross = 0, totalRefund = 0;
  for (const r of rows) {
    totalFb += r.fbSpend;
    totalGa += r.gaSpend;
    totalTt += r.ttSpend ?? 0;
    totalSpend += r.totalSpend;
    totalRev += r.revenue;
    totalGross += r.grossRevenue ?? r.revenue;
    if (r.refundDeduction !== null && r.refundDeduction > 0) {
      totalRefund += r.refundDeduction;
    }
  }
```

- [ ] **Step 5: Bump the summary table `minWidth` + add the header columns**

Change the summary `<TableBase>` (currently `minWidth={500}`, ~line 561):

```tsx
          <TableBase className="text-xs sm:text-sm" minWidth={500} stickyHeader>
```

to:

```tsx
          <TableBase className="text-xs sm:text-sm" minWidth={640} stickyHeader>
```

Replace the summary header row (~562-568):

```tsx
              <tr className="text-ink-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                <th className="px-3 py-2 text-end font-medium">יצא סה&quot;כ</th>
                <th className="px-3 py-2 text-end font-medium">נכנס סה&quot;כ</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
```

with:

```tsx
              <tr className="text-ink-secondary">
                <th className="px-3 py-2 text-start font-medium">תאריך</th>
                {hasFb && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
                {hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
                {hasTt && <th className="px-3 py-2 text-end font-medium">טיקטוק</th>}
                <th className="px-3 py-2 text-end font-medium">{anyPlatform ? 'יצא סה"כ' : 'יצא'}</th>
                <th className="px-3 py-2 text-end font-medium">נכנס סה&quot;כ</th>
                <th className="px-3 py-2 text-center font-medium">ROAS</th>
              </tr>
```

- [ ] **Step 6: Add the per-platform cells to each day row**

In the summary day-row map, replace the date cell + the first spend cell. Currently (~579-580):

```tsx
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.spend) : ''}</td>
```

with (insert the platform cells between the date and total-spend):

```tsx
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(d)}</td>
                    {hasFb && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.fb) : ''}</td>}
                    {hasGa && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.ga) : ''}</td>}
                    {hasTt && <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.tt) : ''}</td>}
                    <td className="px-3 py-1.5 text-end tabular-nums">{agg ? formatNumber(agg.spend) : ''}</td>
```

- [ ] **Step 7: Add the per-platform cells to the total row**

In the summary total row, replace the `סך הכל` cell + total-spend cell. Currently (~597-599):

```tsx
                <td className="px-3 py-2">סך הכל</td>
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalSpend)}</td>
```

with:

```tsx
                <td className="px-3 py-2">סך הכל</td>
                {hasFb && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalFb)}</td>}
                {hasGa && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalGa)}</td>}
                {hasTt && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalTt)}</td>}
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalSpend)}</td>
```

- [ ] **Step 8: Run the summary tests, verify they PASS**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`
Expected: PASS (3 summary tests).

- [ ] **Step 9: Commit**

```bash
git add dashboard-web/src/components/MonthlyTables.tsx dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx
git commit -m "feat(monthly-tables): per-platform spend columns in the general all-stores summary"
```

---

### Task 3: Per-store independent platform columns (TDD — bug fix)

**Files:**
- Modify: `dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx` (append cases)
- Modify: `dashboard-web/src/components/MonthlyTables.tsx` (`MonthBlockPerStore`, lines ~389-393, ~434, ~437, ~452, ~477)

- [ ] **Step 1: Append the failing per-store tests**

Append to `monthlyTablesPerPlatform.dom.test.tsx` (after the `MonthBlockSummary` describe block):

```tsx
describe('MonthBlockPerStore — independent platform columns (bug fix)', () => {
  it('a Facebook-only store shows the פייסבוק column (not bundled away with Google)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 'zolplus', fbSpend: 842, gaSpend: 0, ttSpend: 0, revenue: 2310 }),
      makeRow({ date: '2026-06-02', storeName: 'zolplus', fbSpend: 910, gaSpend: 0, ttSpend: 0, revenue: 2140 }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="zolplus" rows={rows} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');     // FB spent → shown (was hidden before the fix)
    expect(headers).not.toContain('גוגל');     // Google never spent → no column
    expect(headers).not.toContain('טיקטוק');   // TikTok never spent → no column
    // FB spend is visible in the body, not just folded into the total.
    expect(container.textContent).toContain('842');
  });

  it('a store with Facebook + Google (no TikTok) shows both, not TikTok', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 's', fbSpend: 100, gaSpend: 40, ttSpend: 0, revenue: 500 }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="s" rows={rows} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');
    expect(headers).toContain('גוגל');
    expect(headers).not.toContain('טיקטוק');
  });
});
```

- [ ] **Step 2: Run, verify the FB-only test FAILS**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`
Expected: FAIL — the FB-only test fails because today `hasGa=false` hides BOTH פייסבוק and גוגל, so the header has no `פייסבוק`.

- [ ] **Step 3: Add the independent `hasFb` flag**

In `MonthBlockPerStore`, find (~389-393):

```tsx
  // detect if store has GA (any row with gaSpend > 0)
  const hasGa = rows.some(r => r.gaSpend > 0);
  // Phase 05.7.7 — show TikTok column only when at least one row in this
  // month/store has TikTok spend (currently uzoshop-only).
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
```

replace with:

```tsx
  // Per-platform column visibility — INDEPENDENT per platform: each column is
  // shown iff that platform spent > 0 this month (2026-06-01: previously
  // פייסבוק+גוגל were both gated by gaSpend, so a Facebook-only store hid both).
  const hasFb = rows.some(r => r.fbSpend > 0);
  const hasGa = rows.some(r => r.gaSpend > 0);
  // Phase 05.7.7 — show TikTok column only when at least one row in this
  // month/store has TikTok spend (currently uzoshop-only).
  const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
  const anyPlatform = hasFb || hasGa || hasTt;
```

- [ ] **Step 4: Key the Facebook column + label on the new flags**

In `MonthBlockPerStore`, make these four edits:

(a) Header — Facebook `<th>` (~434), change `{hasGa && <th ...>פייסבוק</th>}` to key on `hasFb`:

```tsx
                {hasFb && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
                {hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
```

(b) Header — total-spend label (~437), change `{hasGa ? 'יצא סה"כ' : 'יצא'}` to:

```tsx
                <th className="px-3 py-2 text-end font-medium">{anyPlatform ? 'יצא סה"כ' : 'יצא'}</th>
```

(c) Day-row — Facebook `<td>` (~452), change `{hasGa && <td ...>{r ? formatNumber(r.fbSpend) : ''}</td>}` to key on `hasFb`:

```tsx
                    {hasFb && <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.fbSpend) : ''}</td>}
                    {hasGa && <td className="px-3 py-1.5 text-end tabular-nums">{r ? formatNumber(r.gaSpend) : ''}</td>}
```

(d) Total-row — Facebook total `<td>` (~477), change `{hasGa && <td ...>{formatNumber(totalFb)}</td>}` (the FIRST of the two `hasGa` total cells) to key on `hasFb`:

```tsx
                {hasFb && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalFb)}</td>}
                {hasGa && <td className="px-3 py-2 text-end tabular-nums">{formatNumber(totalGa)}</td>}
```

- [ ] **Step 5: Run the per-store tests, verify they PASS**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx`
Expected: PASS (all 5 tests — 3 summary + 2 per-store).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/MonthlyTables.tsx dashboard-web/src/components/__tests__/monthlyTablesPerPlatform.dom.test.tsx
git commit -m "fix(monthly-tables): per-store platform columns are independent (Facebook-only store no longer hides its FB column)"
```

---

### Task 4: Full gates + docs

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (changelog entry + §6.2 MonthlyTables)

- [ ] **Step 1: Type-check**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Full unit + DOM suites**

Run: `cd dashboard-web && npx vitest run && npx vitest run --config vitest.config.dom.ts`
Expected: all green (no regressions; +5 new DOM tests).

- [ ] **Step 3: Lint + build**

Run: `cd dashboard-web && npx next lint && npm run build`
Expected: lint warnings-only (no new errors); build succeeds.

- [ ] **Step 4: Update the User Manual**

In `docs/ROAS-Dashboard-User-Manual.md`: bump the version block, add a "מה התחדש" entry describing the per-platform columns in the general summary + the per-store independent-column fix, and update §6.2 (MonthlyTables) to mention the general summary now carries per-platform spend columns. (The pre-push docs-currency gate requires the manual when UX files change.)

- [ ] **Step 5: Commit docs**

```bash
git add docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(manual): per-platform spend columns in monthly tables (general summary + per-store fix)"
```

- [ ] **Step 6: Deploy (single push)**

```bash
git push origin main
```
Expected: pre-push gates pass; Vercel builds. Then prod-verify the Analysis→History summary table shows the per-platform columns.

---

## Self-review (against the spec)

- **Per-platform columns shown iff spent that month** → Task 2 Step 3 (`hasFb/hasGa/hasTt` for summary), Task 3 Step 3 (per-store). ✅
- **Summary gets the columns (header/day/empty/total)** → Task 2 Steps 5-7. ✅
- **Per-store independent visibility (bug fix)** → Task 3 Steps 3-4. ✅
- **`יצא סה"כ` vs `יצא` label flip** → Task 2 Step 5, Task 3 Step 4(b). ✅
- **Revenue single column, CAD, mobile scroll (minWidth bump)** → Task 2 Step 5 (`minWidth={640}`); revenue/ROAS columns untouched. ✅
- **Tests: conditional columns, sums, bug-fix regression, label flip** → Task 2 Steps 1, Task 3 Step 1. ✅
- **Non-goals (no API/DB, no per-platform revenue, no ROAS-color change)** → no such changes in any task. ✅

Note on empty/zero days (spec test case 6): a shown platform's cell renders `formatNumber(value)` — so a 0-spend day shows `0`, and a no-row (empty) day shows `''` (blank), per the `agg ? ... : ''` / `r ? ... : ''` guards already in the cell code. This is covered structurally by the existing render guards (no separate test needed beyond the sum/visibility cases).
