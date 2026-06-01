# Editable COGS % (per-month, retroactive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator edit the inventory-cost % (COGS, today a flat 25%) from the dashboard — global business/per-store mode, per-month values (default 25%), with 4 apply-scopes — recomputed client-side and retroactively across every consumer.

**Architecture:** A client-side settings object (localStorage + cloud sync, mirroring `billing.ts`) holds the % by scope+month. A pure `effectiveCogsPct(settings, store, month)` + `applyCogsToRows(rows, settings)` recompute each `DailyRow.cogs` + `netProfit` at the earliest read point; every cogs consumer (hero `operatingProfit`, per-store, P&L, GoalTracker forecast, Detail, insights, ROAS-chart KPIs) reads downstream and updates automatically. The stored `data_daily.cogs_cad` is left untouched. Default settings reproduce today's 25% numbers, so nothing changes until the operator edits.

**Tech Stack:** Next.js + React + TypeScript, Tailwind (token-driven), SWR, vitest (node + `vitest.config.dom.ts`).

**Spec:** `docs/superpowers/specs/2026-06-01-editable-cogs-percent-design.md`
**Mockup:** `docs/superpowers/mockups/2026-06-01-cogs-editor/mockup.html`

## Resolved facts (from code)
- `DailyRow` (src/lib/types.ts:13-19): `revenue`, `totalSpend`, `grossProfit` (= revenue − adSpend, **NOT** cogs-derived → leave), `cogs`, `netProfit` (= revenue − spend − cogs → recompute), `hasCogs`.
- `aggregate()` (src/lib/analytics.ts:144-249) SUMS `r.cogs` per row and derives `netProfit`/`trueNetProfit`/`operatingProfit` from the sum — so pre-adjusted rows flow through with NO aggregate change.
- Persistence pattern to mirror: `src/lib/billing.ts` (`localStorage` + `new CustomEvent('roas-billing-changed')` + `pushCloudKey(key,value)` from `./cloudSync`).
- `BillingSettings` mounts at `src/components/Dashboard.tsx:1053` (`<BillingSettings storeNames={data.stores} />`).
- Campaigns do NOT consume cogs (verified) — no campaign changes.
- cogs-relevant `/api/data` SWR results to wrap: `Dashboard.tsx` main (`:161`), prev (`:580`), chart (`:598`); `GoalTracker.tsx` wide (`:116`/`wideData`). The archive/MonthlyTables (`AnalysisArchiveTab.tsx:74`) shows no cogs → not wrapped.

## File structure
- **Create:** `src/lib/cogsSettings.ts`, `src/lib/hooks/useCogsSettings.ts`, `src/components/CogsSettings.tsx`, tests.
- **Modify:** `src/components/Dashboard.tsx` (wrap 3 SWRs + mount panel), `src/components/GoalTracker.tsx` (wrap wide fetch).

---

### Task 1: `cogsSettings.ts` — model + persistence + effectiveCogsPct (TDD)

**Files:**
- Create: `dashboard-web/src/lib/cogsSettings.ts`
- Test: `dashboard-web/src/lib/__tests__/cogsSettings.test.ts`

- [ ] **Step 1: Write the failing test (model + effectiveCogsPct + read default)**

