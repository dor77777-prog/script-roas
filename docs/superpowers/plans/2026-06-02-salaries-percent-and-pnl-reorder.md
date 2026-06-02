# Dynamic salaries % + P&L tab reorder — TDD implementation plan

**Date:** 2026-06-02
**Status:** Ready to execute (bite-sized, test-first).
**Source spec:** `docs/superpowers/specs/2026-06-02-salaries-percent-and-pnl-reorder-design.md` (implement EXACTLY).
**Approved mockup:** `docs/superpowers/mockups/2026-06-02-salaries-and-pnl-reorder/mockup.html` — UI tasks (T6, T8) must match it. No separate mockup gate.

> **CRITICAL SEQUENCING — read before starting.** This plan must be executed **ONLY AFTER** plan `docs/superpowers/plans/2026-06-02-plan-a-foundation-framing.md` is fully merged. Plan A *also* edits `src/components/PnLBreakdown.tsx` (its T11 COGS prose + T18 MER note) and `src/lib/analytics.ts`. Running concurrently would conflict. Every line reference to PnLBreakdown / analytics in this plan is **current intent as of 2026-06-02**; Plan A will have shifted exact line numbers and possibly the surrounding prose. Therefore **each task that touches `PnLBreakdown.tsx` or `analytics.ts` begins with a 1-minute inspect step** ("re-confirm the anchor text exists; if Plan A renamed/moved it, match the new text") before editing. Do not blindly trust the snippets below — they are anchors, not guarantees.

## Goal

Two P&L-tab changes that ship together:

1. **Dynamic salaries expense** — an editable salaries figure, per-month + retroactive (mirroring the editable-COGS feature), **business-level only**. Each month's value is EITHER a **% of revenue** OR a **fixed monthly CAD amount** (per-entry toggle); un-edited months use the default **7% (percent)**. It subtracts in **true net profit ONLY** — the analytics `trueNetProfit`, the new "משכורות" P&L cascade line, and every consumer that reads `trueNetProfit` (incl. the hero's "רווח נטו" featured card). It does **NOT** touch the hero **operating** profit (`revenue − adSpend − COGS`, computed separately in `lib/home/adapters.ts`).
2. **P&L tab reorder** — `GoalTracker → PnLBreakdown → editors (BillingSettings · CogsSettings · SalarySettings)`.

## Architecture

Mirror the proven editable-COGS pattern exactly:

- `src/lib/salarySettings.ts` — pure model + helpers + localStorage/cloud persistence. Shape:
  ```ts
  type SalaryEntry    = { kind: 'percent' | 'amount'; value: number };
  type SalarySettings = { v: number; default: SalaryEntry; byMonth: Record<string /*YYYY-MM*/, SalaryEntry> };
  const DEFAULT_SALARY: SalaryEntry = { kind: 'percent', value: 7 };
  ```
  Helpers: `effectiveSalaryEntry`, `applySalaryToScope` (4 apply-scopes, business-only), `salariesForRange`, `read/writeSalarySettings`. Dispatches a `roas-salary-changed` CustomEvent + `pushCloudKey`.
- `src/lib/hooks/useSalarySettings.ts` — reactive hook mirroring `useCogsSettings`.
- `src/components/SalarySettings.tsx` — panel mirroring `CogsSettings` (entry-mode toggle, default field, 4 apply-scopes, collapsible per-month timeline, double-count reminder note, business-only). Built to the 2026-06-01 readability standard (`<Money>`, tokens, light+dark).
- **Net wiring:** `aggregate()` gains an optional precomputed `salaries: number` arg, subtracted in `trueNetProfit` only (operating-profit path untouched). `Dashboard.tsx` computes `salariesForRange(salarySettings, cur, range)` and threads it into the `curAgg`/`prevAgg` calls (exactly how `revenueByStore` is threaded today), so the value flows to the hero net card, P&L synthesis, insights, AND `PnLBreakdown`. `PnLBreakdown` renders the new "משכורות" line from `current` (the aggregate already carries the deduction inside `trueNetProfit`); the new line is presentational over an aggregate field added in T5.
- **Reorder:** edit `Dashboard.tsx` `PnLTab` JSX order only.

**Salaries computation (`salariesForRange`)** — for each `YYYY-MM` month overlapping the range:
- `percent` → `value/100 × (Σ revenue of that month's rows that fall inside the range)`. Revenue-based, auto-prorates.
- `amount`  → `value × (days-of-that-month-inside-range ÷ days-in-that-month)`. Day-prorated (same idea as `prorateFixedCosts`/billing).

Sum across months = the range's salaries deduction.

**Why thread through `aggregate()` and not a separate row recompute:** salaries is a single business-level period total, not a per-row field (unlike COGS, which is per-row). Subtracting one precomputed number inside `trueNetProfit` keeps `aggregate()` pure and reaches every true-net consumer without touching the per-store/operating paths.

## Tech Stack

Next.js + TypeScript + Vitest. cwd for ALL test/build commands: `/Users/dorperetz/script-roas/dashboard-web`.
- Node tests: `npx vitest run <path>`
- DOM tests: `npx vitest run --config vitest.config.dom.ts <path>`
- Types: `npx tsc --noEmit`
- Tests import `{ describe, it, expect, vi }` (and `beforeEach`) from `'vitest'`.
- Commit body ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **NO `git push` in any task.** Commit only.

**CAPI note:** This feature is 100% local client-side compute (localStorage + cloud key sync). It has ZERO interaction with Meta/Google/TikTok CAPI, the pipeline, or any platform write path. No backend, migration, or cron change is involved.

For agentic workers: use superpowers:subagent-driven-development.

## Execution checkpoints

- [ ] Plan A (`2026-06-02-plan-a-foundation-framing.md`) confirmed merged to working branch before starting
- [ ] T1 — `salarySettings.ts` model + effective entry + read/write/persistence
- [ ] T2 — `salariesForRange` computation (percent / amount / mixed / proration / default)
- [ ] T3 — `applySalaryToScope` the 4 apply-scopes
- [ ] T4 — register `roas-dashboard:salary-settings` in cloudSync + `useSalarySettings` hook
- [ ] T5 — `aggregate()` optional `salaries` arg → subtract in `trueNetProfit` only
- [ ] T6 — `SalarySettings.tsx` panel (matches mockup)
- [ ] T7 — wire `salariesForRange` into `Dashboard.tsx` aggregates + `salaryTick`
- [ ] T8 — `PnLBreakdown.tsx` new "משכורות" cascade line + reorder `PnLTab`
- [ ] Manual verification checklist

## Files touched (map)

| File | Task(s) | New / Edit |
|---|---|---|
| `src/lib/salarySettings.ts` | T1, T2, T3 | NEW |
| `src/lib/__tests__/salarySettings.test.ts` | T1, T2, T3 | NEW |
| `src/lib/cloudSync.ts` | T4 | Edit (register key + event) |
| `src/lib/hooks/useSalarySettings.ts` | T4 | NEW |
| `src/lib/hooks/__tests__/useSalarySettings.dom.test.tsx` | T4 | NEW |
| `src/lib/analytics.ts` | T5 | Edit (optional `salaries` arg) |
| `src/lib/__tests__/analyticsSalaries.test.ts` | T5 | NEW |
| `src/components/SalarySettings.tsx` | T6 | NEW |
| `src/components/__tests__/SalarySettings.dom.test.tsx` | T6 | NEW |
| `src/components/Dashboard.tsx` | T7, T8 | Edit (thread salaries + tick; reorder PnLTab) |
| `src/components/PnLBreakdown.tsx` | T8 | Edit (new "משכורות" line) |
| `src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx` | T8 | NEW |

---

## Task T1 — salarySettings model + effective entry + persistence

**Files:**
- CREATE `src/lib/salarySettings.ts`
- CREATE `src/lib/__tests__/salarySettings.test.ts`

**Steps:**

