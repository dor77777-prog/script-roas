// dashboard-web/src/components/activity/__tests__/ActivityTab.dom.test.tsx
//
// DOM tests for the <ActivityTab> wrapper — the sub-tab switcher inside the
// "פעילות" area. It defaults to the existing live feed (no behaviour change for
// someone who never clicks) and swaps to the new "סטטיסטיקות והתפלגויות" stats
// view when the operator clicks the switcher. NO info loss — the feed stays.
//
// The two child views (ActivityEventsTab + ActivityStatsTab) both read SWR; we
// mock `swr` to a stub so the switcher logic is tested in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DashboardData, DateRange } from '@/lib/types';

// Both children call useSWR; return a benign empty payload so they render their
// (loading/empty) shells without a network call.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined }),
}));

import { ActivityTab } from '@/components/activity/ActivityTab';

const DATA = { stores: ['uzoshop', 'Zol Plus', '360usmile'] } as unknown as DashboardData;
const RANGE: DateRange = { from: '2026-05-08', to: '2026-06-07' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-06-07T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<ActivityTab> — sub-tab switcher', () => {
  it('defaults to the live feed (events tab), not the stats tab', () => {
    render(<ActivityTab data={DATA} globalStore="All" range={RANGE} />);
    expect(screen.getByTestId('activity-events-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-stats-tab')).toBeNull();
  });

  it('renders both switcher tabs (פיד חי / סטטיסטיקות והתפלגויות)', () => {
    render(<ActivityTab data={DATA} globalStore="All" range={RANGE} />);
    expect(screen.getByRole('tab', { name: 'פיד חי' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }),
    ).toBeInTheDocument();
  });

  it('swaps to the stats tab when the stats switcher is clicked, then back', () => {
    render(<ActivityTab data={DATA} globalStore="All" range={RANGE} />);

    fireEvent.click(screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' }));
    expect(screen.getByTestId('activity-stats-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-events-tab')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'פיד חי' }));
    expect(screen.getByTestId('activity-events-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-stats-tab')).toBeNull();
  });

  it('marks the active switcher tab via aria-selected', () => {
    render(<ActivityTab data={DATA} globalStore="All" range={RANGE} />);
    const feedTab = screen.getByRole('tab', { name: 'פיד חי' });
    const statsTab = screen.getByRole('tab', { name: 'סטטיסטיקות והתפלגויות' });
    expect(feedTab).toHaveAttribute('aria-selected', 'true');
    expect(statsTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(statsTab);
    expect(statsTab).toHaveAttribute('aria-selected', 'true');
    expect(feedTab).toHaveAttribute('aria-selected', 'false');
  });
});
