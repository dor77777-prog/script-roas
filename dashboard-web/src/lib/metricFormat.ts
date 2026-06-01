/**
 * Single source of truth for OVERFLOW-SAFE metric formatting.
 *
 * `display` = what's painted (compact iff abs >= compactAbove). `full` = the
 * always-exact grouped string for title / sr-only. Compact output is bounded
 * (`$XXX.XM`, ≤8 chars) so a `ch`-reserved cell can never overflow at min font.
 * Reuses the dashboard's `$`/`CAD ` prefix convention (NOT narrowSymbol).
 * Negatives use the typographic minus U+2212.
 */
const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export interface MetricFormatOpts {
  /** Currency code prefix; '$' (default) or 'CAD'. */
  code?: '$' | 'CAD';
  /** Compact above this abs value; full grouped below. Default 100_000. */
  compactAbove?: number;
}
export interface MetricFormatResult {
  display: string;
  full: string;
  compacted: boolean;
}

function prefix(code: '$' | 'CAD', body: string, sign: string): string {
  return code === 'CAD' ? `CAD ${sign}${body}` : `${sign}$${body}`;
}

export function formatMetricValue(
  value: number | null | undefined,
  opts: MetricFormatOpts = {},
): MetricFormatResult {
  const { code = '$', compactAbove = 100_000 } = opts;
  if (value == null || Number.isNaN(value)) return { display: '—', full: '—', compacted: false };
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const full = prefix(code, GROUPED.format(Math.round(abs)), sign);
  if (abs < compactAbove) return { display: full, full, compacted: false };
  const display = prefix(code, COMPACT.format(abs), sign);
  return { display, full, compacted: true };
}
