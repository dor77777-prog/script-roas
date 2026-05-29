// TEST-06 (5.2.2.1): single source of truth for chart palette.
// Categorical series colors use Tailwind theme hex literals — these are
// platform identities (Meta amber, Google blue, TikTok slate, etc.) that
// should NOT theme-swap; brand recognition is the whole point.
//
// Axis colors (axis, reconciliationAxis) switched to theme-aware CSS vars
// 2026-05-29 — operator reported dark-on-dark charts in dark mode where
// the previous slate hex literals (#7a8a9a / #64748b) had ~1.5:1 contrast
// against the dark canvas (failing WCAG). The vars resolve through
// ChartContainer's --chart-axis token chain → --text-muted, which is
// oklch(60% L) in light and oklch(60% L on dark hue) in dark → always
// readable. Recharts accepts CSS var strings for tick `fill` props.
//
// c/HI-01 (audit-2026-05-23-v2): colorblind-aware palette notes.
//   - TikTok was previously `#ec4899` (pink) which sat ~340° on the hue
//     wheel, only ~60° from Organic purple (`#9333ea`, ~280°). For
//     protanopia / deuteranopia (~8% of male viewers) the two collapsed
//     into nearly identical magenta-ish lines. Replaced with slate-700
//     (`#374151`) — semantically the "non-magenta neutral" channel and
//     maximally hue-separated from purple. Grayscale parsing also wins:
//     slate is the darkest line on the chart, easy to anchor on.
//   - Meta amber (`#d97706`) vs Shopify green (`#15803d`) is the most
//     common red-green confusion pair, but Shopify is rendered with a
//     6-3 dashed pattern + 2.5px stroke (vs Meta's 1.5px solid), so the
//     pattern channel disambiguates without color. Do not "fix" Meta's
//     hue without also rethinking the dash/solid contract.
export const CHART_COLORS = {
  axis: 'var(--chart-axis)',
  reconciliationAxis: 'var(--chart-axis)',
  meta: '#d97706',
  google: '#2563eb',
  tiktok: '#374151',
  organic: '#9333ea',
  shopify: '#15803d',
  cpm: '#d97706',
  cpmPrev: '#fbbf24',
  roas: '#15803d',
  value: '#15803d',
  spend: '#dc2626',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;
