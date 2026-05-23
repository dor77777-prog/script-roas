import { describe, it, expect } from 'vitest';
import { formatCurrency, safeDecode } from '@/lib/utils';

describe('safeDecode', () => {
  it('decodes a valid URL-encoded string', () => {
    expect(safeDecode('Summer%20Sale')).toBe('Summer Sale');
  });

  it('returns the raw input unchanged when the string has an invalid % sequence', () => {
    // '100%' has a lone % at end — decodeURIComponent throws URIError
    expect(safeDecode('100%')).toBe('100%');
  });

  it('returns empty string for empty string input', () => {
    expect(safeDecode('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(safeDecode(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(safeDecode(undefined)).toBe('');
  });

  it('returns the string unchanged when there are no percent-encoded characters', () => {
    expect(safeDecode('Summer Sale')).toBe('Summer Sale');
  });

  it('correctly decodes Hebrew UTF-8 multi-byte encoded string', () => {
    // %D7%A7%D7%99%D7%A5 = 'קיץ' in UTF-8
    expect(safeDecode('%D7%A7%D7%99%D7%A5')).toBe('קיץ');
  });

  it('returns the raw input for malformed mid-string encoding (foo%E0bar)', () => {
    // %E0 is an incomplete 2-byte UTF-8 sequence → URIError → return as-is
    expect(safeDecode('foo%E0bar')).toBe('foo%E0bar');
  });
});

/**
 * Regression coverage for the formatCurrency rounding bug. Previously
 * `formatCurrency` did `Math.round(n)` BEFORE passing into
 * Intl.NumberFormat, which threw away the fractional part even when the
 * caller asked for 2 decimals. So `formatCurrency(5.40, 2)` returned
 * "5.00" instead of "5.40", breaking every CPC / CPM / CPA cell across
 * the campaigns table.
 *
 * Pin the fix: fractionDigits controls the displayed precision, not a
 * pre-rounding step.
 */
describe('formatCurrency', () => {
  it('returns the integer part rounded to nearest when fractionDigits=0 (default)', () => {
    expect(formatCurrency(5.4)).toBe('5');
    expect(formatCurrency(5.6)).toBe('6');
    expect(formatCurrency(0)).toBe('0');
  });

  it('preserves 2 decimal places when fractionDigits=2 — the previously broken case', () => {
    expect(formatCurrency(5.40, 2)).toBe('5.40');
    expect(formatCurrency(5.45, 2)).toBe('5.45');
    expect(formatCurrency(5.49, 2)).toBe('5.49');
    expect(formatCurrency(5.51, 2)).toBe('5.51');
  });

  it('handles small fractional CPC / CPM values without rounding to integer', () => {
    // Pre-fix: formatCurrency(0.45, 2) returned "0.00" (Math.round(0.45) = 0)
    // After fix: returns "0.45"
    expect(formatCurrency(0.45, 2)).toBe('0.45');
    expect(formatCurrency(0.03, 2)).toBe('0.03');
    expect(formatCurrency(1.23, 2)).toBe('1.23');
  });

  it('rounds at the requested precision boundary (banker / nearest)', () => {
    // 5.455 rounds to 5.46 (or 5.45 depending on Intl rounding mode); both
    // are valid 2-decimal representations — the point is we get 2 decimals,
    // not "5.00".
    const result = formatCurrency(5.455, 2);
    expect(['5.45', '5.46']).toContain(result);
  });

  it('handles negative values correctly', () => {
    // he-IL prefixes with a left-to-right mark (‎) and uses standard
    // hyphen-minus. Strip the LRM so the assertion is locale-independent.
    expect(formatCurrency(-3.7, 2).replace(/‎/g, '')).toBe('-3.70');
  });

  it('formats with locale grouping for thousands', () => {
    // he-IL uses comma as thousands separator
    expect(formatCurrency(1234.56, 2)).toBe('1,234.56');
    expect(formatCurrency(1234567)).toBe('1,234,567');
  });

  it('handles zero correctly with both precisions', () => {
    expect(formatCurrency(0)).toBe('0');
    expect(formatCurrency(0, 2)).toBe('0.00');
  });

  it('does not silently lose precision on edge cases that mattered for CPC', () => {
    // Before fix: a campaign with cpc=0.65 displayed as "1.00" because
    // Math.round(0.65) = 1. After fix: "0.65".
    expect(formatCurrency(0.65, 2)).toBe('0.65');
    // 5.99 was displayed as "6.00" — now displays as "5.99"
    expect(formatCurrency(5.99, 2)).toBe('5.99');
  });

  it('normalizes negative-zero to "0" (audit fix 2026-05-23 FIND-07)', () => {
    // Pre-fix: Intl.NumberFormat('he-IL').format(-0) preserved the sign,
    // so a tiny negative spend (e.g. -0.4 CAD from FX-rounding) that
    // rounded to 0 magnitude rendered as "-0" — looked like a glitch.
    // Post-fix: rounds-to-zero values are coerced to a true 0.
    expect(formatCurrency(-0.4, 0)).toBe('0');
    expect(formatCurrency(-0.49, 0)).toBe('0');
    expect(formatCurrency(-0.001, 2)).toBe('0.00');
    // Object.is(-0, 0) === false, but rendered output should be the
    // positive "0" form regardless.
    expect(formatCurrency(-0, 0)).toBe('0');
    expect(formatCurrency(-0, 2)).toBe('0.00');
    // True negatives still render with the minus sign (LRM stripped).
    // Note: JS Math.round rounds half toward +Infinity, so
    // Math.round(-0.5) === 0 — the magnitude becomes 0 and the
    // normalization correctly drops the sign. -0.51 rounds to -1.
    expect(formatCurrency(-0.51, 0).replace(/‎/g, '')).toBe('-1');
    expect(formatCurrency(-1, 0).replace(/‎/g, '')).toBe('-1');
  });
});
