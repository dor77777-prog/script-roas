// dashboard-web/src/components/__tests__/goalTrackerWideFetch.dom.test.tsx
//
// Start-of-month forecast bug (2026-06-01) — component-level guard.
//
// The GoalTracker's end-of-month forecast collapsed to month-to-date at the
// START of a month because it fed the parent's FILTERED `data.rows` prop to
// forecastMonthEnd. Under the default `this_month` preset that prop contains
// only the current month's days, so the trailing-7-day run-rate baseline
// (which falls in the PREVIOUS month near month-start) had no rows → daily
// average 0 → projection == MTD.
//
// The fix makes GoalTracker fetch its OWN wide, filter-INDEPENDENT window via
// SWR — `/api/data?from=<monthStart-7>&to=<today>` (all stores) — and feed
// THOSE rows to forecastMonthEnd, falling back to the prop rows only while
// the wide fetch is loading.
//
// These tests mock `swr` to:
//   (1) capture the SWR key and assert it is the GLOBAL [monthStart-7, today]
//       window (no store filter, NOT the filtered prop range) — proving the
//       panel stays GLOBAL;
//   (2) inject distinct wide-fetched rows (a real trailing-7-day baseline)
//       and assert the rendered forecast reflects THEM (projection > MTD),
//       not the starved prop rows (which would collapse to MTD).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DashboardData, DailyRow } from '@/lib/types';

// ---- SWR mock: settable holder + captured key, poked before each render. ----
let swrReturn: { data: DashboardData | undefined; error: unknown } = {
  data: undefined,
  error: undefined,
};
let lastSwrKey: string | undefined;

vi.mock('swr', () => ({
  default: (key: string) => {
    lastSwrKey = key;
    return swrReturn;
  },
}));

import { GoalTracker } from '@/components/GoalTracker';

// Per-month goals key (T1/T2). The panel reads its goal from here now; the
// legacy single-number key survives only as a one-time migration source.
const GOAL_SETTINGS_KEY = 'roas-dashboard:goal-settings';

// The single-calendar-month range the GoalTracker selects on. These tests
// exercise the CURRENT month (so the forecast path runs), so the range is the
// current IL calendar month [monthStart, monthEnd].
function currentMonthRange(): { from: string; to: string } {
  const today = todayInIsrael();
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function row(over: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(),
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
  };
}

function dashboardData(rows: DailyRow[]): DashboardData {
  return {
    rows,
    stores: ['uzoshop'],
    lastUpdated: todayInIsrael(),
  } as unknown as DashboardData;
}

beforeEach(() => {
  swrReturn = { data: undefined, error: undefined };
  lastSwrKey = undefined;
  window.localStorage.clear();
  // Pre-seed a goal for the current month so the panel renders the pacing view.
  window.localStorage.setItem(
    GOAL_SETTINGS_KEY,
    JSON.stringify({ v: 1, byMonth: { [todayInIsrael().slice(0, 7)]: 100000 } }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<GoalTracker> wide forecast fetch (2026-06-01) — stays GLOBAL', () => {
  it('keys the SWR fetch on the GLOBAL [monthStart-7, today] window, NOT the filtered prop range and with NO store filter', () => {
    swrReturn = { data: undefined, error: undefined };
    // Pass the current calendar month; the filtered prop rows are irrelevant.
    render(<GoalTracker data={dashboardData([row({ revenue: 1 })])} range={currentMonthRange()} />);

    const today = todayInIsrael();
    const monthStart = `${today.slice(0, 7)}-01`;
    const expectedFrom = addDays(monthStart, -7);
    expect(lastSwrKey).toBe(`/api/data?from=${expectedFrom}&to=${today}`);
    // Global: never carries a store filter.
    expect(lastSwrKey).not.toContain('store=');
  });

  it('feeds the WIDE-fetched rows (real trailing-7-day baseline) to the forecast → projection does NOT collapse to MTD', () => {
    const today = todayInIsrael();
    const monthStart = `${today.slice(0, 7)}-01`;
    const todayDay = parseInt(today.slice(-2), 10);

    // Wide-fetched rows: current-month MTD days + a real trailing-7-day
    // baseline at $10,000/day (these dates fall in the previous month near
    // month-start — exactly what the filtered prop omitted).
    const wideRows: DailyRow[] = [];
    for (let day = 1; day <= todayDay; day++) {
      wideRows.push(row({ date: `${monthStart.slice(0, 7)}-${String(day).padStart(2, '0')}`, revenue: 4000 }));
    }
    for (let d = -7; d <= -1; d++) {
      wideRows.push(row({ date: addDays(today, d), revenue: 10_000 }));
    }
    swrReturn = { data: dashboardData(wideRows), error: undefined };

    // Prop rows are intentionally starved (current month only) — if the
    // component used these the projection would collapse to MTD.
    const propRows = wideRows.filter((r) => r.date >= monthStart);
    const { container } = render(<GoalTracker data={dashboardData(propRows)} range={currentMonthRange()} />);

    // The forecast label "חיזוי סוף חודש" must be present (pacing view rendered).
    expect(screen.getByText('חיזוי סוף חודש')).toBeInTheDocument();

    // With the wide rows, the projection extrapolates the $10k/day run-rate
    // across the remaining days, so the forecast caption must read "above
    // target" (מעל היעד) rather than the collapsed-to-MTD "below target"
    // (מתחת ליעד). MTD here is 4000×todayDay (≤ ~120k early in month) while
    // the projection approaches ~10k×30 ≈ 300k, comfortably over the 100k goal.
    const text = container.textContent ?? '';
    if (todayDay <= 7) {
      expect(text).toContain('מעל היעד');
      expect(text).not.toContain('מתחת ליעד');
    }
  });

  it('falls back to the prop rows while the wide fetch is still loading (panel still renders, no crash)', () => {
    // Wide fetch not resolved yet (data undefined). Prop rows present.
    swrReturn = { data: undefined, error: undefined };
    const today = todayInIsrael();
    const monthStart = `${today.slice(0, 7)}-01`;
    const propRows = [row({ date: monthStart, revenue: 4359 })];
    render(<GoalTracker data={dashboardData(propRows)} range={currentMonthRange()} />);
    // Panel renders the pacing view from the fallback rows without throwing.
    expect(screen.getByText('חיזוי סוף חודש')).toBeInTheDocument();
    expect(screen.getByText('יעד חודשי')).toBeInTheDocument();
  });
});
