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
 * `text-ink`) for gray. Those differences are visual — AdSetTable is left
 * with its own local copy until a dedicated audit aligns it with this
 * canonical map (see CONCERN in Task 4.1 report).
 */

import { roasLabel } from '@/lib/analytics';
import { formatNumber } from '@/lib/utils';

/** ROAS band-tone → cell background only. Used by MonthlyTables + DetailTable. */
const ROAS_BG: Record<string, string> = {
  red:    'bg-status-redBg',
  orange: 'bg-status-orangeBg',
  green:  'bg-status-greenBg',
  blue:   'bg-status-blueBg',
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
 * ROAS band-tone → cell bg + fg (richer variant).
 * Used by CampaignsTableRow — consolidated from the byte-identical copy that
 * lived there.  Uses the canonical `text-status-*Fg` pattern (see NOTE above).
 */
export const ROAS_TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-redFg',
  orange: 'bg-status-orangeBg text-status-orangeFg',
  green:  'bg-status-greenBg text-status-greenFg',
  blue:   'bg-status-blueBg text-status-blueFg',
  gray:   'bg-glass-2 text-ink',
};
