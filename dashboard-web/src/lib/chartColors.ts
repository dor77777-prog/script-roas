// dashboard-web/src/lib/chartColors.ts
//
// Phase E1.6.1 UI overhaul (2026-05-30) — promoted from chart-only
// utility to canonical PLATFORM_TOKENS. Every platform/store/axis/cpm
// color references a CSS var (defined in globals.css with both light
// and dark values). No hardcoded hex remains.
//
// Wave-1 Task 1.2 — this file is the ONE legitimate cross-palette
// bridge. CHART_COLORS.{cpm,roas,spend} map ROAS-grading semantics
// from --band-* into the chart palette so consumer files (RoasChart,
// QuadrantScatter, etc.) can consume `CHART_COLORS.roas` without
// reaching directly into the band palette themselves. The
// `local/no-cross-palette-import` rule is disabled at the few specific
// lines below where band vars appear; that exemption is intentional
// and bounded.
/* eslint-disable local/no-cross-palette-import -- canonical chart↔band bridge; see file header */

export const CHART_AXIS_COLOR = 'var(--chart-axis)';
// Cursor/grid map to the glass edge tones — the legacy `--border-*` family
// was dropped in the Task-1.1 glass+neon flip; --glass-edge-hot has the
// extra violet rim needed for cursor visibility on dark canvas.
export const CHART_CURSOR_COLOR = 'var(--glass-edge-hot)';
export const CHART_GRID_COLOR = 'var(--glass-edge)';
export const CHART_TARGET_COLOR = 'var(--band-green)';
// Warning treatment for heavy-refund-day markers, CPM-spike rings, etc.
// Same hue as --status-orange but routed through the chart palette so
// chart consumers can import it cleanly.
export const CHART_WARNING_COLOR = 'var(--band-orange)';

export const PLATFORM_TOKENS = {
  meta:    { color: 'var(--chart-platform-meta)',    strokeDasharray: undefined, strokeWidth: 1.5 },
  google:  { color: 'var(--chart-platform-google)',  strokeDasharray: undefined, strokeWidth: 1.5 },
  tiktok:  { color: 'var(--chart-platform-tiktok)',  strokeDasharray: undefined, strokeWidth: 1.5 },
  organic: { color: 'var(--chart-platform-organic)', strokeDasharray: undefined, strokeWidth: 1.5 },
  shopify: { color: 'var(--chart-platform-shopify)', strokeDasharray: '6 3',     strokeWidth: 2.5 },
} as const;

export const CHART_COLORS = {
  meta:    PLATFORM_TOKENS.meta.color,
  google:  PLATFORM_TOKENS.google.color,
  tiktok:  PLATFORM_TOKENS.tiktok.color,
  organic: PLATFORM_TOKENS.organic.color,
  shopify: PLATFORM_TOKENS.shopify.color,
  cpm:     'var(--band-blue)',
  cpmPrev: 'var(--chart-cpm-prev)',
  roas:    'var(--band-green)',
  // CAC shares the band-blue cost-metric color with CPM. Named separately
  // so consumers don't rely on the cpm↔cac aliasing.
  cac:     'var(--band-blue)',
  // `value` is the neutral "supporting" line color. --text-2 is the
  // secondary ink stop in the Task-1.1 foreground stack.
  value:   'var(--text-2)',
  spend:   'var(--band-red)',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;

/**
 * Quadrant-tone palette for QuadrantScatter (ROAS × CAC plane). Same
 * band-token bridging rationale as CHART_COLORS — chart consumers
 * import THIS map instead of reaching directly into `--band-*` vars,
 * so `local/no-cross-palette-import` only ever fires on a single
 * grandfathered file (this one).
 */
export const QUADRANT_PALETTE = {
  winner:                    'var(--band-green)',
  'efficient-low-roas':      'var(--band-blue)',
  'profitable-but-expensive': 'var(--band-orange)',
  loser:                     'var(--band-red)',
} as const;

export type QuadrantTone = keyof typeof QUADRANT_PALETTE;