1. Write the failing test file `src/lib/__tests__/salarySettings.test.ts`:

   ```ts
   import { describe, it, expect, beforeEach, vi } from 'vitest';
   import {
     DEFAULT_SALARY, SALARY_SETTINGS_KEY, SALARY_SETTINGS_EVENT,
     defaultSalarySettings, effectiveSalaryEntry,
     readSalarySettings, writeSalarySettings,
     type SalarySettings, type SalaryEntry,
   } from '@/lib/salarySettings';

   vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

   function fakeWindow() {
     const store = new Map<string, string>();
     const ls: Storage = {
       get length() { return store.size; }, clear: () => store.clear(),
       getItem: (k) => (store.has(k) ? store.get(k)! : null),
       key: (i) => Array.from(store.keys())[i] ?? null,
       removeItem: (k) => { store.delete(k); },
       setItem: (k, v) => { store.set(k, String(v)); },
     };
     return { localStorage: ls, dispatchEvent: () => true, CustomEvent: globalThis.CustomEvent ?? class extends Event {} } as unknown as typeof window;
   }
   beforeEach(() => { vi.stubGlobal('window', fakeWindow()); });

   describe('salarySettings — model + effectiveSalaryEntry', () => {
     it('default is business-level 7% percent', () => {
       const s = defaultSalarySettings();
       expect(s.default).toEqual({ kind: 'percent', value: 7 });
       expect(DEFAULT_SALARY).toEqual({ kind: 'percent', value: 7 });
       expect(s.byMonth).toEqual({});
     });

     it('effectiveSalaryEntry returns DEFAULT_SALARY when no override', () => {
       expect(effectiveSalaryEntry(defaultSalarySettings(), '2026-06')).toEqual({ kind: 'percent', value: 7 });
     });

     it('byMonth overrides default; percent OR amount entry', () => {
       const s: SalarySettings = { v: 1, default: { kind: 'percent', value: 7 }, byMonth: { '2026-05': { kind: 'amount', value: 8000 } } };
       expect(effectiveSalaryEntry(s, '2026-05')).toEqual({ kind: 'amount', value: 8000 }); // override
       expect(effectiveSalaryEntry(s, '2026-06')).toEqual({ kind: 'percent', value: 7 });   // default
     });

     it('read returns default when nothing stored; write round-trips + bumps cloud', async () => {
       expect(readSalarySettings()).toEqual(defaultSalarySettings());
       const next: SalarySettings = { ...defaultSalarySettings(), default: { kind: 'amount', value: 5000 } };
       writeSalarySettings(next);
       expect(JSON.parse(window.localStorage.getItem(SALARY_SETTINGS_KEY)!).default).toEqual({ kind: 'amount', value: 5000 });
       const { pushCloudKey } = await import('@/lib/cloudSync');
       expect(pushCloudKey).toHaveBeenCalledWith(SALARY_SETTINGS_KEY, expect.objectContaining({ default: { kind: 'amount', value: 5000 } }));
     });

     it('write dispatches the SALARY_SETTINGS_EVENT name (sanity on the constant)', () => {
       expect(SALARY_SETTINGS_EVENT).toBe('roas-salary-changed');
     });

     it('tolerates malformed JSON → default', () => {
       window.localStorage.setItem(SALARY_SETTINGS_KEY, '{not json');
       expect(readSalarySettings()).toEqual(defaultSalarySettings());
     });

     it('normalizes a malformed entry (missing kind / NaN value) back to a valid SalaryEntry', () => {
       window.localStorage.setItem(SALARY_SETTINGS_KEY, JSON.stringify({ v: 1, default: { kind: 'bogus', value: 'x' }, byMonth: { '2026-05': { kind: 'amount', value: 9000 } } }));
       const s = readSalarySettings();
       expect(s.default).toEqual({ kind: 'percent', value: 7 }); // bad default → DEFAULT_SALARY
       expect(s.byMonth['2026-05']).toEqual({ kind: 'amount', value: 9000 }); // valid kept
     });
   });
   ```

2. Run, expect FAIL (module not found):
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

3. Implement the minimal `src/lib/salarySettings.ts` (model + effective + read/write only — NO `salariesForRange`/`applySalaryToScope` yet; those are T2/T3):

   ```ts
   import { pushCloudKey } from './cloudSync';

   export type SalaryEntry = { kind: 'percent' | 'amount'; value: number };
   export interface SalarySettings {
     v: number;
     default: SalaryEntry;
     byMonth: Record<string, SalaryEntry>; // 'YYYY-MM' → entry
   }

   export const DEFAULT_SALARY: SalaryEntry = { kind: 'percent', value: 7 };
   export const SALARY_SETTINGS_KEY = 'roas-dashboard:salary-settings';
   export const SALARY_SETTINGS_VERSION = 1;
   export const SALARY_SETTINGS_EVENT = 'roas-salary-changed';

   export function defaultSalarySettings(): SalarySettings {
     return { v: SALARY_SETTINGS_VERSION, default: { ...DEFAULT_SALARY }, byMonth: {} };
   }

   /** byMonth[month] ?? default. */
   export function effectiveSalaryEntry(s: SalarySettings, month: string): SalaryEntry {
     return s.byMonth[month] ?? s.default ?? { ...DEFAULT_SALARY };
   }

   function normEntry(x: unknown): SalaryEntry | null {
     if (!x || typeof x !== 'object') return null;
     const o = x as Partial<SalaryEntry>;
     const kind = o.kind === 'amount' ? 'amount' : o.kind === 'percent' ? 'percent' : null;
     if (!kind) return null;
     if (typeof o.value !== 'number' || !Number.isFinite(o.value)) return null;
     return { kind, value: o.value };
   }

   export function readSalarySettings(): SalarySettings {
     if (typeof window === 'undefined') return defaultSalarySettings();
     try {
       const raw = window.localStorage.getItem(SALARY_SETTINGS_KEY);
       if (!raw) return defaultSalarySettings();
       const parsed = JSON.parse(raw) as Partial<SalarySettings>;
       if (!parsed || typeof parsed !== 'object') return defaultSalarySettings();
       const byMonth: Record<string, SalaryEntry> = {};
       if (parsed.byMonth && typeof parsed.byMonth === 'object') {
         for (const [k, v] of Object.entries(parsed.byMonth)) {
           const n = normEntry(v);
           if (n) byMonth[k] = n;
         }
       }
       return {
         v: SALARY_SETTINGS_VERSION,
         default: normEntry(parsed.default) ?? { ...DEFAULT_SALARY },
         byMonth,
       };
     } catch { return defaultSalarySettings(); }
   }

   export function writeSalarySettings(s: SalarySettings): void {
     if (typeof window === 'undefined') return;
     try {
       const versioned: SalarySettings = { ...s, v: SALARY_SETTINGS_VERSION };
       window.localStorage.setItem(SALARY_SETTINGS_KEY, JSON.stringify(versioned));
       window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(SALARY_SETTINGS_EVENT));
       pushCloudKey(SALARY_SETTINGS_KEY, versioned);
     } catch { /* quota / private mode — ignore */ }
   }
   ```

   > NOTE: `pushCloudKey`'s `StateKey` type does NOT yet include `'roas-dashboard:salary-settings'` (added in T4). `npx tsc --noEmit` in this task WILL error on the `pushCloudKey(SALARY_SETTINGS_KEY, ...)` line. That is expected — the vitest test mocks `cloudSync` so it passes. **Skip the `tsc` gate for T1; T4 registers the key and restores a green `tsc`.** Run tsc at the end of T4, not T1.

4. Run, expect PASS:
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

5. Commit: `feat(salaries): salarySettings model + effective entry + persistence (T1)`

---

## Task T2 — salariesForRange computation

**Files:**
- EDIT `src/lib/salarySettings.ts` (add `salariesForRange` + a `daysInMonth` helper)
- EDIT `src/lib/__tests__/salarySettings.test.ts` (append a describe block)

**Steps:**

