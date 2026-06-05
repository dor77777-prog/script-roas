import { pushCloudKey } from './cloudSync';
import type { CompareBaseline } from './presets';
import type { Filters } from './types';

/** Canonical set of valid compare baselines (mirrors `CompareBaseline`). */
const VALID_COMPARE_BASELINES: ReadonlySet<CompareBaseline> = new Set<CompareBaseline>([
  'prev_period',
  'prev_7d',
  'prev_month',
  'prev_year',
  'none',
]);

function normCompareBaseline(x: unknown): CompareBaseline | undefined {
  return typeof x === 'string' && VALID_COMPARE_BASELINES.has(x as CompareBaseline)
    ? (x as CompareBaseline)
    : undefined;
}

/**
 * Saved Views — named snapshots of the dashboard's Filters (preset + range +
 * store) that an operator can re-apply with one click. Persisted to
 * localStorage and synced cross-device via the cloud-sync layer, mirroring the
 * exact read/write/dispatch + useX hook pattern of cogsSettings.ts /
 * salarySettings.ts.
 *
 * Storage shape is keyed by an opaque id so renames don't break references and
 * two views can share a display name. Each view carries createdAt / lastUsedAt
 * timestamps for ordering + "recently used" affordances.
 */

export interface SavedViewMeta {
  createdAt: string;  // ISO timestamp
  lastUsedAt: string; // ISO timestamp
}
export interface SavedView {
  name: string;
  filters: Filters;
  meta: SavedViewMeta;
}
export interface SavedViewsState {
  v: 1;
  views: Record<string, SavedView>;
}

export const SAVED_VIEWS_KEY = 'roas-dashboard:saved-views';
export const SAVED_VIEWS_VERSION = 1;
/** Same CustomEvent pattern as cogsSettings.ts so same-tab edits re-render. */
export const SAVED_VIEWS_EVENT = 'roas-saved-views-changed';

export function defaultSavedViewsState(): SavedViewsState {
  return { v: SAVED_VIEWS_VERSION, views: {} };
}

/** Same standard id approach the app already uses (cf. generateAnnotationId). */
export function generateSavedViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normFilters(x: unknown): Filters | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<Filters>;
  if (typeof o.preset !== 'string') return null;
  if (typeof o.store !== 'string') return null;
  const r = o.range as Partial<Filters['range']> | undefined;
  if (!r || typeof r !== 'object' || typeof r.from !== 'string' || typeof r.to !== 'string') return null;
  // compareBaseline is optional on Filters. Carry it through tolerantly: when
  // absent or invalid it normalizes to undefined (we never invent one) and the
  // key is omitted so the stored shape stays clean.
  const compareBaseline = normCompareBaseline(o.compareBaseline);
  return {
    preset: o.preset as Filters['preset'],
    range: { from: r.from, to: r.to },
    store: o.store,
    ...(compareBaseline ? { compareBaseline } : {}),
  };
}

function normMeta(x: unknown): SavedViewMeta {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<SavedViewMeta>;
  const created = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString();
  const used = typeof o.lastUsedAt === 'string' ? o.lastUsedAt : created;
  return { createdAt: created, lastUsedAt: used };
}

function normView(x: unknown): SavedView | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<SavedView>;
  const filters = normFilters(o.filters);
  if (!filters) return null;
  const name = typeof o.name === 'string' ? o.name : '';
  return { name, filters, meta: normMeta(o.meta) };
}

export function readSavedViews(): SavedViewsState {
  if (typeof window === 'undefined') return defaultSavedViewsState();
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return defaultSavedViewsState();
    const parsed = JSON.parse(raw) as Partial<SavedViewsState>;
    if (!parsed || typeof parsed !== 'object') return defaultSavedViewsState();
    const views: Record<string, SavedView> = {};
    if (parsed.views && typeof parsed.views === 'object') {
      for (const [id, v] of Object.entries(parsed.views)) {
        const n = normView(v);
        if (n) views[id] = n;
      }
    }
    return { v: SAVED_VIEWS_VERSION, views };
  } catch { return defaultSavedViewsState(); }
}

export function writeSavedViews(state: SavedViewsState): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: SavedViewsState = { ...state, v: SAVED_VIEWS_VERSION };
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(SAVED_VIEWS_EVENT));
    pushCloudKey(SAVED_VIEWS_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}

/** Create a new saved view from the given name + filters. Returns the new id. */
export function saveView(name: string, filters: Filters): string {
  const state = readSavedViews();
  const id = generateSavedViewId();
  const now = new Date().toISOString();
  const next: SavedViewsState = {
    ...state,
    views: { ...state.views, [id]: { name, filters, meta: { createdAt: now, lastUsedAt: now } } },
  };
  writeSavedViews(next);
  return id;
}

/** Remove a saved view by id (no-op if absent). */
export function deleteView(id: string): void {
  const state = readSavedViews();
  if (!(id in state.views)) return;
  const views = { ...state.views };
  delete views[id];
  writeSavedViews({ ...state, views });
}

/** Rename a saved view by id (no-op if absent). */
export function renameView(id: string, name: string): void {
  const state = readSavedViews();
  const existing = state.views[id];
  if (!existing) return;
  writeSavedViews({ ...state, views: { ...state.views, [id]: { ...existing, name } } });
}

/** Stamp a view as just-used (updates lastUsedAt). No-op if absent. */
export function touchView(id: string): void {
  const state = readSavedViews();
  const existing = state.views[id];
  if (!existing) return;
  writeSavedViews({
    ...state,
    views: { ...state.views, [id]: { ...existing, meta: { ...existing.meta, lastUsedAt: new Date().toISOString() } } },
  });
}
