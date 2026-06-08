// dashboard-web/src/components/activity/__tests__/ActivityTab.dom.test.tsx
//
// DOM tests for the <ActivityTab> wrapper — the sub-tab switcher inside the
// "פעילות" area. It defaults to the existing live feed (no behaviour change for
// someone who never clicks) and swaps to the new "סטטיסטיקות והתפלגויות" stats
// view when the operator clicks the switcher. NO info loss — the feed stays.
//
// The two child views (ActivityEventsTab + ActivityStatsTab) both read SWR; we
// mock `swr` to a stub so the switcher logic is tested in isolation.

import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DashboardData, Filters as F } from '@/lib/types';

// Both children call useSWR; return a benign empty payload so they render their
// (loading/empty) shells without a network call. We also capture the SWR keys
// so the stats fetch's range wiring can be asserted after the picker changes it.
const swrKeys: string[] = [];
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) swrKeys.push(key);
    return { data: undefined, error: undefined };
  },
}));

import { ActivityTab } from '@/components/activity/ActivityTab';

const DATA = { stores: ['uzoshop', 'Zol Plus', '360usmile'] } as unknown as DashboardData;
const FILTERS: F = {
  preset: 'last_30_days',
  range: { from: '2026-05-08', to: '2026-06-07' },
  store: 'All',
};

/** Render helper — defaults to the global FILTERS + a captured onChange. */
function renderTab(props: Partial<ComponentProps<typeof ActivityTab>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ActivityTab
      data={DATA}
      filters={FILTERS}
      stores={DATA.stores}
      onChange={onChange}
      {...props}
    />,
  );
  return { ...utils, onChange };
}

beforeEach(() => {
  swrKeys.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-06-07T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<ActivityTab> — sub-tab switcher', () => {
  it('defaults to the live feed (events tab), not the stats tab', () => {
    renderTab();
    expect(screen.getByTestId('activity-events-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-stats-tab')).toBeNull();
  });

  it('renders both switcher tabs (פיד חי / סטטיסטיקות והתפלגויות)', () => {
    renderTab();
    expect(screen.getByRole('tab', { name: 'פיד חי' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }),
    ).toBeInTheDocument();
  });

  it('swaps to the stats tab when the stats switcher is clicked, then back', () => {
    renderTab();

    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));
    expect(screen.getByTestId('activity-stats-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-events-tab')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'פיד חי' }));
    expect(screen.getByTestId('activity-events-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-stats-tab')).toBeNull();
  });

  it('marks the active switcher tab via aria-selected', () => {
    renderTab();
    const feedTab = screen.getByRole('tab', { name: 'פיד חי' });
    const statsTab = screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' });
    expect(feedTab).toHaveAttribute('aria-selected', 'true');
    expect(statsTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(statsTab);
    expect(statsTab).toHaveAttribute('aria-selected', 'true');
    expect(feedTab).toHaveAttribute('aria-selected', 'false');
  });
});

describe('<ActivityTab> — global date-range + store picker on the stats sub-tab', () => {
  it('does NOT render the <Filters> range/store picker on the live-feed sub-tab', () => {
    renderTab();
    // default = feed; the shared Filters strip (quick-range label + the
    // featured-presets container) must NOT appear so the feed is not implied
    // to be range-filtered. (The events feed has its OWN store picker labelled
    // "סינון לפי חנות"; we key off the Filters-only quick-range markers.)
    expect(screen.queryByText('טווח מהיר')).toBeNull();
    expect(screen.queryByTestId('filters-featured-desktop')).toBeNull();
  });

  it('renders the shared <Filters> range/store picker on the stats sub-tab', () => {
    renderTab();
    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));
    // The shared Filters component: store <select aria-label="חנות"> + quick-
    // range label + the featured-presets container.
    expect(screen.getByLabelText('חנות')).toBeInTheDocument();
    expect(screen.getByText('טווח מהיר')).toBeInTheDocument();
    expect(screen.getByTestId('filters-featured-desktop')).toBeInTheDocument();
  });

  it('calls the GLOBAL onChange (setFilters) when the range preset changes on the stats sub-tab', () => {
    const { onChange } = renderTab();
    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));

    // Pick a different featured preset ("היום") via the shared Filters strip
    // (scope to the DESKTOP featured row — the mobile pill bar duplicates it).
    const desktopPresets = screen.getByTestId('filters-featured-desktop');
    fireEvent.click(within(desktopPresets).getByRole('button', { name: 'היום' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.preset).toBe('today');
    // The range moved off the original 30-day window → global filters updated.
    expect(next.range).not.toEqual(FILTERS.range);
  });

  it('keys the stats SWR fetch off the GLOBAL range — a wider range yields a different key', () => {
    const wide: F = { ...FILTERS, range: { from: '2026-01-01', to: '2026-06-07' } };
    renderTab({ filters: wide });
    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));

    // The stats child built its /api/activity-stats SWR key from filters.range.
    const statsKey = swrKeys.find((k) => k.includes('/api/activity-stats'));
    expect(statsKey).toBeTruthy();
    expect(statsKey).toContain('2026-01-01');
    expect(statsKey).toContain('2026-06-07');
  });

  it('propagates the GLOBAL store filter into the stats SWR key', () => {
    const scoped: F = { ...FILTERS, store: 'uzoshop' };
    renderTab({ filters: scoped });
    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));

    const statsKey = swrKeys.find((k) => k.includes('/api/activity-stats'));
    expect(statsKey).toBeTruthy();
    expect(statsKey).toContain('store=');
  });
});