1. Append the failing tests to `src/lib/__tests__/salarySettings.test.ts`:

   ```ts
   import { salariesForRange } from '@/lib/salarySettings';
   import type { DailyRow } from '@/lib/types';
   import type { DateRange } from '@/lib/types';

   function row(date: string, revenue: number): DailyRow {
     return {
       date, storeId: 'uzoshop', storeName: 'uzoshop',
       fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue,
       roas: 0, grossProfit: revenue, cogs: 0, netProfit: revenue,
       hasCogs: true, grossRevenue: null, refundDeduction: null,
       fbImpressions: null, gaImpressions: null, ttImpressions: null,
     };
   }

   describe('salariesForRange', () => {
     it('percent: value% × Σ revenue of that month inside the range', () => {
       const s: SalarySettings = { v: 1, default: { kind: 'percent', value: 7 }, byMonth: {} };
       const rows = [row('2026-06-01', 10000), row('2026-06-15', 5000)];
       const range: DateRange = { from: '2026-06-01', to: '2026-06-30' };
       expect(salariesForRange(s, rows, range)).toBeCloseTo(0.07 * 15000, 6); // 1050
     });

     it('percent only counts rows inside the range', () => {
       const s: SalarySettings = { v: 1, default: { kind: 'percent', value: 10 }, byMonth: {} };
       // a row outside the range is ignored even though its month overlaps
       const rows = [row('2026-06-10', 8000), row('2026-06-25', 2000)];
       const range: DateRange = { from: '2026-06-01', to: '2026-06-15' };
       expect(salariesForRange(s, rows, range)).toBeCloseTo(0.10 * 8000, 6); // only the in-range row → 800
     });

     it('amount: value × (days-of-month-in-range ÷ days-in-month)', () => {
       const s: SalarySettings = { v: 1, default: { kind: 'amount', value: 9000 }, byMonth: {} };
       const rows = [row('2026-06-10', 1)]; // a row is needed so the month is "in scope"
       // June has 30 days; range covers 15 of them → 9000 × 15/30 = 4500
       const range: DateRange = { from: '2026-06-01', to: '2026-06-15' };
       expect(salariesForRange(s, rows, range)).toBeCloseTo(9000 * (15 / 30), 6);
     });

     it('amount full month → full amount', () => {
       const s: SalarySettings = { v: 1, default: { kind: 'amount', value: 8000 }, byMonth: {} };
       const rows = [row('2026-02-14', 1)]; // Feb 2026 = 28 days
       const range: DateRange = { from: '2026-02-01', to: '2026-02-28' };
       expect(salariesForRange(s, rows, range)).toBeCloseTo(8000, 6);
     });

     it('mixed months: percent month + amount month summed', () => {
       const s: SalarySettings = {
         v: 1, default: { kind: 'percent', value: 7 },
         byMonth: { '2026-05': { kind: 'amount', value: 6000 } },
       };
       const rows = [row('2026-05-20', 4000), row('2026-06-05', 10000)];
       // May: amount, May has 31 days; range covers 2026-05-20..05-31 = 12 days → 6000 × 12/31
       // June: percent 7% × 10000 (only the in-range June row) = 700
       const range: DateRange = { from: '2026-05-20', to: '2026-06-30' };
       const may = 6000 * (12 / 31);
       const jun = 0.07 * 10000;
       expect(salariesForRange(s, rows, range)).toBeCloseTo(may + jun, 6);
     });

     it('default 7% reproduces the baseline when no months are edited', () => {
       const s = defaultSalarySettings();
       const rows = [row('2026-06-01', 20000)];
       const range: DateRange = { from: '2026-06-01', to: '2026-06-30' };
       expect(salariesForRange(s, rows, range)).toBeCloseTo(0.07 * 20000, 6); // 1400
     });

     it('empty rows → 0', () => {
       expect(salariesForRange(defaultSalarySettings(), [], { from: '2026-06-01', to: '2026-06-30' })).toBe(0);
     });
   });
   ```

2. Run, expect FAIL (`salariesForRange` is not exported):
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

3. Implement in `src/lib/salarySettings.ts`. Add imports at the top (`DailyRow`, `DateRange` from `./types`) and append:

   ```ts
   import type { DailyRow, DateRange } from './types';

   /** Calendar days in the month of a 'YYYY-MM' key (e.g. '2026-02' → 28). */
   function daysInMonth(month: string): number {
     const [y, m] = month.split('-').map(Number);
     if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
     return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
   }

   /** Count of days of `month` ('YYYY-MM') that fall within [range.from, range.to] inclusive. */
   function daysOfMonthInRange(month: string, range: DateRange): number {
     const total = daysInMonth(month);
     let count = 0;
     for (let d = 1; d <= total; d++) {
       const iso = `${month}-${String(d).padStart(2, '0')}`;
       if (iso >= range.from && iso <= range.to) count++;
     }
     return count;
   }

   /**
    * Salaries deduction for the selected range. For each YYYY-MM overlapping the
    * range:
    *   percent → value% × (Σ revenue of that month's rows that fall inside the range)
    *   amount  → value × (days-of-that-month-inside-range ÷ days-in-month)
    * Sum across months. Business-level only; no per-store split.
    */
   export function salariesForRange(s: SalarySettings, rows: readonly DailyRow[], range: DateRange): number {
     // Revenue per month, counting ONLY rows inside the range.
     const revByMonth = new Map<string, number>();
     // Track which months have any in-range row (so an amount-mode month only
     // bills when the business is actually active that month within the range).
     const monthsWithRows = new Set<string>();
     for (const r of rows) {
       if (r.date < range.from || r.date > range.to) continue;
       const m = r.date.slice(0, 7);
       monthsWithRows.add(m);
       revByMonth.set(m, (revByMonth.get(m) ?? 0) + r.revenue);
     }
     let total = 0;
     for (const m of monthsWithRows) {
       const entry = effectiveSalaryEntry(s, m);
       if (entry.kind === 'percent') {
         total += (entry.value / 100) * (revByMonth.get(m) ?? 0);
       } else {
         const dim = daysInMonth(m);
         total += dim > 0 ? entry.value * (daysOfMonthInRange(m, range) / dim) : 0;
       }
     }
     return total;
   }
   ```

4. Run, expect PASS:
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

5. (tsc still red on the cloudSync key — fixed in T4. Skip tsc gate here.)

6. Commit: `feat(salaries): salariesForRange — percent revenue-based + amount day-prorated (T2)`

---

## Task T3 — applySalaryToScope (the 4 apply-scopes)

**Files:**
- EDIT `src/lib/salarySettings.ts` (add `ApplyScope` type + `applySalaryToScope`)
- EDIT `src/lib/__tests__/salarySettings.test.ts` (append a describe block)

**Steps:**

1. Append the failing tests:

   ```ts
   import { applySalaryToScope, type SalaryApplyScope } from '@/lib/salarySettings';

   describe('applySalaryToScope — the 4 apply-scopes (business-only)', () => {
     const base = (): SalarySettings => ({
       v: 1, default: { kind: 'percent', value: 7 },
       byMonth: { '2026-04': { kind: 'amount', value: 5000 } },
     });
     const entry: SalaryEntry = { kind: 'percent', value: 10 };

     it('current → sets byMonth[current], leaves others + default', () => {
       const out = applySalaryToScope(base(), entry, { kind: 'current', currentMonth: '2026-06' }, ['2026-03','2026-04','2026-05','2026-06']);
       expect(out.byMonth['2026-06']).toEqual(entry);
       expect(out.byMonth['2026-04']).toEqual({ kind: 'amount', value: 5000 }); // untouched
       expect(out.default).toEqual({ kind: 'percent', value: 7 });
     });

     it('specific → sets byMonth[that]', () => {
       const out = applySalaryToScope(base(), entry, { kind: 'specific', month: '2026-05' }, ['2026-05','2026-06']);
       expect(out.byMonth['2026-05']).toEqual(entry);
     });

     it('all-previous → sets byMonth for every month < current present in months[]', () => {
       const out = applySalaryToScope(base(), entry, { kind: 'all-previous', currentMonth: '2026-06' }, ['2026-03','2026-04','2026-05','2026-06']);
       expect(out.byMonth['2026-03']).toEqual(entry);
       expect(out.byMonth['2026-04']).toEqual(entry);
       expect(out.byMonth['2026-05']).toEqual(entry);
       expect(out.byMonth['2026-06']).toBeUndefined(); // current excluded
     });

     it('everything → sets default + clears byMonth', () => {
       const out = applySalaryToScope(base(), entry, { kind: 'everything' }, ['2026-04','2026-06']);
       expect(out.default).toEqual(entry);
       expect(out.byMonth).toEqual({});
     });
   });
   ```

2. Run, expect FAIL:
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

