# Refund-Visibility UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface refund activity on Home/Hero, ROAS trend chart, and P&L breakdown using a single shared "heavy refund day" heuristic — without touching any underlying number.

**Architecture:** New pure helper module `refundDayHeuristic.ts` exposes `isHeavyRefundDay(row)`, `sumRefundsInRange(rows)`, `heavyRefundDates(rows)`. Three existing components consume these helpers and render new visual elements (Hero chip + story sentence, ROAS chart dot ring + tooltip line, P&L cascade row). All reads of `DailyRow.refundDeduction` and `DailyRow.grossRevenue` (already exposed by `/api/data`); no API/DB/env changes.

**Tech Stack:** Next.js 15, TypeScript, React, Recharts (existing), vitest ^2.1.

**Branch:** `refund-visibility-ux-2026-05-28` (already created; spec already committed there at `9c22626`).

**Spec:** `docs/superpowers/specs/2026-05-28-refund-visibility-ux-design.md`.

**Heuristic constants (locked):**
- `HEAVY_REFUND_PCT_THRESHOLD = 0.20` (20% of gross)
- `HEAVY_REFUND_ABS_THRESHOLD = 500` ($500 CAD)
- Day qualifies if `refundDeduction ≥ 20% × grossRevenue` **OR** `refundDeduction ≥ $500`.

**Color (locked):** amber/gold. Inline classes `bg-amber-500/15 text-amber-300 border-amber-400/30` (matches existing `RefundIndicator` palette).

**Icon (locked):** `RotateCcw` from `lucide-react` (already imported by `RefundIndicator.tsx` for the same concept).

---

## File structure

**Created:**
- `dashboard-web/src/lib/refundDayHeuristic.ts` — three pure helpers + threshold constants.
- `dashboard-web/src/lib/__tests__/refundDayHeuristic.test.ts` — golden + edge tests.
- `dashboard-web/src/components/__tests__/heroRefundStrings.test.ts` — source-string locks for Hero chip + story.
- `dashboard-web/src/components/__tests__/pnlRefundStrings.test.ts` — source-string locks for P&L line.

**Modified:**
- `dashboard-web/src/components/HeroOverview.tsx` — adds amber chip below revenue tile + appends a refund-clause to the story sentence.
- `dashboard-web/src/components/RoasChart.tsx` — replaces `dot={false}` with a function-renderer that draws an amber ring on heavy-refund days; tooltip body appends a refund line.
- `dashboard-web/src/components/PnLBreakdown.tsx` — inserts a new `<PnLLine label="החזרים בתקופה" ...>` between "הכנסות" and "הוצאות פרסום"; updates the "הכנסות" note to remove the stale `current_total_price` reference and add `(נטו)` suffix.
- `docs/ARCHITECTURE.md` — adds a one-paragraph note under the existing §14.7 cross-day-refund section pointing to the three new surfaces.
- `docs/ROAS-Dashboard-User-Manual.md` — adds a short subsection explaining "יום רפאנד כבד" and how to read the new chip/marker/line.

**Not touched (intentional — zero math change):**
- `dashboard-web/src/lib/analytics.ts` (Aggregate type unchanged)
- `dashboard-web/src/lib/shopifyRevenueRefunds.ts` (algorithm unchanged)
- `dashboard-web/src/lib/postgresReaders.ts` (read path unchanged)
- All API routes.

---

## Task 1: Helper module `refundDayHeuristic.ts` (TDD)

**Files:**
- Create: `dashboard-web/src/lib/refundDayHeuristic.ts`
- Test:   `dashboard-web/src/lib/__tests__/refundDayHeuristic.test.ts`