Create `dashboard-web/src/lib/__tests__/cogsSettings.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_COGS_PCT, COGS_SETTINGS_KEY,
  defaultCogsSettings, effectiveCogsPct, readCogsSettings, writeCogsSettings,
  type CogsSettings,
} from '@/lib/cogsSettings';

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

describe('cogsSettings — model + effectiveCogsPct', () => {
  it('defaults to all-25% business mode', () => {
    const s = defaultCogsSettings();
    expect(s.mode).toBe('business');
    expect(s.business.default).toBe(DEFAULT_COGS_PCT);
    expect(DEFAULT_COGS_PCT).toBe(25);
  });

  it('effectiveCogsPct returns 0.25 by default (business)', () => {
    expect(effectiveCogsPct(defaultCogsSettings(), 'uzoshop', '2026-06')).toBeCloseTo(0.25, 6);
  });

  it('business byMonth overrides default; precedence byMonth > default > 25', () => {
    const s: CogsSettings = { v: 1, mode: 'business', business: { default: 30, byMonth: { '2026-05': 28 } }, perStore: {} };
    expect(effectiveCogsPct(s, 'uzoshop', '2026-05')).toBeCloseTo(0.28, 6); // byMonth
    expect(effectiveCogsPct(s, 'uzoshop', '2026-06')).toBeCloseTo(0.30, 6); // default
  });

  it('per-store mode reads the store scope; unknown store → 25%', () => {
    const s: CogsSettings = {
      v: 1, mode: 'per-store', business: { default: 25, byMonth: {} },
      perStore: { uzoshop: { default: 28, byMonth: { '2026-06': 31 } } },
    };
    expect(effectiveCogsPct(s, 'uzoshop', '2026-06')).toBeCloseTo(0.31, 6);
    expect(effectiveCogsPct(s, 'uzoshop', '2026-05')).toBeCloseTo(0.28, 6);
    expect(effectiveCogsPct(s, 'zolplus', '2026-06')).toBeCloseTo(0.25, 6); // unknown store
  });

  it('read returns default when nothing stored; write round-trips + bumps cloud', async () => {
    expect(readCogsSettings()).toEqual(defaultCogsSettings());
    const next: CogsSettings = { ...defaultCogsSettings(), business: { default: 22, byMonth: {} } };
    writeCogsSettings(next);
    expect(JSON.parse(window.localStorage.getItem(COGS_SETTINGS_KEY)!).business.default).toBe(22);
    const { pushCloudKey } = await import('@/lib/cloudSync');
    expect(pushCloudKey).toHaveBeenCalledWith(COGS_SETTINGS_KEY, expect.objectContaining({ business: { default: 22, byMonth: {} } }));
  });

  it('tolerates malformed JSON → default', () => {
    window.localStorage.setItem(COGS_SETTINGS_KEY, '{not json');
    expect(readCogsSettings()).toEqual(defaultCogsSettings());
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/cogsSettings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cogsSettings.ts`**

Create `dashboard-web/src/lib/cogsSettings.ts`:

```ts
import { pushCloudKey } from './cloudSync';
import type { DailyRow } from './types';

/** Operator-facing default inventory %. */
export const DEFAULT_COGS_PCT = 25;
export const COGS_SETTINGS_KEY = 'roas-dashboard:cogs-settings';
export const COGS_SETTINGS_VERSION = 1;
/** Same CustomEvent pattern as billing.ts so same-tab edits re-render. */
export const COGS_SETTINGS_EVENT = 'roas-cogs-settings-changed';

export interface CogsScopeSettings {
  /** Base % (0-100) for any month without an explicit byMonth entry. */
  default: number;
  /** Explicit per-month overrides: 'YYYY-MM' → percent (0-100). */
  byMonth: Record<string, number>;
}
export interface CogsSettings {
  v: number;
  mode: 'business' | 'per-store';
  business: CogsScopeSettings;
  perStore: Record<string, CogsScopeSettings>;
}

export function defaultCogsSettings(): CogsSettings {
  return { v: COGS_SETTINGS_VERSION, mode: 'business', business: { default: DEFAULT_COGS_PCT, byMonth: {} }, perStore: {} };
}

/** Effective FRACTION (0-1) for a store + 'YYYY-MM'. byMonth > default > 25. */
export function effectiveCogsPct(s: CogsSettings, storeName: string, month: string): number {
  const scope = s.mode === 'per-store'
    ? (s.perStore[storeName] ?? { default: DEFAULT_COGS_PCT, byMonth: {} })
    : s.business;
  const pct = scope.byMonth[month] ?? scope.default ?? DEFAULT_COGS_PCT;
  return pct / 100;
}

export function readCogsSettings(): CogsSettings {
  if (typeof window === 'undefined') return defaultCogsSettings();
  try {
    const raw = window.localStorage.getItem(COGS_SETTINGS_KEY);
    if (!raw) return defaultCogsSettings();
    const parsed = JSON.parse(raw) as Partial<CogsSettings>;
    if (!parsed || typeof parsed !== 'object') return defaultCogsSettings();
    const d = defaultCogsSettings();
    return {
      v: COGS_SETTINGS_VERSION,
      mode: parsed.mode === 'per-store' ? 'per-store' : 'business',
      business: normScope(parsed.business) ?? d.business,
      perStore: normPerStore(parsed.perStore),
    };
  } catch { return defaultCogsSettings(); }
}

function normScope(x: unknown): CogsScopeSettings | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<CogsScopeSettings>;
  const def = typeof o.default === 'number' && Number.isFinite(o.default) ? o.default : DEFAULT_COGS_PCT;
  const byMonth: Record<string, number> = {};
  if (o.byMonth && typeof o.byMonth === 'object') {
    for (const [k, v] of Object.entries(o.byMonth)) if (typeof v === 'number' && Number.isFinite(v)) byMonth[k] = v;
  }
  return { default: def, byMonth };
}
function normPerStore(x: unknown): Record<string, CogsScopeSettings> {
  const out: Record<string, CogsScopeSettings> = {};
  if (x && typeof x === 'object') for (const [store, scope] of Object.entries(x)) { const n = normScope(scope); if (n) out[store] = n; }
  return out;
}

export function writeCogsSettings(s: CogsSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: CogsSettings = { ...s, v: COGS_SETTINGS_VERSION };
    window.localStorage.setItem(COGS_SETTINGS_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new CustomEvent(COGS_SETTINGS_EVENT));
    pushCloudKey(COGS_SETTINGS_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/cogsSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/cogsSettings.ts dashboard-web/src/lib/__tests__/cogsSettings.test.ts
git commit -m "feat(cogs): settings model + effectiveCogsPct + localStorage/cloud persistence"
```