3. Implement in `src/lib/salarySettings.ts` (append):

   ```ts
   export type SalaryApplyScope =
     | { kind: 'current'; currentMonth: string }
     | { kind: 'specific'; month: string }
     | { kind: 'all-previous'; currentMonth: string }
     | { kind: 'everything' };

   /**
    * Pure: produce a new SalarySettings with `entry` applied per the chosen
    * apply-scope. `monthsInData` = the 'YYYY-MM' candidates for 'all-previous'.
    */
   export function applySalaryToScope(
     s: SalarySettings, entry: SalaryEntry, apply: SalaryApplyScope, monthsInData: string[],
   ): SalarySettings {
     const byMonth = { ...s.byMonth };
     switch (apply.kind) {
       case 'current':  byMonth[apply.currentMonth] = entry; return { ...s, byMonth };
       case 'specific': byMonth[apply.month] = entry; return { ...s, byMonth };
       case 'all-previous':
         for (const m of monthsInData) if (m < apply.currentMonth) byMonth[m] = entry;
         return { ...s, byMonth };
       case 'everything': return { ...s, default: entry, byMonth: {} };
     }
   }
   ```

4. Run, expect PASS:
   `npx vitest run src/lib/__tests__/salarySettings.test.ts`

5. (tsc still red on cloudSync — fixed next in T4.)

6. Commit: `feat(salaries): applySalaryToScope — 4 business-level apply-scopes (T3)`

---

## Task T4 — register cloud key + useSalarySettings hook

**Files:**
- EDIT `src/lib/cloudSync.ts` (add the key to `STATE_KEYS` and `CHANGE_EVENTS`)
- CREATE `src/lib/hooks/useSalarySettings.ts`
- CREATE `src/lib/hooks/__tests__/useSalarySettings.dom.test.tsx`

**Steps:**

1. Write the failing hook DOM test `src/lib/hooks/__tests__/useSalarySettings.dom.test.tsx`:

   ```tsx
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { render, screen, fireEvent, act } from '@testing-library/react';
   import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
   import { readSalarySettings } from '@/lib/salarySettings';

   vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
   beforeEach(() => { window.localStorage.clear(); });

   function Harness() {
     const [settings, update] = useSalarySettings();
     return (
       <div>
         <span data-testid="kind">{settings.default.kind}</span>
         <span data-testid="value">{settings.default.value}</span>
         <button
           data-testid="set"
           onClick={() => update({ ...settings, default: { kind: 'amount', value: 8000 } })}
         >set</button>
       </div>
     );
   }

   describe('useSalarySettings', () => {
     it('reads the 7% percent default on first mount', () => {
       render(<Harness />);
       expect(screen.getByTestId('kind').textContent).toBe('percent');
       expect(screen.getByTestId('value').textContent).toBe('7');
     });

     it('update() persists to localStorage and re-renders the hook', () => {
       render(<Harness />);
       act(() => { fireEvent.click(screen.getByTestId('set')); });
       expect(screen.getByTestId('kind').textContent).toBe('amount');
       expect(screen.getByTestId('value').textContent).toBe('8000');
       expect(readSalarySettings().default).toEqual({ kind: 'amount', value: 8000 });
     });

     it('re-reads on a roas-salary-changed event dispatched by another component', () => {
       render(<Harness />);
       // simulate an external write + event (e.g. cloud hydrate or sibling panel)
       act(() => {
         window.localStorage.setItem('roas-dashboard:salary-settings', JSON.stringify({ v: 1, default: { kind: 'percent', value: 12 }, byMonth: {} }));
         window.dispatchEvent(new Event('roas-salary-changed'));
       });
       expect(screen.getByTestId('value').textContent).toBe('12');
     });
   });
   ```

2. Run, expect FAIL (hook missing):
   `npx vitest run --config vitest.config.dom.ts src/lib/hooks/__tests__/useSalarySettings.dom.test.tsx`

3. Register the cloud key in `src/lib/cloudSync.ts`. In the `STATE_KEYS` array (currently ends with `'roas-dashboard:cogs-settings',`) append:
   ```ts
     // Editable salaries % / amount (2026-06-02) — per-month, retroactive, business-level.
     'roas-dashboard:salary-settings',
   ```
   And in the `CHANGE_EVENTS` map (after the `'roas-dashboard:cogs-settings': 'roas-cogs-settings-changed',` entry) add:
   ```ts
     'roas-dashboard:salary-settings': 'roas-salary-changed',
   ```

4. Create the hook `src/lib/hooks/useSalarySettings.ts`:

   ```ts
   'use client';
   import { useEffect, useState, useCallback } from 'react';
   import {
     readSalarySettings, writeSalarySettings,
     SALARY_SETTINGS_EVENT, type SalarySettings,
   } from '@/lib/salarySettings';

   /** Reactive read of the salary settings: re-reads on same-tab edits + cloud hydrate. */
   export function useSalarySettings(): [SalarySettings, (next: SalarySettings) => void] {
     const [settings, setSettings] = useState<SalarySettings>(() => readSalarySettings());
     useEffect(() => {
       const reread = () => setSettings(readSalarySettings());
       window.addEventListener(SALARY_SETTINGS_EVENT, reread);
       window.addEventListener('storage', reread); // cross-device cloud sync writes localStorage
       return () => { window.removeEventListener(SALARY_SETTINGS_EVENT, reread); window.removeEventListener('storage', reread); };
     }, []);
     const update = useCallback((next: SalarySettings) => { writeSalarySettings(next); setSettings(next); }, []);
     return [settings, update];
   }
   ```

5. Run the hook test, expect PASS:
   `npx vitest run --config vitest.config.dom.ts src/lib/hooks/__tests__/useSalarySettings.dom.test.tsx`

6. Now the cloud key is registered → run the full salarySettings node test AND tsc, both expect PASS:
   - `npx vitest run src/lib/__tests__/salarySettings.test.ts`
   - `npx tsc --noEmit`

7. Commit: `feat(salaries): register cloud key + useSalarySettings reactive hook (T4)`

---

## Task T5 — aggregate() optional `salaries` arg → subtract in trueNetProfit only

**Files:**
- EDIT `src/lib/analytics.ts`
- CREATE `src/lib/__tests__/analyticsSalaries.test.ts`

> **Inspect step (Plan A overlap):** open `src/lib/analytics.ts` and re-confirm the `aggregate()` signature + the `const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts;` line still exists. Plan A touched this file; if the variable name or the surrounding return object changed, adapt the edit to match the current code (keep the SAME intent: subtract `salaries` in `trueNetProfit` only).

**Steps:**

1. Write the failing test `src/lib/__tests__/analyticsSalaries.test.ts`:

   ```ts
   import { describe, it, expect } from 'vitest';
   import { aggregate } from '@/lib/analytics';
   import type { DailyRow, DateRange } from '@/lib/types';

   function row(over: Partial<DailyRow>): DailyRow {
     const revenue = over.revenue ?? 10000;
     const totalSpend = over.totalSpend ?? 3000;
     return {
       date: '2026-06-15', storeId: 'uzoshop', storeName: 'uzoshop',
       fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend, revenue,
       roas: revenue / (totalSpend || 1), grossProfit: revenue - totalSpend,
       cogs: revenue * 0.25, netProfit: revenue - totalSpend - revenue * 0.25,
       hasCogs: true, grossRevenue: null, refundDeduction: null,
       fbImpressions: null, gaImpressions: null, ttImpressions: null, ...over,
     };
   }
   const range: DateRange = { from: '2026-06-01', to: '2026-06-30' };

   describe('aggregate — salaries subtract in trueNetProfit only', () => {
     it('omitting salaries reproduces the prior trueNetProfit (default 0)', () => {
       const a = aggregate([row({})], range);
       const b = aggregate([row({})], range, undefined, undefined, 0);
       expect(b.trueNetProfit).toBeCloseTo(a.trueNetProfit, 6);
     });

     it('a positive salaries arg lowers trueNetProfit by exactly that amount', () => {
       const base = aggregate([row({})], range);
       const withSal = aggregate([row({})], range, undefined, undefined, 1400);
       expect(withSal.trueNetProfit).toBeCloseTo(base.trueNetProfit - 1400, 6);
     });

     it('does NOT change operating-profit inputs: revenue, spend, cogs, netProfit (legacy) are untouched', () => {
       const base = aggregate([row({})], range);
       const withSal = aggregate([row({})], range, undefined, undefined, 1400);
       expect(withSal.revenue).toBe(base.revenue);
       expect(withSal.spend).toBe(base.spend);
       expect(withSal.cogs).toBeCloseTo(base.cogs, 6);
       expect(withSal.netProfit).toBeCloseTo(base.netProfit, 6); // legacy net (rev−spend−cogs) is the operating-profit proxy
       expect(withSal.grossProfit).toBeCloseTo(base.grossProfit, 6);
     });

     it('trueMargin reflects the salaries deduction', () => {
       const withSal = aggregate([row({ revenue: 10000 })], range, undefined, undefined, 700);
       expect(withSal.trueMargin).toBeCloseTo(withSal.trueNetProfit / 10000, 6);
     });
   });
   ```

