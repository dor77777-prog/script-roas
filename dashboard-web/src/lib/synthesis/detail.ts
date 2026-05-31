/**
 * Task 3.5 — TL;DR synthesiser for the Detail tab (פירוט יומי).
 *
 * The Detail tab is a row-per-(day × store) table sorted by date desc.
 * The page TL;DR sits under the H1 and identifies the heaviest spend
 * concentration in the range — most often "which store dominated
 * spend?" so the operator's eye knows where to look before scanning
 * the table.
 *
 * Pure function: takes the already-filtered daily rows. Picks the store
 * with the largest share of `totalSpend` and emits a sentence calling
 * out the percentage. When a single store accounts for ≥60% of spend the
 * sentence emphasises "מרכז" (concentrates); below that it uses the
 * softer "מוביל" (leads).
 *
 * Sanity guards:
 *   • Zero spend → confidence='low', text=''. No story to tell.
 *   • <2 stores or share <40% → confidence='low'. With only one store
 *     the headline would be tautological; below 40% it's not
 *     concentration, just the largest of many.
 *   • Share clamped to whole percent (no fractional like "23.4%").
 */

import type { DailyRow } from '@/lib/types';

export interface DetailSynthesisInput {
  /** Already filtered (range + store) daily rows. */
  rows: DailyRow[];
}

export interface DetailSynthesisResult {
  /** Hebrew TL;DR sentence. Empty string when confidence='low'. */
  text: string;
  /** Spend share percent of the called-out store (0..100, integer). */
  anchorMetric: number;
  /** 'low' when sample is too small to tell a story. */
  confidence: 'low' | 'high';
}

export function synthesizeDetail(
  input: DetailSynthesisInput,
): DetailSynthesisResult {
  const rows = input.rows;
  if (rows.length === 0) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  const byStore = new Map<string, number>();
  let totalSpend = 0;
  for (const r of rows) {
    const cur = byStore.get(r.storeName) ?? 0;
    byStore.set(r.storeName, cur + r.totalSpend);
    totalSpend += r.totalSpend;
  }

  if (totalSpend <= 0 || byStore.size < 2) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  let topStore = '';
  let topSpend = 0;
  for (const [store, spend] of byStore) {
    if (spend > topSpend) {
      topSpend = spend;
      topStore = store;
    }
  }

  const sharePct = Math.round((topSpend / totalSpend) * 100);
  if (sharePct < 40) {
    return { text: '', anchorMetric: sharePct, confidence: 'low' };
  }

  const verb = sharePct >= 60 ? 'מרכז' : 'מוביל עם';
  const text = `${topStore} ${verb} ${sharePct}% מההוצאה בטווח הנבחר.`;

  return { text, anchorMetric: sharePct, confidence: 'high' };
}
