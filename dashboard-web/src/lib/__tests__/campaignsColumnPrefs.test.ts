import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGNS_COLUMNS,
  REORDERABLE_COLUMN_IDS,
  buildHiddenColumnsCss,
  moveCampaignsColumn,
  readCampaignsColumnPrefs,
  resetCampaignsColumnOrder,
  resolveCampaignsColumnOrder,
  restoreAllCampaignsColumns,
  toggleCampaignsColumnHidden,
  writeCampaignsColumnPrefs,
} from '@/lib/campaignsColumnPrefs';

/**
 * Phase 05.7.x — locks the contract of the column-prefs helpers behind
 * the "עמודות" menu in the Campaigns table. Two concerns under test:
 *
 *   1. `resolveCampaignsColumnOrder` — pure function that merges a saved
 *      order with REORDERABLE_COLUMN_IDS, dropping unknowns and appending
 *      missing IDs. Drives both the table header and the row body — they
 *      MUST iterate the same list, so this is the lock-step contract.
 *
 *   2. `moveCampaignsColumn` / `resetCampaignsColumnOrder` /
 *      `toggleCampaignsColumnHidden` — write to localStorage AND push to
 *      cloud sync. Tests stub `window` so the helpers can run under the
 *      project's node-default vitest config (no jsdom required).
 *
 * The project-wide vitest env is `node`, per the comment in
 * vitest.config.ts. Adding jsdom would slow down the existing
 * pure-function suite ~5x for no benefit. Instead we stub the bare
 * minimum DOM (localStorage + event API) that this module touches.
 */

// Mock cloudSync.pushCloudKey — it fires fetch() to /api/dashboard-state.
// We capture calls so we can assert the contract without hitting the network.
vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
}));

/**
 * Build a fake `window` with just the surface this module touches:
 *   - localStorage (Storage-like)
 *   - dispatchEvent (for the same-tab CustomEvent broadcast)
 *   - addEventListener / removeEventListener (so test code can listen)
 *
 * We use a Map-backed Storage shim so it actually behaves like a real
 * Storage between calls (get/set/clear/removeItem).
 */
function makeFakeWindow(): {
  win: typeof window;
  listeners: Map<string, Set<EventListener>>;
} {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();

  const localStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };

  const win = {
    localStorage,
    addEventListener: (type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (ev: Event) => {
      const set = listeners.get(ev.type);
      if (set) {
        for (const l of set) l(ev);
      }
      return true;
    },
    // CustomEvent constructor — the helper calls `new CustomEvent(...)`.
    // We re-export the globalThis one so tests don't have to redefine it.
    CustomEvent: globalThis.CustomEvent ?? (class extends Event {
      constructor(type: string, init?: EventInit) {
        super(type, init);
      }
    }),
  } as unknown as typeof window;

  return { win, listeners };
}

let fake: ReturnType<typeof makeFakeWindow>;