---

### Task 2: `applyCogsToRows` (TDD)

**Files:**
- Modify: `dashboard-web/src/lib/cogsSettings.ts`
- Modify: `dashboard-web/src/lib/__tests__/cogsSettings.test.ts`

- [ ] **Step 1: Append the failing test**

Add to `cogsSettings.test.ts` (import `applyCogsToRows` + a `makeRow` helper):

```ts
import { applyCogsToRows } from '@/lib/cogsSettings';
import type { DailyRow } from '@/lib/types';

function makeRow(over: Partial<DailyRow>): DailyRow {
  const revenue = over.revenue ?? 1000;
  const totalSpend = over.totalSpend ?? 300;
  return {
    date: '2026-06-15', storeId: 'uzoshop', storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend, revenue, roas: revenue / (totalSpend || 1),
    grossProfit: revenue - totalSpend, cogs: revenue * 0.25, netProfit: revenue - totalSpend - revenue * 0.25,
    hasCogs: true, grossRevenue: null, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null, ...over,
  };
}

describe('applyCogsToRows', () => {
  it('recomputes cogs + netProfit per row from the effective %, leaves grossProfit', () => {
    const s: CogsSettings = { v: 1, mode: 'business', business: { default: 25, byMonth: { '2026-06': 30 } }, perStore: {} };
    const [r] = applyCogsToRows([makeRow({ revenue: 1000, totalSpend: 300 })], s);
    expect(r.cogs).toBeCloseTo(300, 6);       // 1000 × 30%
    expect(r.netProfit).toBeCloseTo(400, 6);  // 1000 − 300 − 300
    expect(r.grossProfit).toBeCloseTo(700, 6); // revenue − spend (unchanged)
    expect(r.hasCogs).toBe(true);
  });

  it('uses each row\'s own month + store', () => {
    const s: CogsSettings = { v: 1, mode: 'per-store', business: { default: 25, byMonth: {} },
      perStore: { uzoshop: { default: 20, byMonth: {} }, zolplus: { default: 40, byMonth: {} } } };
    const rows = applyCogsToRows([
      makeRow({ storeName: 'uzoshop', revenue: 1000 }),
      makeRow({ storeName: 'zolplus', revenue: 1000 }),
    ], s);
    expect(rows[0].cogs).toBeCloseTo(200, 6); // uzoshop 20%
    expect(rows[1].cogs).toBeCloseTo(400, 6); // zolplus 40%
  });

  it('default settings reproduce a 25%-stored row unchanged', () => {
    const r0 = makeRow({ revenue: 800, totalSpend: 200 }); // cogs 200, net 400
    const [r] = applyCogsToRows([r0], defaultCogsSettings());
    expect(r.cogs).toBeCloseTo(r0.cogs, 6);
    expect(r.netProfit).toBeCloseTo(r0.netProfit, 6);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/lib/__tests__/cogsSettings.test.ts` → FAIL (applyCogsToRows undefined).

- [ ] **Step 3: Implement** — append to `cogsSettings.ts`:

