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

/** Classify a ROAS value into its operator-locked band. `spend === 0` → gray.
 *
 * FIX #24 (2026-06-20): classify from the DISPLAYED value, not the raw ratio.
 * Every ROAS surface renders 2 decimals (`.toFixed(2)`), so a value like 2.698
 * shows "2.70" — at the green threshold — yet the raw 2.698 < 2.7 would paint
 * it the LOWER (orange) band, a colour that disagrees with the digits. Rounding
 * to 2dp HERE (the single source of truth) fixes every caller at once: the band
 * always matches the number the operator reads. Values already at ≤2 decimals
 * are unaffected (rounding is a no-op), so the operator-locked thresholds
 * (2.0 / 2.7 / 3.0) are unchanged. */
export function bandForRoas(roas: number, opts?: { spend?: number }): CoreRoasBand {
  if (opts && opts.spend === 0) return 'gray';
  // Band the same 2-decimal value the UI displays so the colour can never
  // disagree with the rendered digits at a threshold boundary.
  const shown = Number.isFinite(roas) ? Number(roas.toFixed(2)) : roas;
  if (shown > 3.0) return 'blue';
  if (shown >= 2.7) return 'green';
  if (shown >= 2.0) return 'orange';
  return 'red';
}

/**
 * ALARM state (the loud, pulsing red-alarm): real money out (> $100 CAD), zero
 * sales back. Strictly ABOVE the threshold — $99 spend with no sales is still
 * "morning". This is the LOUD subset of {@link isSpendNoSales}: it adds the
 * pulsing ring + the "go look NOW" note.
 */
export function isSpendAlarm(m: { spend: number; revenue: number }): boolean {
  return m.spend > ALARM_SPEND_THRESHOLD_CAD && m.revenue === 0;
}

/**
 * "Spent money, made zero sales" at ANY amount (spend > 0 && revenue === 0).
 *
 * Such a store carries `roas: null` upstream (a 0-revenue ratio is meaningless)
 * — but it is NOT "no data". It is actively burning money with zero return, so
 * it must read RED, never the neutral gray "אין נתונים" (which is reserved for
 * genuine no-activity, spend === 0). {@link isSpendAlarm} is the louder subset
 * (> $100) that also earns the pulsing red-alarm; between $0 and $100 it is
 * plain red ("דורש בחינה").
 *
 * Operator decision 2026-06-15: a $40-spend / $0-sales store was rendering gray
 * on the per-store card (looked identical to an OFF store), while the detail
 * modal showed it as full red-alarm — the two surfaces disagreed. Both now use
 * this split: alarm > $100, plain red below, gray only at spend === 0.
 */
export function isSpendNoSales(m: { spend: number; revenue: number }): boolean {
  return m.spend > 0 && m.revenue === 0;
}
