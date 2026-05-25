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

/** Format CAD/USD as `CAD 1,234` (currency prefixed, integer). */
export function fmtMoney(n: number, code: string = 'CAD'): React.ReactElement {
  return bdi(
    React.createElement(React.Fragment, null,
      React.createElement('span', { className: 'text-text-muted font-medium pe-1' }, code),
      fixMinus(MONEY.format(Math.round(n))),
    ),
  );
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

/**
 * Stable per-store color tokens. The same store gets the same color in every
 * chart, sparkline, legend, and store-chip — cross-component memory pattern
 * lifted from PostHog. Add new stores by extending this map.
 */
export const STORE_HUES: Record<string, { hex: string; bg: string }> = {
  uzoshop:     { hex: '#0d3680', bg: 'rgba(13, 54, 128, 0.08)' },
  'Zol Plus':  { hex: '#c92a2a', bg: 'rgba(201, 42, 42, 0.08)' },
  '360usmile': { hex: '#0a7d3b', bg: 'rgba(10, 125, 59, 0.08)' },
};

export function storeColor(storeName: string, fallbackIdx = 0): string {
  if (STORE_HUES[storeName]) return STORE_HUES[storeName].hex;
  return ['#0d3680', '#c92a2a', '#0a7d3b', '#b45309', '#7c3aed'][fallbackIdx % 5];
}

export function storeBg(storeName: string, fallbackIdx = 0): string {
  if (STORE_HUES[storeName]) return STORE_HUES[storeName].bg;
  return [
    'rgba(13, 54, 128, 0.08)',
    'rgba(201, 42, 42, 0.08)',
    'rgba(10, 125, 59, 0.08)',
    'rgba(180, 83, 9, 0.08)',
    'rgba(124, 58, 237, 0.08)',
  ][fallbackIdx % 5];
}