```ts
/**
 * Recompute each row's COGS-derived fields from the effective % (per the row's
 * own month + store). grossProfit (= revenue − adSpend) is NOT cogs-derived, so
 * it is left as-is. With default settings this reproduces a 25%-stored row.
 */
export function applyCogsToRows(rows: DailyRow[], s: CogsSettings): DailyRow[] {
  return rows.map((r) => {
    const pct = effectiveCogsPct(s, r.storeName, r.date.slice(0, 7));
    const cogs = r.revenue * pct;
    return { ...r, cogs, hasCogs: true, netProfit: r.revenue - r.totalSpend - cogs };
  });
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/cogsSettings.ts dashboard-web/src/lib/__tests__/cogsSettings.test.ts
git commit -m "feat(cogs): applyCogsToRows — recompute cogs+netProfit per row from effective %"
```

---

### Task 3: apply-scope mutation helpers (TDD)

**Files:** Modify `cogsSettings.ts` + its test.

- [ ] **Step 1: Append the failing test**

```ts
import { applyPctToScope, type ApplyScope } from '@/lib/cogsSettings';

describe('applyPctToScope — the 4 apply-scopes', () => {
  const base = (): CogsScopeSettings => ({ default: 25, byMonth: { '2026-04': 27 } });
  it('current month → sets byMonth[current]', () => {
    const out = applyPctToScope(base(), 32, { kind: 'current', currentMonth: '2026-06' }, ['2026-03','2026-04','2026-05','2026-06']);
    expect(out.byMonth['2026-06']).toBe(32);
    expect(out.byMonth['2026-04']).toBe(27); // untouched
    expect(out.default).toBe(25);
  });
  it('specific month → sets byMonth[that]', () => {
    const out = applyPctToScope(base(), 18, { kind: 'specific', month: '2026-05' }, ['2026-05','2026-06']);
    expect(out.byMonth['2026-05']).toBe(18);
  });
  it('all previous → sets byMonth for every month < current present in the data', () => {
    const out = applyPctToScope(base(), 33, { kind: 'all-previous', currentMonth: '2026-06' }, ['2026-03','2026-04','2026-05','2026-06']);
    expect(out.byMonth['2026-03']).toBe(33);
    expect(out.byMonth['2026-04']).toBe(33);
    expect(out.byMonth['2026-05']).toBe(33);
    expect(out.byMonth['2026-06']).toBeUndefined(); // current NOT touched
  });
  it('everything → sets default + clears byMonth', () => {
    const out = applyPctToScope(base(), 26, { kind: 'everything' }, ['2026-04','2026-06']);
    expect(out.default).toBe(26);
    expect(out.byMonth).toEqual({});
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — append to `cogsSettings.ts`:

```ts
export type ApplyScope =
  | { kind: 'current'; currentMonth: string }
  | { kind: 'specific'; month: string }
  | { kind: 'all-previous'; currentMonth: string }
  | { kind: 'everything' };

/**
 * Pure: produce a new scope with `pct` applied per the chosen apply-scope.
 * `monthsInData` = the 'YYYY-MM' present in the loaded rows (for 'all-previous').
 */
