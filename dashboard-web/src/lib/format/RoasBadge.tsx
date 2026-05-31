/**
 * RoasBadge — renders a `roasCell()` result as a SOLID rounded badge.
 *
 * OPERATOR FIX (2026-06-01): the Analysis→History monthly tables (and the
 * Analysis DetailTable) used to wash the whole `<td>` in a pale band tint.
 * The operator asked for the ROAS value to look like the campaign SCORE
 * badges (HealthScoreBadge.tsx) + the mockup: a solid rounded chip with a
 * white number on solid green/blue/orange/red.
 *
 * This component renders only the INNER cell content. The failure cell keeps
 * its full-cell wash, so callers add `cellTdClass(cell.className)` to the
 * `<td>` (which yields `roas-cell-fail` only for the fail case) and put
 * `<RoasBadge .../>` inside it:
 *
 *   • failure  (`roas-cell-fail`) → full-cell fail wash on the `<td>` + plain
 *     "0" text. That cell is the `--cell-fail` / `--cell-fail-fg` token (dark
 *     navy + pink "0") which already matches the mockup, so it is NOT a chip.
 *   • no-data / gray (empty className) → plain text (or blank), no chip.
 *   • normal (solid `bg-status-{c} text-accent-fg`) → rounded badge chip.
 *
 * Thresholds + band→tone mapping are unchanged (driven by roasCell()).
 */
import { cn } from '@/lib/utils';
import { ROAS_BADGE_SHAPE } from './roasCell';

/**
 * Class to apply to the `<td>` wrapping a `roasCell()` result. Only the
 * failure case keeps a full-cell wash; tone badges live inside via RoasBadge.
 */
export function roasCellTdClass(className: string): string {
  return className === 'roas-cell-fail' ? 'roas-cell-fail' : '';
}

export function RoasBadge({
  className,
  text,
}: {
  className: string;
  text: string;
}) {
  // Failure cell: full-cell wash lives on the <td>; render plain "0" inside.
  // No-data / gray tone: plain text (no chip). Returning the string directly
  // avoids a single-child Fragment (lint) — a component may return a string.
  if (className === 'roas-cell-fail' || !className) {
    return text;
  }
  // Normal → solid rounded badge mirroring HealthScoreBadge's chip.
  return <span className={cn(ROAS_BADGE_SHAPE, className)}>{text}</span>;
}
