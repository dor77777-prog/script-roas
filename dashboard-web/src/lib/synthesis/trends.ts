/**
 * Task 3.5 — TL;DR synthesiser for the Trends sub-tab (Analysis → מגמות).
 *
 * Trends shows the ROAS-over-time line chart for the selected range. The
 * page-level TL;DR sentence sits under the H1 and answers: "in the period
 * I'm looking at, did spend and revenue move in the same direction, or
 * did one diverge from the other?" — a richer one-liner than the chart's
 * own headline (which is anchored on ROAS).
 *
 * Pure function: takes the already-filtered daily series + the visible
 * stores. No fetch, no DOM, no React. Follows the same contract as
 * synthesizeRoasChart from Task 3.2.
 *
 * Sanity guards:
 *   • <6 rows → confidence='low', text=''. With <6 we cannot split into
 *     two equal halves and call out a directional change.
 *   • Deltas <5% are reported as "יציב" (flat).
 *   • Spend/revenue deltas are clamped to 1 decimal place.
 */

import type { DailyRow } from '@/lib/types';

export interface TrendsSynthesisInput {
  /** The already-filtered (range + store) daily rows. */
  rows: DailyRow[];
}

export interface TrendsSynthesisResult {
  /** Hebrew TL;DR sentence. Empty string when confidence='low'. */
  text: string;
  /** ROAS delta percent in the period (signed, 1-decimal clamped). */
  anchorMetric: number;
  /** 'low' when sample is too small to trust. */
  confidence: 'low' | 'high';
}

function sumBy<T>(arr: T[], pick: (r: T) => number): number {
  let s = 0;
  for (const r of arr) s += pick(r);
  return s;
}

function clampOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function pctChange(prev: number, curr: number): number {
  if (prev === 0) return 0;
  return ((curr - prev) / prev) * 100;
}

function direction(deltaPct: number): 'up' | 'down' | 'flat' {
  if (deltaPct > 5) return 'up';
  if (deltaPct < -5) return 'down';
  return 'flat';
}

export function synthesizeTrends(
  input: TrendsSynthesisInput,
): TrendsSynthesisResult {
  const rows = input.rows;
  // Need ≥6 rows so each half has ≥3 samples — anything smaller and the
  // halves are too noisy to call a directional move.
  if (rows.length < 6) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  // Aggregate per-day so multiple stores on the same day collapse to a
  // single chronological point before we split the timeline. Otherwise
  // multi-store ranges would inflate the sample count without giving any
  // additional temporal resolution.
  const byDate = new Map<string, { spend: number; revenue: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { spend: 0, revenue: 0 };
    cur.spend += r.totalSpend;
    cur.revenue += r.revenue;
    byDate.set(r.date, cur);
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  if (days.length < 6) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  const half = Math.floor(days.length / 2);
  const first = days.slice(0, half);
  const second = days.slice(half);

  const prevSpend = sumBy(first, (d) => d.spend);
  const currSpend = sumBy(second, (d) => d.spend);
  const prevRevenue = sumBy(first, (d) => d.revenue);
  const currRevenue = sumBy(second, (d) => d.revenue);
  const prevRoas = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const currRoas = currSpend > 0 ? currRevenue / currSpend : 0;

  const roasDelta = clampOneDecimal(pctChange(prevRoas, currRoas));
  const spendDelta = clampOneDecimal(pctChange(prevSpend, currSpend));
  const revenueDelta = clampOneDecimal(pctChange(prevRevenue, currRevenue));

  const roasDir = direction(roasDelta);
  const spendDir = direction(spendDelta);
  const revenueDir = direction(revenueDelta);

  // Phrase priority:
  //   1. ROAS moved → headline with ROAS delta.
  //   2. ROAS flat but spend or revenue diverged → call out the divergence.
  //   3. Everything flat → "יציב".
  let text: string;
  if (roasDir === 'up') {
    text = `ROAS עלה ${Math.abs(roasDelta)}% במחצית השנייה של הטווח.`;
  } else if (roasDir === 'down') {
    text = `ROAS ירד ${Math.abs(roasDelta)}% במחצית השנייה של הטווח.`;
  } else if (spendDir !== 'flat' || revenueDir !== 'flat') {
    const spendWord = spendDir === 'up' ? 'עלתה' : spendDir === 'down' ? 'ירדה' : 'יציבה';
    const revenueWord =
      revenueDir === 'up' ? 'עלתה' : revenueDir === 'down' ? 'ירדה' : 'יציבה';
    text = `הוצאה ${spendWord} ${Math.abs(spendDelta)}% בעוד הכנסה ${revenueWord} ${Math.abs(revenueDelta)}%.`;
  } else {
    text = 'מגמה יציבה — אין שינוי משמעותי בטווח הנבחר.';
  }

  return { text, anchorMetric: roasDelta, confidence: 'high' };
}