export function applyPctToScope(scope: CogsScopeSettings, pct: number, apply: ApplyScope, monthsInData: string[]): CogsScopeSettings {
  const byMonth = { ...scope.byMonth };
  switch (apply.kind) {
    case 'current':  byMonth[apply.currentMonth] = pct; return { ...scope, byMonth };
    case 'specific': byMonth[apply.month] = pct; return { ...scope, byMonth };
    case 'all-previous':
      for (const m of monthsInData) if (m < apply.currentMonth) byMonth[m] = pct;
      return { ...scope, byMonth };
    case 'everything': return { default: pct, byMonth: {} };
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/cogsSettings.ts dashboard-web/src/lib/__tests__/cogsSettings.test.ts
git commit -m "feat(cogs): applyPctToScope — the 4 apply-scopes (current/specific/all-previous/everything)"
```

---

### Task 4: `useCogsSettings` + `useCogsAdjustedRows` hooks

**Files:**
- Create: `dashboard-web/src/lib/hooks/useCogsSettings.ts`

- [ ] **Step 1: Implement** (pattern mirrors how other prefs hooks re-read on the CustomEvent; no separate unit test — exercised via the DOM test in Task 6 + the wiring in Task 5):

```ts
'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { DailyRow } from '@/lib/types';
import {
  readCogsSettings, writeCogsSettings, applyCogsToRows,
  COGS_SETTINGS_EVENT, type CogsSettings,
} from '@/lib/cogsSettings';

/** Reactive read of the COGS settings: re-reads on same-tab edits + cloud hydrate. */
export function useCogsSettings(): [CogsSettings, (next: CogsSettings) => void] {
  const [settings, setSettings] = useState<CogsSettings>(() => readCogsSettings());
  useEffect(() => {
    const reread = () => setSettings(readCogsSettings());
    window.addEventListener(COGS_SETTINGS_EVENT, reread);
    // Cloud sync writes localStorage from another device → 'storage' event.
    window.addEventListener('storage', reread);
    return () => { window.removeEventListener(COGS_SETTINGS_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  const update = useCallback((next: CogsSettings) => { writeCogsSettings(next); setSettings(next); }, []);
  return [settings, update];
}

/** Apply the COGS override to a rows array reactively. Returns the SAME ref when
 *  rows is nullish so callers can `?? []` as before. */
export function useCogsAdjustedRows<T extends DailyRow>(rows: T[] | undefined): T[] | undefined {
  const [settings] = useCogsSettings();
  return useMemo(() => (rows ? (applyCogsToRows(rows, settings) as T[]) : rows), [rows, settings]);
}
```

- [ ] **Step 2: Type-check** — `cd dashboard-web && npx tsc --noEmit` → 0.
- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/lib/hooks/useCogsSettings.ts
git commit -m "feat(cogs): useCogsSettings + useCogsAdjustedRows reactive hooks"
```

---

### Task 5: Wire the row transform at the cogs-relevant SWR consumers

**Files:** Modify `dashboard-web/src/components/Dashboard.tsx`, `dashboard-web/src/components/GoalTracker.tsx`.

The pattern: rename each cogs-relevant SWR's destructured `data` to `rawXxx`, then build the adjusted object so existing `.rows` reads are unchanged.

- [ ] **Step 1: Dashboard main data (`:161`).** Find:

```tsx
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(
    buildDateRangeKey('/api/data', filters.range),
    ...
  );
```
Rename `data` → `rawData` in that destructure ONLY, then immediately after the SWR add:
```tsx
  const [cogsSettings] = useCogsSettings();
  const data = useMemo(
    () => (rawData ? { ...rawData, rows: applyCogsToRows(rawData.rows, cogsSettings) } : rawData),
    [rawData, cogsSettings],
  );
```
(All existing `data.rows` / `data.stores` reads now use the adjusted object. `data.stores` etc. pass through via the spread.) Add imports:
```tsx
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import { applyCogsToRows } from '@/lib/cogsSettings';
```
Verify `useMemo` is already imported (it is).

- [ ] **Step 2: Dashboard prev-range (`:580`) + chart (`:598`).** For each, rename the destructured `data:` alias (e.g. `data: prevData` → `data: rawPrevData`, `data: chartDataResp` → `data: rawChartDataResp`) and add an adjusted memo reusing `cogsSettings`:
```tsx
  const prevData = useMemo(() => (rawPrevData ? { ...rawPrevData, rows: applyCogsToRows(rawPrevData.rows, cogsSettings) } : rawPrevData), [rawPrevData, cogsSettings]);
  const chartDataResp = useMemo(() => (rawChartDataResp ? { ...rawChartDataResp, rows: applyCogsToRows(rawChartDataResp.rows, cogsSettings) } : rawChartDataResp), [rawChartDataResp, cogsSettings]);
```
(Use the actual current alias names found at those lines.)

- [ ] **Step 3: GoalTracker wide fetch (`:116`/`:128`).** In `GoalTracker.tsx`, find `const forecastRows = wideData?.rows ?? data.rows;` (`:128`). Adjust both inputs:
```tsx
  const [cogsSettings] = useCogsSettings();
  const forecastRows = useMemo(
    () => applyCogsToRows(wideData?.rows ?? data.rows, cogsSettings),
    [wideData, data.rows, cogsSettings],
  );
```
Add the imports (`useCogsSettings`, `applyCogsToRows`, ensure `useMemo`).

- [ ] **Step 4: Type-check + full suites**

Run: `cd dashboard-web && npx tsc --noEmit && npx vitest run && npx vitest run --config vitest.config.dom.ts`
Expected: tsc 0; all green (no behavior change yet — default settings reproduce 25%).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx dashboard-web/src/components/GoalTracker.tsx
git commit -m "feat(cogs): apply effective-COGS recompute at the cogs-relevant /api/data consumers"
```

---

### Task 6: `CogsSettings.tsx` editor UI (TDD via DOM test)

**Files:**
- Create: `dashboard-web/src/components/CogsSettings.tsx`
- Test: `dashboard-web/src/components/__tests__/CogsSettings.dom.test.tsx`

- [ ] **Step 1: Write the failing DOM test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CogsSettings } from '@/components/CogsSettings';
import { readCogsSettings } from '@/lib/cogsSettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

beforeEach(() => { window.localStorage.clear(); });

describe('CogsSettings', () => {
  it('renders the business % field at the 25% default', () => {
    render(<CogsSettings storeNames={['uzoshop', 'zolplus', 'usmile360']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    expect((screen.getByTestId('cogs-business-input') as HTMLInputElement).value).toBe('25');
  });

  it('applying a business % to the current month persists byMonth[current]', () => {
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '30' } });
    // 'current month' is the default selected apply-scope.
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.byMonth['2026-06']).toBe(30);
  });

  it('switching to per-store mode shows a field per store', () => {
    render(<CogsSettings storeNames={['uzoshop', 'zolplus']} currentMonth="2026-06" monthsInData={['2026-06']} />);
    fireEvent.click(screen.getByTestId('cogs-mode-per-store'));
    expect(screen.getByTestId('cogs-store-input-uzoshop')).toBeTruthy();
    expect(screen.getByTestId('cogs-store-input-zolplus')).toBeTruthy();
  });

  it('"everything" apply-scope sets default + clears byMonth', () => {
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '26' } });
    fireEvent.click(screen.getByTestId('cogs-scope-everything'));
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.default).toBe(26);
    expect(readCogsSettings().business.byMonth).toEqual({});
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run --config vitest.config.dom.ts src/components/__tests__/CogsSettings.dom.test.tsx`).

- [ ] **Step 3: Implement `CogsSettings.tsx`** — token-only, reuse `Card`/`Button`/`NativeSelect`. Props: `{ storeNames: string[]; currentMonth: string; monthsInData: string[] }`. Local form state (mode, business %, per-store %s, apply-scope, specific month). On "החל שינוי", build the next `CogsSettings` via `applyPctToScope` on the active scope(s) and call the `update` from `useCogsSettings`. Include the `data-testid`s used above (`cogs-business-input`, `cogs-mode-per-store`, `cogs-store-input-<store>`, `cogs-scope-everything`, `cogs-apply`), the segmented mode control, the 4 apply-scope radios + a `NativeSelect` of `monthsInData` for "specific", and a read-only timeline table of effective % per month (business: one column; per-store: a column per store) computed via `effectiveCogsPct`. All Hebrew labels per the mockup. Must use only token classes (no raw hex/oklch) so `designColorGuard` passes; AA both themes.

Full component (copy verbatim):

```tsx
'use client';
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { cn } from '@/lib/utils';
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import {
  DEFAULT_COGS_PCT, effectiveCogsPct, applyPctToScope,
  type ApplyScope, type CogsScopeSettings, type CogsSettings as TCogs,
} from '@/lib/cogsSettings';

type ScopeKind = 'current' | 'specific' | 'all-previous' | 'everything';

export function CogsSettings({ storeNames, currentMonth, monthsInData }: {
  storeNames: string[]; currentMonth: string; monthsInData: string[];
}) {
  const [settings, update] = useCogsSettings();
  const [mode, setMode] = useState<TCogs['mode']>(settings.mode);
  const [businessPct, setBusinessPct] = useState<string>(String(settings.business.default ?? DEFAULT_COGS_PCT));
  const [storePct, setStorePct] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const s of storeNames) o[s] = String(settings.perStore[s]?.default ?? DEFAULT_COGS_PCT);
    return o;
  });
  const [scopeKind, setScopeKind] = useState<ScopeKind>('current');
  const [specificMonth, setSpecificMonth] = useState<string>(currentMonth);

  const months = useMemo(() => Array.from(new Set([...monthsInData, currentMonth])).sort().reverse(), [monthsInData, currentMonth]);

  const buildApply = (): ApplyScope => {
    switch (scopeKind) {
      case 'current': return { kind: 'current', currentMonth };
      case 'specific': return { kind: 'specific', month: specificMonth };
      case 'all-previous': return { kind: 'all-previous', currentMonth };
      case 'everything': return { kind: 'everything' };
    }
  };

  const onApply = () => {
    const apply = buildApply();
    if (mode === 'business') {
      const pct = clampPct(businessPct);
      const next: TCogs = { ...settings, mode, business: applyPctToScope(settings.business, pct, apply, months) };
      update(next);
    } else {
      const perStore = { ...settings.perStore };
      for (const s of storeNames) {
        const scope: CogsScopeSettings = perStore[s] ?? { default: DEFAULT_COGS_PCT, byMonth: {} };
        perStore[s] = applyPctToScope(scope, clampPct(storePct[s]), apply, months);
      }
      update({ ...settings, mode, perStore });
    }
  };

  // Mode toggle persists immediately (it's a global switch).
  const switchMode = (m: TCogs['mode']) => { setMode(m); update({ ...settings, mode: m }); };

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-bold text-ink">הוצאות מלאי (COGS)</h3>

      {/* mode */}
      <div>
        <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1.5">מצב (גלובלי)</div>
        <div className="inline-flex rounded-md bg-glass-2 border border-glass-edge p-0.5 gap-0.5">
          <Button type="button" variant="ghost" data-testid="cogs-mode-business"
            onClick={() => switchMode('business')}
            className={cn('h-auto px-3 py-1.5 text-sm', mode === 'business' && 'bg-accent text-accent-fg')}>רמת עסק</Button>
          <Button type="button" variant="ghost" data-testid="cogs-mode-per-store"
            onClick={() => switchMode('per-store')}
            className={cn('h-auto px-3 py-1.5 text-sm', mode === 'per-store' && 'bg-accent text-accent-fg')}>רמת חנות</Button>
        </div>
      </div>

      {/* % inputs */}
      <div className="space-y-2">
        {mode === 'business' ? (
          <PctField label="כל העסק" testid="cogs-business-input" value={businessPct} onChange={setBusinessPct} />
        ) : (
          storeNames.map((s) => (
            <PctField key={s} label={s} testid={`cogs-store-input-${s}`} value={storePct[s] ?? ''} onChange={(v) => setStorePct((p) => ({ ...p, [s]: v }))} />
          ))
        )}
      </div>

      {/* apply-scope */}
      <fieldset className="space-y-1.5">
        <legend className="text-2xs uppercase tracking-wide text-ink-muted mb-1">החל על</legend>
        <Radio name="cogs-scope" testid="cogs-scope-current" checked={scopeKind === 'current'} onChange={() => setScopeKind('current')} label={`החודש הנוכחי (${currentMonth})`} />
        <Radio name="cogs-scope" testid="cogs-scope-specific" checked={scopeKind === 'specific'} onChange={() => setScopeKind('specific')} label="חודש ספציפי" />
        {scopeKind === 'specific' && (
          <div className="ms-6">
            <NativeSelect data-testid="cogs-month" value={specificMonth} onChange={(e) => setSpecificMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </div>
        )}
        <Radio name="cogs-scope" testid="cogs-scope-all-previous" checked={scopeKind === 'all-previous'} onChange={() => setScopeKind('all-previous')} label="כל החודשים הקודמים" />
        <Radio name="cogs-scope" testid="cogs-scope-everything" checked={scopeKind === 'everything'} onChange={() => setScopeKind('everything')} label="הכל — קודמים + נוכחי + עתידיים" />
      </fieldset>

      <Button type="button" variant="primary" data-testid="cogs-apply" onClick={onApply} className="w-full">החל שינוי</Button>

      <p className="text-2xs text-ink-muted leading-relaxed">
        ברירת מחדל {DEFAULT_COGS_PCT}% לכל חודש שלא נערך. השינוי רטרואקטיבי ומיידי בכל הדשבורד. מסונכרן לענן.
      </p>

      {/* timeline */}
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink-secondary">
              <th className="text-start px-2 py-1 font-medium">חודש</th>
              {mode === 'per-store'
                ? storeNames.map((s) => <th key={s} className="text-end px-2 py-1 font-medium">{s}</th>)
                : <th className="text-end px-2 py-1 font-medium">אחוז</th>}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m} className="border-t border-glass-edge">
                <td className="text-start px-2 py-1 tabular-nums">{m}</td>
                {mode === 'per-store'
                  ? storeNames.map((s) => <td key={s} className="text-end px-2 py-1 tabular-nums">{(effectiveCogsPct(settings, s, m) * 100).toFixed(0)}%</td>)
                  : <td className="text-end px-2 py-1 tabular-nums">{(effectiveCogsPct(settings, '', m) * 100).toFixed(0)}%</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function clampPct(v: string): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_COGS_PCT;
  return Math.max(0, Math.min(100, n));
}

function PctField({ label, testid, value, onChange }: { label: string; testid: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <div className="relative w-28">
        <input data-testid={testid} value={value} inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm font-bold text-center tabular-nums bg-glass-2 text-ink border border-glass-edge rounded-md ps-7 pe-2 py-2" />
        <span className="absolute inset-inline-start-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs font-bold">%</span>
      </div>
    </div>
  );
}

function Radio({ name, testid, checked, onChange, label }: { name: string; testid: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
      <input type="radio" name={name} data-testid={testid} checked={checked} onChange={onChange} className="accent-accent w-4 h-4" />
      <span>{label}</span>
    </label>
  );
}
```

- [ ] **Step 4: Run the DOM test → PASS.** Fix any token-guard issue (no raw hex). Run `npx vitest run src/lib/__tests__/designColorGuard.test.ts` too.
- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/CogsSettings.tsx dashboard-web/src/components/__tests__/CogsSettings.dom.test.tsx
git commit -m "feat(cogs): CogsSettings editor — mode toggle, %/store inputs, 4 apply-scopes, effective-% timeline"
```

---

### Task 7: Mount `CogsSettings` beside `BillingSettings`

**Files:** Modify `dashboard-web/src/components/Dashboard.tsx` (`:1053`).

- [ ] **Step 1:** Find `<BillingSettings storeNames={data.stores} />` (`:1053`) and add `CogsSettings` right after it, passing the current month + the months present in the loaded rows:
```tsx
          <BillingSettings storeNames={data.stores} />
          <CogsSettings
            storeNames={data.stores}
            currentMonth={getTodayInIsraelTz().slice(0, 7)}
            monthsInData={Array.from(new Set(data.rows.map((r) => r.date.slice(0, 7)))).sort()}
          />
```
Add `import { CogsSettings } from '@/components/CogsSettings';` and ensure `getTodayInIsraelTz` is imported from `@/lib/dateRange` (it already exists per memory). If a different "today" helper is the local convention, use it.

- [ ] **Step 2: tsc + build** — `cd dashboard-web && npx tsc --noEmit && npm run build` → green.
- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx
git commit -m "feat(cogs): mount CogsSettings panel beside BillingSettings"
```

---

### Task 8: Full gates + User Manual + deploy

- [ ] **Step 1:** `cd dashboard-web && npx tsc --noEmit && npx vitest run && npx vitest run --config vitest.config.dom.ts && npx next lint && npm run build` → all green / warnings-only.
- [ ] **Step 2: User Manual** — bump version, add a "מה התחדש" entry (editable COGS %: global business/per-store, per-month, 4 apply-scopes, retroactive, default 25%, weighted-avg display), and document the panel + the env-var supersession note. (docs-currency pre-push gate requires it.)
- [ ] **Step 3: Commit docs**, then **Step 4:** `git push origin main`. Then **prod-verify**: open the panel, set the current month to 30%, confirm the hero operating-profit + P&L + GoalTracker reflect the new COGS, both themes.

---

## Self-review (against spec)
- Data model + persistence (localStorage + cloud + version) → Task 1 ✅
- effectiveCogsPct (byMonth>default>25, business/per-store) → Task 1 ✅
- applyCogsToRows (cogs+netProfit, grossProfit untouched, default reproduces 25%) → Task 2 ✅
- 4 apply-scopes (everything = default+clear) → Task 3 ✅
- reactive hooks → Task 4 ✅
- recompute flows to every consumer via wrapped SWRs → Task 5 ✅ (campaigns excluded — verified no cogs)
- editor UI (mode/inputs/scopes/timeline), token-only, AA → Task 6 ✅
- mount beside BillingSettings → Task 7 ✅
- weighted-avg business display = Σcogs/Σrevenue → automatic (no code; aggregate sums adjusted rows) ✅
- env-var supersession documented → Task 8 manual ✅
- No DB/cron change ✅ · grossProfit not cogs-derived (verified) ✅
