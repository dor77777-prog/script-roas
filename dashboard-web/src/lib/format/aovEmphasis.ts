/**
 * Task 1.5 — semantic AOV emphasis classifier.
 *
 * Maps an Average-Order-Value (in CAD) to one of three CSS class hooks
 * consumed by `.cell.aov-good | .aov-bad | .aov-mid` in globals.css.
 * The PerStoreRow (Task 3.3) attaches the returned class to the AOV
 * `<div class="cell">` so the value/label render in red, green, or
 * neutral white per the visual spec in mockup-04i-store-emphasis.html.
 *
 * Thresholds (CAD) — strict comparisons, not inclusive:
 *   aov > 70  → 'aov-good'  (green ▴ glyph)
 *   aov < 50  → 'aov-bad'   (red ▾ glyph)
 *   50 ≤ x ≤ 70 → 'aov-mid' (neutral white, no glyph)
 *
 * Returns `null` for nullish / NaN inputs so callers can spread the
 * className conditionally without painting an unknown bucket.
 *
 * CPM cells receive NO emphasis class — always white per [[home-visual-rules]].
 */
export type AovClass = 'aov-good' | 'aov-bad' | 'aov-mid';

export function aovEmphasis(
  aovCAD: number | null | undefined,
): AovClass | null {
  if (aovCAD == null || Number.isNaN(aovCAD)) return null;
  if (aovCAD > 70) return 'aov-good';
  if (aovCAD < 50) return 'aov-bad';
  return 'aov-mid';
}
