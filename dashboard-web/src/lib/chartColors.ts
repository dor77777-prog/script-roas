// TEST-06 (5.2.2.1): single source of truth for chart hex literals.
// Values mirror the Tailwind theme/default utility colors used by these charts.
export const CHART_COLORS = {
  axis: '#7a8a9a',
  reconciliationAxis: '#64748b',
  meta: '#d97706',
  google: '#2563eb',
  organic: '#9333ea',
  shopify: '#15803d',
  cpm: '#d97706',
  cpmPrev: '#fbbf24',
  roas: '#15803d',
  value: '#15803d',
  spend: '#dc2626',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;