- [ ] **Step 1: Write the failing tests** at `dashboard-web/src/lib/__tests__/refundDayHeuristic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  HEAVY_REFUND_PCT_THRESHOLD,
  HEAVY_REFUND_ABS_THRESHOLD,
  isHeavyRefundDay,
  sumRefundsInRange,
  heavyRefundDates,
} from '../refundDayHeuristic';
import type { DailyRow } from '../types';

function row(over: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-01',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0,
    revenue: 0, roas: 0, grossProfit: 0, cogs: 0, netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
    ...over,
  };
}

describe('thresholds', () => {
  it('expose locked constants', () => {
    expect(HEAVY_REFUND_PCT_THRESHOLD).toBe(0.20);
    expect(HEAVY_REFUND_ABS_THRESHOLD).toBe(500);
  });
});

describe('isHeavyRefundDay', () => {
  it('false when refundDeduction is null/0', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: null, grossRevenue: 1000 }))).toBe(false);
    expect(isHeavyRefundDay(row({ refundDeduction: 0, grossRevenue: 1000 }))).toBe(false);
  });
  it('true at exactly 20% of gross', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 200, grossRevenue: 1000 }))).toBe(true);
  });
  it('false just below 20% (and absolute < $500)', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 199, grossRevenue: 1000 }))).toBe(false);
  });
  it('true at exactly $500 even when pct is tiny', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 500, grossRevenue: 100000 }))).toBe(true);
  });
  it('true at $499.99 with high pct, true at $500 with low pct — OR semantics', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 499.99, grossRevenue: 2000 }))).toBe(true); // 25% > 20%
    expect(isHeavyRefundDay(row({ refundDeduction: 500, grossRevenue: 50000 }))).toBe(true);   // abs ≥ 500
  });
  it('falls back to revenue+refundDeduction when grossRevenue is null (legacy row)', () => {
    // Legacy row: grossRevenue null, revenue=800, refundDeduction=200.
    // Effective gross = 800 + 200 = 1000. Pct = 200/1000 = 20% → heavy.
    expect(isHeavyRefundDay(row({ refundDeduction: 200, revenue: 800, grossRevenue: null }))).toBe(true);
  });
  it('false when both grossRevenue and revenue are 0 (no signal)', () => {
    expect(isHeavyRefundDay(row({ refundDeduction: 1, revenue: 0, grossRevenue: null }))).toBe(false);
    // ... unless abs threshold fires:
    expect(isHeavyRefundDay(row({ refundDeduction: 500, revenue: 0, grossRevenue: null }))).toBe(true);
  });
});

describe('sumRefundsInRange', () => {
  it('returns 0 for empty input', () => {
    expect(sumRefundsInRange([])).toBe(0);
  });
  it('sums refundDeduction, treating null as 0', () => {
    const rows = [
      row({ refundDeduction: 100 }),
      row({ refundDeduction: null }),
      row({ refundDeduction: 250.5 }),
    ];
    expect(sumRefundsInRange(rows)).toBe(350.5);
  });
});

describe('heavyRefundDates', () => {
  it('returns sorted unique dates of heavy days only', () => {
    const rows = [
      row({ date: '2026-05-20', refundDeduction: 1000, grossRevenue: 2000 }),  // heavy
      row({ date: '2026-05-05', refundDeduction: 50,   grossRevenue: 1000 }),  // not heavy
      row({ date: '2026-05-12', refundDeduction: 600,  grossRevenue: 10000 }), // heavy (abs)
      row({ date: '2026-05-20', refundDeduction: 100,  grossRevenue: 1000 }),  // same date, second store — still heavy on aggregate
    ];
    const dates = heavyRefundDates(rows);
    expect(dates).toEqual(['2026-05-12', '2026-05-20']);
  });
  it('returns [] when nothing is heavy', () => {
    expect(heavyRefundDates([row({ refundDeduction: 10, grossRevenue: 1000 })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/refundDayHeuristic.test.ts
```
Expected: FAIL — cannot resolve `../refundDayHeuristic`.

- [ ] **Step 3: Implement** at `dashboard-web/src/lib/refundDayHeuristic.ts`:

