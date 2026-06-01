// dashboard-web/src/lib/__tests__/urlState.dom.test.ts
//
// Task 3.4 — drillToCampaigns URL mutation helper.
//
// Lives under the DOM-config glob (vitest.config.dom.ts) because the helper
// reads/writes window.location and window.history, and dispatches a real
// PopStateEvent. Pure-function urlState helpers (readDashboardState,
// writeDashboardState, etc.) don't need DOM and could move to a node test
// file later if we ever want to test them — this file covers only the
// browser-effect surface that Task 3.4 introduced.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  drillToCampaigns,
  readDashboardState,
  writeDashboardState,
  type DashboardState,
} from '../urlState';

// Shared defaults for the readDashboardState migration tests below.
const DEFAULTS: DashboardState = {
  tab: 'home',
  filters: { preset: 'this_month', range: { from: '2026-01-01', to: '2026-01-31' }, store: 'All' },
};

beforeEach(() => {
  // Reset URL between tests so each starts from a known state. jsdom only
  // accepts same-origin replacements; pushState with an empty search is the
  // cleanest reset that works in every jsdom version.
  window.history.replaceState(null, '', '/');
});

describe('drillToCampaigns', () => {
  it('sets tab=campaigns', () => {
    drillToCampaigns();
    expect(window.location.search).toBe('?tab=campaigns');
  });

  it('encodes store + platform pre-filters as c_store + c_platform', () => {
    drillToCampaigns({ store: 'uzoshop', platform: 'meta' });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('campaigns');
    expect(params.get('c_store')).toBe('uzoshop');
    expect(params.get('c_platform')).toBe('meta');
  });

  it('omits c_store when the value is "All" (matches syncTabLocalUrl semantics)', () => {
    drillToCampaigns({ store: 'All', platform: 'tiktok' });
    const params = new URLSearchParams(window.location.search);
    expect(params.has('c_store')).toBe(false);
    expect(params.get('c_platform')).toBe('tiktok');
  });

  it('omits c_platform when value is "all" (the default state)', () => {
    drillToCampaigns({ store: 'usmile360', platform: 'all' });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('c_store')).toBe('usmile360');
    expect(params.has('c_platform')).toBe(false);
  });

  it('preserves unrelated query params (does not stomp tab-local p_* state)', () => {
    window.history.replaceState(null, '', '/?p_store=other-store&preset=last_7_days');
    drillToCampaigns({ store: 'uzoshop' });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('campaigns');
    expect(params.get('c_store')).toBe('uzoshop');
    expect(params.get('p_store')).toBe('other-store');
    expect(params.get('preset')).toBe('last_7_days');
  });

  it('clears a stale c_store when called with no store', () => {
    window.history.replaceState(null, '', '/?tab=campaigns&c_store=prev');
    drillToCampaigns({ platform: 'google' });
    const params = new URLSearchParams(window.location.search);
    expect(params.has('c_store')).toBe(false);
    expect(params.get('c_platform')).toBe('google');
  });

  it('writes c_drill (storeId::Platform::campaignId) when a campaign is given', () => {
    window.history.replaceState(null, '', '/');
    drillToCampaigns({
      store: 'uzoshop',
      campaign: { storeId: 'store-uuid-1', platform: 'meta', campaignId: 'cmp-99' },
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('campaigns');
    expect(params.get('c_store')).toBe('uzoshop');
    // lowercase Home platform key maps to the CampaignDrawer's 'Meta' casing.
    expect(params.get('c_drill')).toBe('store-uuid-1::Meta::cmp-99');
  });

  it('clears a stale c_drill when called without a campaign (table-only drill)', () => {
    window.history.replaceState(null, '', '/?tab=campaigns&c_drill=old::Google::x');
    drillToCampaigns({ store: 'uzoshop' });
    const params = new URLSearchParams(window.location.search);
    expect(params.has('c_drill')).toBe(false);
  });

  it('uses pushState (drill is a navigation — back button returns to Home)', () => {
    const lengthBefore = window.history.length;
    drillToCampaigns({ store: 'uzoshop' });
    // pushState appends to history; replaceState would leave length unchanged.
    // jsdom honours this. (Allow >= because some jsdom versions still bump
    // length on the replaceState in beforeEach.)
    expect(window.history.length).toBeGreaterThanOrEqual(lengthBefore + 1);
  });

  it('dispatches a popstate event so URL-sync listeners re-read the search', () => {
    let popped = false;
    const listener = () => {
      popped = true;
    };
    window.addEventListener('popstate', listener);
    try {
      drillToCampaigns({ store: 'uzoshop' });
    } finally {
      window.removeEventListener('popstate', listener);
    }
    expect(popped).toBe(true);
  });

  it('is safe to call with no opts at all', () => {
    expect(() => drillToCampaigns()).not.toThrow();
    expect(window.location.search).toBe('?tab=campaigns');
  });
});

describe('readDashboardState — legacy "analysis" tab migration (2026-06-01)', () => {
  it('maps the retired ?tab=analysis to trends (its former default sub-tab)', () => {
    const state = readDashboardState(DEFAULTS, '?tab=analysis');
    expect(state.tab).toBe('trends');
  });

  it('preserves preset + store while migrating ?tab=analysis', () => {
    const state = readDashboardState(DEFAULTS, '?tab=analysis&preset=last_7_days&store=uzoshop');
    expect(state.tab).toBe('trends');
    expect(state.filters.preset).toBe('last_7_days');
    expect(state.filters.store).toBe('uzoshop');
  });

  it('accepts the new top-level archive + trends tab keys verbatim', () => {
    expect(readDashboardState(DEFAULTS, '?tab=archive').tab).toBe('archive');
    expect(readDashboardState(DEFAULTS, '?tab=trends').tab).toBe('trends');
  });

  it('falls back to the default tab for an unknown tab key', () => {
    expect(readDashboardState(DEFAULTS, '?tab=bogus').tab).toBe('home');
  });

  it('never writes the retired "analysis" key back; emits the new keys (home omitted)', () => {
    expect(writeDashboardState({ ...DEFAULTS, tab: 'archive' })).toContain('tab=archive');
    expect(writeDashboardState({ ...DEFAULTS, tab: 'trends' })).toContain('tab=trends');
    // home is the default → omitted from the URL for a clean "/".
    expect(writeDashboardState({ ...DEFAULTS, tab: 'home' })).not.toContain('tab=');
    // The retired key can never round-trip back into a written URL.
    expect(writeDashboardState({ ...DEFAULTS, tab: 'trends' })).not.toContain('analysis');
  });
});
