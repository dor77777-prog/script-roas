import { pushCloudKey } from './cloudSync';
import { getTodayInIsraelTz } from './dateRange';
import type { DateRange } from './types';

/**
 * Per-month business-wide monthly revenue goals.
 *
 * Mirrors the editable-settings pattern of cogsSettings.ts / salarySettings.ts:
 * a `byMonth` map keyed by 'YYYY-MM', localStorage-persisted, cloud-synced via
 * pushCloudKey, and re-read on the `roas-goal-changed` CustomEvent.
 *
 * Business-wide ONLY — there is intentionally no per-store dimension (the goal
 * is one business-wide target; see GoalTracker's "monthly goal is global"
 * constraint). A month with no explicit goal inherits the latest explicitly-set
 * earlier month's goal (carry-forward); no earlier set goal → no goal.
 *
 * Migration: this key replaces the legacy single number stored under
 * `roas-dashboard:monthly-revenue-goal`. On first read with no goal-settings but
 * a legacy value present, the legacy number seeds byMonth[currentMonth] (the
 * current IL month) so existing pacing is preserved; past months stay unset
 * until explicitly edited.
 */
export interface GoalSettings {
  v: number;
  /** Explicit per-month goals: 'YYYY-MM' → positive revenue target. */
  byMonth: Record<string, number>;
}

export const GOAL_SETTINGS_KEY = 'roas-dashboard:goal-settings';
export const GOAL_SETTINGS_VERSION = 1;
/** Reuse the existing goal event so legacy + new writers share one re-render signal. */
export const GOAL_SETTINGS_EVENT = 'roas-goal-changed';
/** Legacy single-number key — read for one-time migration only. */
export const LEGACY_GOAL_KEY = 'roas-dashboard:monthly-revenue-goal';

export function defaultGoalSettings(): GoalSettings {
  return { v: GOAL_SETTINGS_VERSION, byMonth: {} };
}

/**
 * Effective goal for a 'YYYY-MM':
 *   - exact byMonth[month] wins → { value, carriedFrom: null }
 *   - else the latest set month STRICTLY earlier than `month` → { value, carriedFrom: thatKey }
 *   - else → { value: null, carriedFrom: null }
 */
export function effectiveGoal(
  s: GoalSettings,
  month: string,
): { value: number | null; carriedFrom: string | null } {
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
  return { value: null, carriedFrom: null };
}

/**
 * Returns 'YYYY-MM' iff the range lies within ONE calendar month
 * (a full month OR any partial inside one month), else null. A range that
 * spans more than one calendar month → null (GoalTracker shows its empty
 * "single calendar month only" state).
 */
export function monthFromRange(range: DateRange): string | null {
  const { from, to } = range;
  if (!isIsoDay(from) || !isIsoDay(to)) return null;
  const m = from.slice(0, 7);
  if (to.slice(0, 7) !== m) return null;
  return m;
}

function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function readGoalSettings(): GoalSettings {
  if (typeof window === 'undefined') return defaultGoalSettings();
  try {
    const raw = window.localStorage.getItem(GOAL_SETTINGS_KEY);
    if (!raw) return migrateFromLegacy();
    const parsed = JSON.parse(raw) as Partial<GoalSettings>;
    if (!parsed || typeof parsed !== 'object') return defaultGoalSettings();
    return { v: GOAL_SETTINGS_VERSION, byMonth: normByMonth(parsed.byMonth) };
  } catch {
    return defaultGoalSettings();
  }
}

/** No goal-settings yet: seed byMonth[currentMonth] from the legacy number, if any. */
function migrateFromLegacy(): GoalSettings {
  try {
    const legacy = window.localStorage.getItem(LEGACY_GOAL_KEY);
    if (legacy) {
      const n = Number(legacy);
      if (Number.isFinite(n) && n > 0) {
        const month = getTodayInIsraelTz().slice(0, 7);
        return { v: GOAL_SETTINGS_VERSION, byMonth: { [month]: n } };
      }
    }
  } catch { /* ignore */ }
  return defaultGoalSettings();
}

/** Keep only positive finite numbers; drop everything else. */
function normByMonth(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
  }
  return out;
}

export function writeGoalSettings(s: GoalSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const versioned: GoalSettings = { ...s, v: GOAL_SETTINGS_VERSION };
    window.localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify(versioned));
    window.dispatchEvent(new (window.CustomEvent ?? CustomEvent)(GOAL_SETTINGS_EVENT));
    pushCloudKey(GOAL_SETTINGS_KEY, versioned);
  } catch { /* quota / private mode — ignore */ }
}