```ts
// dashboard-web/src/lib/refundDayHeuristic.ts
//
// Pure helpers for the refund-visibility UX feature (spec
// 2026-05-28-refund-visibility-ux-design.md). Single source of truth for the
// "heavy refund day" threshold so HeroOverview, RoasChart and PnLBreakdown
// stay in lockstep.

import type { DailyRow } from './types';

/** A day qualifies as "heavy refund" if refunds reach this fraction of gross. */
export const HEAVY_REFUND_PCT_THRESHOLD = 0.20;

/** ...OR if absolute refund amount reaches this CAD floor. */
export const HEAVY_REFUND_ABS_THRESHOLD = 500;

/**
 * True iff the day's refunds are material enough to surface with the
 * amber chip / dot ring / story sentence.
 *
 * Triggers on EITHER refundDeduction ≥ 20% × gross OR refundDeduction ≥ $500.
 * The OR semantics catch two distinct cases: (a) high-percent refund days
 * even when totals are small, and (b) very large absolute refunds (the
 * 2026-05-20 uzoshop case) that drown out everything else on the chart
 * regardless of the day's gross.
 *
 * Legacy fallback: when grossRevenue is null (rows pre-Phase 05.7.3), uses
 * revenue + refundDeduction as the effective gross. Returns false when both
 * are zero — no signal, no heuristic.
 */
export function isHeavyRefundDay(row: DailyRow): boolean {
  const refund = row.refundDeduction ?? 0;
  if (refund <= 0) return false;
  if (refund >= HEAVY_REFUND_ABS_THRESHOLD) return true;
  const gross = row.grossRevenue ?? (row.revenue + refund);
  if (gross <= 0) return false;
  return refund / gross >= HEAVY_REFUND_PCT_THRESHOLD;
}

/**
 * Sum of refundDeduction across the rows the caller passes in. The caller
 * is responsible for filtering by store / date range first — this helper
 * does not enforce scope.
 */
export function sumRefundsInRange(rows: readonly DailyRow[]): number {
  return rows.reduce((acc, r) => acc + (r.refundDeduction ?? 0), 0);
}

/**
 * Sorted, deduplicated list of date strings (YYYY-MM-DD) where at least
 * one row qualifies as a heavy refund day. Multiple rows on the same
 * date (e.g. multi-store filter set to "All") collapse to one entry.
 */
export function heavyRefundDates(rows: readonly DailyRow[]): string[] {
  const dates = new Set<string>();
  for (const r of rows) {
    if (isHeavyRefundDay(r)) dates.add(r.date);
  }
  return Array.from(dates).sort();
}
```

- [ ] **Step 4: Run, confirm all tests PASS**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/refundDayHeuristic.test.ts
```
Expected: 13 tests pass.

- [ ] **Step 5: Type check**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit
```
Expected: clean (no output).

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/lib/refundDayHeuristic.ts dashboard-web/src/lib/__tests__/refundDayHeuristic.test.ts && git commit -m "feat(refund-ux): pure helpers — isHeavyRefundDay + sumRefundsInRange + heavyRefundDates"
```

---

## Task 2: Hero chip + story-sentence clause

**Files:**
- Modify: `dashboard-web/src/components/HeroOverview.tsx`
- Test:   `dashboard-web/src/components/__tests__/heroRefundStrings.test.ts`

- [ ] **Step 1: Write failing source-string test** at `dashboard-web/src/components/__tests__/heroRefundStrings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Source-string lock for the refund-visibility UX strings in HeroOverview.
// The project does not run @testing-library/react render tests broadly, so
// these grep-style locks catch accidental string drift.
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../HeroOverview.tsx'),
  'utf8',
);

