/**
 * Task 3.2 — TL;DR synthesiser for the <RoasTargetChart> section.
 *
 * Produces ONE authoritative Hebrew sentence + an anchor metric the caller
 * tints with the band colour. The sentence answers "what is the chart
 * telling me?" before the operator parses the dots themselves — per
 * [[home-visual-rules]] Q6: the TL;DR sentence is the chart's headline,
 * not a caption.
 *
 * Pure function — accepts the already-clipped point set + the chart range
 * key (used only for label phrasing). No fetch, no DOM, no React. Lives
 * here (lib/synthesis/) so future copy can be A/B-tested by swapping the
 * helper without touching the component.
 *
 * Sanity guards:
 *   • <3 non-null points → confidence='low', text=''. Caller falls back
 *     to a static eyebrow.
 *   • All decimals clamped to 1-place — never display more than 1 digit of
 *     a delta percent (avoids fake precision like "−5.234%").
 *   • Compares first half vs second half of the range to derive the
 *     trend. With ≥3 points each half has ≥1 sample.
 *
 * Returns the raw values; the caller builds the JSX with `<span class>`
 * accents so the tinting matches `useRoasBandGradient` exactly.
 */

import type { RoasBand } from '@/lib/format/useRoasBandGradient';

export interface RoasChartPoint {
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** ROAS for the day; null = no data (skipped from average). */
  roas: number | null;
}

export type RoasChartRangeKey =
  | '7'
  | '30'
  | '90'
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | 'custom';

export interface RoasChartSynthesisInput {
  points: RoasChartPoint[];
  range: RoasChartRangeKey;
  /** ROAS target line — defaults to 3.0. */
  target?: number;
}

export interface RoasChartSynthesisResult {
  /** Hebrew TL;DR sentence. Empty string when confidence='low'. */
  text: string;
  /** The number the caller should band-tint inside the sentence (period avg). */
  anchorMetric: number;
  /** Direction of the delta — caller picks the accent class. */
  direction: 'up' | 'down' | 'flat';
  /** Magnitude of the delta in percent (0..∞), 1-decimal clamped. */
  deltaPct: number;
  /** Band recommendation for the anchor number (matches the chart's KPI band). */
  band: RoasBand;
  /** 'low' when sample is too small to trust; caller hides the sentence. */
  confidence: 'low' | 'high';
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function clampOneDecimal(n: number): number {
  // Math.round to 1 decimal — not toFixed (which returns a string). The
  // result is still a number so a caller doing further math (deltaPct *
  // -1, etc.) does not have to re-parse a localised string.
  return Math.round(n * 10) / 10;
}

/**
 * Pick the band the chart's anchor number should wear. Identical
 * thresholds to `useRoasBandGradient` so the sentence and the KPI strip
 * never disagree on the colour for the same number.
 */
function bandForRoas(roas: number): RoasBand {
  if (Number.isNaN(roas)) return 'gray';
  if (roas < 2.0) return 'red';
  if (roas < 2.7) return 'orange';
  if (roas < 3.0) return 'green';
  return 'blue';
}

/**
 * Hebrew label for the chart's range — only used inside the TL;DR
 * sentence. Custom is intentionally generic ("בטווח שנבחר") since the
 * exact dates already appear in the scope badge to the right.
 */
export function rangeLabelHe(range: RoasChartRangeKey): string {
  switch (range) {
    case '7':  return '7 הימים האחרונים';
    case '30': return '30 הימים האחרונים';
    case '90': return '90 הימים האחרונים';
    case 'mtd': return 'מתחילת החודש';
    case 'qtd': return 'מתחילת הרבעון';
    case 'ytd': return 'מתחילת השנה';
    case 'custom':
    default:    return 'בטווח שנבחר';
  }
}

/* --------------------------------------------------------------------------
 * Synthesis
 * -------------------------------------------------------------------------- */

export function synthesizeRoasChart(
  input: RoasChartSynthesisInput,
): RoasChartSynthesisResult {
  const target = input.target ?? 3.0;
  const nonNull = input.points
    .filter((p): p is RoasChartPoint & { roas: number } => p.roas != null && !Number.isNaN(p.roas));

  // Sanity guard — need ≥3 samples to talk about a trend at all.
  if (nonNull.length < 3) {
    return {
      text: '',
      anchorMetric: 0,
      direction: 'flat',
      deltaPct: 0,
      band: 'gray',
      confidence: 'low',
    };
  }

  const half = Math.floor(nonNull.length / 2);
  const first = nonNull.slice(0, half).map((p) => p.roas);
  const second = nonNull.slice(half).map((p) => p.roas);
  const prevAvg = average(first);
  const currAvg = average(second);
  const overallAvg = average(nonNull.map((p) => p.roas));

  const deltaRaw =
    prevAvg === 0
      ? 0
      : ((currAvg - prevAvg) / prevAvg) * 100;
  const deltaPct = clampOneDecimal(Math.abs(deltaRaw));
  const direction: 'up' | 'down' | 'flat' =
    deltaRaw < -5 ? 'down' : deltaRaw > 5 ? 'up' : 'flat';

  const band = bandForRoas(overallAvg);
  const anchorMetric = clampOneDecimal(overallAvg);
  const label = rangeLabelHe(input.range);

  let text: string;
  if (direction === 'down') {
    text = `ROAS ירד ${deltaPct}% ב${label}. ממוצע ${anchorMetric.toFixed(1)} מול יעד ${target.toFixed(1)}.`;
  } else if (direction === 'up') {
    text = `ROAS עלה ${deltaPct}% ב${label}. ממוצע ${anchorMetric.toFixed(1)} מול יעד ${target.toFixed(1)}.`;
  } else {
    text = `ROAS יציב סביב ${anchorMetric.toFixed(1)} ב${label}. יעד ${target.toFixed(1)}.`;
  }

  return {
    text,
    anchorMetric,
    direction,
    deltaPct,
    band,
    confidence: 'high',
  };
}