2. Run, expect FAIL (5th positional arg not accepted / type error):
   `npx vitest run src/lib/__tests__/analyticsSalaries.test.ts`

3. Edit `src/lib/analytics.ts` `aggregate()`:
   - Add a 5th optional parameter after `revenueByStore?: Record<string, number>,`:
     ```ts
       /**
        * Phase 2026-06-02 — precomputed business-level salaries deduction for
        * this range (from `salariesForRange`). Subtracted in `trueNetProfit`
        * ONLY. The operating-profit path (revenue − spend − cogs, computed in
        * lib/home/adapters.ts) and the legacy `netProfit` field are untouched.
        * Defaults to 0 so every existing caller is unaffected.
        */
       salaries: number = 0,
     ```
   - Change the trueNetProfit line from:
     ```ts
     const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts;
     ```
     to:
     ```ts
     const trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts - salaries;
     ```
   - Add a `salaries` field to the `Aggregate` type (near `fixedCosts`) and to the returned object so PnLBreakdown can render the line in T8:
     - In the `Aggregate` type, after the `fixedCosts: number;` block add:
       ```ts
       /** Business-level salaries deduction for the period (CAD). Subtracted in
        *  trueNetProfit only; 0 when no salary settings are applied. */
       salaries: number;
       ```
     - In the returned object literal, after `fixedCosts,` add `salaries,`.

4. Run, expect PASS:
   `npx vitest run src/lib/__tests__/analyticsSalaries.test.ts`

5. tsc, expect PASS: `npx tsc --noEmit`

6. Commit: `feat(salaries): aggregate() subtracts precomputed salaries in trueNetProfit only (T5)`

---

## Task T6 — SalarySettings panel (matches mockup)

**Files:**
- CREATE `src/components/SalarySettings.tsx`
- CREATE `src/components/__tests__/SalarySettings.dom.test.tsx`

Mirror `CogsSettings.tsx` structure/classes. Differences per spec + mockup:
- Business-level ONLY (no mode toggle, no per-store fields).
- A per-entry **mode toggle**: `% מהמחזור` vs `סכום חודשי (CAD)` (drives the entry `kind`).
- One value field: prefix `%` in percent mode, prefix `CAD` in amount mode.
- 4 apply-scopes + "החל שינוי" button (same testids style as COGS, `sal-` prefix).
- Collapsed-by-default month timeline; rows show effective entry — percent as `N%`, amount as `<Money value=… />  / חודש`; `נערך` / `ברירת מחדל` badges.
- Double-count reminder note (the `note-box warn` from the mockup).
- Business-only note dot.
- Default-7% / retroactive / cloud-synced help line.

**Steps:**

1. Write the failing DOM test `src/components/__tests__/SalarySettings.dom.test.tsx`:

   ```tsx
   import { describe, it, expect, vi, beforeEach } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { SalarySettings } from '@/components/SalarySettings';
   import { readSalarySettings } from '@/lib/salarySettings';

   vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
   beforeEach(() => { window.localStorage.clear(); });

   describe('SalarySettings', () => {
     it('renders the default value field at 7 in percent mode', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
       expect((screen.getByTestId('salary-value-input') as HTMLInputElement).value).toBe('7');
     });

     it('applying a % to the current month persists a percent entry in byMonth[current]', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
       fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '10' } });
       fireEvent.click(screen.getByTestId('salary-apply')); // 'current' is the default scope
       expect(readSalarySettings().byMonth['2026-06']).toEqual({ kind: 'percent', value: 10 });
     });

     it('switching to amount mode then applying persists an amount entry', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
       fireEvent.click(screen.getByTestId('salary-mode-amount'));
       fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '8000' } });
       fireEvent.click(screen.getByTestId('salary-apply'));
       expect(readSalarySettings().byMonth['2026-06']).toEqual({ kind: 'amount', value: 8000 });
     });

     it('"everything" scope sets default + clears byMonth', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
       fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '9' } });
       fireEvent.click(screen.getByTestId('salary-scope-everything'));
       fireEvent.click(screen.getByTestId('salary-apply'));
       expect(readSalarySettings().default).toEqual({ kind: 'percent', value: 9 });
       expect(readSalarySettings().byMonth).toEqual({});
     });

     it('"all previous" works on a short loaded range via the 18-month window', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
       fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '5' } });
       fireEvent.click(screen.getByTestId('salary-scope-all-previous'));
       fireEvent.click(screen.getByTestId('salary-apply'));
       const bm = readSalarySettings().byMonth;
       expect(bm['2026-05']).toEqual({ kind: 'percent', value: 5 }); // prior month not in monthsInData
       expect(bm['2025-07']).toEqual({ kind: 'percent', value: 5 }); // inside the 18-month window
       expect(bm['2026-06']).toBeUndefined();                        // current excluded
     });

     it('hides the months timeline by default and expands on toggle', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
       const toggle = screen.getByTestId('salary-timeline-toggle');
       expect(toggle.getAttribute('aria-expanded')).toBe('false');
       expect(screen.queryByTestId('salary-timeline')).toBeNull();
       fireEvent.click(toggle);
       expect(toggle.getAttribute('aria-expanded')).toBe('true');
       expect(screen.getByTestId('salary-timeline')).toBeTruthy();
       expect(screen.getByTestId('salary-default-2026-06')).toBeTruthy(); // un-edited → default badge
     });

     it('timeline marks an edited month "נערך" after apply', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
       fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '11' } });
       fireEvent.click(screen.getByTestId('salary-apply'));
       fireEvent.click(screen.getByTestId('salary-timeline-toggle'));
       expect(screen.getByTestId('salary-edited-2026-06')).toBeTruthy();
       expect(screen.queryByTestId('salary-default-2026-06')).toBeNull();
     });

     it('shows the double-count reminder note', () => {
       render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
       expect(screen.getByTestId('salary-double-count-note').textContent)
         .toContain('הסר משם כדי לא לספור פעמיים');
     });
   });
   ```

2. Run, expect FAIL (component missing):
   `npx vitest run --config vitest.config.dom.ts src/components/__tests__/SalarySettings.dom.test.tsx`