beforeEach(() => {
  fake = makeFakeWindow();
  vi.stubGlobal('window', fake.win);
  // The helper uses `new CustomEvent(...)` — make sure that resolves
  // even though we're in a node env.
  if (typeof globalThis.CustomEvent === 'undefined') {
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        constructor(type: string, init?: EventInit) {
          super(type, init);
        }
      },
    );
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('REORDERABLE_COLUMN_IDS — schema sanity', () => {
  it('contains exactly the 15 metric columns documented in the manual', () => {
    expect(REORDERABLE_COLUMN_IDS).toHaveLength(15);
  });

  it('every reorderable ID exists in CAMPAIGNS_COLUMNS', () => {
    const known = new Set(CAMPAIGNS_COLUMNS.map(c => c.id));
    for (const id of REORDERABLE_COLUMN_IDS) {
      expect(known.has(id)).toBe(true);
    }
  });

  it('no reorderable ID is also pinned (pinned cols are structural, not movable)', () => {
    const pinned = new Set(
      CAMPAIGNS_COLUMNS.filter(c => c.pinned).map(c => c.id),
    );
    for (const id of REORDERABLE_COLUMN_IDS) {
      expect(pinned.has(id)).toBe(false);
    }
  });
});

describe('resolveCampaignsColumnOrder — pure merge contract', () => {
  it('undefined saved order → returns canonical order (copy, not reference)', () => {
    const out = resolveCampaignsColumnOrder(undefined);
    expect(out).toEqual([...REORDERABLE_COLUMN_IDS]);
    // Confirm we return a NEW array — callers may mutate the result
    // (CampaignsTable does so to insert structural columns).
    expect(out).not.toBe(REORDERABLE_COLUMN_IDS as unknown as string[]);
  });

  it('empty saved order → returns canonical order', () => {
    expect(resolveCampaignsColumnOrder([])).toEqual([...REORDERABLE_COLUMN_IDS]);
  });

  it('preserves a complete saved order verbatim', () => {
    // Operator dragged ROAS first, then spend, then everything else default.
    const saved = ['roas', 'spend', 'budget', 'conversionValue', 'roasShopify',
                   'roasShopifyPlatform', 'shopifyValuePlatform', 'shopifyUnitsPlatform',
                   'shopifyValueTotal', 'shopifyUnitsTotal', 'conversions', 'ctr',
                   'cpc', 'cpm', 'cpa'];
    expect(resolveCampaignsColumnOrder(saved)).toEqual(saved);
  });

  it('appends missing IDs in canonical position', () => {
    // Operator saved an order with only 3 IDs (older version of the
    // schema, or someone hand-edited the localStorage value).
    const saved = ['cpa', 'cpm', 'spend'];
    const out = resolveCampaignsColumnOrder(saved);
    // First 3 IDs are the saved ones, in saved order.
    expect(out.slice(0, 3)).toEqual(['cpa', 'cpm', 'spend']);
    // The remaining 12 IDs are the rest of REORDERABLE in canonical order.
    const missing = REORDERABLE_COLUMN_IDS.filter(
      id => !saved.includes(id),
    );
    expect(out.slice(3)).toEqual(missing);
  });

  it('drops unknown IDs from saved order (schema rename / removal)', () => {
    // 'oldDeprecatedColumn' is not in REORDERABLE — discard it. The
    // operator never sees an error; the missing column simply ceases
    // to render.
    const saved = ['oldDeprecatedColumn', 'cpa', 'somethingElse', 'spend'];
    const out = resolveCampaignsColumnOrder(saved);
    expect(out).toContain('cpa');
    expect(out).toContain('spend');
    expect(out).not.toContain('oldDeprecatedColumn');
    expect(out).not.toContain('somethingElse');
    // All 15 reorderable IDs end up in the result.
    expect(out).toHaveLength(REORDERABLE_COLUMN_IDS.length);
  });

  it('de-duplicates a saved order that lists an ID twice', () => {
    // If the operator's saved order somehow has duplicates (cloud-sync
    // race?), keep only the first occurrence.
    const saved = ['cpa', 'spend', 'cpa', 'cpm'];
    const out = resolveCampaignsColumnOrder(saved);
    const cpaCount = out.filter(id => id === 'cpa').length;
    expect(cpaCount).toBe(1);
    // 'cpa' should be in its first-occurrence position (index 0).
    expect(out[0]).toBe('cpa');
  });

  it('result always contains every REORDERABLE_COLUMN_IDS member exactly once', () => {
    // Invariant: no matter what we feed in, the operator never loses
    // access to a reorderable column. This is the safety net.
    const inputs: (string[] | undefined)[] = [
      undefined,
      [],
      ['cpa'],
      ['oldColumn', 'anotherOld'],
      ['cpa', 'cpa', 'spend', 'spend'],
      [...REORDERABLE_COLUMN_IDS].reverse(),
    ];
    for (const input of inputs) {
      const out = resolveCampaignsColumnOrder(input);
      for (const id of REORDERABLE_COLUMN_IDS) {
        expect(out.filter(x => x === id)).toHaveLength(1);
      }
    }
  });
});

describe('moveCampaignsColumn — reorder one slot', () => {
  it('moves a column one slot up', () => {
    // Start from canonical: spend(0), budget(1), conversionValue(2), ...
    // Move budget UP one → expect: budget(0), spend(1), conversionValue(2)
    const next = moveCampaignsColumn('budget', 'up');
    expect(next.order).toBeDefined();
    expect(next.order![0]).toBe('budget');
    expect(next.order![1]).toBe('spend');
    // Verify persists in localStorage.
    const stored = readCampaignsColumnPrefs();
    expect(stored.order![0]).toBe('budget');
  });

  it('moves a column one slot down', () => {
    // Start from canonical: spend(0), budget(1), conversionValue(2)
    // Move spend DOWN one → expect: budget(0), spend(1), conversionValue(2)
    const next = moveCampaignsColumn('spend', 'down');
    expect(next.order![0]).toBe('budget');
    expect(next.order![1]).toBe('spend');
  });

  it('is a no-op when moving the first column up', () => {
    // 'spend' is at index 0 — moving up would push it to -1. Don't.
    const before = readCampaignsColumnPrefs();
    const next = moveCampaignsColumn('spend', 'up');
    // No order should have been written.
    expect(next.order).toBe(before.order);
  });

  it('is a no-op when moving the last column down', () => {
    // 'cpa' is the last in REORDERABLE — moving down past the end is a no-op.
    const before = readCampaignsColumnPrefs();
    const next = moveCampaignsColumn('cpa', 'down');
    expect(next.order).toBe(before.order);
  });

  it('is a no-op for an unknown column ID', () => {
    const before = readCampaignsColumnPrefs();
    const next = moveCampaignsColumn('nonExistentColumn', 'up');
    expect(next).toEqual(before);
  });

  it('two consecutive moves compose correctly', () => {
    // spend → up (no-op, already first)
    moveCampaignsColumn('spend', 'up');
    // cpa → up (cpa was last, becomes second-to-last)
    moveCampaignsColumn('cpa', 'up');
    const out = readCampaignsColumnPrefs();
    expect(out.order).toBeDefined();
    const cpaIdx = out.order!.indexOf('cpa');
    expect(cpaIdx).toBe(out.order!.length - 2);
  });

  it('preserves hidden state across reorder', () => {
    // Hide some columns first.
    toggleCampaignsColumnHidden('cpm');
    toggleCampaignsColumnHidden('cpc');
    // Then reorder.
    moveCampaignsColumn('cpa', 'up');
    const out = readCampaignsColumnPrefs();
    // Hidden array should still contain both IDs.
    expect(out.hidden).toContain('cpm');
    expect(out.hidden).toContain('cpc');
  });
});

describe('resetCampaignsColumnOrder — restore canonical', () => {
  it('clears the saved order entirely', () => {
    moveCampaignsColumn('budget', 'up');
    expect(readCampaignsColumnPrefs().order).toBeDefined();
    resetCampaignsColumnOrder();
    expect(readCampaignsColumnPrefs().order).toBeUndefined();
  });

  it('after reset, resolveCampaignsColumnOrder returns canonical', () => {
    moveCampaignsColumn('budget', 'up');
    moveCampaignsColumn('cpa', 'up');
    resetCampaignsColumnOrder();
    const stored = readCampaignsColumnPrefs();
    expect(resolveCampaignsColumnOrder(stored.order)).toEqual([
      ...REORDERABLE_COLUMN_IDS,
    ]);
  });

  it('preserves hidden state across reset (only order is reset)', () => {
    toggleCampaignsColumnHidden('cpm');
    moveCampaignsColumn('budget', 'up');
    resetCampaignsColumnOrder();
    expect(readCampaignsColumnPrefs().hidden).toContain('cpm');
  });
});

describe('readCampaignsColumnPrefs — tolerant read', () => {
  it('returns empty on missing localStorage entry', () => {
    expect(readCampaignsColumnPrefs()).toEqual({ hidden: [], order: undefined });
  });

  it('returns empty on malformed JSON', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      '{ not json',
    );
    expect(readCampaignsColumnPrefs()).toEqual({ hidden: [], order: undefined });
  });

  it('parses the canonical {hidden, order} shape', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      JSON.stringify({ hidden: ['cpm'], order: ['cpa', 'spend'] }),
    );
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual(['cpm']);
    expect(out.order).toEqual(['cpa', 'spend']);
  });

  it('parses the legacy bare-array form as {hidden: [...]} (back-compat)', () => {
    // Older versions stored a bare array of hidden IDs — we still
    // accept that to keep the existing operator's prefs working after
    // upgrade.
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      JSON.stringify(['cpm', 'ctr']),
    );
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual(['cpm', 'ctr']);
    expect(out.order).toBeUndefined();
  });

  it('drops non-string entries from hidden array', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      JSON.stringify({ hidden: ['cpm', 42, null, 'cpc'], order: undefined }),
    );
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual(['cpm', 'cpc']);
  });

  it('drops non-string entries from order array', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      JSON.stringify({ hidden: [], order: ['cpa', 99, null, 'spend'] }),
    );
    const out = readCampaignsColumnPrefs();
    expect(out.order).toEqual(['cpa', 'spend']);
  });
});

