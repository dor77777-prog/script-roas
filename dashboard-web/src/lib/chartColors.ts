// dashboard-web/src/lib/chartColors.ts
//
// Phase E1.6.1 UI overhaul (2026-05-30) — promoted from chart-only
// utility to canonical PLATFORM_TOKENS. Every platform/store/axis/cpm
// color references a CSS var (defined in globals.css with both light
// and dark values). No hardcoded hex remains.

export const CHART_AXIS_COLOR = 'var(--chart-axis)';
export const CHART_CURSOR_COLOR = 'var(--border-strong)';
export const CHART_GRID_COLOR = 'var(--border-subtle)';
export const CHART_TARGET_COLOR = 'var(--status-green)';

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
  cpm:     'var(--status-blue)',
  cpmPrev: 'var(--chart-cpm-prev)',
  roas:    'var(--status-green)',
  value:   'var(--text-secondary)',
  spend:   'var(--status-red)',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;
