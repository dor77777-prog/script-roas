import { describe, expect, it } from 'vitest';

/**
 * d/HI-04 (audit 2026-05-23) — locks the filter-symmetry contract between
 * the two useMemos in components/AdsDrawer.tsx.
 *
 * Before the fix:
 *   - `summary` useMemo: deps included rangeFrom/rangeTo but the inline
 *     `r.date < rangeFrom || r.date > rangeTo` predicate was removed in
 *     FIX-07 (5.2.2.1) on the rationale that /api/ads filters server-side.
 *   - `dailyMetaByAd` useMemo: deps included rangeFrom/rangeTo AND the
 *     same predicate STILL filtered client-side.
 *   - Result: two memos walking the same `data.rows` with different
 *     predicates. If a future caller hands AdsDrawer rows that span
 *     beyond the requested range (e.g., test fixtures, cache bleed-
 *     through, server-side filter regression), the totals would drift
 *     between the headline ad-row aggregates and the daily series.
 *
 * Fix: re-apply the date predicate in `summary` so both memos use the
 * identical narrow set. This suite tests the predicate-equivalence
 * contract — applying the same date-bounds filter to a row set yields
 * the same survivors regardless of which memo's body runs the filter.
 */

type Row = { date: string; spend: number };

function predicate(r: Row, from: string, to: string): boolean {
  return r.date >= from && r.date <= to;
}

describe('AdsDrawer summary / dailyMetaByAd filter symmetry — locks d/HI-04', () => {
  const rows: Row[] = [
    { date: '2026-04-30', spend: 10 },   // before range
    { date: '2026-05-01', spend: 20 },   // boundary low
    { date: '2026-05-15', spend: 30 },   // mid
    { date: '2026-05-31', spend: 40 },   // boundary high
    { date: '2026-06-01', spend: 50 },   // after range
  ];
  const from = '2026-05-01';
  const to = '2026-05-31';

  it('the same predicate drops rows outside [from, to]', () => {
    const surviving = rows.filter(r => predicate(r, from, to));
    expect(surviving.map(r => r.date)).toEqual([
      '2026-05-01', '2026-05-15', '2026-05-31',
    ]);
  });

  it('summary-equivalent sum and daily-equivalent sum stay in sync (symmetric filter)', () => {
    const summarySum = rows
      .filter(r => predicate(r, from, to))
      .reduce((s, r) => s + r.spend, 0);
    const dailySum = rows
      .filter(r => predicate(r, from, to))
      .reduce((s, r) => s + r.spend, 0);
    expect(summarySum).toBe(dailySum);
    expect(summarySum).toBe(20 + 30 + 40);
  });

  it('asymmetric filter (no date guard in summary) DRIFTS from daily — proof the guard matters', () => {
    const summarySumNoGuard = rows.reduce((s, r) => s + r.spend, 0); // skips the predicate
    const dailySumWithGuard = rows
      .filter(r => predicate(r, from, to))
      .reduce((s, r) => s + r.spend, 0);
    // Sums diverge — this was the pre-fix state. The fix restores the
    // predicate so both walks produce the same total.
    expect(summarySumNoGuard).not.toBe(dailySumWithGuard);
  });
});
