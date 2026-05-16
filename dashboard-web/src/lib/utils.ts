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
