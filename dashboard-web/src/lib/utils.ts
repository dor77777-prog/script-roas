import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'decimal',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.round(n));
}

export function formatNumber(n: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function formatDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
}

export function formatPct(n: number, sign = false): string {
  const fmt = new Intl.NumberFormat('he-IL', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
  return sign && n > 0 ? '+' + fmt : fmt;
}

// TODO(phase-5): wire safeDecode() into useSearchParams() consumers for UTM
// param surfaces (CampaignDrawer URL params, future deep-link routes,
// landing-URL manual-spend rows). Until then this is preemptive infrastructure
// — keep the tests green so the contract doesn't drift before the first
// caller arrives. (IN-07)
/**
 * Try/catch wrapper around `decodeURIComponent`. Returns the decoded
 * string on success, or the input unchanged on failure. Use anywhere a
 * decoded URL-encoded user-supplied string is consumed (utm parameters
 * already in Sheets, landing-URL manual-spend rows, anything that could
 * contain a lone `%` character that crashes `decodeURIComponent`).
 *
 * Why not throw? The original `decodeURIComponent('%E0')` throws
 * `URIError: URI malformed`. In a UI render path that's a white-screen.
 * Returning the raw input lets the caller render the as-is value
 * (slightly ugly) rather than crash the page.
 *
 * No existing call sites in dashboard-web at Phase 2 task time (grep confirmed 0).
 * This utility is preemptive for Phase 5 (query params) and Phase 8 (i18n).
 * Pattern: returns '' for null/undefined, matching formatDate's always-string contract.
 */
export function safeDecode(value: string | null | undefined): string {
  if (value == null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
