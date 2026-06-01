import { pushCloudKey } from './cloudSync';
import type { DailyRow } from './types';

/** Operator-facing default inventory %. */
export const DEFAULT_COGS_PCT = 25;
export const COGS_SETTINGS_KEY = 'roas-dashboard:cogs-settings';
export const COGS_SETTINGS_VERSION = 1;
/** Same CustomEvent pattern as billing.ts so same-tab edits re-render. */
export const COGS_SETTINGS_EVENT = 'roas-cogs-settings-changed';

export interface CogsScopeSettings {
  /** Base % (0-100) for any month without an explicit byMonth entry. */
  default: number;
  /** Explicit per-month overrides: 'YYYY-MM' → percent (0-100). */
  byMonth: Record<string, number>;
}
export interface CogsSettings {
  v: number;
  mode: 'business' | 'per-store';
  business: CogsScopeSettings;
  perStore: Record<string, CogsScopeSettings>;
}

export function defaultCogsSettings(): CogsSettings {
  return { v: COGS_SETTINGS_VERSION, mode: 'business', business: { default: DEFAULT_COGS_PCT, byMonth: {} }, perStore: {} };
}

/** Effective FRACTION (0-1) for a store + 'YYYY-MM'. byMonth > default > 25. */
export function effectiveCogsPct(s: CogsSettings, storeName: string, month: string): number {
  const scope = s.mode === 'per-store'
    ? (s.perStore[storeName] ?? { default: DEFAULT_COGS_PCT, byMonth: {} })
    : s.business;
  const pct = scope.byMonth[month] ?? scope.default ?? DEFAULT_COGS_PCT;
  return pct / 100;
}

export function readCogsSettings(): CogsSettings {
  if (typeof window === 'undefined') return defaultCogsSettings();
  try {
    const raw = window.localStorage.getItem(COGS_SETTINGS_KEY);
    if (!raw) return defaultCogsSettings();
    const parsed = JSON.parse(raw) as Partial<CogsSettings>;
    if (!parsed || typeof parsed !== 'object') return defaultCogsSettings();
    const d = defaultCogsSettings();
    return {
      v: COGS_SETTINGS_VERSION,
      mode: parsed.mode === 'per-store' ? 'per-store' : 'business',
      business: normScope(parsed.business) ?? d.business,
      perStore: normPerStore(parsed.perStore),
    };
  } catch { return defaultCogsSettings(); }
}

function normScope(x: unknown): CogsScopeSettings | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<CogsScopeSettings>;
  const def = typeof o.default === 'number' && Number.isFinite(o.default) ? o.default : DEFAULT_COGS_PCT;
  const byMonth: Record<string, number> = {};
  if (o.byMonth && typeof o.byMonth === 'object') {
    for (const [k, v] of Object.entries(o.byMonth)) if (typeof v === 'number' && Number.isFinite(v)) byMonth[k] = v;
  }
  return { default: def, byMonth };
}
function normPerStore(x: unknown): Record<string, CogsScopeSettings> {
  const out: Record<string, CogsScopeSettings> = {};
  if (x && typeof x === 'object') for (const [store, scope] of Object.entries(x)) { const n = normScope(scope); if (n) out[store] = n; }
  return out;
}

export function writeCogsSettings(s: CogsSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: CogsSettings = { ...s, v: COGS_SETTINGS_VERSION };
    window.localStorage.setItem(COGS_SETTINGS_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(COGS_SETTINGS_EVENT));
    pushCloudKey(COGS_SETTINGS_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}

/**
 * Recompute each row's COGS-derived fields from the effective % (per the row's
 * own month + store). grossProfit (= revenue − adSpend) is NOT cogs-derived, so
 * it is left as-is. With default settings this reproduces a 25%-stored row.
 */
export function applyCogsToRows(rows: DailyRow[], s: CogsSettings): DailyRow[] {
  return rows.map((r) => {
    const pct = effectiveCogsPct(s, r.storeName, r.date.slice(0, 7));
    const cogs = r.revenue * pct;
    return { ...r, cogs, hasCogs: true, netProfit: r.revenue - r.totalSpend - cogs };
  });
}

export type ApplyScope =
  | { kind: 'current'; currentMonth: string }
  | { kind: 'specific'; month: string }
  | { kind: 'all-previous'; currentMonth: string }
  | { kind: 'everything' };

/**
 * Pure: produce a new scope with `pct` applied per the chosen apply-scope.
 * `monthsInData` = the 'YYYY-MM' present in the loaded rows (for 'all-previous').
 */
export function applyPctToScope(scope: CogsScopeSettings, pct: number, apply: ApplyScope, monthsInData: string[]): CogsScopeSettings {
  const byMonth = { ...scope.byMonth };
  switch (apply.kind) {
    case 'current':  byMonth[apply.currentMonth] = pct; return { ...scope, byMonth };
    case 'specific': byMonth[apply.month] = pct; return { ...scope, byMonth };
    case 'all-previous':
      for (const m of monthsInData) if (m < apply.currentMonth) byMonth[m] = pct;
      return { ...scope, byMonth };
    case 'everything': return { default: pct, byMonth: {} };
  }
}
