import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GOAL_SETTINGS_KEY, GOAL_SETTINGS_EVENT, GOAL_SETTINGS_VERSION,
  LEGACY_GOAL_KEY,
  defaultGoalSettings, effectiveGoal,
  readGoalSettings, writeGoalSettings,
  monthFromRange,
  type GoalSettings,
} from '@/lib/goalSettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

// getTodayInIsraelTz powers the migration's "current month" seed. Mock it so
// the migration test is deterministic regardless of the real clock.
vi.mock('@/lib/dateRange', () => ({ getTodayInIsraelTz: vi.fn(() => '2026-06-15') }));

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

describe('goalSettings — model + defaults', () => {
  it('default is business-wide with an empty byMonth map', () => {
    const s = defaultGoalSettings();
    expect(s).toEqual({ v: GOAL_SETTINGS_VERSION, byMonth: {} });
  });

  it('exposes the canonical key + legacy key + event constants', () => {
    expect(GOAL_SETTINGS_KEY).toBe('roas-dashboard:goal-settings');
    expect(LEGACY_GOAL_KEY).toBe('roas-dashboard:monthly-revenue-goal');
    expect(GOAL_SETTINGS_EVENT).toBe('roas-goal-changed');
  });
});

describe('effectiveGoal — exact > carry-forward > null', () => {
  const s: GoalSettings = { v: 1, byMonth: { '2026-03': 50000, '2026-05': 70000 } };

  it('exact month wins; carriedFrom is null', () => {
    expect(effectiveGoal(s, '2026-05')).toEqual({ value: 70000, carriedFrom: null });
    expect(effectiveGoal(s, '2026-03')).toEqual({ value: 50000, carriedFrom: null });
  });

  it('no exact → carries the LATEST earlier set month', () => {
    // 2026-06 has none → carries from 2026-05 (latest < 2026-06)
    expect(effectiveGoal(s, '2026-06')).toEqual({ value: 70000, carriedFrom: '2026-05' });
    // 2026-04 has none → carries from 2026-03 (only earlier set month)
    expect(effectiveGoal(s, '2026-04')).toEqual({ value: 50000, carriedFrom: '2026-03' });
  });

  it('no exact and no earlier set month → null / null', () => {
    expect(effectiveGoal(s, '2026-02')).toEqual({ value: null, carriedFrom: null });
    expect(effectiveGoal(s, '2026-01')).toEqual({ value: null, carriedFrom: null });
  });

  it('empty settings → null / null for any month', () => {
    expect(effectiveGoal(defaultGoalSettings(), '2026-06')).toEqual({ value: null, carriedFrom: null });
  });

  it('a LATER set month never carries backward to an earlier month', () => {
    const only = { v: 1, byMonth: { '2026-09': 99000 } };
    expect(effectiveGoal(only, '2026-06')).toEqual({ value: null, carriedFrom: null });
  });
});

describe('monthFromRange — single-calendar-month detection', () => {
  it('full calendar month → that month', () => {
    expect(monthFromRange({ from: '2026-06-01', to: '2026-06-30' })).toBe('2026-06');
    expect(monthFromRange({ from: '2026-02-01', to: '2026-02-28' })).toBe('2026-02');
  });

  it('partial range INSIDE one month → that month', () => {
    expect(monthFromRange({ from: '2026-06-10', to: '2026-06-20' })).toBe('2026-06');
    expect(monthFromRange({ from: '2026-06-15', to: '2026-06-15' })).toBe('2026-06'); // single day
  });

  it('cross-month range → null', () => {
    expect(monthFromRange({ from: '2026-05-20', to: '2026-06-10' })).toBeNull();
    expect(monthFromRange({ from: '2026-01-01', to: '2026-12-31' })).toBeNull();
  });

  it('malformed inputs → null', () => {
    expect(monthFromRange({ from: '', to: '' })).toBeNull();
    expect(monthFromRange({ from: '2026-06', to: '2026-06-30' })).toBeNull();
    expect(monthFromRange({ from: '2026-06-01', to: 'bogus' })).toBeNull();
  });
});

describe('readGoalSettings / writeGoalSettings — persistence + cloud', () => {
  it('read returns default when nothing stored', () => {
    expect(readGoalSettings()).toEqual(defaultGoalSettings());
  });

  it('write round-trips + bumps cloud + dispatches event constant', async () => {
    const next: GoalSettings = { v: 1, byMonth: { '2026-06': 80000 } };
    writeGoalSettings(next);
    expect(JSON.parse(window.localStorage.getItem(GOAL_SETTINGS_KEY)!).byMonth).toEqual({ '2026-06': 80000 });
    const { pushCloudKey } = await import('@/lib/cloudSync');
    expect(pushCloudKey).toHaveBeenCalledWith(GOAL_SETTINGS_KEY, expect.objectContaining({ byMonth: { '2026-06': 80000 } }));
  });

  it('write stamps the current version', () => {
    writeGoalSettings({ v: 99 as number, byMonth: { '2026-06': 1 } } as GoalSettings);
    expect(JSON.parse(window.localStorage.getItem(GOAL_SETTINGS_KEY)!).v).toBe(GOAL_SETTINGS_VERSION);
  });

  it('tolerates malformed JSON → default', () => {
    window.localStorage.setItem(GOAL_SETTINGS_KEY, '{not json');
    expect(readGoalSettings()).toEqual(defaultGoalSettings());
  });

  it('drops malformed byMonth entries (NaN / non-positive / non-number)', () => {
    window.localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify({
      v: 1, byMonth: { '2026-06': 70000, '2026-07': 'x', '2026-08': 0, '2026-09': -5, '2026-10': NaN },
    }));
    const s = readGoalSettings();
    expect(s.byMonth).toEqual({ '2026-06': 70000 });
  });
});

describe('migration — legacy monthly-revenue-goal seeds byMonth[currentMonth]', () => {
  it('seeds the current IL month when only the legacy key exists', () => {
    window.localStorage.setItem(LEGACY_GOAL_KEY, '70000'); // legacy number string
    // mocked getTodayInIsraelTz → '2026-06-15' → current month '2026-06'
    const s = readGoalSettings();
    expect(s.byMonth).toEqual({ '2026-06': 70000 });
  });

  it('does NOT seed past months — only the current month', () => {
    window.localStorage.setItem(LEGACY_GOAL_KEY, '55000');
    const s = readGoalSettings();
    expect(Object.keys(s.byMonth)).toEqual(['2026-06']);
  });

  it('goal-settings present → ignores the legacy key (no migration)', () => {
    window.localStorage.setItem(LEGACY_GOAL_KEY, '70000');
    window.localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify({ v: 1, byMonth: { '2026-04': 40000 } }));
    const s = readGoalSettings();
    expect(s.byMonth).toEqual({ '2026-04': 40000 }); // legacy ignored
  });

  it('no legacy + no goal-settings → plain default', () => {
    expect(readGoalSettings()).toEqual(defaultGoalSettings());
  });

  it('legacy value not a positive number → no seed (default)', () => {
    window.localStorage.setItem(LEGACY_GOAL_KEY, 'not-a-number');
    expect(readGoalSettings()).toEqual(defaultGoalSettings());
    window.localStorage.setItem(LEGACY_GOAL_KEY, '0');
    expect(readGoalSettings()).toEqual(defaultGoalSettings());
  });
});
