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
