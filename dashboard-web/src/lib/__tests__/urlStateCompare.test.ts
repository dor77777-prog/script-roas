// dashboard-web/src/lib/__tests__/urlStateCompare.test.ts
//
// A — urlState `compare` query param.
//
// The Filters object carries an optional `compareBaseline` (the CompareBaseline
// union from @/lib/presets). readDashboardState / writeDashboardState mirror it
// into the URL as `compare=…`, but ONLY when it's a non-default value: the
// default/unset baseline is 'prev_period', so both `undefined` and
// 'prev_period' must produce NO `compare` param (exactly like preset='today').
//
// These are pure-function round-trip tests — no DOM needed.

import { describe, it, expect } from 'vitest';
import {
  readDashboardState,
  writeDashboardState,
  type DashboardState,
} from '../urlState';
import type { CompareBaseline } from '../presets';

const DEFAULTS: DashboardState = {
  tab: 'home',
  filters: { preset: 'this_month', range: { from: '2026-01-01', to: '2026-01-31' }, store: 'All' },
};

/** Build a state carrying a specific (or absent) compareBaseline. */
function stateWithCompare(compareBaseline?: CompareBaseline): DashboardState {
  return {
    tab: 'home',
    filters: { ...DEFAULTS.filters, compareBaseline },
  };
}

describe('urlState — compare baseline param', () => {
  it('round-trips a non-default baseline (prev_7d)', () => {
    const search = writeDashboardState(stateWithCompare('prev_7d'));
    expect(search).toContain('compare=prev_7d');
    const read = readDashboardState(DEFAULTS, search);
    expect(read.filters.compareBaseline).toBe('prev_7d');
  });

  it('round-trips a non-default baseline (prev_year)', () => {
    const search = writeDashboardState(stateWithCompare('prev_year'));
    expect(search).toContain('compare=prev_year');
    const read = readDashboardState(DEFAULTS, search);
    expect(read.filters.compareBaseline).toBe('prev_year');
  });

  it('round-trips prev_month and none', () => {
    for (const b of ['prev_month', 'none'] as const) {
      const search = writeDashboardState(stateWithCompare(b));
      expect(search).toContain(`compare=${b}`);
      expect(readDashboardState(DEFAULTS, search).filters.compareBaseline).toBe(b);
    }
  });

  it("omits the param for the default 'prev_period' (reads back undefined)", () => {
    const search = writeDashboardState(stateWithCompare('prev_period'));
    expect(search).not.toContain('compare');
    const read = readDashboardState(DEFAULTS, search);
    expect(read.filters.compareBaseline).toBeUndefined();
  });

  it('omits the param when compareBaseline is undefined (reads back undefined)', () => {
    const search = writeDashboardState(stateWithCompare(undefined));
    expect(search).not.toContain('compare');
    const read = readDashboardState(DEFAULTS, search);
    expect(read.filters.compareBaseline).toBeUndefined();
  });

  it('reads an invalid compare value back as undefined without throwing', () => {
    expect(() =>
      readDashboardState(DEFAULTS, '?compare=garbage'),
    ).not.toThrow();
    const read = readDashboardState(DEFAULTS, '?compare=garbage');
    expect(read.filters.compareBaseline).toBeUndefined();
  });

  it("treats an explicit ?compare=prev_period as the default (undefined)", () => {
    const read = readDashboardState(DEFAULTS, '?compare=prev_period');
    expect(read.filters.compareBaseline).toBeUndefined();
  });

  it('does not disturb other global params when writing compare', () => {
    const search = writeDashboardState({
      tab: 'campaigns',
      filters: { ...DEFAULTS.filters, store: 'uzoshop', compareBaseline: 'prev_7d' },
    });
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    expect(params.get('tab')).toBe('campaigns');
    expect(params.get('store')).toBe('uzoshop');
    expect(params.get('compare')).toBe('prev_7d');
  });
});
