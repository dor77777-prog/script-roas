import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number, fractionDigits = 0): string {
  // Previously this passed `Math.round(n)` to Intl.NumberFormat, which threw
  // away the fractional part BEFORE the formatter ran — so `formatCurrency(5.40, 2)`
  // showed "5.00" instead of "5.40". That silently broke every CPC / CPM / CPA
  // cell in the table for ~ever. Let Intl.NumberFormat do the rounding to the
  // requested precision — it handles both fractionDigits=0 (→ integer) and
  // fractionDigits=2 (→ 2 decimals) correctly via maximumFractionDigits.
  //
  // Audit fix 2026-05-23 (FIND-07 dashboard-fidelity): avoid the "-0" /
  // "-0.00" output that Intl.NumberFormat produces when a tiny negative
  // input rounds to zero magnitude at the requested precision. Pre-
  // normalize so the operator never sees a "-0" cell that looks like a
  // rendering glitch but is actually the rounded form of e.g. -0.4 CAD.
  const factor = Math.pow(10, fractionDigits);
  const rounded = Math.round(n * factor) / factor;
  const normalized = rounded === 0 ? 0 : n;
  return new Intl.NumberFormat('he-IL', {
    style: 'decimal',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(normalized);
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
