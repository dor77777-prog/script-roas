// dashboard-web/src/components/__tests__/goalTrackerPerMonth.dom.test.tsx
//
// T3 — GoalTracker rewired to per-month + range-aware lookback.
//
// Verifies the new behavior layered on top of the existing pacing card
// (which keeps its 3-metric grid + bar + footer 1:1):
//   - single-month CURRENT range → pacing view (existing forecast layout)
//   - single-month PAST range with goal MET → "✓ עמד ביעד" badge + תוצאה column
//   - single-month PAST range with goal MISSED → "✗ לא עמד" badge
//   - carry-forward → the "נגרר מ-<month>" tag near the goal
//   - non-single-month range → empty "single calendar month only" state
//   - the ‹ › stepper changes the viewed month
//
// `swr` is mocked so we control the all-stores rows fed to the panel. The
// per-month goals are seeded into the new `roas-dashboard:goal-settings` key.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DashboardData, DailyRow } from '@/lib/types';

// ---- SWR mock: per-key holder so different month windows get the right rows.
let swrRows: DailyRow[] | undefined;

vi.mock('swr', () => ({
  default: () => ({ data: swrRows ? dashboardData(swrRows) : undefined, error: undefined }),
}));

import { GoalTracker } from '@/components/GoalTracker';
import { GOAL_SETTINGS_KEY } from '@/lib/goalSettings';

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function row(over: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(),
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0,
    revenue: 0, roas: 0, grossProfit: 0, cogs: 0, netProfit: 0,
    hasCogs: false, grossRevenue: null, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
    ...over,
  };
}

function dashboardData(rows: DailyRow[]): DashboardData {
  return { rows, stores: ['uzoshop'], lastUpdated: todayInIsrael() } as unknown as DashboardData;
}

/** Whole-calendar-month range, e.g. '2026-04' → {from:'2026-04-01', to:'2026-04-30'}. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** A past month relative to the current IL month (two months back, always complete). */
function pastMonth(): string {
  const cur = todayInIsrael().slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m - 1 - 2, 1); // two months back
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function setGoals(byMonth: Record<string, number>) {
  window.localStorage.setItem(
    GOAL_SETTINGS_KEY,
    JSON.stringify({ v: 1, byMonth }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  swrRows = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<GoalTracker> per-month + range-aware (T3)', () => {
  it('non-single-month range → empty "single calendar month only" state, no pacing grid', () => {
    setGoals({ [todayInIsrael().slice(0, 7)]: 100000 });
    // 90-day span crossing several months.
    render(<GoalTracker data={dashboardData([])} range={{ from: '2026-01-01', to: '2026-03-31' }} />);
    expect(screen.getByText('מעקב יעד זמין לחודש בודד')).toBeInTheDocument();
    expect(screen.queryByText('חיזוי סוף חודש')).not.toBeInTheDocument();
  });

  it('single-month CURRENT range with a goal → pacing view (existing forecast layout)', () => {
    const cur = todayInIsrael().slice(0, 7);
    setGoals({ [cur]: 100000 });
    swrRows = [row({ revenue: 4000 })];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(cur)} />);
    expect(screen.getByText('חיזוי סוף חודש')).toBeInTheDocument();
    expect(screen.getByText('יעד חודשי')).toBeInTheDocument();
  });

  it('PAST complete month, goal MET → "✓ עמד ביעד" badge + "תוצאה מול יעד" column', () => {
    const pm = pastMonth();
    setGoals({ [pm]: 100000 });
    // Final actual across the month sums to 150,000 (>= goal → met).
    swrRows = [
      row({ date: `${pm}-05`, revenue: 80000 }),
      row({ date: `${pm}-20`, revenue: 70000 }),
    ];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(pm)} />);
    expect(screen.getByText('✓ עמד ביעד')).toBeInTheDocument();
    expect(screen.getByText(/תוצאה מול יעד/)).toBeInTheDocument();
    expect(screen.getByText('הכנסות בחודש')).toBeInTheDocument();
    // No forecast/days-left chrome on a completed month.
    expect(screen.queryByText('חיזוי סוף חודש')).not.toBeInTheDocument();
  });

  it('PAST complete month, goal MISSED → "✗ לא עמד" badge', () => {
    const pm = pastMonth();
    setGoals({ [pm]: 200000 });
    swrRows = [row({ date: `${pm}-10`, revenue: 50000 })]; // < goal → missed
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(pm)} />);
    expect(screen.getByText('✗ לא עמד')).toBeInTheDocument();
  });

  it('carry-forward → shows the "נגרר מ-<month>" tag when the viewed month has no explicit goal', () => {
    const pm = pastMonth();
    // Goal set for the month BEFORE pm; pm inherits it.
    const [y, m] = pm.split('-').map(Number);
    const earlier = new Date(y, m - 1 - 1, 1);
    const earlierKey = `${earlier.getFullYear()}-${String(earlier.getMonth() + 1).padStart(2, '0')}`;
    setGoals({ [earlierKey]: 100000 });
    swrRows = [row({ date: `${pm}-10`, revenue: 120000 })];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(pm)} />);
    expect(screen.getByText(/נגרר מ/)).toBeInTheDocument();
  });

  it('no explicit goal and no carry → empty-goal "קבע יעד" card for that month', () => {
    const pm = pastMonth();
    // No goals at all.
    swrRows = [row({ date: `${pm}-10`, revenue: 5000 })];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(pm)} />);
    expect(screen.getByText('קבע יעד')).toBeInTheDocument();
  });

  it('CURRENT month → renders the net run-rate panel (projected net / spend / ROAS)', () => {
    // profit-net-runrate-surfaced (Wave 1): forecastMonthEnd already computes
    // projectedNet/Spend/Roas; surface them so a green revenue bar can't hide
    // net sliding to break-even.
    const cur = todayInIsrael().slice(0, 7);
    setGoals({ [cur]: 100000 });
    swrRows = [row({ revenue: 4000, totalSpend: 1000, fbSpend: 1000, hasCogs: true, cogs: 1000, grossProfit: 3000, netProfit: 2000 })];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(cur)} />);
    const panel = screen.getByTestId('goal-runrate');
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain('רווח-נטו צפוי');
    expect(panel.textContent).toMatch(/×/); // projected ROAS rendered as "N.N×"
  });

  it('PAST complete month → NO run-rate panel (forecast chrome hidden)', () => {
    const pm = pastMonth();
    setGoals({ [pm]: 100000 });
    swrRows = [row({ date: `${pm}-10`, revenue: 120000 })];
    render(<GoalTracker data={dashboardData(swrRows)} range={monthRange(pm)} />);
    expect(screen.queryByTestId('goal-runrate')).not.toBeInTheDocument();
  });

  it('the ‹ › stepper changes the viewed month label', () => {
    const cur = todayInIsrael().slice(0, 7);
    setGoals({ [cur]: 100000 });
    swrRows = [row({ revenue: 4000 })];
    const { container } = render(
      <GoalTracker data={dashboardData(swrRows)} range={monthRange(cur)} />,
    );
    // Find the month-nav label and the prev button.
    const prevBtn = screen.getByRole('button', { name: 'חודש קודם' });
    const before = container.textContent ?? '';
    fireEvent.click(prevBtn);
    const after = container.textContent ?? '';
    // The visible month label changed (we stepped back one month).
    expect(after).not.toBe(before);
  });
});
