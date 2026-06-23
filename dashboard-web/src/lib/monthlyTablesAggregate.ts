// dashboard-web/src/lib/monthlyTablesAggregate.ts
//
// Pure aggregation helpers for the Monthly (Archive) tables enhancements.
// Kept framework-free so the maths is unit-testable under the node config and
// reused by both the detailed month blocks (net-profit + margin columns) and
// the month-summary scorecard matrix (per-month totals + MoM deltas +
// per-month daily ROAS sparkline series).

import type { DailyRow } from '@/lib/types';

/** Net-profit margin as a fraction (netProfit / revenue). `null` when revenue
 *  is 0 so the UI can render "—" instead of a divide-by-zero / Infinity. */
export function marginPct(netProfit: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return netProfit / revenue;
}

export type RowAggregate = {
  totalFb: number;
  totalGa: number;
  totalTt: number;
  totalSpend: number;
  revenue: number;
  /** Σ netProfit, counting ONLY rows where hasCogs is true. */
  netProfit: number;
  /** Blended ROAS (revenue / totalSpend); 0 when spend is 0. */
  roas: number;
  /** Net-profit margin (netProfit / revenue); null when revenue is 0. */
  margin: number | null;
  /** true iff at least one row carried COGS — gates net-profit/margin display. */
  hasCogs: boolean;
};

/** Aggregate a flat set of daily rows into spend/revenue/net-profit totals.
 *  netProfit only accumulates from COGS-bearing rows so a partially-populated
 *  month doesn't show a misleadingly-low profit. */
export function aggregateRows(rows: DailyRow[]): RowAggregate {
  let totalFb = 0, totalGa = 0, totalTt = 0, totalSpend = 0, revenue = 0, netProfit = 0;
  let hasCogs = false;
  for (const r of rows) {
    totalFb += r.fbSpend;
    totalGa += r.gaSpend;
    totalTt += r.ttSpend ?? 0;
    totalSpend += r.totalSpend;
    revenue += r.revenue;
    if (r.hasCogs) {
      netProfit += r.netProfit;
      hasCogs = true;
    }
  }
  return {
    totalFb,
    totalGa,
    totalTt,
    totalSpend,
    revenue,
    netProfit,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    margin: marginPct(netProfit, revenue),
    hasCogs,
  };
}

export type MonthDelta = {
  /** Signed fraction (e.g. 0.25 = +25%); null when the prior base was 0. */
  spend: number | null;
  revenue: number | null;
  roas: number | null;
  netProfit: number | null;
};

export type MonthScorecard = {
  ym: string; // YYYY-MM
  totalSpend: number;
  revenue: number;
  roas: number;
  netProfit: number;
  margin: number | null;
  hasCogs: boolean;
  /** Daily ROAS values for the month, ordered by date ascending (sparkline). */
  dailyRoasSeries: number[];
  /** Month-over-month deltas vs the next-older PRESENT month; null for the
   *  oldest month (no prior to compare against). Each value is a fraction
   *  (e.g. 0.25 = +25%). When the prior month's base is 0 the delta is null
   *  for that metric (can't express a % change from zero). */
  deltas: MonthDelta | null;
};

/** Signed-fraction delta `(cur - prev) / prev`; null when prev is 0 (no base). */
function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return (cur - prev) / prev;
}

/**
 * Build one scorecard per month from a flat row set, sorted newest-first.
 * Each card carries the month's totals + a daily ROAS series (date-ascending)
 * + month-over-month deltas vs the next-older present month (gap-aware: if
 * intermediate months are missing, the prior is simply the next month that
 * actually has data). The deltas object is null for the oldest month; an
 * individual metric delta is `null` when the prior base is 0.
 */
export function computeMonthScorecards(rows: DailyRow[]): MonthScorecard[] {
  const byMonth = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(r);
  }

  // Oldest → newest so each card can look back one entry for its prior month.
  const ascending = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const cards: MonthScorecard[] = ascending.map(([ym, monthRows]) => {
    const agg = aggregateRows(monthRows);
    const dailyRoasSeries = [...monthRows]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => (Number.isFinite(r.roas) ? r.roas : 0));
    return {
      ym,
      totalSpend: agg.totalSpend,
      revenue: agg.revenue,
      roas: agg.roas,
      netProfit: agg.netProfit,
      margin: agg.margin,
      hasCogs: agg.hasCogs,
      dailyRoasSeries,
      deltas: null, // filled in below once neighbours are known
    };
  });

  for (let i = 1; i < cards.length; i++) {
    const cur = cards[i];
    const prev = cards[i - 1];
    // A deltas object exists whenever a prior month is present; individual
    // metrics are null where the prior base was 0 (no % change from zero).
    cur.deltas = {
      spend: pctDelta(cur.totalSpend, prev.totalSpend),
      revenue: pctDelta(cur.revenue, prev.revenue),
      roas: pctDelta(cur.roas, prev.roas),
      netProfit: pctDelta(cur.netProfit, prev.netProfit),
    };
  }

  // Newest-first for display.
  return cards.reverse();
}
