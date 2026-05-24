/**
 * URL state serialization for dashboard filters + active tab.
 *
 * The dashboard used to reset to defaults on every page reload — refreshing
 * the page bounced the user out of the campaigns tab back to home, and reset
 * their custom date range. We now mirror the dashboard's state into the URL
 * query string so:
 *   - refresh keeps you exactly where you were
 *   - bookmarks work
 *   - users can share a URL with a teammate that opens to the same view
 *
 * Encoded params (all optional, sensible defaults):
 *   tab     = home | analysis | campaigns | products | detail
 *   preset  = yesterday | this_month | this_week | last_7_days | last_month
 *             | last_30_days | custom
 *   from    = YYYY-MM-DD   (only used when preset=custom)
 *   to      = YYYY-MM-DD
 *   store   = "All" | <store name>
 */

import type { Filters, PresetKey, DateRange } from './types';
import { computePresetRange } from './presets';

export type TabKey = 'home' | 'pnl' | 'analysis' | 'campaigns' | 'products' | 'detail';

const TAB_VALUES = new Set<TabKey>(['home', 'pnl', 'analysis', 'campaigns', 'products', 'detail']);
const PRESET_VALUES = new Set<PresetKey>([
  'yesterday', 'this_month', 'this_week',
  'last_7_days', 'last_month', 'last_30_days', 'custom',
]);

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export type DashboardState = {
  tab: TabKey;
  filters: Filters;
};

export function readDashboardState(
  defaults: DashboardState,
  search: string,
): DashboardState {
  if (typeof search !== 'string' || !search) return defaults;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const rawTab = params.get('tab');
  const tab: TabKey =
    rawTab && (TAB_VALUES as Set<string>).has(rawTab)
      ? (rawTab as TabKey)
      : defaults.tab;

  const rawPreset = params.get('preset');
  const preset: PresetKey =
    rawPreset && (PRESET_VALUES as Set<string>).has(rawPreset)
      ? (rawPreset as PresetKey)
      : defaults.filters.preset;

  let range: DateRange;
  if (preset === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    if (from && to && DATE_RX.test(from) && DATE_RX.test(to)) {
      range = { from, to };
    } else {
      range = defaults.filters.range;
    }
  } else {
    // Re-derive the preset range from "today" so an old bookmark for
    // "this_month" reflects the *current* month, not the month it was saved.
    range = computePresetRange(preset);
  }

  const store = params.get('store') ?? defaults.filters.store;

  return {
    tab,
    filters: { preset, range, store },
  };
}

/**
 * Build a search string for the current state, omitting defaults so the URL
 * stays clean ("/" not "/?tab=home&preset=yesterday&store=All").
 */
