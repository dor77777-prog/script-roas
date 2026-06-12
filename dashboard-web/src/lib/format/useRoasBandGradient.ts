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
 * Threshold ladder lives in lib/roasBands.ts (operator-locked) — this module
 * owns only red-alarm priority, null/NaN→gray, and the gradient/label layer.
 *
 * The `red-alarm` band is the operator-locked "spent money, made zero sales"
 * state (`spend > 0 && revenue === 0`). The caller derives this boolean and
 * passes it as the 3rd arg; because such a store gets `roas: null` upstream
 * (a 0-revenue ROAS isn't a meaningful ratio), the red-alarm branch MUST sit
 * ABOVE the null→gray check so it wins. Genuine no-activity (spend === 0)
 * does NOT set the flag and stays gray.
 *
 * NaN is treated as null (defensive — guards against bad math
 * upstream where a 0/0 divide produced NaN instead of null).
 *
 * 2026-06 re-skin (Task 0.2): the numeric threshold ladder itself now lives in
 * lib/roasBands.ts (`bandForRoas`) — the SINGLE SOURCE OF TRUTH for band
 * classification. This module keeps owning the gradient/desaturate/label layer
 * plus the red-alarm + null/NaN handling on top of it.
 */
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';

export type RoasBand = CoreRoasBand | 'red-alarm';

/**
 * Canonical Hebrew band-tag wording — ONE source of truth so every ROAS-band
 * surface (per-store pills, the RoasTargetChart KPI chip, etc.) reads the same
 * word for the same band. Matches analytics.ts roasLabel's text. Moved here
 * from PerStoreRow on 2026-06-09 (Task 10) so the chart can share it instead of
 * its own bespoke vocabulary ("מתחת ליעד/דורש מעקב/סביב היעד/מעל יעד").
 */
export const BAND_TAG_LABEL: Record<RoasBand, string> = {
  red:         'דורש בחינה',
  'red-alarm': '0 מכירות',
  orange:      'סביר',
  green:       'טוב',
  blue:        'מעולה',
  gray:        'אין נתונים',
};

export interface BandResult {
  band: RoasBand;
  desaturate: boolean;
}

export function useRoasBandGradient(
  roas: number | null | undefined,
  isStale = false,
  zeroSalesWithSpend = false,
): BandResult {
  // Top priority — spent money, zero return. Wins over the null→gray check
  // below because such a store carries `roas: null` upstream.
  if (zeroSalesWithSpend) return { band: 'red-alarm', desaturate: isStale };
  if (roas == null || Number.isNaN(roas)) {
    return { band: 'gray', desaturate: isStale };
  }
  // Threshold ladder is delegated to the single source of truth
  // (lib/roasBands.ts). 2026-06-09 Task 11 lock preserved there: exactly 3.0 =
  // "at target" = green, in lock-step with analytics.ts roasLabel; >3.0 = blue.
  return { band: bandForRoas(roas), desaturate: isStale };
}
