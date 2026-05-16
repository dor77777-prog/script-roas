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

export type TabKey = 'home' | 'analysis' | 'campaigns' | 'products' | 'detail';

const TAB_VALUES = new Set<TabKey>(['home', 'analysis', 'campaigns', 'products', 'detail']);
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
  if (state.filters.preset !== 'yesterday') params.set('preset', state.filters.preset);
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
