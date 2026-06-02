import { pushCloudKey } from './cloudSync';

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