describe('HeroOverview — refund-visibility strings', () => {
  it('imports the refund heuristic helpers', () => {
    expect(SRC).toMatch(/from\s+['"]@\/lib\/refundDayHeuristic['"]/);
    expect(SRC).toMatch(/isHeavyRefundDay|heavyRefundDates|sumRefundsInRange/);
  });
  it('renders the chip text "יום רפאנד כבד" when there is exactly one heavy day', () => {
    expect(SRC).toMatch(/יום רפאנד כבד/);
  });
  it('renders the multi-day chip pattern "ימי רפאנד כבדים"', () => {
    expect(SRC).toMatch(/ימי רפאנד כבדים/);
  });
  it('appends a refund clause to the story when sumRefundsInRange > 0', () => {
    expect(SRC).toMatch(/החזרים מעובדים/);
  });
  it('uses the amber palette (matches existing RefundIndicator)', () => {
    expect(SRC).toMatch(/amber-/);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/components/__tests__/heroRefundStrings.test.ts
```
Expected: 5 tests fail — none of the strings yet exist.

- [ ] **Step 3: Implement in HeroOverview.tsx**

(a) Add the import block (top of file, alongside other `@/lib` imports):

```ts
import { isHeavyRefundDay, sumRefundsInRange, heavyRefundDates } from '@/lib/refundDayHeuristic';
```

(b) Inside the existing `useMemo(() => { ... }, [...])` that computes `story / kpis / chartData` (currently around line 159), compute the new derived values from `rows` (the scoped, store-filtered rows the memo already has access to). Add right before `return { story, kpis, chartData };`:

```ts
    // === Refund-visibility derivations (Phase: refund-visibility UX) ===
    // Heuristic-driven; uses existing DailyRow.refundDeduction/grossRevenue.
    const heavyDates = heavyRefundDates(rows);
    const refundsTotal = sumRefundsInRange(rows);

    // Story clause: only appended when refunds occurred at all this period.
    if (refundsTotal > 0) {
      const refundStr = `CAD ${Math.round(refundsTotal).toLocaleString('he-IL')}`;
      if (heavyDates.length === 1) {
        story += ` מתוך הירידה, כ-${refundStr} הם החזרים מעובדים ב-${formatDateHe(heavyDates[0])}.`;
      } else if (heavyDates.length > 1) {
        story += ` מתוך הירידה, ${refundStr} בהחזרים מעובדים על פני ${heavyDates.length} ימים בתקופה.`;
      } else {
        // Refunds exist but no day passes "heavy" — surface the total anyway.
        story += ` (כולל ${refundStr} בהחזרים מעובדים בתקופה.)`;
      }
    }
```

Where `formatDateHe(d)` is the same `formatDate` helper the component already imports from `@/lib/format` (e.g. "20/5"). If the existing import is named differently, use it as-is — do NOT introduce a second formatter.

(c) Expose `heavyDates` + `refundsTotal` on the memo return alongside `story / kpis / chartData`:

```ts
    return { story, kpis, chartData, heavyDates, refundsTotal };
```

(d) Destructure them at the call site (currently `const { story, kpis, chartData } = useMemo(...)`):

```ts
const { story, kpis, chartData, heavyDates, refundsTotal } = useMemo(...);
```

(e) Render the chip inside the revenue tile (find the existing `<HeroStat label="הכנסות" ...>` JSX block; the chip goes immediately after that opening tag's content, as a sibling under the same tile container). The exact JSX (uses Tailwind classes already present in the project):

```tsx
{heavyDates.length > 0 && (
  <div
    className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/30 px-2 py-0.5 text-xs text-amber-300 font-medium"
    title={`${heavyDates.length} ימי החזרים בתקופה — ${heavyDates.join(', ')}`}
  >
    <RotateCcw className="h-3 w-3" aria-hidden="true" />
    {heavyDates.length === 1
      ? `יום רפאנד כבד (${formatDateHe(heavyDates[0])})`
      : `${heavyDates.length} ימי רפאנד כבדים`}
  </div>
)}
```

Add the `RotateCcw` import from `lucide-react` if not already present:

```ts
import { RotateCcw } from 'lucide-react';
```

(f) When `heavyDates.length === 0` AND `refundsTotal === 0`, NOTHING new renders. Verified by JSX guard above + the `if (refundsTotal > 0)` guard in the story clause.

- [ ] **Step 4: Run targeted test → PASS**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/components/__tests__/heroRefundStrings.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npm test 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | tail -3
```
Expected: all tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/components/HeroOverview.tsx dashboard-web/src/components/__tests__/heroRefundStrings.test.ts && git commit -m "feat(refund-ux): Hero — amber chip for heavy refund days + story-sentence refund clause"
```

---

## Task 3: ROAS chart — amber dot ring + tooltip refund line

**Files:**
- Modify: `dashboard-web/src/components/RoasChart.tsx`

This task has no separate source-string test — the visual behavior is fully exercised by the Hero test (which loads the same helpers) and the unit tests on the helpers. The chart rendering is a behavioral integration that the project's existing test infrastructure cannot meaningfully cover without `@testing-library/react`. A live verification step is included instead (Task 6 final-pass).

- [ ] **Step 1: Add helper import** at the top of `RoasChart.tsx`:

```ts
import { isHeavyRefundDay } from '@/lib/refundDayHeuristic';
import type { DailyRow } from '@/lib/types';
```

- [ ] **Step 2: Build a date→row map from the rows the component already receives**

Inside the existing component body, near where `chartData` is computed (find the `useMemo` that produces `chartData` for the chart), add:

```ts
// Build a quick (date, store) → row lookup for the heavy-refund heuristic.
// rows is the same filtered/scoped row list the chart already consumes.
const refundDayKeys = useMemo(() => {
  const set = new Set<string>(); // "YYYY-MM-DD|storeName"
  for (const r of rows as DailyRow[]) {
    if (isHeavyRefundDay(r)) set.add(`${r.date}|${r.storeName}`);
  }
  return set;
}, [rows]);
```

Replace `rows` with whatever the component's actual variable name is (peek at the existing `useMemo` deps to confirm — likely `data.rows` or a prop).

- [ ] **Step 3: Replace `dot={false}` on the per-store `<Line>` with a function-renderer**

The existing `<Line ... dot={false} ... />` (around line 139) becomes:

```tsx
<Line
  key={store}
  dataKey={store}
  stroke={storeColor(store)}
  strokeWidth={isPrimary ? 2.5 : 1.5}
  dot={(props: { cx?: number; cy?: number; payload?: { date?: string } }) => {
    const date = props.payload?.date;
    if (!date || props.cx == null || props.cy == null) return <g />;
    const isHeavy = refundDayKeys.has(`${date}|${store}`);
    if (!isHeavy) return <g />; // Default: no dot (matches prior behavior).
    return (
      <g>
        <circle cx={props.cx} cy={props.cy} r={5} fill={storeColor(store)} />
        <circle
          cx={props.cx}
          cy={props.cy}
          r={8}
          fill="transparent"
          stroke="rgb(245, 158, 11)" /* amber-500 */
          strokeWidth={2}
        />
      </g>
    );
  }}
  activeDot={{ r: isPrimary ? 5 : 4, strokeWidth: 0 }}
  // ... preserve any other existing props (animationDuration, etc.)
/>
```

The returned `<g />` (empty group) for non-heavy days reproduces the prior `dot={false}` behavior. Recharts requires a renderable element here — returning `null` triggers a React warning.

- [ ] **Step 4: Extend the tooltip body**

In the existing `<Tooltip content={({ active, payload }) => { ... }}>` block (around line 88), after the loop that renders per-store entries, insert (right before the closing tooltip container):

```tsx
{(() => {
  const date = payload[0].payload.date as string;
  // Collapse refunds across all stores rendered on this tooltip date.
  let refundSum = 0;
  let anyHeavy = false;
  for (const entry of payload) {
    const store = entry.dataKey as string;
    const row = (rows as DailyRow[]).find(r => r.date === date && r.storeName === store);
    if (row?.refundDeduction) refundSum += row.refundDeduction;
    if (row && isHeavyRefundDay(row)) anyHeavy = true;
  }
  if (!anyHeavy || refundSum <= 0) return null;
  return (
    <div className="mt-1 pt-1 border-t border-amber-400/30 text-xs text-amber-300">
      ↩ יום רפאנד כבד — החזרים: -CAD {Math.round(refundSum).toLocaleString('he-IL')}. ה-ROAS משקף את הנטו.
    </div>
  );
})()}
```

Reuse the same `rows` reference the chart already has — do NOT re-derive from a different source (would risk drift).

- [ ] **Step 5: Verify rendering compiles**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Full test suite still green**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npm test 2>&1 | tail -5
```
Expected: all pass (no new test file in this task; existing tests must not regress).

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/components/RoasChart.tsx && git commit -m "feat(refund-ux): ROAS chart — amber ring on heavy refund days + tooltip refund line"
```

---

## Task 4: P&L — new "החזרים בתקופה" row + revenue note update

**Files:**
- Modify: `dashboard-web/src/components/PnLBreakdown.tsx`
- Test:   `dashboard-web/src/components/__tests__/pnlRefundStrings.test.ts`

- [ ] **Step 1: Write failing source-string test** at `dashboard-web/src/components/__tests__/pnlRefundStrings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../PnLBreakdown.tsx'),
  'utf8',
);

describe('PnLBreakdown — refund-visibility strings', () => {
  it('imports sumRefundsInRange from the heuristic module', () => {
    expect(SRC).toMatch(/from\s+['"]@\/lib\/refundDayHeuristic['"]/);
    expect(SRC).toMatch(/sumRefundsInRange/);
  });
  it('renders the new label "החזרים בתקופה"', () => {
    expect(SRC).toMatch(/החזרים בתקופה/);
  });
  it('renders the explanatory note that this is presentational only', () => {
    expect(SRC).toMatch(/כבר מנוכים מההכנסות/);
  });
  it('marks the revenue row label with (נטו)', () => {
    expect(SRC).toMatch(/הכנסות.*\(נטו\)/);
  });
  it('removes the stale current_total_price reference from the revenue note', () => {
    expect(SRC).not.toMatch(/current_total_price/);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/components/__tests__/pnlRefundStrings.test.ts
```
Expected: 5 tests fail.

- [ ] **Step 3: Implement**

(a) Add import at the top of `PnLBreakdown.tsx`:

```ts
import { sumRefundsInRange } from '@/lib/refundDayHeuristic';
```

(b) Compute the per-store-scoped refund total. The component already has access to `current` (scoped Aggregate) and the raw rows that fed it. Find the variable holding the raw rows (likely `rows` or a memo-derived `scopedRows`). Add right before the `<ol>` cascade (around line 220):

```tsx
const refundTotalInPeriod = sumRefundsInRange(scopedRows);
```

If the local variable name is different, use it. If the rows are not currently passed in, thread them: PnLBreakdown receives `data.rows` from Dashboard.tsx already (verify via the call site); if not, add it as a prop. Do NOT re-fetch.

(c) Update the existing revenue `<PnLLine>` (around line 222):

Before (current):
```tsx
<PnLLine
  label="הכנסות"
  amount={revenue}
  pct={100}
  tone="positive"
  note="כולל החזרות שכבר מוקזזות (current_total_price)"
  running={revenue}
/>
```

After:
```tsx
<PnLLine
  label="הכנסות (נטו)"
  amount={revenue}
  pct={100}
  tone="positive"
  note="נטו אחרי החזרים — הברוטו לפני החזרים מוצג בשורה הבאה"
  running={revenue}
/>
```

(d) Immediately AFTER the revenue line and BEFORE the "הוצאות פרסום" line, insert the new refund-deduction line (conditional — render only when there are refunds in the period):

```tsx
{refundTotalInPeriod > 0 && (
  <PnLLine
    label="החזרים בתקופה"
    amount={-refundTotalInPeriod}
    pct={revenue > 0 ? -(refundTotalInPeriod / revenue) * 100 : 0}
    tone="cost"
    note="כבר מנוכים מההכנסות מעל — מוצג להבהרה"
    running={revenue}
  />
)}
```

Key decisions encoded:
- `running={revenue}` (NOT `revenue - refundTotalInPeriod`) — the line is presentational; the cascade's running total must continue from net revenue, exactly as before. This guarantees zero math change.
- Conditional on `> 0` so days/periods without refunds render no row.

- [ ] **Step 4: Run targeted test → PASS**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/components/__tests__/pnlRefundStrings.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npm test 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | tail -3
```
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas && git add dashboard-web/src/components/PnLBreakdown.tsx dashboard-web/src/components/__tests__/pnlRefundStrings.test.ts && git commit -m "feat(refund-ux): P&L — החזרים בתקופה row + revenue (נטו) clarification"
```

---

## Task 5: Docs update + merge + live verify

**Files:**
- Modify: `docs/ARCHITECTURE.md` — append a paragraph under the existing cross-day-refund section pointing to the three new surfaces.
- Modify: `docs/ROAS-Dashboard-User-Manual.md` — add a short subsection explaining the new UI elements to operators.

- [ ] **Step 1: ARCHITECTURE.md update**

Find the existing cross-day-refund section (§14.7 per the existing audit). Append:

```markdown
### Surfaces (Phase: refund-visibility UX — 2026-05-28)

The cross-day-refund algorithm has been correct since Phase 05.2.3.0, but until
this phase the operator could only see the result on Detail / Monthly tables
via `RefundIndicator`. The refund-visibility UX adds three additional surfaces,
all reading the already-exposed `DailyRow.refundDeduction` + `grossRevenue`:

- **`HeroOverview.tsx`** — amber chip below the revenue tile when ≥1 heavy-refund
  day exists in the selected range; story-sentence clause when any refunds exist
  at all.
- **`RoasChart.tsx`** — amber ring drawn around the line's dot on heavy-refund
  dates; tooltip body extended with the refund total for that date.
- **`PnLBreakdown.tsx`** — new "החזרים בתקופה" cascade row between revenue (now
  labelled `הכנסות (נטו)`) and ad-spend, presentational only; running total is
  unchanged.

Single threshold (`refundDeduction ≥ 20% × grossRevenue` OR `≥ $500`) lives in
`src/lib/refundDayHeuristic.ts` to keep the three surfaces in lockstep.
```

- [ ] **Step 2: User Manual update**

Append a short subsection near the existing P&L / Hero documentation:

```markdown
### יום החזרים כבד — חיווי חדש

הדשבורד מסמן אוטומטית ימים שבהם החזרים תפסו ≥20% מהברוטו או ≥$500 CAD. תראה את זה ב-3 מקומות:

- **בכרטיסיית "היום" / Hero** — תווית כתומה ↩ "יום רפאנד כבד (DD/M)" מתחת לערך ההכנסות, ומשפט סיפור שמסביר כמה $ של החזרים מעובדים בתקופה.
- **בגרף ROAS (טאב ניתוח)** — נקודה עם טבעת כתומה ביום כזה; ריחוף מציג את סכום ההחזרים.
- **ב-P&L** — שורה "החזרים בתקופה" מציגה את הסכום הכולל, עם הערה "כבר מנוכים מההכנסות מעל — מוצג להבהרה". הרווח הסופי לא משתנה — זו רק שקיפות.

הכל מבוסס על הנתון `refundDeduction` שנכתב ב-`data_daily` ע"י cron-daily לפי `processed_at` של ה-refund (לא לפי תאריך ההזמנה המקורית). ימים שלא עומדים בסף לא מוצגים בכלל — אפס בלגן בימים נורמליים.
```

- [ ] **Step 3: Commit docs**

```bash
cd /Users/dorperetz/script-roas && git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md && git commit -m "docs(refund-ux): ARCHITECTURE §14.7 surfaces note + User Manual operator section"
```

- [ ] **Step 4: Final tsc + full suite**

```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit && npm test 2>&1 | tail -5
```
Expected: clean, all tests green.

- [ ] **Step 5: Merge branch to main + push**

```bash
cd /Users/dorperetz/script-roas && git checkout main && git merge --no-ff refund-visibility-ux-2026-05-28 -m "merge: refund-visibility UX (Hero chip+story, ROAS marker, P&L line)" && git push origin main
```
Expected: pre-push gates pass (tsc + vitest + docs-currency — already updated above).

- [ ] **Step 6: Live verification — wait for Vercel deploy then open prod**

```bash
# Wait for new code: a Hero rendered on prod for a range including 2026-05-20
# should now contain the refund chip. Poll the HTML for the literal string.
for i in $(seq 1 12); do
  if curl -s --max-time 15 "https://roas-dashboard-smoky.vercel.app/" | grep -q "יום רפאנד"; then
    echo "DEPLOY LIVE @ ~$((i*15))s"; break;
  fi
  sleep 15
done
```
Expected: the loop exits within ~3 min with "DEPLOY LIVE".

Then manually:
1. Open `https://roas-dashboard-smoky.vercel.app/` in a browser.
2. Set date range to include 2026-05-20 (e.g. 2026-05-15 → 2026-05-26).
3. Confirm: amber chip "↩ יום רפאנד כבד (20/5)" below revenue, story sentence mentions refunds, ROAS chart 20/5 dot has amber ring, P&L cascade shows "החזרים בתקופה" row with negative amount.
4. Switch range to a refund-free window (e.g. last 3 days only): confirm NONE of the new UI appears.

---

## Self-review (run before declaring complete)

**1. Spec coverage check:**
- Spec §Architecture → Task 1 ✓
- Spec §HeroOverview chip + story → Task 2 ✓
- Spec §RoasChart marker + tooltip → Task 3 ✓
- Spec §PnLBreakdown line + revenue label → Task 4 ✓
- Spec §Threshold constants → Task 1 exposes them ✓
- Spec §Empty-period zero clutter → enforced via `> 0` guards in Tasks 2/3/4 ✓
- Spec §No-math-change → No aggregate.ts / shopifyRevenueRefunds.ts / postgresReaders.ts touched ✓
- Spec §Testing → unit (Task 1) + source-string (Tasks 2,4) + live verify (Task 5) ✓
- Spec §Out-of-scope items (hourly attribution, KPI tile chip, algorithm changes) → none included ✓

**2. Placeholder scan:** No "TBD" / "fill in details" / "similar to Task N" / unspecified error handling. All code blocks complete.

**3. Type consistency:** `isHeavyRefundDay(row: DailyRow): boolean`, `sumRefundsInRange(rows: readonly DailyRow[]): number`, `heavyRefundDates(rows: readonly DailyRow[]): string[]` — used identically in Tasks 2, 3, 4. Constants `HEAVY_REFUND_PCT_THRESHOLD = 0.20` and `HEAVY_REFUND_ABS_THRESHOLD = 500` defined in Task 1 step 3, asserted in Task 1 step 1 test. JSX classes (`bg-amber-500/15 border-amber-400/30 text-amber-300`) repeated identically across Tasks 2 + 3.