export function writeDashboardState(state: DashboardState): string {
  const params = new URLSearchParams();
  if (state.tab !== 'home') params.set('tab', state.tab);
  if (state.filters.preset !== 'this_month') params.set('preset', state.filters.preset);
  if (state.filters.preset === 'custom') {
    params.set('from', state.filters.range.from);
    params.set('to', state.filters.range.to);
  }
  if (state.filters.store !== 'All') params.set('store', state.filters.store);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Push the current state to the URL without adding a history entry.
 * Using `replaceState` so the back button still goes to the previous page,
 * not through a chain of "filter changed" entries.
 */
export function syncUrl(state: DashboardState) {
  if (typeof window === 'undefined') return;
  const next = writeDashboardState(state);
  const current = window.location.search;
  if (current === next) return;
  const url = window.location.pathname + next + window.location.hash;
  window.history.replaceState(null, '', url);
}

/**
 * Tab-local state encoded into the URL so refresh / bookmark / share preserves
 * what the operator was looking at on that tab. Each tab gets a short prefix
 * to keep params disambiguated:
 *   - campaigns tab: c_store, c_platform, c_preset, c_from, c_to
 *   - products tab:  p_store, p_preset, p_from, p_to
 *
 * Defaults are NOT serialized — only deviations from the tab default land in
 * the URL so the query string stays short.
 */

export type TabLocalState = {
  /** Per-tab store override (defaults to the global store filter). */
  store?: string;
  /** Per-tab platform filter (campaigns only). 'all' | 'meta' | 'google' | 'tiktok'. */
  platform?: string;
  /** Per-tab preset key. Mirrors global preset semantics. */
  preset?: PresetKey;
  /** Per-tab custom range. Only honored when preset === 'custom'. */
  range?: DateRange;
};

const TAB_PREFIX: Record<'campaigns' | 'products', string> = {
  campaigns: 'c',
  products: 'p',
};

/**
 * Read tab-local state from a search string. Defaults are returned for any
 * param that's absent or fails validation. Caller decides whether to fall
 * back to global filters when fields are undefined.
 */
export function readTabLocalState(
  tab: 'campaigns' | 'products',
  search: string,
): TabLocalState {
  if (typeof search !== 'string' || !search) return {};
  const prefix = TAB_PREFIX[tab];
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: TabLocalState = {};

  const store = params.get(`${prefix}_store`);
  if (store && store.trim().length > 0) out.store = store;

  if (tab === 'campaigns') {
    const platform = params.get(`${prefix}_platform`);
    if (platform && ['all', 'meta', 'google', 'tiktok'].includes(platform)) {
      out.platform = platform;
    }
  }

  const rawPreset = params.get(`${prefix}_preset`);
  if (rawPreset && (PRESET_VALUES as Set<string>).has(rawPreset)) {
    out.preset = rawPreset as PresetKey;
    if (out.preset === 'custom') {
      const from = params.get(`${prefix}_from`);
      const to = params.get(`${prefix}_to`);
      if (from && to && DATE_RX.test(from) && DATE_RX.test(to)) {
        out.range = { from, to };
      }
    } else {
      // Non-custom preset: re-derive range from "today" so an old bookmark
      // for "last_7_days" reflects the *current* last-7-days, not the
      // window it was saved.
      out.range = computePresetRange(out.preset);
    }
  }

  return out;
}

/**
 * Sync tab-local state into the URL. Preserves existing global state params
 * (tab / preset / from / to / store) — only the per-tab params with this
 * tab's prefix are updated. `replaceState` (no history entry).
 */
export function syncTabLocalUrl(
  tab: 'campaigns' | 'products',
  state: TabLocalState,
  globalStore: string,
): void {
  if (typeof window === 'undefined') return;
  const prefix = TAB_PREFIX[tab];
  const existing = new URLSearchParams(
    window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search,
  );

  const writeOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined || value === null || value === '') {
      existing.delete(key);
    } else {
      existing.set(key, value);
    }
  };

  // Store: only serialize when it differs from the global filter (no point
  // duplicating). Empty / matching = no param.
  writeOrDelete(
    `${prefix}_store`,
    state.store && state.store !== globalStore ? state.store : undefined,
  );

  // Platform (campaigns only): default 'all' is omitted.
  if (tab === 'campaigns') {
    writeOrDelete(
      `${prefix}_platform`,
      state.platform && state.platform !== 'all' ? state.platform : undefined,
    );
  }

  // Preset: omit when default ('this_month'). Custom always serializes
  // from/to alongside.
  if (state.preset && state.preset !== 'this_month') {
    existing.set(`${prefix}_preset`, state.preset);
    if (state.preset === 'custom' && state.range) {
      existing.set(`${prefix}_from`, state.range.from);
      existing.set(`${prefix}_to`, state.range.to);
    } else {
      existing.delete(`${prefix}_from`);
      existing.delete(`${prefix}_to`);
    }
  } else {
    existing.delete(`${prefix}_preset`);
    existing.delete(`${prefix}_from`);
    existing.delete(`${prefix}_to`);
  }

  const next = existing.toString();
  const nextSearch = next ? `?${next}` : '';
  if (nextSearch === window.location.search) return;
  const url = window.location.pathname + nextSearch + window.location.hash;
  window.history.replaceState(null, '', url);
}
