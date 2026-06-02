/**
 * Phase 4 — pure helper for the first-click headline delta. Compares
 * first-click ROAS vs last-click ("ROAS Shopify"). Returns null when no
 * meaningful comparison is possible. Pure — no IO, no React.
 */
export type FirstClickDelta = {
  /** firstClickRoas - lastClickRoas. */
  delta: number;
  direction: 'up' | 'down' | 'flat';
  /** RTL-safe LTR-isolated label, e.g. "+1.00x" / "-0.50x" / "0.00x". */
  label: string;
};

export function firstClickDelta(
  firstClickRoas: number,
  lastClickRoas: number,
): FirstClickDelta | null {
  if (!Number.isFinite(firstClickRoas) || !Number.isFinite(lastClickRoas)) return null;
  if (lastClickRoas === 0) return null;
  const delta = firstClickRoas - lastClickRoas;
  const direction: FirstClickDelta['direction'] =
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sign = delta > 0 ? '+' : '';
  const label = `${sign}${delta.toFixed(2)}x`;
  return { delta, direction, label };
}
