/**
 * Task 3.5 — TL;DR synthesiser for the Archive sub-tab (Analysis → היסטוריה).
 *
 * Archive shows monthly tables — one calendar month at a time. The page
 * TL;DR sits under the H1 and either:
 *   • flags the strongest month in the selected year, OR
 *   • when the last 3 months are tightly clustered, calls out the
 *     stability so the operator does not waste attention scanning each
 *     month for change.
 *
 * Pure function: takes raw daily rows (the whole dataset, NOT just the
 * visible month) + the active calendar year. The synthesiser collapses
 * rows to months internally — keeping the caller's contract tight.
 *
 * Sanity guards:
 *   • <2 completed months → confidence='low', text=''. Cannot rank a
 *     single sample.
 *   • Months with zero spend are skipped (no ROAS to compare).
 *   • All decimals clamped to 2-places (ROAS is shown as 2.84, not 2.8).
 */

import type { DailyRow } from '@/lib/types';

export interface ArchiveSynthesisInput {
  /** Full daily row set — synthesiser slices the visible year itself. */
  rows: DailyRow[];
  /** The calendar year being viewed in the archive. */
  year: number;
}

export interface ArchiveSynthesisResult {
  /** Hebrew TL;DR sentence. Empty string when confidence='low'. */
  text: string;
  /** ROAS of the called-out month (or the avg when stability headline). */
  anchorMetric: number;
  /** 'low' when sample is too small to trust. */
  confidence: 'low' | 'high';
}

const HE_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

function clampTwoDecimals(n: number): number {
  return Math.round(n * 100) / 100;
}

export function synthesizeArchive(
  input: ArchiveSynthesisInput,
): ArchiveSynthesisResult {
  const yearStr = String(input.year);
  // Per-month aggregates for the requested year.
  const byMonth = new Map<number, { spend: number; revenue: number }>();
  for (const r of input.rows) {
    if (!r.date.startsWith(yearStr)) continue;
    const monthNum = Number(r.date.slice(5, 7)); // 1..12
    if (!Number.isFinite(monthNum)) continue;
    const cur = byMonth.get(monthNum) ?? { spend: 0, revenue: 0 };
    cur.spend += r.totalSpend;
    cur.revenue += r.revenue;
    byMonth.set(monthNum, cur);
  }

  // Months with zero spend produce a meaningless ROAS — drop them so a
  // dormant month doesn't get crowned "weakest" or "strongest".
  const months: Array<{ month: number; roas: number }> = [];
  for (const [m, agg] of byMonth) {
    if (agg.spend <= 0) continue;
    months.push({ month: m, roas: agg.revenue / agg.spend });
  }
  months.sort((a, b) => a.month - b.month);

  if (months.length < 2) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  // Strongest month overall in the year so far.
  const best = months.reduce((acc, m) => (m.roas > acc.roas ? m : acc), months[0]);
  const bestRoas = clampTwoDecimals(best.roas);

  // Stability check — last 3 months within ±10% of their own average.
  if (months.length >= 3) {
    const last3 = months.slice(-3);
    const avg = last3.reduce((s, m) => s + m.roas, 0) / 3;
    const within = last3.every(
      (m) => avg > 0 && Math.abs(m.roas - avg) / avg <= 0.1,
    );
    if (within) {
      const stableAvg = clampTwoDecimals(avg);
      return {
        text: `ROAS חודשי יציב סביב ${stableAvg.toFixed(2)} ב-3 החודשים האחרונים.`,
        anchorMetric: stableAvg,
        confidence: 'high',
      };
    }
  }

  const bestName = HE_MONTHS[best.month - 1];
  return {
    text: `${bestName} ${input.year} היה החודש החזק ביותר השנה עם ROAS ${bestRoas.toFixed(2)}.`,
    anchorMetric: bestRoas,
    confidence: 'high',
  };
}
