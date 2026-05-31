/**
 * Task 3.5 — TL;DR synthesiser for the P&L tab (רווח והפסד).
 *
 * P&L stacks revenue → ad spend → COGS → transaction fees → fixed costs
 * → true net profit. The page TL;DR sits under the H1 and answers the
 * question every operator asks first: "did I actually make money this
 * period, and by how much?". The headline anchors on the true margin
 * percent (trueNetProfit / revenue) and compares it to the configured
 * target (default 35%) — the same threshold the GoalTracker uses.
 *
 * Pure function: takes the already-aggregated `Aggregate` (the same
 * value PnLBreakdown receives) plus an optional target margin override.
 * No fetch, no DOM, no React.
 *
 * Sanity guards:
 *   • revenue <= 0 → confidence='low', text=''. No business done →
 *     no margin to talk about.
 *   • Margin clamped to whole percent — fractional precision implies
 *     accuracy we don't have (P&L includes 25% COGS rate-of-thumb).
 */

import type { Aggregate } from '@/lib/analytics';

export interface PnlSynthesisInput {
  /** The aggregate the P&L tab is rendering. */
  agg: Aggregate;
  /** Target net margin as a decimal (default 0.35 = 35%). */
  targetMargin?: number;
}

export interface PnlSynthesisResult {
  /** Hebrew TL;DR sentence. Empty string when confidence='low'. */
  text: string;
  /** True margin percent (0..100, integer). */
  anchorMetric: number;
  /** 'low' when sample is too small to trust. */
  confidence: 'low' | 'high';
}

export function synthesizePnl(input: PnlSynthesisInput): PnlSynthesisResult {
  const { agg } = input;
  const target = input.targetMargin ?? 0.35;

  if (!agg || agg.revenue <= 0) {
    return { text: '', anchorMetric: 0, confidence: 'low' };
  }

  const marginPct = Math.round(agg.trueMargin * 100);
  const targetPct = Math.round(target * 100);

  let text: string;
  if (agg.trueNetProfit < 0) {
    // Operator is losing money in the period — surface the loss, don't
    // sugar-coat it with a margin sentence (a negative percent reads
    // confusingly next to "מעל יעד").
    text = `רווח נטו שלילי בטווח הנבחר — בדוק הוצאות מול הכנסה.`;
  } else if (marginPct >= targetPct) {
    text = `רווח נטו ${marginPct}% — מעל יעד ${targetPct}%.`;
  } else {
    text = `רווח נטו ${marginPct}% — מתחת ליעד ${targetPct}%.`;
  }

  return { text, anchorMetric: marginPct, confidence: 'high' };
}
