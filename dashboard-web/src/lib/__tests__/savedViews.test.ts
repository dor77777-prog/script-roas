import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SAVED_VIEWS_KEY,
  defaultSavedViewsState,
  readSavedViews,
  writeSavedViews,
  saveView,
  deleteView,
  renameView,
  touchView,
  type SavedViewsState,
} from '@/lib/savedViews';
import type { Filters } from '@/lib/types';

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

const filtersA: Filters = { preset: 'this_month', range: { from: '2026-06-01', to: '2026-06-30' }, store: 'All' };
const filtersB: Filters = { preset: 'last_7_days', range: { from: '2026-05-29', to: '2026-06-04' }, store: 'uzoshop' };

describe('savedViews — model + read/write', () => {
  it('read returns empty default when nothing stored', () => {
    expect(readSavedViews()).toEqual(defaultSavedViewsState());
    expect(defaultSavedViewsState()).toEqual({ v: 1, views: {} });
  });

  it('write round-trips + bumps cloud', async () => {
    const id = 'view-abc';
    const state: SavedViewsState = {
      v: 1,
      views: { [id]: { name: 'June', filters: filtersA, meta: { createdAt: '2026-06-01T00:00:00.000Z', lastUsedAt: '2026-06-01T00:00:00.000Z' } } },
    };
    writeSavedViews(state);
    const stored = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_KEY)!);
    expect(stored.views[id].name).toBe('June');
    expect(stored.views[id].filters).toEqual(filtersA);
    const { pushCloudKey } = await import('@/lib/cloudSync');
    expect(pushCloudKey).toHaveBeenCalledWith(SAVED_VIEWS_KEY, expect.objectContaining({ v: 1 }));
  });

  it('tolerates malformed JSON → default', () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, '{not json');
    expect(readSavedViews()).toEqual(defaultSavedViewsState());
  });

  it('drops views with malformed filters on read', () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify({
      v: 1, views: { bad: { name: 'x', filters: { preset: 'this_month' } }, good: { name: 'ok', filters: filtersA, meta: {} } },
    }));
    const s = readSavedViews();
    expect(Object.keys(s.views)).toEqual(['good']);
  });
});

describe('savedViews — compareBaseline persistence', () => {
  it('persists + reads back a view saved with compareBaseline', () => {
    const id = saveView('Year-over-year', {
      preset: 'this_month',
      range: { from: '2026-06-01', to: '2026-06-30' },
      store: 'All',
      compareBaseline: 'prev_year',
    });
    const s = readSavedViews();
    expect(s.views[id].filters.compareBaseline).toBe('prev_year');
  });

  it('reads back compareBaseline as undefined when the view was saved without one', () => {
    const id = saveView('No compare', filtersA);
    const s = readSavedViews();
    expect(s.views[id].filters.compareBaseline).toBeUndefined();
  });

  it('drops an invalid compareBaseline to undefined on read (tolerant normalization)', () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify({
      v: 1,
      views: {
        weird: { name: 'weird', filters: { ...filtersA, compareBaseline: 'not_a_baseline' }, meta: {} },
      },
    }));
    const s = readSavedViews();
    expect(Object.keys(s.views)).toEqual(['weird']);
    expect(s.views.weird.filters.compareBaseline).toBeUndefined();
  });
});

describe('savedViews — CRUD lifecycle (save → read → rename → delete)', () => {
  it('full lifecycle', () => {
    // save
    const id = saveView('My View', filtersA);
    let s = readSavedViews();
    expect(Object.keys(s.views)).toHaveLength(1);
    expect(s.views[id].name).toBe('My View');
    expect(s.views[id].filters).toEqual(filtersA);
    expect(s.views[id].meta.createdAt).toBeTruthy();
    expect(s.views[id].meta.lastUsedAt).toBe(s.views[id].meta.createdAt);

    // a second save → distinct id, both persisted
    const id2 = saveView('Other', filtersB);
    expect(id2).not.toBe(id);
    s = readSavedViews();
    expect(Object.keys(s.views)).toHaveLength(2);
    expect(s.views[id2].filters).toEqual(filtersB);

    // rename
    renameView(id, 'Renamed');
    s = readSavedViews();
    expect(s.views[id].name).toBe('Renamed');
    expect(s.views[id].filters).toEqual(filtersA); // filters untouched
    expect(s.views[id2].name).toBe('Other');       // sibling untouched

    // delete
    deleteView(id);
    s = readSavedViews();
    expect(Object.keys(s.views)).toEqual([id2]);
  });

  it('rename / delete / touch are no-ops for unknown ids', () => {
    const id = saveView('Keep', filtersA);
    renameView('nope', 'X');
    deleteView('nope');
    touchView('nope');
    const s = readSavedViews();
    expect(Object.keys(s.views)).toEqual([id]);
    expect(s.views[id].name).toBe('Keep');
  });

  it('touchView updates lastUsedAt but preserves createdAt + filters', () => {
    const id = saveView('Touch me', filtersA);
    const before = readSavedViews().views[id];
    // Force a distinct lastUsedAt by stubbing the clock forward.
    const later = '2099-01-01T00:00:00.000Z';
    const spy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(later);
    touchView(id);
    spy.mockRestore();
    const after = readSavedViews().views[id];
    expect(after.meta.lastUsedAt).toBe(later);
    expect(after.meta.createdAt).toBe(before.meta.createdAt);
    expect(after.filters).toEqual(filtersA);
  });
});
