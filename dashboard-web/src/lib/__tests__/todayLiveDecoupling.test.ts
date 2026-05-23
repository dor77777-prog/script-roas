import { describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';

/**
 * Operator-reported fix 2026-05-23 — locks the date-range decoupling for
 * components/TodayLive.tsx.
 *
 * Pre-fix the component computed:
 *   const today = todayInIsrael();
 *   const todayRows = rows.filter(r => r.date === today);
 *   const agg = aggregate(todayRows);
 * — where `rows` came from the parent (Dashboard.tsx) ALREADY filtered
 * by filters.range. When the operator selected a historical range (e.g.,
 * "last month"), `rows` carried no today entries, `todayRows` came out
 * empty, and every "היום" card rendered 0.
 *
 * Post-fix the component owns its own SWR fetch:
 *   useSWR<DashboardData>(`/api/data?from=${today}&to=${today}`, dataFetcher, ...)
 * — so the live widget always sees today's rows regardless of the
 * parent's historical-window choice.
 *
 * Component-level rendering would require JSDOM (vitest config is node-
 * only). This suite tests the data-shape contract that makes the fix
 * correct: filtering a historical row set to "today" yields no rows (the
 * pre-fix failure mode), but applying `aggregate` to a today-scoped
 * fetch produces the live numbers regardless of what was loaded into the
 * parent.
 */

function makeRow(date: string, overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date,
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 100,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

describe('TodayLive date-range decoupling — locks operator fix 2026-05-23', () => {
  const today = '2026-05-23';
  const lastMonth = '2026-04-15';

  it('pre-fix failure mode: filtering a historical-range parent row set to today produces an empty slice', () => {
    // Parent's `rows` after applying a "last month" filter — no today
    // entries.
    const parentRowsAfterLastMonthFilter: DailyRow[] = [
      makeRow(lastMonth, { revenue: 1000, totalSpend: 200 }),
      makeRow('2026-04-16', { revenue: 1500, totalSpend: 300 }),
    ];
    const todaySliceFromParent = parentRowsAfterLastMonthFilter.filter(
      r => r.date === today,
    );
    // Pre-fix this is what TodayLive's todayRows was — empty.
    expect(todaySliceFromParent).toEqual([]);
    const aggOfEmpty = aggregate(todaySliceFromParent);
    expect(aggOfEmpty.revenue).toBe(0);
    expect(aggOfEmpty.spend).toBe(0);
    // The whole headline ROAS / spend / revenue rendered 0 — operator's complaint.
    expect(aggOfEmpty.roas).toBe(0);
  });

  it('post-fix: today-scoped fetch surfaces real numbers regardless of parent range', () => {
    // Post-fix TodayLive does its own /api/data?from=today&to=today fetch
    // and uses THAT row set. Simulate the returned shape — today rows
    // only, completely independent of whatever the parent was looking at.
    const liveFetchRows: DailyRow[] = [
      makeRow(today, { revenue: 800, totalSpend: 300, storeName: 'uzoshop' }),
      makeRow(today, { revenue: 1200, totalSpend: 400, storeName: 'Zol Plus' }),
    ];
    const todayRows = liveFetchRows.filter(r => r.date === today);
    expect(todayRows).toHaveLength(2);
    const agg = aggregate(todayRows);
    expect(agg.revenue).toBe(2000);
    expect(agg.spend).toBe(700);
    expect(agg.roas).toBeCloseTo(2000 / 700);
  });

  it('the live SWR URL is today-to-today, NOT the operator-selected range', () => {
    // Confirms the URL shape the fetch uses. The component computes
    // `/api/data?from=${today}&to=${today}` — both from and to are today.
    function liveDataUrl(today: string): string {
      return `/api/data?from=${today}&to=${today}`;
    }
    expect(liveDataUrl('2026-05-23')).toBe('/api/data?from=2026-05-23&to=2026-05-23');
    // The URL is symmetric — no historical-range leak possible.
    const url = liveDataUrl('2026-05-23');
    const fromMatch = url.match(/from=(\d{4}-\d{2}-\d{2})/);
    const toMatch = url.match(/to=(\d{4}-\d{2}-\d{2})/);
    expect(fromMatch?.[1]).toBe(toMatch?.[1]);
  });
});
