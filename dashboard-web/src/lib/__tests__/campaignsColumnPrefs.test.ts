import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGNS_COLUMNS,
  CAMPAIGNS_PREFS_VERSION,
  DEFAULT_HIDDEN_COLUMN_IDS,
  REORDERABLE_COLUMN_IDS,
  buildHiddenColumnsCss,
  migrateCampaignsColumnPrefs,
  moveCampaignsColumn,
  readCampaignsColumnPrefs,
  resetCampaignsColumnOrder,
  resetCampaignsColumnsToDefault,
  resolveCampaignsColumnOrder,
  restoreAllCampaignsColumns,
  toggleCampaignsColumnHidden,
  writeCampaignsColumnPrefs,
} from '@/lib/campaignsColumnPrefs';

const STORAGE_KEY = 'roas-dashboard:campaigns-column-visibility';

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
  it('contains exactly the 19 metric columns documented in the manual', () => {
    // 16 base columns + 3 new (column-audit 2026-06-01):
    //   shopifyValueAllocated (ROAS Shopify numerator),
    //   clicks, impressions.
    expect(REORDERABLE_COLUMN_IDS).toHaveLength(19);
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

  // Column-audit 2026-06-01 — FIX 1 + FIX 3 registration contract.
  it('registers the new shopifyValueAllocated / clicks / impressions columns', () => {
    const known = new Set(CAMPAIGNS_COLUMNS.map(c => c.id));
    for (const id of ['shopifyValueAllocated', 'clicks', 'impressions']) {
      expect(known.has(id)).toBe(true);
      expect((REORDERABLE_COLUMN_IDS as readonly string[]).includes(id)).toBe(true);
    }
  });

  it('positions shopifyValueAllocated between shopifyValuePlatform and shopifyUnitsPlatform', () => {
    const ids = REORDERABLE_COLUMN_IDS as readonly string[];
    const platformIdx = ids.indexOf('shopifyValuePlatform');
    const allocIdx = ids.indexOf('shopifyValueAllocated');
    const unitsIdx = ids.indexOf('shopifyUnitsPlatform');
    // Allocated (the ROAS Shopify numerator) sits between the deterministic
    // per-platform value (left) and the per-platform units (right).
    expect(platformIdx).toBeGreaterThanOrEqual(0);
    expect(allocIdx).toBeGreaterThan(platformIdx);
    expect(unitsIdx).toBeGreaterThan(allocIdx);
  });

  it('the new shopifyValueAllocated column has the Hebrew label + numerator description', () => {
    const col = CAMPAIGNS_COLUMNS.find(c => c.id === 'shopifyValueAllocated');
    expect(col).toBeDefined();
    expect(col!.label).toBe('ערך Shopify · מוקצה');
    // Description must spell out that this is the ROAS Shopify numerator.
    expect(col!.description).toContain('המונה של ROAS Shopify');
  });
});