describe('toggleCampaignsColumnHidden — hide/show one column', () => {
  it('adds an ID when not hidden', () => {
    const out = toggleCampaignsColumnHidden('cpm');
    expect(out.hidden).toContain('cpm');
  });

  it('removes an ID when already hidden', () => {
    toggleCampaignsColumnHidden('cpm');
    const out = toggleCampaignsColumnHidden('cpm');
    expect(out.hidden).not.toContain('cpm');
  });

  it('keeps the hidden array sorted (deterministic for diffs in cloud sync)', () => {
    toggleCampaignsColumnHidden('cpm');
    toggleCampaignsColumnHidden('cpa');
    toggleCampaignsColumnHidden('cpc');
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual(['cpa', 'cpc', 'cpm']);
  });
});

describe('restoreAllCampaignsColumns — show everything', () => {
  it('clears the hidden array', () => {
    toggleCampaignsColumnHidden('cpm');
    toggleCampaignsColumnHidden('cpc');
    const out = restoreAllCampaignsColumns();
    expect(out.hidden).toEqual([]);
  });

  it('also wipes the saved order (lock current behaviour)', () => {
    // `restoreAllCampaignsColumns` constructs {hidden: []} without
    // copying the existing order — this wipes the order as a side
    // effect. Lock that so a future refactor that splits the two
    // surfaces them as separate decisions.
    moveCampaignsColumn('budget', 'up');
    toggleCampaignsColumnHidden('cpm');
    restoreAllCampaignsColumns();
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual([]);
    expect(out.order).toBeUndefined();
  });
});