3. Implement `src/components/SalarySettings.tsx`. Use this exact skeleton (copy the `lastNMonths`, `Radio`, `Badge` helpers from `CogsSettings.tsx` — they are local helpers, re-declare them here):

   ```tsx
   'use client';
   import { useMemo, useState } from 'react';
   import { Card } from '@/components/ui/Card';
   import { Button } from '@/components/ui/Button';
   import { Input } from '@/components/ui/Input';
   import { NativeSelect } from '@/components/ui/NativeSelect';
   import { Money } from '@/components/ui/Money';
   import {
     TableBase, TableHead, TableRow, TableHeaderCell, TableCell,
   } from '@/components/ui/TableBase';
   import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
   import { cn } from '@/lib/utils';
   import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
   import {
     DEFAULT_SALARY, effectiveSalaryEntry, applySalaryToScope,
     type SalaryApplyScope, type SalaryEntry, type SalarySettings as TSal,
   } from '@/lib/salarySettings';

   type ScopeKind = 'current' | 'specific' | 'all-previous' | 'everything';

   export function SalarySettings({ currentMonth, monthsInData }: {
     currentMonth: string; monthsInData: string[];
   }) {
     const [settings, update] = useSalarySettings();
     const [kind, setKind] = useState<SalaryEntry['kind']>(settings.default.kind ?? DEFAULT_SALARY.kind);
     const [value, setValue] = useState<string>(String(settings.default.value ?? DEFAULT_SALARY.value));
     const [scopeKind, setScopeKind] = useState<ScopeKind>('current');
     const [specificMonth, setSpecificMonth] = useState<string>(currentMonth);
     const [timelineOpen, setTimelineOpen] = useState(false);

     // Fixed 18-month lookback ∪ months-in-data ∪ every edited byMonth key, so
     // all-previous / specific-month / the timeline cover history independent of
     // the dashboard's current filter range (mirrors CogsSettings).
     const months = useMemo(() => {
       const set = new Set<string>([...lastNMonths(currentMonth, 18), ...monthsInData, currentMonth]);
       for (const m of Object.keys(settings.byMonth)) set.add(m);
       return Array.from(set).sort().reverse();
     }, [monthsInData, currentMonth, settings]);

     const isEdited = (m: string): boolean => settings.byMonth[m] !== undefined;

     const buildApply = (): SalaryApplyScope => {
       switch (scopeKind) {
         case 'current': return { kind: 'current', currentMonth };
         case 'specific': return { kind: 'specific', month: specificMonth };
         case 'all-previous': return { kind: 'all-previous', currentMonth };
         case 'everything': return { kind: 'everything' };
       }
     };

     const onApply = () => {
       const entry: SalaryEntry = { kind, value: clampValue(value, kind) };
       update(applySalaryToScope(settings, entry, buildApply(), months));
     };

     return (
       <Card className="space-y-4">
         <h3 className="text-sm font-bold text-ink">משכורות</h3>

         {/* entry-mode toggle: percent vs amount */}
         <div>
           <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1.5">מצב הזנה</div>
           <div className="inline-flex rounded-md bg-glass-2 border border-glass-edge p-0.5 gap-0.5">
             <Button type="button" variant="ghost" data-testid="salary-mode-percent"
               onClick={() => setKind('percent')}
               className={cn('h-auto px-3 py-1.5 text-sm', kind === 'percent' && 'bg-accent text-accent-fg')}>% מהמחזור</Button>
             <Button type="button" variant="ghost" data-testid="salary-mode-amount"
               onClick={() => setKind('amount')}
               className={cn('h-auto px-3 py-1.5 text-sm', kind === 'amount' && 'bg-accent text-accent-fg')}>סכום חודשי (CAD)</Button>
           </div>
         </div>

         {/* value field — prefix flips with mode */}
         <div className="space-y-2">
           <div className="flex items-center gap-2">
             <span className="flex-1 text-sm font-medium text-ink">כל העסק</span>
             <div className="w-32">
               <Input
                 data-testid="salary-value-input"
                 aria-label={kind === 'percent' ? 'משכורות — אחוז מהמחזור' : 'משכורות — סכום חודשי'}
                 value={value}
                 inputMode="decimal"
                 dir="ltr"
                 onChange={(e) => setValue(e.target.value)}
                 prefix={<span className="text-xs font-bold">{kind === 'percent' ? '%' : 'CAD'}</span>}
                 className="text-center font-bold"
               />
             </div>
           </div>
         </div>

         {/* apply-scope */}
         <fieldset className="space-y-1.5">
           <legend className="text-2xs uppercase tracking-wide text-ink-muted mb-1">החל על</legend>
           <Radio name="salary-scope" testid="salary-scope-current" checked={scopeKind === 'current'} onChange={() => setScopeKind('current')} label={`החודש הנוכחי (${currentMonth})`} />
           <Radio name="salary-scope" testid="salary-scope-specific" checked={scopeKind === 'specific'} onChange={() => setScopeKind('specific')} label="חודש ספציפי" />
           {scopeKind === 'specific' && (
             <div className="ms-6">
               <NativeSelect data-testid="salary-month" value={specificMonth} onChange={(e) => setSpecificMonth(e.target.value)}>
                 {months.map((m) => <option key={m} value={m}>{m}</option>)}
               </NativeSelect>
             </div>
           )}
           <Radio name="salary-scope" testid="salary-scope-all-previous" checked={scopeKind === 'all-previous'} onChange={() => setScopeKind('all-previous')} label="כל החודשים הקודמים" />
           <Radio name="salary-scope" testid="salary-scope-everything" checked={scopeKind === 'everything'} onChange={() => setScopeKind('everything')} label="הכל — קודמים + נוכחי + עתידיים" />
         </fieldset>

         <Button type="button" variant="primary" data-testid="salary-apply" onClick={onApply} className="w-full">החל שינוי</Button>

         <p className="text-2xs text-ink-muted leading-relaxed">
           ברירת מחדל {DEFAULT_SALARY.value}% לכל חודש שלא נערך. השינוי רטרואקטיבי ומיידי בכל הדשבורד. מסונכרן לענן.
         </p>

         {/* double-count reminder note */}
         <div data-testid="salary-double-count-note" className="rounded-lg bg-status-warningBg border border-status-warning px-3 py-2.5 flex items-start gap-2">
           <AlertCircle size={14} className="text-status-warningFg shrink-0 mt-0.5" />
           <div className="text-2xs text-status-warningFg leading-relaxed">
             אם הזנת משכורות ב&quot;עלויות קבועות&quot; — הסר משם כדי לא לספור פעמיים.
           </div>
         </div>

         {/* business-only note */}
         <p className="text-2xs text-ink-muted">ברמת העסק בלבד — אין הזנה לפי חנות.</p>

         {/* collapsible month timeline */}
         <div className="pt-1">
           <Button
             type="button"
             variant="ghost"
             data-testid="salary-timeline-toggle"
             aria-expanded={timelineOpen}
             aria-controls="salary-timeline-region"
             onClick={() => setTimelineOpen((v) => !v)}
             className="gap-1 h-auto px-2 py-1 text-[11px] sm:text-xs font-medium text-ink-secondary hover:text-ink"
           >
             {timelineOpen ? 'הסתר טבלת חודשים' : 'הצג טבלת חודשים'}
             {timelineOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
           </Button>
           {timelineOpen && (
             <div id="salary-timeline-region" data-testid="salary-timeline" className="mt-2 overflow-auto animate-fade-in">
               <TableBase density="compact" className="text-xs">
                 <TableHead>
                   <TableRow>
                     <TableHeaderCell>חודש</TableHeaderCell>
                     <TableHeaderCell numeric>ערך אפקטיבי</TableHeaderCell>
                   </TableRow>
                 </TableHead>
                 <tbody>
                   {months.map((m) => {
                     const edited = isEdited(m);
                     const entry = effectiveSalaryEntry(settings, m);
                     const dim = edited ? '' : 'text-ink-muted';
                     return (
                       <TableRow key={m} data-testid={`salary-timeline-row-${m}`}>
                         <TableCell className={cn('tabular-nums', dim)}>
                           {m}
                           {edited && <Badge testid={`salary-edited-${m}`} variant="edited">נערך</Badge>}
                         </TableCell>
                         <TableCell numeric className={dim}>
                           {entry.kind === 'percent'
                             ? `${entry.value}%`
                             : <><Money value={entry.value} /> <span className="text-2xs text-ink-muted">/ חודש</span></>}
                           {!edited && <Badge testid={`salary-default-${m}`} variant="default">ברירת מחדל</Badge>}
                         </TableCell>
                       </TableRow>
                     );
                   })}
                 </tbody>
               </TableBase>
             </div>
           )}
         </div>
       </Card>
     );
   }

   function clampValue(v: string, kind: SalaryEntry['kind']): number {
     const n = parseFloat(v);
     if (!Number.isFinite(n) || n < 0) return kind === 'percent' ? DEFAULT_SALARY.value : 0;
     return kind === 'percent' ? Math.min(100, n) : n; // amount is unbounded above
   }

   /** Last `n` calendar months ending at `endMonth` (inclusive), 'YYYY-MM'. */
   function lastNMonths(endMonth: string, n: number): string[] {
     const out: string[] = [];
     let [y, m] = endMonth.split('-').map(Number);
     if (!Number.isFinite(y) || !Number.isFinite(m)) return out;
     for (let i = 0; i < n; i++) {
       out.push(`${y}-${String(m).padStart(2, '0')}`);
       m -= 1;
       if (m === 0) { m = 12; y -= 1; }
     }
     return out;
   }

   function Badge({ testid, variant, children }: { testid: string; variant: 'edited' | 'default'; children: React.ReactNode }) {
     return (
       <span
         data-testid={testid}
         className={cn(
           'ms-1.5 inline-block rounded-md px-1.5 py-0.5 text-2xs font-bold align-middle',
           variant === 'edited' ? 'bg-accent-soft text-accent' : 'bg-glass-3 text-ink-secondary',
         )}
       >
         {children}
       </span>
     );
   }

   function Radio({ name, testid, checked, onChange, label }: { name: string; testid: string; checked: boolean; onChange: () => void; label: string }) {
     return (
       <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
         <Input type="radio" name={name} data-testid={testid} checked={checked} onChange={onChange} className="accent-accent w-4 h-4" />
         <span>{label}</span>
       </label>
     );
   }
   ```

   > Re-confirm the import paths `@/components/ui/Card|Button|Input|NativeSelect|Money|TableBase` resolve exactly as in `CogsSettings.tsx` (they do today). If `TableBase`'s `density`/`numeric` props differ from COGS usage, match the COGS file verbatim.

