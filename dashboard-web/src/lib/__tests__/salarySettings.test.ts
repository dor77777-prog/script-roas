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