describe('writeCampaignsColumnPrefs — cloud sync side effect', () => {
  it('persists to localStorage', () => {
    writeCampaignsColumnPrefs({ hidden: ['cpm'], order: ['cpa', 'spend'] });
    const raw = window.localStorage.getItem(
      'roas-dashboard:campaigns-column-visibility',
    );
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.hidden).toEqual(['cpm']);
    expect(parsed.order).toEqual(['cpa', 'spend']);
  });

  it('dispatches a CustomEvent so listeners in the same tab re-read prefs', () => {
    const handler = vi.fn();
    window.addEventListener(
      'roas-campaigns-column-visibility-changed',
      handler,
    );
    writeCampaignsColumnPrefs({ hidden: ['cpm'] });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(
      'roas-campaigns-column-visibility-changed',
      handler,
    );
  });
});

describe('buildHiddenColumnsCss — generated stylesheet', () => {
  it('returns empty string when nothing is hidden', () => {
    expect(buildHiddenColumnsCss([])).toBe('');
  });

  it('generates a scoped display:none rule for each hidden ID', () => {
    const css = buildHiddenColumnsCss(['cpm', 'cpc']);
    expect(css).toContain('.roas-campaigns-table [data-col-id="cpm"]');
    expect(css).toContain('.roas-campaigns-table [data-col-id="cpc"]');
    expect(css).toContain('display: none !important');
  });

  it('filters out IDs with non-alphanumeric characters (XSS hardening)', () => {
    // Attacker tries to inject a CSS selector — the regex rejects it.
    const css = buildHiddenColumnsCss(['cpm', '"]{}<script>']);
    expect(css).toContain('cpm');
    expect(css).not.toContain('script');
  });

  it('returns empty when every ID is filtered out', () => {
    expect(buildHiddenColumnsCss(['"]{}<script>'])).toBe('');
  });
});
