/**
 * Single source of truth for OVERFLOW-SAFE metric formatting.
 *
 * `display` = what's painted (compact iff abs >= compactAbove). `full` = the
 * always-exact grouped string for title / sr-only. Compact output is bounded
 * (`$XXX.XM`, ≤8 chars) so a `ch`-reserved cell can never overflow at min font.
 *
 * Wave C4a: gained `prefix` / `locale` / `decimals` so a single primitive can
 * reproduce EVERY money render site in the app byte-for-byte:
 *   - bare `he-IL` 0dp  → table cells  (`formatCurrency(n, 0)`):  `1,234`
 *   - bare `he-IL` 2dp  → cpc/cpm/cpa  (`formatCurrency(n, 2)`):  `1,234.56`
 *   - `$`-prefixed en-US → hero compact (`fmtMoneyCompact`):      `$4,847` / `$1.2M`
 *   - bare en-US 2dp     → hero cpm grouping:                     `1,234.56`
 * Negatives use the typographic minus U+2212; a tiny negative that rounds to
 * zero at the requested precision normalizes to `0` (mirrors `formatCurrency`).
 *
 * NOTE: the compact path is intentionally locale-INDEPENDENT (always en-US
 * `1.2M`). Compaction only fires for huge values as an overflow floor, where a
 * bounded `1.2M`-style token is the goal regardless of the cell's grouping
 * locale; full/sr-only/title always carry the exact locale-grouped value.
 */
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Memoized grouped formatters, keyed by `locale_decimals`. `formatMetricValue`
 * runs once per FRAME inside the count-up tween (≈30–40×/animation × several
 * hero numbers), so constructing a fresh `Intl.NumberFormat` each call was
 * needless churn. The set of (locale, decimals) combos is tiny and bounded, so
 * a plain module cache never grows unbounded.
 */
const GROUPED_CACHE = new Map<string, Intl.NumberFormat>();
function groupedFormatter(locale: string, decimals: number): Intl.NumberFormat {
  const key = `${locale}_${decimals}`;
  let fmt = GROUPED_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'decimal',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    GROUPED_CACHE.set(key, fmt);
  }
  return fmt;
}

export type MoneyPrefix = '$' | 'CAD' | 'none';

export interface MetricFormatOpts {
  /**
   * Prefix convention: '$' (default) → `$1,234`; 'CAD' → `CAD 1,234`;
   * 'none' → bare grouped value (`1,234`). Replaces the old `code` option
   * (renamed in Wave C4a — there were no other `code` callers).
   */
  prefix?: MoneyPrefix;
  /** Grouping locale for the full (non-compact) value. Default 'en-US'. */
  locale?: 'en-US' | 'he-IL';
  /** Fractional digits for the full value. Default 0. */
  decimals?: 0 | 2;
  /** Compact above this abs value; full grouped below. Default 100_000. */
  compactAbove?: number;
}
export interface MetricFormatResult {
  display: string;
  full: string;
  compacted: boolean;
}

function applyPrefix(prefix: MoneyPrefix, body: string, sign: string): string {
  if (prefix === 'CAD') return `CAD ${sign}${body}`;
  if (prefix === 'none') return `${sign}${body}`;
  return `${sign}$${body}`;
}

export function formatMetricValue(
  value: number | null | undefined,
  opts: MetricFormatOpts = {},
): MetricFormatResult {
  const { prefix = '$', locale = 'en-US', decimals = 0, compactAbove = 100_000 } = opts;
  if (value == null || Number.isNaN(value)) return { display: '—', full: '—', compacted: false };

  // -0 normalization (mirror formatCurrency): a tiny negative that rounds to
  // zero magnitude at the requested precision must show 0, never −0.
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const normalized = rounded === 0 ? 0 : value;

  const sign = normalized < 0 ? '−' : '';
  const abs = Math.abs(normalized);

  const grouped = groupedFormatter(locale, decimals);
  const full = applyPrefix(prefix, grouped.format(abs), sign);
  if (abs < compactAbove) return { display: full, full, compacted: false };
  const display = applyPrefix(prefix, COMPACT.format(abs), sign);
  return { display, full, compacted: true };
}
