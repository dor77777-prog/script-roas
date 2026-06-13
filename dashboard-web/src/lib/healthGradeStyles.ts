// dashboard-web/src/lib/healthGradeStyles.ts
//
// Single source of truth for the Health-Score visual vocabulary shared by
// HealthScoreBadge (table chip + drill popover) and HealthScorePanel (inline
// drawer surface). Extracted in the Horizon W4 re-skin to kill the duplicated
// GRADE_STYLES / COMPONENT_LABELS / barColor that previously lived in both
// components and could silently drift apart.
//
// Values are token-only (status-*Btn / status-*Solid / status-* tints +
// paired *Fg foregrounds) so the grade chips stay AA-legible in BOTH themes:
// the chip text colour is a guaranteed-contrast on-band token (text-accent-fg
// or text-status-orangeSolidFg), never derived from the band hue itself. The
// `tone` field colours the grade LABEL on the neutral card surface (panel
// only) and stays the legible status foreground, not the tint.

import type { HealthGrade } from '@/lib/campaignHealthScore';

/**
 * Per-grade chip recipe.
 *   • `chip`  — solid status band + paired on-band foreground (white grade
 *               letter on a solid colour band). `unknown` is a neutral tint.
 *   • `ring`  — 1px status ring around the chip.
 *   • `label` — Hebrew verdict word for the grade.
 *   • `tone`  — status FOREGROUND colour used to tint the grade LABEL text on
 *               the neutral panel surface (HealthScorePanel). The badge does
 *               not use it (its label lives inside the solid chip).
 *
 * Grade → band mapping (unchanged from the pre-extraction copies):
 *   A → green · B → blue · C → orange (solid) · D/F → red · unknown → neutral.
 */
export const GRADE_STYLES: Record<
  HealthGrade,
  { chip: string; ring: string; label: string; tone: string }
> = {
  A: { chip: 'bg-status-greenBtn text-accent-fg', ring: 'ring-status-green', label: 'מצוין', tone: 'text-status-greenFg' },
  B: { chip: 'bg-status-blueBtn text-accent-fg', ring: 'ring-status-blue', label: 'בריא', tone: 'text-status-blueFg' },
  C: { chip: 'bg-status-orangeSolid text-status-orangeSolidFg', ring: 'ring-status-orange', label: 'גבולי', tone: 'text-status-orangeFg' },
  D: { chip: 'bg-status-redBtn text-accent-fg', ring: 'ring-status-red', label: 'בעייתי', tone: 'text-status-redFg' },
  F: { chip: 'bg-status-redBtn text-accent-fg', ring: 'ring-status-red', label: 'כשל', tone: 'text-status-redFg' },
  unknown: { chip: 'bg-glass-2 text-ink-muted', ring: 'ring-glass-edge', label: 'מוקדם מדי', tone: 'text-ink-muted' },
};

/** The four WEIGHTED components that drive the score (the unknown/insufficient
 *  short-circuit renders reasons only, not these rows). */
export type WeightedComponentKey =
  | 'profitability'
  | 'volume'
  | 'trajectory'
  | 'attributionClarity';

// Column-audit 2026-06-01 (FIX 2) — the profitability axis runs on the
// CLICK-ID / PROVEN (deterministic) ROAS, so this label clarifies WHY the
// score's ROAS can differ from the table's "ROAS Shopify (מוקצה)" column
// (which adds a proportional fallback of un-attributed orders). LABEL/TEXT
// only — the score computation in campaignHealthScore.ts is unchanged.
export const COMPONENT_LABELS: Record<
  WeightedComponentKey,
  { label: string; weight: string }
> = {
  profitability:      { label: 'רווחיות (ROAS מוכח · click-id כשקיים)', weight: '40%' },
  volume:             { label: 'נפח',                weight: '15%' },
  trajectory:         { label: 'מומנטום',            weight: '25%' },
  attributionClarity: { label: 'אמינות attribution', weight: '20%' },
};

/** Fixed render order for the four weighted-component bars. */
export const COMPONENT_ORDER: ReadonlyArray<WeightedComponentKey> = [
  'profitability',
  'volume',
  'trajectory',
  'attributionClarity',
];

/**
 * Component-bar fill colour by sub-score. Same thresholds the badge popover
 * and the drawer panel shared before extraction:
 *   ≥75 green · ≥50 blue · ≥30 orange · else red.
 */
export function barColor(value: number): string {
  if (value >= 75) return 'bg-status-green';
  if (value >= 50) return 'bg-status-blue';
  if (value >= 30) return 'bg-status-orange';
  return 'bg-status-red';
}
