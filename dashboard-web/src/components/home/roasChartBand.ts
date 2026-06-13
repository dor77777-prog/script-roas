/**
 * roasChartBand.ts — PURE chart-line band mapping for <RoasTargetChart>.
 *
 * Design spec §3.2.2 (Horizon re-skin, operator-approved 2026-06-12): the ROAS
 * chart's LINE STROKE and AREA FILL are a SINGLE hue = the band of the
 * PERIOD-AVERAGE ROAS. This REPLACES the old two-tone area split
 * (green-above-target / red-below-target at 3.0).
 *
 * Five visual states, mirroring the mockup gallery
 * (docs/superpowers/mockups/2026-06-12-horizon-reskin/home-approved.html:317-365):
 *
 *   avg < 2.0          → red    · solid line, area = red    hue @ ~0.2 → 0
 *   2.0 ≤ avg < 2.7    → orange · solid line, area = orange hue @ ~0.2 → 0
 *   2.7 ≤ avg ≤ 3.0    → green  · solid line, area = green  hue @ ~0.2 → 0
 *   avg > 3.0          → blue   · solid line, area = blue   hue @ ~0.2 → 0
 *   spend === 0        → gray   · DASHED line ("1 6"), area = gray @ low opacity
 *
 * NO band logic is re-forked here — the threshold ladder is delegated to the
 * SINGLE SOURCE OF TRUTH `bandForRoas` in lib/roasBands.ts. This module only
 * adds the "organic / no-spend" detection and the band → CSS-var/dash mapping
 * so the component stays token-only (band colours via the existing `--band-*`
 * tokens, no raw hex — designColorGuard enforces this).
 *
 * Pure: no React, no DOM, no fetch. Unit-tested in
 * src/components/home/__tests__/chartLineBand.test.ts.
 */
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';

/** Period-level inputs — the SAME headline aggregation the chart already uses
 *  (kpis.roas = agg.roas = total conversion value / total spend; kpis.spend =
 *  agg.spend). We do NOT compute a second average here. */
export interface RoasChartBandInput {
  /** Period-average ROAS = total revenue / total spend over the visible window.
   *  May be null/undefined upstream (e.g. organic period nulls the ratio). */
  roas: number | null | undefined;
  /** Period TOTAL ad spend over the visible window. `=== 0` → organic. */
  spend: number;
}

export interface RoasChartBandResult {
  /** The operator-locked band the whole line + area take. Organic → 'gray'. */
  band: CoreRoasBand;
  /** True when the period had NO ad spend (spend === 0) — line is gray + dashed. */
  isOrganic: boolean;
}

/**
 * Classify a period's average ROAS into its single chart-line band.
 *
 * Organic (`spend === 0`) wins over the ROAS ladder — a ratio is meaningless
 * with no spend, so the line goes gray + dashed regardless of any stray roas
 * value. This mirrors `bandForRoas(_, { spend: 0 }) → 'gray'`, surfaced here as
 * an explicit `isOrganic` flag the component uses to pick the dashed treatment.
 */
export function bandForPeriod(input: RoasChartBandInput): RoasChartBandResult {
  const isOrganic = input.spend === 0;
  if (isOrganic) {
    return { band: 'gray', isOrganic: true };
  }
  // Normalise null/NaN to a non-positive value → bandForRoas falls through to
  // 'red' (callers own null normalisation; a non-organic period with a missing
  // ratio is a genuine below-break-even / no-return signal, not organic).
  const roas =
    input.roas == null || Number.isNaN(input.roas) ? 0 : input.roas;
  return { band: bandForRoas(roas, { spend: input.spend }), isOrganic: false };
}

/** CSS custom-property carrying each band's mockup-locked hue (light + dark). */
export const BAND_STROKE_VAR: Record<CoreRoasBand, string> = {
  red:    'var(--band-red)',
  orange: 'var(--band-orange)',
  green:  'var(--band-green)',
  blue:   'var(--band-blue)',
  gray:   'var(--band-gray)',
};

/** Mockup-locked organic dash (home-approved.html:362 → stroke-dasharray="1 6"). */
export const ORGANIC_DASH = '1 6';

export interface ChartLineStyle {
  /** `var(--band-…)` for stroke + area hue. Token-only (no raw hex). */
  strokeVar: string;
  /** True for the organic / no-spend state → render the line dashed. */
  isDashed: boolean;
  /** `stroke-dasharray` value when dashed; undefined for a solid line. */
  dash?: string;
}

/**
 * Map a (band, isOrganic) pair → the stroke CSS var + dash treatment.
 * Solid for every spend-backed band; dashed only for organic gray.
 */
export function chartLineStyleForBand(
  band: CoreRoasBand,
  isOrganic: boolean,
): ChartLineStyle {
  const strokeVar = BAND_STROKE_VAR[band];
  if (isOrganic) {
    return { strokeVar, isDashed: true, dash: ORGANIC_DASH };
  }
  return { strokeVar, isDashed: false };
}

/** Stable per-band <linearGradient> id so the area fill is keyed to the band
 *  (and React doesn't re-use a stale gradient when the band flips). */
export function areaGradientIdForBand(
  band: CoreRoasBand,
  isOrganic: boolean,
): string {
  return isOrganic ? 'roas-area-organic' : `roas-area-${band}`;
}
