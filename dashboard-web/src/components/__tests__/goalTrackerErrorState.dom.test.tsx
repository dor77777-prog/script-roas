// dashboard-web/src/components/__tests__/goalTrackerErrorState.dom.test.tsx
//
// P1-4d (2026-06-10 state-honesty sweep) — GoalTracker wide-fetch failure.
//
// Pre-fix the panel destructured only { data } from its month-anchored
// /api/data SWR fetch: on failure it silently fell back to the parent's
// FILTERED prop rows (wrong scope) → a past month rendered "✗ לא עמד · $0"
// as if the data legitimately said so, and the current month's pacing ran on
// the wrong rows. Now `error` (with no stale data) renders an explicit
// role=alert card with retry; the month nav + edit-goal affordance stay
// reachable.
//
// Mock pattern mirrors goalTrackerWideFetch.dom.test.tsx (settable swr stub).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DashboardData, DailyRow } from '@/lib/types';

let swrReturn: { data: DashboardData | undefined; error: unknown; mutate?: () => void } = {
  data: undefined,
  error: undefined,
};

vi.mock('swr', () => ({
  default: () => swrReturn,
}));

import { GoalTracker } from '@/components/GoalTracker';

const GOAL_SETTINGS_KEY = 'roas-dashboard:goal-settings';

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function currentMonthRange(): { from: string; to: string } {
  const month = todayInIsrael().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function row(over: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(), storeId: 'uzoshop', storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0,
    revenue: 0, roas: 0, grossProfit: 0, cogs: 0, netProfit: 0, hasCogs: false,
    grossRevenue: null, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
    ...over,
  } as DailyRow;
}

function dashboardData(rows: DailyRow[]): DashboardData {
  return { rows, stores: ['uzoshop'], lastUpdated: todayInIsrael() } as unknown as DashboardData;
}

beforeEach(() => {
  swrReturn = { data: undefined, error: undefined };
  window.localStorage.clear();
  window.localStorage.setItem(
    GOAL_SETTINGS_KEY,
    JSON.stringify({ v: 1, byMonth: { [todayInIsrael().slice(0, 7)]: 100000 } }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<GoalTracker> — P1-4d wide-fetch error branch', () => {
  it('renders an explicit role=alert error card (NOT $0 actuals) when the wide fetch fails with no data', () => {
    swrReturn = { data: undefined, error: new Error('GoalTracker: 500'), mutate: vi.fn() };
    render(
      <GoalTracker data={dashboardData([row({ revenue: 4359 })])} range={currentMonthRange()} />,
    );

    const alert = screen.getByTestId('goal-tracker-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('שגיאה בטעינת נתוני החודש');
    expect(alert.textContent).toContain('GoalTracker: 500');
    // Retry affordance.
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
    // None of the pacing/actuals UI renders against the wrong fallback rows.
    expect(screen.queryByText('חיזוי סוף חודש')).toBeNull();
    expect(screen.queryByText(/לא עמד/)).toBeNull();
  });

  it('keeps rendering the normal pacing view when data is present even if a background refresh errored (stale > blank)', () => {
    swrReturn = {
      data: dashboardData([row({ revenue: 5000 })]),
      error: new Error('transient revalidation error'),
      mutate: vi.fn(),
    };
    render(
      <GoalTracker data={dashboardData([])} range={currentMonthRange()} />,
    );

    // Stale data on screen beats a blank error card.
    expect(screen.getByText('חיזוי סוף חודש')).toBeInTheDocument();
    expect(screen.queryByTestId('goal-tracker-error')).toBeNull();
  });
});