// Column-audit 2026-06-01 — FIX 1 + FIX 3 + declutter default-visibility contract.
describe('DEFAULT_HIDDEN_COLUMN_IDS — default visibility (lean declutter)', () => {
  // The full "lean default" hidden seed: redundant/low-signal columns whose
  // information is already covered by a visible column.
  const EXPECTED_HIDDEN = [
    'budget',
    'clicks',
    'cpc',
    'cpm',
    'ctr',
    'impressions',
    'roasShopifyPlatform',
    'shopifyUnitsPlatform',
    'shopifyUnitsTotal',
    'shopifyValuePlatform',
    'shopifyValueTotal',
  ];

  it('hides exactly the lean-declutter set by default', () => {
    expect([...DEFAULT_HIDDEN_COLUMN_IDS].sort()).toEqual(EXPECTED_HIDDEN);
  });

  it('shopifyValueAllocated is VISIBLE by default (the ROAS Shopify numerator stays on)', () => {
    expect((DEFAULT_HIDDEN_COLUMN_IDS as readonly string[]).includes('shopifyValueAllocated')).toBe(false);
  });

  it('keeps the headline columns visible by default', () => {
    // A fresh operator (no saved prefs) reads the seed; the visible set is
    // every reorderable ID NOT in the hidden seed.
    const hidden = new Set(DEFAULT_HIDDEN_COLUMN_IDS as readonly string[]);
    const visible = (REORDERABLE_COLUMN_IDS as readonly string[]).filter(id => !hidden.has(id));
    // The lean default keeps the spend → revenue → ROAS story visible.
    for (const id of [
      'spend',
      'conversionValue',
      'roas',
      'roasShopify',
      'shopifyValueAllocated',
      'shopifyOrdersTotal',
      'conversions',
      'cpa',
    ]) {
      expect(visible).toContain(id);
    }
    // ...and hides the decluttered redundant columns.
    for (const id of ['clicks', 'impressions', 'ctr', 'cpc', 'cpm', 'budget', 'shopifyValueTotal']) {
      expect(visible).not.toContain(id);
    }
  });

  it('every hidden-seed ID is a real, reorderable (toggle-able) column', () => {
    // A hidden default that the operator can never un-hide would be a trap.
    const reorderable = new Set(REORDERABLE_COLUMN_IDS as readonly string[]);
    for (const id of DEFAULT_HIDDEN_COLUMN_IDS) {
      expect(reorderable.has(id)).toBe(true);
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
    // Must list ALL reorderable IDs (a partial list gets the missing ones
    // appended) — kept in sync with REORDERABLE_COLUMN_IDS.
    const saved = ['roas', 'spend', 'budget', 'conversionValue', 'roasShopify',
                   'roasShopifyPlatform', 'shopifyValuePlatform', 'shopifyValueAllocated',
                   'shopifyUnitsPlatform', 'shopifyValueTotal', 'shopifyUnitsTotal',
                   'shopifyOrdersTotal', 'conversions', 'clicks', 'impressions',
                   'ctr', 'cpc', 'cpm', 'cpa'];
    expect(saved).toHaveLength(REORDERABLE_COLUMN_IDS.length);
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
    // Hide some columns first (roas + roasShopify are visible by default,
    // so toggling them ADDS to the hidden set).
    toggleCampaignsColumnHidden('roas');
    toggleCampaignsColumnHidden('roasShopify');
    // Then reorder.
    moveCampaignsColumn('cpa', 'up');
    const out = readCampaignsColumnPrefs();
    // Hidden array should still contain both IDs.
    expect(out.hidden).toContain('roas');
    expect(out.hidden).toContain('roasShopify');
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
    toggleCampaignsColumnHidden('roas');
    moveCampaignsColumn('budget', 'up');
    resetCampaignsColumnOrder();
    expect(readCampaignsColumnPrefs().hidden).toContain('roas');
  });
});

describe('readCampaignsColumnPrefs — tolerant read', () => {
  it('returns the default-hidden seed on missing localStorage entry', () => {
    // Fresh operator (no saved prefs) → clicks/impressions hidden by
    // default; everything else (incl. shopifyValueAllocated) visible.
    expect(readCampaignsColumnPrefs()).toEqual({
      hidden: [...DEFAULT_HIDDEN_COLUMN_IDS],
      order: undefined,
    });
  });

  it('returns the default-hidden seed on malformed JSON', () => {
    window.localStorage.setItem(
      'roas-dashboard:campaigns-column-visibility',
      '{ not json',
    );
    expect(readCampaignsColumnPrefs()).toEqual({
      hidden: [...DEFAULT_HIDDEN_COLUMN_IDS],
      order: undefined,
    });
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
    // roas is visible by default → toggling ADDS it to the hidden set.
    const out = toggleCampaignsColumnHidden('roas');
    expect(out.hidden).toContain('roas');
  });

  it('removes an ID when already hidden', () => {
    toggleCampaignsColumnHidden('roas');
    const out = toggleCampaignsColumnHidden('roas');
    expect(out.hidden).not.toContain('roas');
  });

  it('keeps the hidden array sorted (deterministic for diffs in cloud sync)', () => {
    // Toggle three columns that are VISIBLE by default (not in the seed) so
    // each one is ADDED to the hidden set; the result must stay sorted and
    // still contain the whole declutter seed.
    toggleCampaignsColumnHidden('roas');
    toggleCampaignsColumnHidden('cpa');
    toggleCampaignsColumnHidden('spend');
    const out = readCampaignsColumnPrefs();
    // Sorted: a stable copy equals the array itself.
    expect(out.hidden).toEqual([...out.hidden].sort());
    // Seed + the three newly-hidden columns are all present.
    for (const id of [...DEFAULT_HIDDEN_COLUMN_IDS, 'roas', 'cpa', 'spend']) {
      expect(out.hidden).toContain(id);
    }
  });

  /**
   * HIGH-4 audit fix (2026-05-23): toggle must preserve the operator's
   * saved order. Pre-fix code constructed `{hidden: [...]}` without
   * copying `order` — every hide/show toggle silently reset the saved
   * order to the canonical default.
   *
   * Operator scenario: reorder → hide → reorder → hide ... the saved
   * reorder must survive every toggle so the operator's layout doesn't
   * collapse mid-workflow.
   */
  it('preserves the saved order across hide → reorder → hide (HIGH-4)', () => {
    // 1) Hide a column (roas is visible by default → this ADDS it).
    toggleCampaignsColumnHidden('roas');
    // 2) Reorder another (budget is REORDERABLE[1] → moving up records order).
    moveCampaignsColumn('budget', 'up');
    const orderAfterReorder = readCampaignsColumnPrefs().order;
    expect(orderAfterReorder![0]).toBe('budget');
    // 3) Hide a SECOND column.
    toggleCampaignsColumnHidden('cpa');
    const out = readCampaignsColumnPrefs();
    // Order MUST survive the second toggle.
    expect(out.order).toEqual(orderAfterReorder);
    expect(out.order![0]).toBe('budget');
    // Both toggled columns remain hidden — alongside the declutter seed.
    expect(out.hidden).toContain('roas');
    expect(out.hidden).toContain('cpa');
    expect(out.hidden).toContain('clicks');
    expect(out.hidden).toContain('impressions');
  });

  it('preserves the saved order across un-hide (toggle to clear)', () => {
    moveCampaignsColumn('cpa', 'up');
    const orderAfterReorder = readCampaignsColumnPrefs().order;
    toggleCampaignsColumnHidden('roas'); // hide (roas is visible by default)
    toggleCampaignsColumnHidden('roas'); // un-hide (same call, opposite effect)
    const out = readCampaignsColumnPrefs();
    expect(out.order).toEqual(orderAfterReorder);
    expect(out.hidden).not.toContain('roas');
  });
});

describe('restoreAllCampaignsColumns — show everything', () => {
  it('clears the hidden array', () => {
    toggleCampaignsColumnHidden('cpm');
    toggleCampaignsColumnHidden('cpc');
    const out = restoreAllCampaignsColumns();
    expect(out.hidden).toEqual([]);
  });

  /**
   * HIGH-4 audit fix (2026-05-23): post-fix `restoreAllCampaignsColumns`
   * preserves the operator's saved column order. Pre-fix it constructed
   * `{hidden: []}` without copying `order` — silently wiping the saved
   * reorder as a side effect of "show everything". Operators reported
   * losing their reordered column layout when restoring visibility.
   *
   * If the operator explicitly wants to reset the order, they call
   * `resetCampaignsColumnOrder` (a separate, intentional action).
   */
  it('preserves the saved order across restore (HIGH-4)', () => {
    moveCampaignsColumn('budget', 'up');
    toggleCampaignsColumnHidden('cpm');
    const orderBeforeRestore = readCampaignsColumnPrefs().order;
    expect(orderBeforeRestore).toBeDefined();
    expect(orderBeforeRestore![0]).toBe('budget');
    restoreAllCampaignsColumns();
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual([]);
    // Order MUST survive — same first element as before the restore.
    expect(out.order).toEqual(orderBeforeRestore);
    expect(out.order![0]).toBe('budget');
  });

  it('preserves the canonical-default order (no explicit order saved) across restore', () => {
    toggleCampaignsColumnHidden('cpm');
    restoreAllCampaignsColumns();
    const out = readCampaignsColumnPrefs();
    expect(out.hidden).toEqual([]);
    // No order was ever saved → order stays undefined (canonical default).
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

// Declutter migration (2026-06-01) — existing operators (with saved prefs)
// must get the lean default-hidden columns folded in exactly once.
describe('migrateCampaignsColumnPrefs — one-time declutter migration', () => {
  const seed = () => [...DEFAULT_HIDDEN_COLUMN_IDS].sort();

  it('no-op when there is no saved entry (fresh operator → read seed handles it)', () => {
    migrateCampaignsColumnPrefs();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('unions the lean default into a pre-declutter {hidden:[]} entry + stamps version', () => {
    // Existing operator from before the declutter: everything visible.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: [], order: undefined }));
    migrateCampaignsColumnPrefs();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored.hidden).toEqual(seed());
    expect(stored.v).toBe(CAMPAIGNS_PREFS_VERSION);
    // read() now reflects the lean default for this existing operator.
    expect(readCampaignsColumnPrefs().hidden).toEqual(seed());
  });

  it('preserves the operator\'s own hidden columns + saved order (union, not replace)', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hidden: ['cpa'], order: ['spend', 'cpa', 'roas'] }),
    );
    migrateCampaignsColumnPrefs();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    // cpa (operator's own) survives + all lean defaults are added.
    expect(stored.hidden).toEqual([...new Set(['cpa', ...DEFAULT_HIDDEN_COLUMN_IDS])].sort());
    expect(stored.hidden).toContain('cpa');
    for (const id of DEFAULT_HIDDEN_COLUMN_IDS) expect(stored.hidden).toContain(id);
    // saved order untouched.
    expect(stored.order).toEqual(['spend', 'cpa', 'roas']);
    expect(stored.v).toBe(CAMPAIGNS_PREFS_VERSION);
  });

  it('migrates the legacy bare-array form too', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['cpa']));
    migrateCampaignsColumnPrefs();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored.hidden).toContain('cpa');
    for (const id of DEFAULT_HIDDEN_COLUMN_IDS) expect(stored.hidden).toContain(id);
    expect(stored.v).toBe(CAMPAIGNS_PREFS_VERSION);
  });

  it('is idempotent — a second run does not change already-migrated prefs', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: [], order: undefined }));
    migrateCampaignsColumnPrefs();
    const afterFirst = window.localStorage.getItem(STORAGE_KEY);
    migrateCampaignsColumnPrefs();
    const afterSecond = window.localStorage.getItem(STORAGE_KEY);
    expect(afterSecond).toEqual(afterFirst);
  });

  it('does not re-hide a column the operator un-hid AFTER migrating (version guard)', () => {
    // Operator migrates, then explicitly restores (un-hides) CPM.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: [], order: undefined }));
    migrateCampaignsColumnPrefs();
    toggleCampaignsColumnHidden('cpm'); // CPM is in the seed → this un-hides it
    expect(readCampaignsColumnPrefs().hidden).not.toContain('cpm');
    // A later mount must NOT re-hide CPM (prefs are already at current version).
    migrateCampaignsColumnPrefs();
    expect(readCampaignsColumnPrefs().hidden).not.toContain('cpm');
  });
});

// "Restore default view" button (2026-06-01) — explicit snap to the lean default.
describe('resetCampaignsColumnsToDefault — snap to lean default view', () => {
  it('sets hidden to exactly the lean default set and clears custom order', () => {
    // Operator has everything visible + a custom order.
    moveCampaignsColumn('cpa', 'up');
    restoreAllCampaignsColumns(); // show everything (hidden = [])
    const out = resetCampaignsColumnsToDefault();
    expect(out.hidden).toEqual([...DEFAULT_HIDDEN_COLUMN_IDS].sort());
    expect(out.order).toBeUndefined();
    // Persisted + readable back as the lean default.
    expect(readCampaignsColumnPrefs().hidden).toEqual([...DEFAULT_HIDDEN_COLUMN_IDS].sort());
    expect(resolveCampaignsColumnOrder(readCampaignsColumnPrefs().order)).toEqual([
      ...REORDERABLE_COLUMN_IDS,
    ]);
  });

  it('stamps the current schema version (so the migration stays a no-op after)', () => {
    resetCampaignsColumnsToDefault();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored.v).toBe(CAMPAIGNS_PREFS_VERSION);
  });
});
