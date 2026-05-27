/**
 * A9-04 (2026-05-27) — the "dead day" anomaly (spend > 50 && revenue === 0)
 * fires CRITICAL (weight 98). Pre-fix it also fired for the CURRENT in-progress
 * Israel day, where revenue is legitimately 0 mid-morning before the day's
 * orders attribute. That produced a false-alarm CRITICAL every morning.
 *
 * Post-fix: the dead-day insight is suppressed for the current Israel day, but
 * still fires for a genuinely dead PAST day.
 */
import { describe, it, expect } from 'vitest';
import { detectAnomalies } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function row(patch: Partial<DailyRow> & { date: string }): DailyRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 500,
    roas: 5,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...patch,
  };
}

/**
 * Builds 8 healthy days ending on `lastDate`, then overrides the LAST row
 * (lastDate) to a dead-day shape (spend 100, revenue 0). detectAnomalies
 * scans each store's rows with the last row as "today".
 */
function buildSeriesEndingOn(lastDate: string): DailyRow[] {
  const rows: DailyRow[] = [];
  for (let i = 7; i >= 1; i--) {
    rows.push(row({ date: addDays(lastDate, -i) }));
  }
  // The day under test: high spend, zero revenue → dead-day candidate.
  rows.push(row({ date: lastDate, totalSpend: 100, revenue: 0, roas: 0 }));
  return rows;
}

const isDeadDay = (insights: { id: string }[]) =>
  insights.some((i) => i.id.includes('-dead-day-'));

describe('dead-day insight — current-day suppression (A9-04)', () => {
  it('does NOT fire for the current Israel day even with spend>50 && revenue===0', () => {
    const today = todayInIsrael();
    const insights = detectAnomalies(buildSeriesEndingOn(today));
    expect(isDeadDay(insights)).toBe(false);
  });

  it('still fires for a PAST dead day with spend>50 && revenue===0', () => {
    // Pick a past date inside the 21-day analysis window (today - 2).
    const past = addDays(todayInIsrael(), -2);
    const insights = detectAnomalies(buildSeriesEndingOn(past));
    expect(isDeadDay(insights)).toBe(true);
  });
});
