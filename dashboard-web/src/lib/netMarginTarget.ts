import { pushCloudKey } from './cloudSync';

/**
 * Per-month, business-wide target NET-PROFIT margin (the threshold the P&L tab
 * synthesis line compares the realized true margin against:
 * "רווח נטו X% — מתחת/מעל ליעד Y%").
 *
 * Mirrors the editable-settings pattern of cogsSettings.ts / goalSettings.ts:
 *  - localStorage-persisted under a canonical `roas-dashboard:*` key,
 *  - cloud-synced via pushCloudKey (registered in cloudSync STATE_KEYS),
 *  - re-read on a dedicated CustomEvent + the cross-device `storage` event.
 *
 * Storage shape mirrors a single COGS *business scope* (`CogsScopeSettings`):
 * a `default` fraction PLUS a per-month `byMonth` override map with
 * carry-forward — but business-wide ONLY (no per-store dimension; the net-margin
 * target is one business-wide goal, exactly like the monthly revenue goal).
 *
 * Default stays 0.35 (35%) so the EXISTING P&L behavior is preserved when the
 * operator never edits it — the same value pnl.ts keeps as its `?? 0.35`
 * fallback.
 *
 * Effective target for a 'YYYY-MM': exact byMonth[month] → latest earlier set
 * month (carry-forward) → `default` → 0.35.
 */

/** Operator-facing default target net margin (decimal, 0.35 = 35%). */
export const DEFAULT_NET_MARGIN_TARGET = 0.35;
export const NET_MARGIN_TARGET_KEY = 'roas-dashboard:net-margin-target';
export const NET_MARGIN_TARGET_VERSION = 1;
export const NET_MARGIN_TARGET_EVENT = 'roas-net-margin-target-changed';

export interface NetMarginTargetSettings {
  v: number;
  /** Base target FRACTION (0-1) for any month without an explicit byMonth entry. */
  default: number;
  /** Explicit per-month overrides: 'YYYY-MM' → target FRACTION (0-1). */
  byMonth: Record<string, number>;
}

export function defaultNetMarginTargetSettings(): NetMarginTargetSettings {
  return { v: NET_MARGIN_TARGET_VERSION, default: DEFAULT_NET_MARGIN_TARGET, byMonth: {} };
}

/**
 * Effective target FRACTION (0-1) for a 'YYYY-MM':
 *   - exact byMonth[month] wins → { value, carriedFrom: null }
 *   - else the latest set month STRICTLY earlier than `month` → carry-forward
 *   - else the global `default` → { value: default, carriedFrom: null }
 */
export function effectiveNetMarginTarget(
  s: NetMarginTargetSettings,
  month: string,
): { value: number; carriedFrom: string | null } {
  const exact = s.byMonth[month];
  if (typeof exact === 'number' && Number.isFinite(exact)) {
    return { value: exact, carriedFrom: null };
  }
  let bestKey: string | null = null;
  for (const k of Object.keys(s.byMonth)) {
    if (k < month && (bestKey === null || k > bestKey)) bestKey = k;
  }
  if (bestKey !== null) {
    return { value: s.byMonth[bestKey], carriedFrom: bestKey };
  }
  const def = Number.isFinite(s.default) ? s.default : DEFAULT_NET_MARGIN_TARGET;
  return { value: def, carriedFrom: null };
}

export function readNetMarginTargetSettings(): NetMarginTargetSettings {
  if (typeof window === 'undefined') return defaultNetMarginTargetSettings();
  try {
    const raw = window.localStorage.getItem(NET_MARGIN_TARGET_KEY);
    if (!raw) return defaultNetMarginTargetSettings();
    const parsed = JSON.parse(raw) as Partial<NetMarginTargetSettings>;
    if (!parsed || typeof parsed !== 'object') return defaultNetMarginTargetSettings();
    const def = typeof parsed.default === 'number' && Number.isFinite(parsed.default)
      ? parsed.default
      : DEFAULT_NET_MARGIN_TARGET;
    return { v: NET_MARGIN_TARGET_VERSION, default: def, byMonth: normByMonth(parsed.byMonth) };
  } catch {
    return defaultNetMarginTargetSettings();
  }
}

/** Keep only finite fractions in (0,1]; drop everything else. */
function normByMonth(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1) out[k] = v;
    }
  }
  return out;
}

export function writeNetMarginTargetSettings(s: NetMarginTargetSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: NetMarginTargetSettings = { ...s, v: NET_MARGIN_TARGET_VERSION };
    window.localStorage.setItem(NET_MARGIN_TARGET_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(NET_MARGIN_TARGET_EVENT));
    pushCloudKey(NET_MARGIN_TARGET_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}
