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
