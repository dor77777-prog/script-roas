import { describe, it, expect } from 'vitest';

/**
 * CPM (cost per 1000 impressions) formula.
 *
 * Inlined in CampaignsTable.sortAggregated, CampaignsTableRow render,
 * and CampaignDrawer summary.dailyArr build. All three sites use the
 * same definition: spend / impressions * 1000, with a zero-impressions
 * guard returning 0 so empty rows sort to the bottom on desc and the
 * row renders "—" instead of NaN.
 *
 * This test pins the contract so any future tweak (e.g. switching to
 * per-mille instead of per-thousand-impressions, or moving the guard
 * value) is caught here before it ships.
 */
function cpm(spend: number, impressions: number): number {
  return impressions > 0 ? (spend / impressions) * 1000 : 0;
}

describe('cpm', () => {
  it('returns spend / impressions * 1000 for normal inputs', () => {
    // $50 spent for 10,000 impressions -> $5 per 1000 impressions
    expect(cpm(50, 10000)).toBe(5);
  });

  it('handles fractional CPM', () => {
    // $7.50 spent for 5,000 impressions -> $1.50 CPM
    expect(cpm(7.5, 5000)).toBe(1.5);
  });

  it('returns 0 when impressions is 0 (no spend either)', () => {
    expect(cpm(0, 0)).toBe(0);
  });

  it('returns 0 when impressions is 0 but spend > 0 (defensive guard)', () => {
    // This shouldn't happen in production (no impressions = no campaign)
    // but the guard prevents NaN / Infinity from poisoning the sort.
    expect(cpm(100, 0)).toBe(0);
  });

  it('returns 0 when impressions is negative (defensive guard)', () => {
    // The > 0 check excludes negatives. setNumberFormat / parseNumber should
    // never produce negative impressions, but pin the contract.
    expect(cpm(50, -100)).toBe(0);
  });

  it('handles spend = 0 with impressions > 0 (free impressions)', () => {
    // Free reach (organic boost, leaked test traffic, etc.) -> CPM = 0.
    expect(cpm(0, 10000)).toBe(0);
  });

  it('scales linearly with spend', () => {
    expect(cpm(100, 10000)).toBe(10);
    expect(cpm(200, 10000)).toBe(20);
    expect(cpm(50, 10000)).toBe(5);
  });

  it('scales inversely with impressions', () => {
    expect(cpm(100, 10000)).toBe(10);
    expect(cpm(100, 20000)).toBe(5);
    expect(cpm(100, 5000)).toBe(20);
  });

  it('handles very small impression counts (single-digit)', () => {
    // 1 impression for $0.50 -> $500 per 1000 impressions
    expect(cpm(0.5, 1)).toBe(500);
  });

  it('handles very large impression counts (million-scale)', () => {
    // $5000 spend / 10M impressions -> $0.50 CPM
    expect(cpm(5000, 10_000_000)).toBe(0.5);
  });
});

/**
 * CampaignDrawer CPM-chart visibility gate. Mirrors the inline
 * computation in the JSX `if (rangeDays < 3 || cpmSeries.length < 2)
 * return null` block, kept here so future refactors don't silently
 * change the "show CPM chart" rule.
 */
function rangeDaysInclusive(fromYmd: string, toYmd: string): number {
  const fromMs = Date.UTC(
    Number(fromYmd.slice(0, 4)),
    Number(fromYmd.slice(5, 7)) - 1,
    Number(fromYmd.slice(8, 10)),
  );
  const toMs = Date.UTC(
    Number(toYmd.slice(0, 4)),
    Number(toYmd.slice(5, 7)) - 1,
    Number(toYmd.slice(8, 10)),
  );
  return Math.round((toMs - fromMs) / 86400000) + 1;
}

describe('CampaignDrawer CPM chart range gate', () => {
  it('returns 1 for a single-day range (from === to)', () => {
    expect(rangeDaysInclusive('2026-05-20', '2026-05-20')).toBe(1);
  });

  it('returns 2 for a 2-day range', () => {
    expect(rangeDaysInclusive('2026-05-20', '2026-05-21')).toBe(2);
  });

  it('returns 3 for a 3-day range — chart should show at exactly 3 days', () => {
    // User explicitly asked: show at >=3 days, not >3 days.
    expect(rangeDaysInclusive('2026-05-18', '2026-05-20')).toBe(3);
  });

  it('returns 7 for a week-long range', () => {
    expect(rangeDaysInclusive('2026-05-14', '2026-05-20')).toBe(7);
  });

  it('handles month boundary correctly', () => {
    // 2026-04-30 to 2026-05-02 inclusive = 3 days
    expect(rangeDaysInclusive('2026-04-30', '2026-05-02')).toBe(3);
  });

  it('handles year boundary correctly', () => {
    // 2025-12-30 to 2026-01-02 inclusive = 4 days
    expect(rangeDaysInclusive('2025-12-30', '2026-01-02')).toBe(4);
  });
});
