/**
 * roasBands.ts — SINGLE SOURCE OF TRUTH for ROAS band classification.
 *
 * The 2026-06 re-skin audit found 7 parallel band-threshold implementations
 * across the dashboard; they all drain into this module. Any surface that
 * colors/labels a ROAS number MUST classify it through `bandForRoas`.
 *
 * Thresholds are OPERATOR-LOCKED (do not re-anchor without operator sign-off):
 *   roas < 2.0          → red     (below break-even)
 *   2.0 ≤ roas < 2.7    → orange  (break-even zone, watch)
 *   2.7 ≤ roas ≤ 3.0    → green   (3.00 inclusive = AT target)
 *   roas > 3.0          → blue    (above target)
 *   spend === 0         → gray    (no ad activity — a ratio is meaningless)
 *
 * PRECONDITION: callers own null/NaN/≤0 normalization (see useRoasBandGradient,
 * roasLabel in analytics.ts). bandForRoas assumes a finite positive ratio —
 * NaN or a bare 0 without {spend: 0} falls through to 'red'.
 *
 * Lock-step guard: see roasBandConsistency.guard.test.ts — roasLabel in
 * analytics.ts must move in lock-step until it too delegates.
 */
export type CoreRoasBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';

/**
 * Operator-locked alarm threshold (CAD). The alarm fires only once spend
 * crosses $100 CAD with ZERO sales — early-morning spend trickles in before
 * the first order lands, so a $0-revenue store at $20 spend at 7am is normal,
 * not an emergency. $100+ with nothing back is a real "go look NOW" signal.
 */
export const ALARM_SPEND_THRESHOLD_CAD = 100;

/** Classify a ROAS value into its operator-locked band. `spend === 0` → gray. */
export function bandForRoas(roas: number, opts?: { spend?: number }): CoreRoasBand {
  if (opts && opts.spend === 0) return 'gray';
  if (roas > 3.0) return 'blue';
  if (roas >= 2.7) return 'green';
  if (roas >= 2.0) return 'orange';
  return 'red';
}

/**
 * Alarm state: real money out (> $100 CAD), zero sales back.
 * Strictly ABOVE the threshold — $99 spend with no sales is still "morning".
 *
 * SUPERSEDES the legacy zeroSalesWithSpend = spend > 0 derivation in
 * PerStoreRow.tsx/storeDetail.ts — those call sites MUST switch to this
 * predicate during the band-drain migration (W0.3/W3). Deliberate visible
 * change: stores with ≤$100 spend and zero sales drop from red-alarm to
 * plain red.
 */
export function isSpendAlarm(m: { spend: number; revenue: number }): boolean {
  return m.spend > ALARM_SPEND_THRESHOLD_CAD && m.revenue === 0;
}
