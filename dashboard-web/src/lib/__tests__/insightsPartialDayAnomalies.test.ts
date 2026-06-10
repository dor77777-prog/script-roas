/**
 * P1-7 (audit 2026-06-10) — the revenue z-score CRITICAL and the 3-day ROAS
 * streak rules must NOT evaluate the in-progress Israel day.
 *
 * A9-04 (2026-05-27) added a current-day guard to the dead-day rule only
 * (see insightsDeadDayCurrentDay.test.ts). The other anomaly rules kept
 * anchoring on the LAST row: mid-morning the day's revenue is legitimately
 * ~15% of a full day (orders haven't attributed yet), so |z| >> 2.5 fired a
 * false CRITICAL "צניחה חריגה בהכנסות" every morning, and the ROAS streak
 * counted today's lagged-attribution ROAS as a "low day".
 *
 * Post-fix: when the last row IS the current IL day, the z-score / streak
 * rules evaluate the series ending on the last COMPLETED day instead
 * (mirroring detectCampaignDied's today-1 anchor). The partial day stays
 * visible in charts — it is only excluded from anomaly evaluation.
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
  } as DailyRow;
}

/**
 * 15 healthy baseline days (revenue alternating 480/520 so the MAD is
 * non-zero and the robust z-score can fire) ending the day before
 * `lastDate`, then `lastDate` itself at 15% of baseline revenue (75).
 */
function buildRevenueCrashSeriesEndingOn(lastDate: string): DailyRow[] {
  const rows: DailyRow[] = [];
  for (let i = 15; i >= 1; i--) {
    rows.push(row({ date: addDays(lastDate, -i), revenue: i % 2 === 0 ? 480 : 520 }));
  }
  rows.push(row({ date: lastDate, revenue: 75 })); // 15% of a ~500 baseline
  return rows;
}

/**
 * 13 healthy ROAS days (~3.0) then 3 consecutive low-ROAS days (1.5)
 * ending on `lastDate`. Revenue is held constant so ONLY the streak rule
 * can fire (constant baseline → MAD 0 → z-score 0).
 */
function buildRoasStreakSeriesEndingOn(lastDate: string): DailyRow[] {
  const rows: DailyRow[] = [];
  for (let i = 15; i >= 3; i--) {
    rows.push(row({ date: addDays(lastDate, -i), totalSpend: 100, revenue: 300, roas: 3 }));
  }
  for (let i = 2; i >= 0; i--) {
    rows.push(row({ date: addDays(lastDate, -i), totalSpend: 100, revenue: 150, roas: 1.5 }));
  }
  return rows;
}

const hasRevCrash = (insights: { id: string; severity: string }[]) =>
  insights.some((i) => i.id.includes('-rev-') && i.severity === 'critical');
const hasRoasStreak = (insights: { id: string }[]) =>
  insights.some((i) => i.id.includes('-roas-streak-'));

describe('revenue z-score — current-day suppression (P1-7)', () => {
  it('does NOT fire the critical anomaly when the 15%-of-baseline row is the current IL day', () => {
    const insights = detectAnomalies(buildRevenueCrashSeriesEndingOn(todayInIsrael()));
    expect(hasRevCrash(insights)).toBe(false);
  });

  it('MUST fire when the same crash row is yesterday (a COMPLETED day)', () => {
    const insights = detectAnomalies(
      buildRevenueCrashSeriesEndingOn(addDays(todayInIsrael(), -1)),
    );
    expect(hasRevCrash(insights)).toBe(true);
  });

  it('still fires on a yesterday crash even when a partial today row is appended (today-1 anchor)', () => {
    const yesterday = addDays(todayInIsrael(), -1);
    const rows = buildRevenueCrashSeriesEndingOn(yesterday);
    // Append the in-progress IL day — must not mask yesterday's real crash.
    rows.push(row({ date: todayInIsrael(), revenue: 60 }));
    const insights = detectAnomalies(rows);
    expect(hasRevCrash(insights)).toBe(true);
  });
});

describe('3-day ROAS streak — current-day suppression (P1-7)', () => {
  it('does NOT count the in-progress IL day as the 3rd low day', () => {
    // Low days are [today-2, today-1, today]; with today excluded only TWO
    // completed low days remain → no streak.
    const insights = detectAnomalies(buildRoasStreakSeriesEndingOn(todayInIsrael()));
    expect(hasRoasStreak(insights)).toBe(false);
  });

  it('MUST fire when all 3 low days are COMPLETED (series ends yesterday)', () => {
    const insights = detectAnomalies(
      buildRoasStreakSeriesEndingOn(addDays(todayInIsrael(), -1)),
    );
    expect(hasRoasStreak(insights)).toBe(true);
  });
});
