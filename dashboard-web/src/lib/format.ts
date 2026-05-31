/**
 * RTL-safe number formatting helpers.
 *
 * In a Hebrew RTL document, Latin numerals + Latin currency codes (CAD, ILS)
 * are weak-LTR runs and the Unicode bidi algorithm can reorder them in
 * surprising ways — e.g. a percent sign jumping to the wrong side of the
 * digit, or a minus sign ending up at the right edge. The fix is to wrap
 * every numeric atom in <bdi dir="ltr"> so it renders as one atomic unit.
 *
 * These helpers return React fragments (not strings) so the <bdi> wrapping
 * happens automatically at every call site.
 */
import React from 'react';

const _SIGN_FORMATTER = new Intl.NumberFormat('he-IL', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const PCT_FORMATTER = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const PLAIN_PCT = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const MONEY = new Intl.NumberFormat('he-IL', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const MONEY_2 = new Intl.NumberFormat('he-IL', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COUNT = new Intl.NumberFormat('he-IL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUM_2 = new Intl.NumberFormat('he-IL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Replaces the locale's '-' (HYPHEN-MINUS) with the typographic minus U+2212.
 * The proper minus survives copy-paste cleanly and aligns vertically with
 * '+' in tabular columns.
 */
function fixMinus(s: string): string {
  return s.replace(/-/g, '−');
}

/**
 * `<bdi dir="ltr">{s}</bdi>` — isolates a numeric run so RTL flow doesn't
 * shuffle its components.
 */
function bdi(content: React.ReactNode, className?: string): React.ReactElement {
  return React.createElement(
    'bdi',
    { dir: 'ltr', className: className ?? 'tabular-nums' },
    content,
  );
}

/** Format a count (no decimals): `1,234`. */
export function fmtCount(n: number): React.ReactElement {
  return bdi(fixMinus(COUNT.format(n)));
}

/**
 * Format CAD/USD as `CAD 1,234` (currency prefixed). Default 0 decimals.
 * Pass `decimals=2` for CPC/CPM/CPA cells that need cent-level precision.
 */
export function fmtMoney(
  n: number,
  code: string = 'CAD',
  decimals: 0 | 2 = 0,
): React.ReactElement {
  const f = decimals === 0 ? MONEY : MONEY_2;
  const rounded = decimals === 0 ? Math.round(n) : n;
  return bdi(
    React.createElement(React.Fragment, null,
      React.createElement('span', { className: 'text-ink-muted font-medium pe-1' }, code),
      fixMinus(f.format(rounded)),
    ),
  );
}

/**
 * Plain-string sibling of {@link fmtMoney} for non-JSX consumers
 * (aria-label, title attribute, log message, multi-line tooltips, etc.).
 * Returns the same currency-prefixed, integer-rounded string content but
 * WITHOUT the `<bdi>` ReactNode wrap — strings can't carry DOM elements.
 *
 * Wave 4 / Task 4.3: introduced to reconcile the `lib/utils.ts` vs
 * `lib/format.ts` bifurcation. Call sites that used to hand-build
 * `` `CAD ${n}` `` (which bypassed the <bdi> wrap and risked bidi-
 * reordering inside Hebrew tooltips/aria labels) now go through one of
 * the two siblings — JSX → fmtMoney, string → fmtMoneyString.
 *
 * For 2-decimal output (CPC/CPM/CPA), pass `decimals=2`.
 */
export function fmtMoneyString(
  n: number,
  code: string = 'CAD',
  decimals: 0 | 2 = 0,
): string {
  const f = decimals === 0 ? MONEY : MONEY_2;
  const rounded = decimals === 0 ? Math.round(n) : n;
  return `${code} ${fixMinus(f.format(rounded))}`;
}

/** Bare money without currency prefix. */
export function fmtMoneyBare(n: number, decimals: 0 | 2 = 0): React.ReactElement {
  const f = decimals === 0 ? MONEY : MONEY_2;
  return bdi(fixMinus(f.format(n)));
}

/** Format a 2-decimal number (e.g. ROAS 2.85). */
export function fmtNum2(n: number): React.ReactElement {
  return bdi(fixMinus(NUM_2.format(n)));
}

/**
 * Compact money formatter — `"$1.2k"` / `"$110k"` / `"$1.4M"`.
 *
 * Round-6 (2026-05-31): per-store metric cells (הוצאה / הכנסה / AOV)
 * collapsed when revenue / spend ran into 5-6 digits (`$110,899`,
 * `$47,738`) — the 4-up grid in `PerStoreRow` clipped the digit run
 * because the cell value font sits at 18-20px. Compact notation keeps
 * the number readable in narrow cells without truncating mid-glyph.
 * Returns a plain string (not a React element) so callers can compose
 * it inside their own `<bdi dir="ltr">` wrapper — keeps the LTR-isolate
 * decision at the call site.
 *
 * Threshold: 10_000 → compact ("$10.0k"); below that, plain
 * comma-separated ("$9,840"). Matches the operator's "looks broken
 * once the number passes 5 digits" feedback. Negative values keep
 * the typographic minus (U+2212) for visual alignment.
 */
const COMPACT_USD = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function fmtMoneyCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs < 10_000) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }
  return `${sign}$${COMPACT_USD.format(abs)}`;
}

/**
 * Aggressive compact money — abbreviates from ≥1_000 ("$5.8K" / "$112K" /
 * "$1.4M"). Used by the per-store metric grid (PerStoreRow spend / revenue
 * `.sv` cells) where the enlarged 20-22px font overflowed the narrow 1/4
 * column at 4-digit values (e.g. `$5,755` clipped to `…,755`). The wider
 * `fmtMoneyCompact` only abbreviates ≥10_000, so 4-digit values still
 * truncated; this variant always fits because the longest output is
 * `$XXX.XK` (7 chars) / `$X.XM` (5 chars). Below $1_000 it renders the
 * plain rounded value ("$842") — those already fit. Negative values keep
 * the typographic minus (U+2212).
 */
export function fmtMoneyCompactTight(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs < 1_000) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }
  return `${sign}$${COMPACT_USD.format(abs)}`;
}

/**
 * Format a delta percentage like "+12.4%" / "−3.4%". Always signed.
 * Returns a styled element so the call site can pick "good/bad" tone.
 */
export function fmtDeltaPct(value: number): React.ReactElement {
  return bdi(fixMinus(PCT_FORMATTER.format(value)));
}

/** Format a percentage WITHOUT a sign (e.g. CTR display): "12.4%". */
export function fmtPct(value: number, decimals: number = 1): React.ReactElement {
  if (decimals === 1) return bdi(fixMinus(PLAIN_PCT.format(value)));
  // Custom decimals — build a one-off formatter.
  return bdi(
    fixMinus(
      new Intl.NumberFormat('he-IL', {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value),
    ),
  );
}

/** Date formatter for Hebrew context: `DD/MM/YYYY`. */
export function fmtDate(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : yyyymmdd;
}

/** Shorter date for crowded cells: `DD/MM`. */
export function fmtDateShort(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : yyyymmdd;
}

// Per-store color helpers (palette map, badge hex, color resolver, bg
// resolver) moved to `@/lib/storeColors` in Task 1.11 of the UI/UX overhaul
// (2026-05-30). Single source of truth for store hues keeps every chart,
// badge, and chip aligned with the canonical store CSS-var tokens.
