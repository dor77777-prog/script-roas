/**
 * Unified ROAS-cell helper — Task 4.1.
 *
 * Consolidates the three local ROAS_BG / roasCell copies that lived in
 * MonthlyTables, DetailTable, and CampaignsTableRow into a single source
 * of truth.  The failure-cell (spent money, zero revenue) is now driven by
 * the `roas-cell-fail` CSS utility class (backed by `--cell-fail` /
 * `--cell-fail-fg` tokens) rather than the literal `bg-black` / `bg-status-red`
 * that the two prior copies used — unifying the visual treatment and keeping
 * it theme-overridable.
 *
 * ROAS_TONE_BG (the richer bg+fg variant) matches CampaignsTableRow's copy
 * which uses the canonical `text-status-*Fg` pattern, consistent with
 * Badge.tsx, FreshnessChip.tsx, InsightCard.tsx, and CampaignDrawerStatusSection.
 *
 * NOTE: AdSetTable.tsx previously kept a DIFFERENT TONE_BG variant that used
 * `text-status-red` (not `text-status-redFg`) and `text-ink-muted` (not
 * `text-ink`) for gray. AdSetTable now imports ROAS_TONE_BG directly so the
 * canonical `*Fg` pattern is applied consistently across all ROAS cells.
 */

import { roasLabel } from '@/lib/analytics';
import { formatNumber } from '@/lib/utils';

/**
 * ROAS band-tone → SOLID badge color. Used by MonthlyTables + DetailTable.
 *
 * OPERATOR FIX (2026-06-01): the Analysis→History monthly tables previously
 * washed the WHOLE `<td>` in a PALE tint (`bg-status-*Bg`). The operator
 * wants them to match the campaign SCORE badges (HealthScoreBadge.tsx) and
 * the mockup (mockup-mesh-light-analysis-history.png): a SOLID rounded badge
 * (white number on solid green/blue/orange/red), not a full-cell wash. So
 * `roasCell()` now returns the solid `bg-status-{c} text-accent-fg` class,
 * and consumers render the value inside an inline-flex rounded badge (see
 * `RoasBadge` / the inline badge span in each table). Thresholds unchanged.
 */
const ROAS_BG: Record<string, string> = {
  red:    'bg-status-red text-accent-fg',
  orange: 'bg-status-orange text-accent-fg',
  green:  'bg-status-green text-accent-fg',
  blue:   'bg-status-blue text-accent-fg',
  gray:   '',
};

/**
 * Unified ROAS cell classifier.
 *
 *   failure  — spend > 0, revenue = 0  → `roas-cell-fail` + "0"
 *   no-data  — spend = 0, revenue = 0  → blank
 *   normal   — revenue > 0             → band-tone bg + formatted number
 */
export function roasCell(
  roas: number,
  revenue: number,
  totalSpend: number,
): { className: string; text: string } {
  if (revenue === 0 && totalSpend > 0) return { className: 'roas-cell-fail', text: '0' };
  if (revenue === 0 && totalSpend === 0) return { className: '', text: '' };
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}

/**
 * ROAS band-tone → SOLID badge bg + white fg (richer variant).
 * Used by CampaignsTableRow + AdSetTable.
 *
 * OPERATOR FIX (2026-06-01): for consistency with the Analysis→History fix
 * above (and because the campaign-table ROAS cells in the mockup are ALSO
 * solid), this map now emits the SOLID `bg-status-{c} text-accent-fg` chip —
 * same treatment as HealthScoreBadge — instead of the prior pale
 * `bg-status-*Bg` / `text-status-*Fg` tint. Gray (no/low data) stays a quiet
 * neutral chip. Both consumers wrap the value in a rounded badge span.
 */
export const ROAS_TONE_BG: Record<string, string> = {
  red:    'bg-status-red text-accent-fg',
  orange: 'bg-status-orange text-accent-fg',
  green:  'bg-status-green text-accent-fg',
  blue:   'bg-status-blue text-accent-fg',
  gray:   'bg-glass-2 text-ink',
};

/**
 * Shared badge-shape classes for ROAS cells — mirrors HealthScoreBadge's chip
 * (inline-flex rounded pill, bold tabular nums, white number on solid band).
 * Combine with a `ROAS_BG` / `ROAS_TONE_BG` color entry to render the badge.
 */
export const ROAS_BADGE_SHAPE =
  'inline-flex items-center justify-center min-w-[3rem] px-2 py-0.5 rounded-md font-bold tabular-nums';
