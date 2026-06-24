import { describe, it, expect } from 'vitest';
import { reconcileRows, type ReconcileRowsInput } from '../reconcileRows';
import { findingMagnitude, parseFinding } from '../reconcileAck';
import type { Violation } from '../reconcile';

/**
 * detailContract — locks the detail/values string FORMAT that findingMagnitude()
 * parses, per invariant, so a future format drift FAILS CI rather than silently
 * making findingMagnitude return 0 (which would suppress an acked-then-worsened
 * finding under a stale ack — the third minor review finding).
 *
 * The ack worsening logic (isFindingAcked) compares findingMagnitude(current)
 * against the magnitude captured at ack time. If a detail-string change ever
 * breaks the parse, the magnitude collapses to 0 and growth <= 0, so the finding
 * stays hidden. We additionally guard isFindingAcked to SHOW on a 0-magnitude
 * current under a >0 ack, but this contract test is the FIRST line of defence:
 * any drift in how reconcileRows formats a finding's two comparable numbers
 * trips here.
 *
 * For each gap-valued invariant we synthesize a window that produces exactly one
 * violation of that class, then assert findingMagnitude() pulls a finite,
 * NON-ZERO gap out of the produced Violation.
 */

const onlyWith = (vs: Violation[], inv: string): Violation => {
  const match = vs.filter((v) => v.label.includes(inv));
  expect(match.length, `expected exactly one ${inv} violation, got ${match.length}: ${JSON.stringify(match.map((m) => m.label))}`).toBe(1);
  return match[0];
};

describe('detail-string contract — findingMagnitude parses a NON-ZERO gap for every gap-valued invariant', () => {
  it('INV-7 (cross-source spend) — "data_daily X vs campaigns_daily Y"', () => {
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-02', storeName: 'uzoshop', fbSpend: 1972, gaSpend: 0, ttSpend: 0, totalSpend: 1972, revenue: 6000, roas: 6000 / 1972 }],
      productRows: [],
      campaignRows: [{ date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 3000 }],
      ordersRows: [],
    };
    const v = onlyWith(reconcileRows(input), 'INV-7 Meta spend');
    expect(findingMagnitude(v)).toBeCloseTo(Math.abs(3000 - 1972), 4);
    expect(findingMagnitude(v)).toBeGreaterThan(0);
  });

  it('INV-9 (products vs data revenue) — trailing "§14.7" note does NOT poison the parse', () => {
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-02', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 1, revenue: 6000, roas: 6000 }],
      productRows: [{ date: '2026-05-02', storeName: 'uzoshop', revenue: 9000, netRevenue: 9000, orders: 12 }],
      campaignRows: [],
      ordersRows: [],
    };
    const v = onlyWith(reconcileRows(input), 'INV-9');
    // The INV-9 detail ends with "... ARCHITECTURE.md §14.7" — assert the parser
    // still pulls the first TWO numbers (6000, 9000) and not the trailing 14/7.
    const p = parseFinding(v);
    expect(p.expected).toBe(6000);
    expect(p.actual).toBe(9000);
    expect(findingMagnitude(v)).toBeCloseTo(3000, 4);
  });

  it('INV-10 (orders vs data revenue) — "data_daily X vs orders_attribution Y"', () => {
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-02', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 1, revenue: 6000, roas: 6000 }],
      productRows: [],
      campaignRows: [],
      ordersRows: [{ date: '2026-05-02', storeName: 'uzoshop', totalCad: 9000 }],
    };
    const v = onlyWith(reconcileRows(input), 'INV-10');
    expect(findingMagnitude(v)).toBeCloseTo(3000, 4);
    expect(findingMagnitude(v)).toBeGreaterThan(0);
  });

  it('INV-7 TikTok over-report — "data_daily(account-level) X vs campaigns_daily(per-campaign) Y …" parses the FIRST two numbers', () => {
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-21', storeName: 'uzoshop', fbSpend: 0, gaSpend: 0, ttSpend: 11.1, totalSpend: 11.1, revenue: 100, roas: 100 / 11.1 }],
      productRows: [],
      campaignRows: [{ date: '2026-05-21', storeName: 'uzoshop', platform: 'TikTok', spend: 23.46 }],
      ordersRows: [],
    };
    const v = onlyWith(reconcileRows(input), 'INV-7 TikTok');
    const p = parseFinding(v);
    expect(p.expected).toBeCloseTo(11.1, 4);
    expect(p.actual).toBeCloseTo(23.46, 4);
    expect(findingMagnitude(v)).toBeCloseTo(Math.abs(23.46 - 11.1), 4);
  });

  it('INV-6 (same-source platform-sum) — agree() `values` map yields the spread magnitude', () => {
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-02', storeName: 'uzoshop', fbSpend: 100, gaSpend: 0, ttSpend: 0, totalSpend: 150, revenue: 600, roas: 4 }],
      productRows: [],
      campaignRows: [],
      ordersRows: [],
    };
    // totalSpend 150 vs fb+ga+tt = 100 → INV-6 spread 50.
    const v = onlyWith(reconcileRows(input), 'INV-6');
    expect(v.values, 'INV-6 must carry a values map (agree() output)').toBeTruthy();
    expect(findingMagnitude(v)).toBeCloseTo(50, 4);
  });

  it('INV-3 (same-source ROAS ratio) — agree() `values` map yields a RATIO-scale magnitude', () => {
    // roas column deliberately disagrees with revenue/totalSpend by a ratio gap.
    const input: ReconcileRowsInput = {
      dataRows: [{ date: '2026-05-02', storeName: 'uzoshop', fbSpend: 100, gaSpend: 0, ttSpend: 0, totalSpend: 100, revenue: 300, roas: 9 }],
      productRows: [],
      campaignRows: [],
      ordersRows: [],
    };
    // expected ROAS = 300/100 = 3; roas column = 9 → INV-3 spread 6 (a ratio).
    const v = onlyWith(reconcileRows(input), 'INV-3');
    expect(v.values, 'INV-3 must carry a values map (agree() output)').toBeTruthy();
    const mag = findingMagnitude(v);
    expect(mag).toBeCloseTo(6, 4);
    // Contract: INV-3 magnitude is a small RATIO, NOT a dollar figure — this is
    // exactly why the absolute worsening floor must be unit-aware.
    expect(mag).toBeLessThan(25);
  });
});