4. Run, expect PASS:
   `npx vitest run --config vitest.config.dom.ts src/components/__tests__/SalarySettings.dom.test.tsx`

5. tsc, expect PASS: `npx tsc --noEmit`

6. Commit: `feat(salaries): SalarySettings panel — %/amount toggle, 4 scopes, timeline, double-count note (T6)`

---

## Task T7 — wire salariesForRange into Dashboard aggregates + salaryTick

**Files:**
- EDIT `src/components/Dashboard.tsx`

> **Inspect step (Plan A overlap):** open `src/components/Dashboard.tsx`. Re-confirm: (a) the `billingTick` `useEffect` block (currently ~lines 205-215) that listens for `'roas-billing-changed'`; (b) the `filtered` memo (~265-293) that builds `curAgg: aggregate(cur, filters.range)` and `prevAgg: aggregate(prev, prevR)`; (c) the existing `const [cogsSettings] = useCogsSettings();` line. Plan A may have shifted these — match the current code.

This wires the salaries deduction into the same `filtered` memo that already applies COGS, so the hero net card, P&L synthesis, insights, and PnLBreakdown all pick it up. There is NO separate "KpiCards" component in this codebase — the net-profit numbers are all driven by `aggregate().trueNetProfit` (hero featured card via `lib/home/adapters.ts`, P&L cascade via PnLBreakdown). Threading through `aggregate()` covers them all.

**Steps:**

1. Add the salary hook + tick. Near the existing `const [cogsSettings] = useCogsSettings();` (the one inside the main Dashboard component, ~line 165), add:
   ```ts
   const [salarySettings] = useSalarySettings();
   ```
   And add the import at the top alongside the COGS hook import:
   ```ts
   import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
   import { salariesForRange } from '@/lib/salarySettings';
   ```

2. Add a `salaryTick` re-aggregate trigger mirroring `billingTick`. Right after the existing `billingTick` `useEffect`, add:
   ```ts
   // Re-aggregate on salary edits so true-net values stay in sync (mirror billingTick).
   const [salaryTick, setSalaryTick] = useState(0);
   useEffect(() => {
     const bump = () => setSalaryTick((t) => t + 1);
     window.addEventListener('roas-salary-changed', bump);
     return () => window.removeEventListener('roas-salary-changed', bump);
   }, []);
   ```

