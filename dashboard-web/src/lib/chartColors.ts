// Single source of truth for the chart palette.
//
// All categorical line colors (per-platform + per-store) route through
// theme-aware --chart-* CSS variables defined in globals.css. Light
// defaults reflect true brand identity:
//   - Meta:    blue   (#2563eb / oklch(70% 0.18 260) dark)
//   - Google:  amber  (#d97706 / oklch(75% 0.16 60)  dark)
//   - TikTok:  red    (#ef4444 / oklch(72% 0.22 25)  dark)
//   - Organic: purple (#a855f7 / oklch(75% 0.18 305) dark)
//   - Shopify: green  (#10b981 / oklch(75% 0.18 155) dark)
//
// Per-store colors sit OUTSIDE every platform hue family (cyan / hot pink /
// lime) so a chart that overlays per-store lines on per-platform lines
// never reads as one channel echoing another. See lib/storeColors.ts.
//
// Status colors (cpm, roas, value, spend) route through the existing
// --status-orange / --status-green / --status-red semantic tokens — they
// are not brand identities, just channel labels keyed to the dashboard's
// existing color language.
//
// Colorblind contract (revised 2026-05-29):
//   The prior contract from audit-2026-05-23-v2 pinned TikTok outside the
//   magenta/purple hue family for protanopia/deuteranopia separation from
//   Organic purple. That contract was retired when TikTok moved to the
//   brand-true neon red. Disambiguation channels that survive:
//     1. Stroke pattern (Shopify rendered with a 6-3 dashed pattern + 2.5px
//        stroke vs Meta's 1.5px solid). RoasChart owns this convention.
//     2. Legend swatch + label. Every chart that uses categorical colors
//        renders a visible legend; total hue collapse still leaves the
//        textual label as a fallback identifier.
//   The trade-off (brand identity > colorblind hue safety) is intentional
//   and was approved by the operator on 2026-05-29.
export const CHART_COLORS = {
  axis: 'var(--chart-axis)',
  reconciliationAxis: 'var(--chart-axis)',
  meta:    'var(--chart-platform-meta)',
  google:  'var(--chart-platform-google)',
  tiktok:  'var(--chart-platform-tiktok)',
  organic: 'var(--chart-platform-organic)',
  shopify: 'var(--chart-platform-shopify)',
  cpm:     'var(--status-orange)',
  cpmPrev: '#fbbf24',
  roas:    'var(--status-green)',
  value:   'var(--status-green)',
  spend:   'var(--status-red)',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;
