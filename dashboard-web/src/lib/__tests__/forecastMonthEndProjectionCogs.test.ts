// dashboard-web/src/lib/__tests__/forecastMonthEndProjectionCogs.test.ts
//
// HIGH-9 / O3-HI-01 regression: forecastMonthEnd's MTD net used per-store
// `r.cogs` (the cron writer's value at the per-store ${STORE}_COGS_RATE),
// but the END-OF-MONTH projection multiplied projectedRev by the GLOBAL
// COGS_RATE_OF_REVENUE constant. A store calibrated at 18% would show
// MTD net consistent with its 18% rate, then a projected net using 25% —
// a guaranteed mid-card inconsistency in the same forecast.
//
// Fix: derive the projection's COGS rate from the observed last-7 window
// (`last7Cogs / last7Rev`) so MTD and the projection use the same effective
// rate. Fall back to the global constant only when last-7 revenue is zero
// (no signal).
//
// Test strategy: produce a 7-day window whose effective per-row rate is
// ~18% (rows with hasCogs:true + r.cogs already calibrated). Assert
// projectedNet matches the 18%-derived formula, NOT the 25% one.
//
// vitest runs node so the function is pure; we use the real
// `todayInIsrael()` to build a fixture anchored to the current date.

import { describe, expect, it } from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';

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

function row(overrides: Partial<DailyRow> = {}): DailyRow {
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
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    ...overrides,
  };
}

describe('forecastMonthEnd projection COGS rate (HIGH-9 / O3-HI-01)', () => {
  it('projected net uses the observed 7-day effective COGS rate, not global 25%', () => {
    // Build 7 days of rows with r.cogs == 18% × revenue (writer-provided
    // per-store calibration). 18% is the same effective rate MTD will see.
    // The fix must produce a projection consistent with that — NOT 25%.
    //
    // Note (HIGH-10 / O3-HI-02): the baseline window is [today-7, today-1]
    // — exclude today. We place all 7 rows in that window.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      const date = addDays(today, d);
      rows.push(
        row({
          date,
          revenue: 1000,
          totalSpend: 200,
          cogs: 180, // 18% of revenue, writer-provided
          hasCogs: true,
        }),
      );
    }

    const f = forecastMonthEnd(rows);
    // dailyAvgRev = 7000/7 = 1000; dailyAvgSpend = 1400/7 = 200.
    // Observed cogs rate = 1260/7000 = 0.18.
    // Expected projectedNet uses 0.18, NOT 0.25.
    const expectedNetAt18 =
      f.projectedRevenue - f.projectedSpend - f.projectedRevenue * 0.18;
    const wrongNetAt25 =
      f.projectedRevenue - f.projectedSpend - f.projectedRevenue * 0.25;
    expect(f.projectedNet).toBeCloseTo(expectedNetAt18, 6);
    // Pre-fix value was wrongNetAt25 — pin so a refactor can't quietly
    // re-introduce the global rate.
    expect(f.projectedNet).not.toBeCloseTo(wrongNetAt25, 2);
  });

  it('falls back to 25% when last-7 window has zero revenue (no signal)', () => {
    // Empty rows — no signal anywhere; projectedRev is also 0, so
    // projectedNet collapses to -projectedSpend (which is also 0).
    // The fallback isn't visibly observable in the result there.
    //
    // Build a richer scenario: MTD has revenue but the last-7 window
    // is entirely zero. In practice this means a stretch with no orders
    // (an outage or a brand-new store), and we want the projection to
    // come from the global default rather than emit NaN.
    const today = todayInIsrael();
    const monthStart = today.slice(0, 8) + '01';
    // Build a few historical MTD rows OUTSIDE the last-7 window. If
    // today is e.g. 2026-05-23, MTD includes 05-01..05-23 but the last-7
    // window is 05-17..05-23 (with HIGH-10 it'll be 05-16..05-22).
    // Put rows on 05-01..05-10 only so last-7 is empty.
    const earlyMtdDate = today.slice(0, 8) + '03';
    void monthStart;
    const rows: DailyRow[] = [
      row({ date: earlyMtdDate, revenue: 500, totalSpend: 100, cogs: 90 }),
    ];
    const f = forecastMonthEnd(rows);
    // last7Rev === 0 → observedCogsRate falls back to 0.25.
    // projectedRev = mtdRev (500) + 0 * daysRemaining = 500; same for spend.
    // projectedNet = 500 - 100 - 500 * 0.25 = 275.
    // The KEY assertion is that the function doesn't NaN/Infinity out
    // when the window is empty.
    expect(Number.isFinite(f.projectedNet)).toBe(true);
    expect(f.projectedNet).toBeCloseTo(275, 6);
  });

  it('mixed rates across the 7-day window blend into the projection naturally', () => {
    // 5 days at 18% + 2 days at 30% — all placed inside the
    // [today-7, today-1] baseline window (HIGH-10).
    // Total rev: 7 × 1000 = 7000.
    // Total cogs: 5*180 + 2*300 = 900 + 600 = 1500.
    // Effective rate: 1500/7000 ≈ 21.43%.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -3; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000, totalSpend: 200, cogs: 180,
          hasCogs: true,
        }),
      );
    }
    for (let d = -2; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000, totalSpend: 200, cogs: 300,
          hasCogs: true,
        }),
      );
    }
    const f = forecastMonthEnd(rows);
    const blended = 1500 / 7000;
    const expectedNet =
      f.projectedRevenue - f.projectedSpend - f.projectedRevenue * blended;
    expect(f.projectedNet).toBeCloseTo(expectedNet, 4);
  });
});
