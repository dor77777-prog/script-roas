/**
 * RoasBadge — renders a `roasCell()` result as a SOLID rounded badge.
 *
 * OPERATOR FIX (2026-06-01): the Analysis→History monthly tables (and the
 * Analysis DetailTable) used to wash the whole `<td>` in a pale band tint.
 * The operator asked for the ROAS value to look like the campaign SCORE
 * badges (HealthScoreBadge.tsx) + the mockup: a solid rounded chip with a
 * white number on solid green/blue/orange/red.
 *
 * This component renders only the INNER cell content. EVERY non-empty state
 * is now a rounded badge chip (same shape "language"), so the `<td>` carries
 * no color wash — see `roasCellTdClass()` which returns '' for all cases:
 *
 *   • failure  (`roas-cell-fail`) → ROUNDED BADGE chip carrying the failure
 *     color (`--cell-fail` dark-navy bg + `--cell-fail-fg` pink "0"), SAME
 *     size/shape as the tone badges. NOT a full-cell wash anymore — the
 *     `roas-cell-fail` CSS only sets bg+color, the rounded shape comes from
 *     `ROAS_BADGE_SHAPE`.
 *   • no-data / gray (empty className) → plain text (or blank), no chip.
 *   • normal (solid `bg-status-{c} text-accent-fg`) → rounded badge chip.
 *
 * Thresholds + band→tone mapping are unchanged (driven by roasCell()).
 */
import { cn } from '@/lib/utils';
import { ROAS_BADGE_SHAPE } from './roasCell';

/**
 * Class to apply to the `<td>` wrapping a `roasCell()` result. No state washes
 * the cell anymore — the failure "0" and the tone values all render as a
 * rounded badge span inside the cell (via RoasBadge), so this returns '' for
 * every case. Kept as a function so call sites stay stable.
 */
export function roasCellTdClass(_className: string): string {
  return '';
}

export function RoasBadge({
  className,
  text,
}: {
  className: string;
  text: string;
}) {
  // No-data / gray tone: plain text (or blank), no chip. Returning the string
  // directly avoids a single-child Fragment (lint) — a component may return a
  // string.
  if (!className) {
    return text;
  }
  // Failure ("0") AND normal tone values both render as a rounded badge chip
  // (same ROAS_BADGE_SHAPE). The failure chip carries `roas-cell-fail`
  // (dark-navy bg + pink "0" from the --cell-fail tokens); tone chips carry
  // the solid `bg-status-{c} text-accent-fg`. Shape language is identical.
  return <span className={cn(ROAS_BADGE_SHAPE, className)}>{text}</span>;
}
