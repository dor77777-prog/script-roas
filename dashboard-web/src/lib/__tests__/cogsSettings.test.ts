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
