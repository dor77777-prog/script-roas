/**
 * Task 1.3 — V4 band signal helper.
 *
 * Centralised ROAS-band selector used by every state-bearing card on
 * the dashboard (CommandCenterHero, PerStoreRow, etc.) so they all
 * pick the same band for the same number. The pair (band, desaturate)
 * is consumed by the `.glass[data-band="…"]` CSS in globals.css —
 * downstream components are expected to set both the `data-band`
 * attribute and a desaturate hook on the same element.
 *
 * NOTE on naming: this is a **pure function**, not a React hook. The
 * `use` prefix is a stylistic choice locked in the implementation
 * plan to read naturally at call sites (`useRoasBandGradient(roas)`).
 * It does not call into React's hook machinery and is therefore safe
 * to invoke from any context — server components, loops, conditionals.
 *
 * Thresholds (locked, must stay in lock-step with roasLabel() tones):
 *   roas < 2.0          → red
 *   2.0 ≤ roas < 2.7    → orange
 *   2.7 ≤ roas < 3.0    → green
 *   roas ≥ 3.0          → blue
 *   roas null/undefined → gray
 *
 * NaN is treated as null (defensive — guards against bad math
 * upstream where a 0/0 divide produced NaN instead of null).
 */
export type RoasBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';

export interface BandResult {
  band: RoasBand;
  desaturate: boolean;
}

export function useRoasBandGradient(
  roas: number | null | undefined,
  isStale = false,
): BandResult {
  if (roas == null || Number.isNaN(roas)) {
    return { band: 'gray', desaturate: isStale };
  }
  if (roas < 2.0) return { band: 'red', desaturate: isStale };
  if (roas < 2.7) return { band: 'orange', desaturate: isStale };
  if (roas < 3.0) return { band: 'green', desaturate: isStale };
  return { band: 'blue', desaturate: isStale };
}
