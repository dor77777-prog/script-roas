/**
 * 2026-06-09 (Problem B): with spend === 0 the directional ROAS is uncomputable
 * and used to render an ambiguous "—" that made a self-healing intraday state
 * look broken. This distinguishes the two non-idle spend=0 cases so the
 * operator gets certainty instead of a blank:
 *  - 'updating' — conversions/value already reported but billed spend hasn't
 *                 landed yet (Meta/Google finalize conversions faster than
 *                 spend; self-heals on the next ~10-min hot_metrics tick).
 *  - 'awaiting' — an active campaign enrolled as a placeholder before its first
 *                 metrics tick (impressions only / nothing yet).
 *  - null       — genuinely idle (no spend, no value, no impressions) → "—".
 *
 * TEMPORAL GATE: "updating"/"awaiting" describe a LIVE intraday state, so they
 * only make sense when the selected range includes today. For a fully historical
 * range a spend=0 row is genuinely complete (no spend was ever billed) and must
 * fall through to the neutral "—" — never "מתעדכן". Callers pass
 * `rangeIncludesToday` (e.g. `range.to >= todayInIsrael()`).
 *
 * Pure → unit-testable in the node suite (kept out of the .tsx component so the
 * node test doesn't pull React/UI deps).
 */
export function campaignPendingState(
  a: { spend: number; conversionValue: number; conversions: number; impressions: number },
  rangeIncludesToday: boolean,
): 'updating' | 'awaiting' | null {
  if (!rangeIncludesToday) return null; // historical range → spend=0 is final, show "—"
  if (a.spend > 0) return null;
  if (a.conversionValue > 0 || a.conversions > 0) return 'updating';
  if (a.impressions > 0) return 'awaiting';
  return null;
}
