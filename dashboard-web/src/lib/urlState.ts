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
  'today', 'yesterday', 'this_month', 'this_week',
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

/** Param names this module owns. Anything else in the URL is preserved
 *  (per-tab `c_*` / `p_*` written by syncTabLocalUrl, drill state, etc.). */
const GLOBAL_PARAMS = new Set(['tab', 'preset', 'from', 'to', 'store']);

/**
 * Build a search string for the current state, omitting defaults so the URL
 * stays clean ("/" not "/?tab=home&preset=yesterday&store=All").
 *
 * Phase 12.5.x (2026-05-24) — `existingSearch` is the current URL query so
 * we PRESERVE params not in GLOBAL_PARAMS. Previously this function built a
 * fresh URLSearchParams() and silently wiped per-tab params written by
 * `syncTabLocalUrl` (c_*, p_*) — refresh then read defaults because the
 * params Dashboard's parent effect had stripped were no longer in the URL.
 */
export function writeDashboardState(
  state: DashboardState,
  existingSearch: string = '',
): string {
  const raw = existingSearch.startsWith('?') ? existingSearch.slice(1) : existingSearch;
  const params = new URLSearchParams(raw);
  // Reset only the params this module owns; leave c_* / p_* and any future
  // per-component params alone.
  for (const k of GLOBAL_PARAMS) params.delete(k);
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
  const current = window.location.search;
  const next = writeDashboardState(state, current);
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

/**
 * CampaignDrawer drill-down identity (mode='campaign' → click row).
 * Encoded in URL as `c_drill=storeId::Platform::campaignId`.
 */
export type CampaignDrillState = {
  storeId: string;
  platform: string;
  campaignId: string;
};

/**
 * AdsDrawer drill-down identity (mode='adset' → click row).
 * Encoded in URL as `c_adDrill=storeId::Platform::campaignId::adSetId`.
 * adSetName is intentionally NOT in the URL — the drawer re-reads it from
 * `data.rows` once the IDs match (avoids URL-encoding free-text + keeps
 * the param short).
 */
export type AdDrillState = {
  storeId: string;
  campaignId: string;
  adSetId: string;
  platform: 'Meta' | 'TikTok';
};

export type TabLocalState = {
  /** Per-tab store override (defaults to the global store filter). */
  store?: string;
  /** Per-tab platform filter (campaigns only). 'all' | 'meta' | 'google' | 'tiktok'. */
  platform?: string;
  /** Per-tab preset key. Mirrors global preset semantics. */
  preset?: PresetKey;
  /** Per-tab custom range. Only honored when preset === 'custom'. */
  range?: DateRange;
  /**
   * Phase 12.5.x (2026-05-24) — campaigns tab only. View mode (campaign /
   * adset). Default 'campaign' is omitted from the URL to keep it tidy.
   */
  mode?: 'campaign' | 'adset';
  /**
   * Phase 12.5.x (2026-05-24) — campaigns tab only. Sort key + direction.
   * Default ('roas' / 'desc') is omitted from the URL.
   */
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  /**
   * Phase 12.5.x (2026-05-24) — campaigns tab only. Opened CampaignDrawer
   * identity. Set when the operator clicked a campaign row.
   */
  drill?: CampaignDrillState;
  /**
   * Phase 12.5.x (2026-05-24) — campaigns tab only. Opened AdsDrawer
   * identity. Set when the operator clicked an ad-set row (mode='adset').
   */
  adDrill?: AdDrillState;
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

  // Phase 12.5.x (2026-05-24) — campaigns-tab-only extras: mode, sort,
  // drill, adDrill. Each is silently ignored when malformed (no throw —
  // we never want a stale URL to break the dashboard on load).
  if (tab === 'campaigns') {
    const mode = params.get(`${prefix}_mode`);
    if (mode === 'campaign' || mode === 'adset') out.mode = mode;

    const sortKey = params.get(`${prefix}_sort`);
    if (sortKey && sortKey.trim().length > 0) out.sortKey = sortKey;
    const sortDir = params.get(`${prefix}_sortDir`);
    if (sortDir === 'asc' || sortDir === 'desc') out.sortDir = sortDir;

    const drillRaw = params.get(`${prefix}_drill`);
    if (drillRaw) {
      const parts = drillRaw.split('::');
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        out.drill = {
          storeId: parts[0],
          platform: parts[1],
          campaignId: parts[2],
        };
      }
    }

    const adDrillRaw = params.get(`${prefix}_adDrill`);
    if (adDrillRaw) {
      const parts = adDrillRaw.split('::');
      if (
        parts.length === 4 &&
        parts[0] &&
        (parts[1] === 'Meta' || parts[1] === 'TikTok') &&
        parts[2] &&
        parts[3]
      ) {
        out.adDrill = {
          storeId: parts[0],
          platform: parts[1] as 'Meta' | 'TikTok',
          campaignId: parts[2],
          adSetId: parts[3],
        };
      }
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

  // Phase 12.5.x (2026-05-24) — campaigns-tab-only extras.
  if (tab === 'campaigns') {
    writeOrDelete(
      `${prefix}_mode`,
      state.mode && state.mode !== 'campaign' ? state.mode : undefined,
    );
    // Default sort = roas DESC. Only serialize deviations.
    writeOrDelete(
      `${prefix}_sort`,
      state.sortKey && state.sortKey !== 'roas' ? state.sortKey : undefined,
    );
    writeOrDelete(
      `${prefix}_sortDir`,
      state.sortDir && state.sortDir !== 'desc' ? state.sortDir : undefined,
    );
    writeOrDelete(
      `${prefix}_drill`,
      state.drill
        ? `${state.drill.storeId}::${state.drill.platform}::${state.drill.campaignId}`
        : undefined,
    );
    writeOrDelete(
      `${prefix}_adDrill`,
      state.adDrill
        ? `${state.adDrill.storeId}::${state.adDrill.platform}::${state.adDrill.campaignId}::${state.adDrill.adSetId}`
        : undefined,
    );
  }

  const next = existing.toString();
  const nextSearch = next ? `?${next}` : '';
  if (nextSearch === window.location.search) return;
  const url = window.location.pathname + nextSearch + window.location.hash;
  window.history.replaceState(null, '', url);
}

/* --------------------------------------------------------------------------
 * Task 3.4 — Home → Campaigns drill helper.
 *
 * Home cards (PerStoreRow, CommandCenterHero secondary tiles) drill into the
 * Campaigns tab pre-filtered by store and/or platform. This helper centralises
 * the URL mutation so every drill site has identical semantics:
 *
 *   1. Set `tab=campaigns` (the global tab param read by readDashboardState).
 *   2. Set the campaigns-tab-local `c_store` / `c_platform` overrides if
 *      provided (those are the params read by readTabLocalState('campaigns')).
 *   3. dispatch a `popstate` event so the Dashboard's URL-state effect
 *      re-reads the search string in the same tick (history.pushState alone
 *      does NOT trigger popstate — without this nudge the dashboard would
 *      need a full reload to notice the change).
 *
 * `pushState` (not replaceState) so the operator's back button returns them
 * to the Home tab they drilled from — that's the whole point of a drill.
 * -------------------------------------------------------------------------- */

export type DrillToCampaignsOpts = {
  /** Store filter for the campaigns tab. Pass undefined / 'All' to clear. */
  store?: string;
  /** Platform filter for the campaigns tab. 'all' | 'meta' | 'google' | 'tiktok'. */
  platform?: 'all' | 'meta' | 'google' | 'tiktok';
};

/**
 * Mutate the URL to land on the Campaigns tab with optional store/platform
 * pre-filters applied. Safe to call from SSR contexts — no-ops on the server.
 *
 * The caller should also call into the Dashboard tab-change handler (or just
 * rely on the popstate listener — Dashboard re-reads the URL on every
 * popstate). We dispatch popstate here so a single call is sufficient.
 */
export function drillToCampaigns(opts: DrillToCampaignsOpts = {}): void {
  if (typeof window === 'undefined') return;

  const existing = new URLSearchParams(
    window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search,
  );

  // Global tab → campaigns.
  existing.set('tab', 'campaigns');

  // Campaigns-tab-local store override. Default 'All' is encoded by clearing
  // the param (matches syncTabLocalUrl semantics).
  if (opts.store && opts.store !== 'All') {
    existing.set('c_store', opts.store);
  } else {
    existing.delete('c_store');
  }

  // Campaigns-tab-local platform filter. Default 'all' is the omitted state.
  if (opts.platform && opts.platform !== 'all') {
    existing.set('c_platform', opts.platform);
  } else {
    existing.delete('c_platform');
  }

  const next = existing.toString();
  const nextSearch = next ? `?${next}` : '';
  const url = window.location.pathname + nextSearch + window.location.hash;

  // pushState (not replaceState) — drilling is a navigation, so the back
  // button should return the operator to the Home view they came from.
  window.history.pushState(null, '', url);

  // Nudge any listener (Dashboard's URL-sync effect) to re-read the search.
  // pushState alone does NOT fire popstate; without this dispatch the URL
  // would update but the dashboard wouldn't switch tabs until next render.
  window.dispatchEvent(new PopStateEvent('popstate'));
}
