import { pushCloudKey } from './cloudSync';
import type { DailyRow, DateRange } from './types';

export type SalaryEntry = { kind: 'percent' | 'amount'; value: number };
export interface SalarySettings {
  v: number;
  default: SalaryEntry;
  byMonth: Record<string, SalaryEntry>; // 'YYYY-MM' → entry
}

export const DEFAULT_SALARY: SalaryEntry = { kind: 'percent', value: 7 };
export const SALARY_SETTINGS_KEY = 'roas-dashboard:salary-settings';
export const SALARY_SETTINGS_VERSION = 1;
export const SALARY_SETTINGS_EVENT = 'roas-salary-changed';

export function defaultSalarySettings(): SalarySettings {
  return { v: SALARY_SETTINGS_VERSION, default: { ...DEFAULT_SALARY }, byMonth: {} };
}

/** byMonth[month] ?? default. */
export function effectiveSalaryEntry(s: SalarySettings, month: string): SalaryEntry {
  return s.byMonth[month] ?? s.default ?? { ...DEFAULT_SALARY };
}

function normEntry(x: unknown): SalaryEntry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<SalaryEntry>;
  const kind = o.kind === 'amount' ? 'amount' : o.kind === 'percent' ? 'percent' : null;
  if (!kind) return null;
  if (typeof o.value !== 'number' || !Number.isFinite(o.value)) return null;
  return { kind, value: o.value };
}

export function readSalarySettings(): SalarySettings {
  if (typeof window === 'undefined') return defaultSalarySettings();
  try {
    const raw = window.localStorage.getItem(SALARY_SETTINGS_KEY);
    if (!raw) return defaultSalarySettings();
    const parsed = JSON.parse(raw) as Partial<SalarySettings>;
    if (!parsed || typeof parsed !== 'object') return defaultSalarySettings();
    const byMonth: Record<string, SalaryEntry> = {};
    if (parsed.byMonth && typeof parsed.byMonth === 'object') {
      for (const [k, v] of Object.entries(parsed.byMonth)) {
        const n = normEntry(v);
        if (n) byMonth[k] = n;
      }
    }
    return {
      v: SALARY_SETTINGS_VERSION,
      default: normEntry(parsed.default) ?? { ...DEFAULT_SALARY },
      byMonth,
    };
  } catch { return defaultSalarySettings(); }
}

export function writeSalarySettings(s: SalarySettings): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: SalarySettings = { ...s, v: SALARY_SETTINGS_VERSION };
    window.localStorage.setItem(SALARY_SETTINGS_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(SALARY_SETTINGS_EVENT));
    pushCloudKey(SALARY_SETTINGS_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}

/** Calendar days in the month of a 'YYYY-MM' key (e.g. '2026-02' → 28). */
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
}

/** Count of days of `month` ('YYYY-MM') that fall within [range.from, range.to] inclusive. */
function daysOfMonthInRange(month: string, range: DateRange): number {
  const total = daysInMonth(month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    if (iso >= range.from && iso <= range.to) count++;
  }
  return count;
}

/**
 * Salaries deduction for the selected range. For each YYYY-MM overlapping the
 * range:
 *   percent → value% × (Σ revenue of that month's rows that fall inside the range)
 *   amount  → value × (days-of-that-month-inside-range ÷ days-in-month)
 * Sum across months. Business-level only; no per-store split.
 */
export function salariesForRange(s: SalarySettings, rows: readonly DailyRow[], range: DateRange): number {
  // Revenue per month, counting ONLY rows inside the range.
  const revByMonth = new Map<string, number>();
  // Track which months have any in-range row (so an amount-mode month only
  // bills when the business is actually active that month within the range).
  const monthsWithRows = new Set<string>();
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    const m = r.date.slice(0, 7);
    monthsWithRows.add(m);
    revByMonth.set(m, (revByMonth.get(m) ?? 0) + r.revenue);
  }
  let total = 0;
  for (const m of monthsWithRows) {
    const entry = effectiveSalaryEntry(s, m);
    if (entry.kind === 'percent') {
      total += (entry.value / 100) * (revByMonth.get(m) ?? 0);
    } else {
      const dim = daysInMonth(m);
      total += dim > 0 ? entry.value * (daysOfMonthInRange(m, range) / dim) : 0;
    }
  }
  return total;
}

export type SalaryApplyScope =
  | { kind: 'current'; currentMonth: string }
  | { kind: 'specific'; month: string }
  | { kind: 'all-previous'; currentMonth: string }
  | { kind: 'everything' };

/**
 * Pure: produce a new SalarySettings with `entry` applied per the chosen
 * apply-scope. `monthsInData` = the 'YYYY-MM' candidates for 'all-previous'.
 */
export function applySalaryToScope(
  s: SalarySettings, entry: SalaryEntry, apply: SalaryApplyScope, monthsInData: string[],
): SalarySettings {
  const byMonth = { ...s.byMonth };
  switch (apply.kind) {
    case 'current':  byMonth[apply.currentMonth] = entry; return { ...s, byMonth };
    case 'specific': byMonth[apply.month] = entry; return { ...s, byMonth };
    case 'all-previous':
      for (const m of monthsInData) if (m < apply.currentMonth) byMonth[m] = entry;
      return { ...s, byMonth };
    case 'everything': return { ...s, default: entry, byMonth: {} };
  }
}
