// src/lib/home/revenueBasis.ts
/**
 * Blended net/gross revenue factor for a store/period. Used to re-base
 * gross orders_attribution revenue (immutable total_price) onto the same NET
 * basis as the headline MER (data_daily.revenue_cad). The factor is uniform
 * per store/period, so ratios (e.g. coverage %) are basis-invariant and must
 * NOT be adjusted — only absolute $ (NC-ROAS revenue, revenue-by-source $).
 */
export interface NetAdjust {
  factor: number;
  degraded: boolean; // true when gross is missing/zero → no adjustment applied
}

export function netAdjustFactor(net: number, gross: number): NetAdjust {
  if (
    typeof net !== 'number' || typeof gross !== 'number' ||
    !Number.isFinite(net) || !Number.isFinite(gross) || gross <= 0
  ) {
    return { factor: 1, degraded: true };
  }
  const raw = net / gross;
  const factor = Math.min(1.5, Math.max(0, raw));
  return { factor, degraded: false };
}