3. In the `filtered` memo, compute the per-range salaries and thread it into both `aggregate` calls. Change:
   ```ts
       curAgg: aggregate(cur, filters.range),
       prevAgg: aggregate(prev, prevR),
   ```
   to:
   ```ts
       curAgg: aggregate(cur, filters.range, undefined, undefined, salariesForRange(salarySettings, cur, filters.range)),
       prevAgg: aggregate(prev, prevR, undefined, undefined, salariesForRange(salarySettings, prev, prevR)),
   ```
   > `cur`/`prev` are the COGS-adjusted, store-filtered `DailyRow[]` already in scope inside the memo. `salariesForRange` reads revenue from these rows, so the salaries deduction respects the active store + range filters. (This is the spec's intended behavior: business-level salaries scale with whatever revenue is in view — same as COGS.)

4. Add `salarySettings` and `salaryTick` to the `filtered` memo's dependency array (alongside `data, filters, billingTick`):
   ```ts
   }, [data, filters, billingTick, salarySettings, salaryTick]);
   ```

5. The `aggregateByStore` per-store cards do NOT get salaries (business-level only, not per-store) — leave that call unchanged. This is intentional and matches the spec ("business-level ONLY, no per-store").

6. tsc, expect PASS: `npx tsc --noEmit`

7. Run the existing Dashboard-adjacent suites to confirm nothing regressed (these exercise the aggregate/home adapters; salaries default to 0 inside `salariesForRange` only if rows are empty, but with the default 7% they will now subtract — so any snapshot that asserts an exact `trueNetProfit` for a non-empty period MUST be updated to include the 7% deduction. Inspect failures and update the expected numbers to reflect the new default-7% salary line — do NOT special-case it away):
   - `npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx`
   - `npx vitest run src/lib/synthesis/__tests__/pnl.test.ts`
   - `npx vitest run src/lib/__tests__` (the analytics/home/insights node suites)
   > If a test passes a hand-built `Aggregate` directly (not via `aggregate()`), it is unaffected (the `salaries` field defaults via the object it constructs — add `salaries: 0` to any inline `Aggregate` literal the compiler now flags as missing the field).

8. Commit: `feat(salaries): thread salariesForRange into Dashboard aggregates + salaryTick (T7)`

---

## Task T8 — PnLBreakdown "משכורות" line + PnLTab reorder

**Files:**
- EDIT `src/components/PnLBreakdown.tsx`
- EDIT `src/components/Dashboard.tsx` (reorder `PnLTab`)
- CREATE `src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx`

> **Inspect step (Plan A overlap):** open `src/components/PnLBreakdown.tsx`. Re-confirm: (a) the cascade `<PnLLine label="הוצאות קבועות (יחסי)" … running={finalProfit} />` block; (b) the `const finalProfit = afterFees - current.fixedCosts;` line; (c) the final "רווח נטו אמיתי" `<li>`. Plan A edited the COGS note prose + added an MER note here — the EXACT note text on the COGS / fees lines may differ now; match whatever is current. The salaries line + the running-total rewiring below are additive and must slot AFTER "הוצאות קבועות" and BEFORE "רווח נטו אמיתי".

**Steps:**

1. Write the failing DOM test `src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx`:

   ```tsx
   import { describe, it, expect } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import { PnLBreakdown } from '@/components/PnLBreakdown';
   import type { Aggregate } from '@/lib/analytics';

   function agg(over: Partial<Aggregate>): Aggregate {
     return {
       revenue: 48920, spend: 16840, fbSpend: 0, gaSpend: 0, ttSpend: 0, roas: 2.9,
       grossProfit: 48920 - 16840, cogs: 13208, netProfit: 48920 - 16840 - 13208,
       transactionFees: 3180, fixedCosts: 1290, storeCount: 3, daysCovered: 18,
       salaries: 3424, trueNetProfit: 48920 - 16840 - 13208 - 3180 - 1290 - 3424,
       trueMargin: (48920 - 16840 - 13208 - 3180 - 1290 - 3424) / 48920, rowCount: 18,
       ...over,
     };
   }

   describe('PnLBreakdown — salaries line', () => {
     it('renders a "משכורות" cascade line with the salaries amount', () => {
       render(<PnLBreakdown current={agg({})} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={[]} />);
       const line = screen.getByTestId('pnl-line-salaries');
       expect(line).toBeTruthy();
       expect(line.textContent).toContain('משכורות');
     });

     it('the salaries line is absent when salaries is 0', () => {
       render(<PnLBreakdown current={agg({ salaries: 0, trueNetProfit: 48920 - 16840 - 13208 - 3180 - 1290 })} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={[]} />);
       expect(screen.queryByTestId('pnl-line-salaries')).toBeNull();
     });

     it('keeps every prior cascade line (no info loss): refunds line still renders when present', () => {
       // a refund row drives the presentational "החזרים בתקופה" line
       const rows = [{
         date: '2026-06-10', storeId: 'uzoshop', storeName: 'uzoshop',
         fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 1000,
         roas: 0, grossProfit: 1000, cogs: 0, netProfit: 1000, hasCogs: true,
         grossRevenue: 1500, refundDeduction: 500,
         fbImpressions: null, gaImpressions: null, ttImpressions: null,
       }];
       render(<PnLBreakdown current={agg({})} storeNames={['uzoshop']} rangeFrom="2026-06-01" rangeTo="2026-06-30" rows={rows} />);
       // both the refunds line and the salaries line coexist
       expect(screen.getByText('החזרים בתקופה')).toBeTruthy();
       expect(screen.getByTestId('pnl-line-salaries')).toBeTruthy();
     });
   });
   ```

   > Confirm the refund-line precondition: the existing code renders "החזרים בתקופה" when `sumRefundsInRange(rows) > 0`. The row above carries `refundDeduction: 500` (and `grossRevenue: 1500`) which `sumRefundsInRange` reads. If `sumRefundsInRange` keys off a different field, set the field that test reproduces a positive refund total (open `src/lib/refundDayHeuristic.ts` to confirm during the inspect step) — keep the assertion intent: the refunds line must still render.

2. Run, expect FAIL (no `pnl-line-salaries`):
   `npx vitest run --config vitest.config.dom.ts src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx`

3. Edit `src/components/PnLBreakdown.tsx`:
   - Rewire the running totals so the fixed-costs line no longer ends at `finalProfit`. Change:
     ```ts
     const afterAd     = revenue - current.spend;
     const afterCogs   = afterAd - current.cogs;
     const afterFees   = afterCogs - current.transactionFees;
     const finalProfit = afterFees - current.fixedCosts;
     ```
     to:
     ```ts
     const afterAd       = revenue - current.spend;
     const afterCogs     = afterAd - current.cogs;
     const afterFees     = afterCogs - current.transactionFees;
     const afterFixed    = afterFees - current.fixedCosts;
     const salaries      = current.salaries ?? 0;
     const finalProfit   = afterFixed - salaries;
     ```
   - In the "הוצאות קבועות (יחסי)" `<PnLLine>`, change its `running={finalProfit}` to `running={afterFixed}`.
   - Immediately AFTER that "הוצאות קבועות" `<PnLLine>` and BEFORE the final-result `<li>`, insert the salaries line (only when `salaries > 0`):
     ```tsx
     {salaries > 0 && (
       <li data-testid="pnl-line-salaries" className="contents">
         <PnLLine
           label="משכורות"
           amount={-salaries}
           pct={-pct(salaries)}
           tone="cost"
           note={revenue > 0 ? `לפי הגדרה · ${((salaries / revenue) * 100).toFixed(1)}% מהמחזור` : 'לפי הגדרה'}
           running={finalProfit}
         />
       </li>
     )}
     ```
     > `PnLLine` itself renders an `<li>`. To attach a `data-testid` without breaking the `<ol>` grid, wrap with a `className="contents"` `<li>` is invalid (li-in-li). INSTEAD: add an optional `testid?: string` prop to the `PnLLine` component and pass `data-testid` onto its own `<li>`. Do that: in `PnLLine`'s props add `testid?: string;`, and on its root `<li>` add `data-testid={testid}`. Then render the salaries line as a plain `<PnLLine … testid="pnl-line-salaries" />` (no wrapper):
     ```tsx
     {salaries > 0 && (
       <PnLLine
         testid="pnl-line-salaries"
         label="משכורות"
         amount={-salaries}
         pct={-pct(salaries)}
         tone="cost"
         note={revenue > 0 ? `לפי הגדרה · ${((salaries / revenue) * 100).toFixed(1)}% מהמחזור` : 'לפי הגדרה'}
         running={finalProfit}
       />
     )}
     ```
     Use the second form (testid prop on PnLLine), NOT the `<li className="contents">` wrapper.
   - `totalCosts` (the hero "סך עלויות" strip number) must include salaries so the hero math reconciles with the cascade. Change:
     ```ts
     const totalCosts = current.spend + current.cogs + current.transactionFees + current.fixedCosts;
     ```
     to:
     ```ts
     const totalCosts = current.spend + current.cogs + current.transactionFees + current.fixedCosts + (current.salaries ?? 0);
     ```
     (The hero "רווח נטו" big number already reads `finalProfit`, which now includes salaries — consistent.)

4. Reorder `PnLTab` in `src/components/Dashboard.tsx`. The current order inside the `return` is: `SectionIntro · PageScope · PageSynthesis · Filters · GoalTracker · <div>{BillingSettings, CogsSettings, PnLBreakdown}</div>`. Change the trailing block so PnLBreakdown comes right after GoalTracker and the three editors follow, in order Billing → Cogs → Salary. Replace:
   ```tsx
         <GoalTracker data={data} />

         <div className="space-y-3">
           <div className="flex justify-end">
             <BillingSettings storeNames={data.stores} />
           </div>
           <CogsSettings
             storeNames={data.stores}
             currentMonth={getTodayInIsraelTz().slice(0, 7)}
             monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
           />
           <PnLBreakdown
             current={filtered.curAgg}
             storeNames={filtered.visibleStores}
             rangeFrom={filters.range.from}
             rangeTo={filters.range.to}
             rows={filtered.cur}
           />
         </div>
   ```
   with:
   ```tsx
         <GoalTracker data={data} />

         <PnLBreakdown
           current={filtered.curAgg}
           storeNames={filtered.visibleStores}
           rangeFrom={filters.range.from}
           rangeTo={filters.range.to}
           rows={filtered.cur}
         />

         <div className="space-y-3">
           <div className="flex justify-end">
             <BillingSettings storeNames={data.stores} />
           </div>
           <CogsSettings
             storeNames={data.stores}
             currentMonth={getTodayInIsraelTz().slice(0, 7)}
             monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
           />
           <SalarySettings
             currentMonth={getTodayInIsraelTz().slice(0, 7)}
             monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
           />
         </div>
   ```
   And add the import near the `CogsSettings` import:
   ```ts
   import { SalarySettings } from '@/components/SalarySettings';
   ```

5. Run, expect PASS:
   `npx vitest run --config vitest.config.dom.ts src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx`

6. Run the existing PnLBreakdown DOM suite(s) to confirm the reorder/line addition didn't regress them; update any that asserted the old running-total chain or the old `totalCosts`:
   - `npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlBreakdownCogsProse.dom.test.tsx`
   - `npx vitest run --config vitest.config.dom.ts src/components/__tests__` (any other PnL/Dashboard DOM suites)

7. tsc, expect PASS: `npx tsc --noEmit`

8. Commit: `feat(salaries): PnLBreakdown משכורות line + PnLTab reorder (GoalTracker→P&L→editors) (T8)`

---

## Manual verification checklist

Run `npx tsc --noEmit` and the full suite once at the end:
- `npx vitest run` (node)
- `npx vitest run --config vitest.config.dom.ts` (dom)

Then, in the running dashboard (P&L tab), both **light and dark** themes:

1. **Reorder** — order top→bottom is: page intro/scope/synthesis/filters → **יעד חודשי (GoalTracker)** → **Profit & Loss (PnLBreakdown)** → **הגדרות חיוב / הוצאות מלאי (COGS) / משכורות** editors. No card disappeared (BillingSettings, CogsSettings, PnLBreakdown all still present; SalarySettings new at the bottom).
2. **Default 7%** — with no salary edits, the P&L cascade shows a **משכורות** line ≈ 7% of revenue, sitting AFTER "הוצאות קבועות (יחסי)" and BEFORE "רווח נטו אמיתי". The "החזרים בתקופה" presentational line is still present (no info loss). Running total flows: fixed → (after-fixed) → salaries → final.
3. **True net only** — the hero "רווח נטו" featured card drops by the salaries amount; the hero **operating-profit** number (revenue − adSpend − COGS) and the per-store ROAS-band cards are UNCHANGED.
4. **Percent edit** — set 10% for the current month via "החודש הנוכחי", apply → cascade salaries line jumps to 10% of revenue immediately (no reload); P&L synthesis margin sentence updates.
5. **Amount edit** — switch to "סכום חודשי (CAD)", enter 8000, apply to current month → salaries line shows the day-prorated amount for the visible range; pick a full calendar month range → shows full 8000.
6. **Apply-scopes** — "כל החודשים הקודמים" and "הכל" write the expected byMonth/default (verify via the timeline).
7. **Timeline** — collapsed by default; expands on toggle; edited months show "נערך", others "ברירת מחדל"; amount months render `CAD N / חודש`, percent months render `N%`. Numbers never clip (rendered via `<Money>`).
8. **Double-count note** — the orange reminder "אם הזנת משכורות ב'עלויות קבועות' — הסר משם כדי לא לספור פעמיים." is visible in the panel, legible in both themes.
9. **Persistence + cloud** — reload the page: the salary settings persist (localStorage). Confirm a `pushCloudKey('roas-dashboard:salary-settings', …)` fires on save (network tab / the cloud-sync indicator).
10. **Business-only** — there is NO per-store toggle/field in the SalarySettings panel; the per-store ROAS cards never show a salaries deduction.
