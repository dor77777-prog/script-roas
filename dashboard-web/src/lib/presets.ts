import type { DateRange, PresetKey } from './types';

// Audit fix 2026-05-23 (d/HI-09): the previous TZ_OFFSET_HOURS = 3 was
// hardcoded to summer DST. Between October's "fall back" and March's
// "spring forward" IL runs at +2 (winter); the static +3 silently
// rolled "today" forward into tomorrow during winter pre-21:00 IL,
// making the "yesterday" preset return TODAY for several hours each
// winter evening — operator complained 0-revenue days. Switched to
// Intl Asia/Jerusalem for all boundary computation so DST is handled
// automatically and we never drift on the "spring forward" / "fall
// back" weekends.
function ilDateParts(now = new Date()): { y: number; m: number; d: number } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Build a UTC-anchored Date representing "midnight at the IL calendar
 * day (y, m, d)". The anchor itself is in UTC so subsequent addDays()
 * arithmetic is DST-immune; output is always formatted YYYY-MM-DD by
 * the consumer via `fmt`. Used by the test-seam variant of
 * computePresetRange so tests can pin behaviour across DST boundaries
 * without manipulating the system clock.
 */
function todayLocalFromParts(parts: { y: number; m: number; d: number }): Date {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: 'היום',
  yesterday: 'אתמול',
  this_month: 'מתחילת החודש',
  this_week: 'השבוע',
  last_7_days: '7 ימים אחרונים',
  last_month: 'חודש קודם',
  last_30_days: '30 ימים אחרונים',
  custom: 'מותאם אישית',
};

/** הצגה ראשונה ומודגשת: 4 הטווחים השימושיים ביותר. */
export const PRESET_FEATURED: PresetKey[] = [
  'today',
  'yesterday',
  'last_7_days',
  'this_month',
];
export const PRESET_SECONDARY: PresetKey[] = [
  'this_week',
  'last_month',
  'last_30_days',
  'custom',
];

export const PRESET_ORDER: PresetKey[] = [...PRESET_FEATURED, ...PRESET_SECONDARY];

export function computePresetRange(preset: PresetKey, customRange?: DateRange): DateRange {
  return _computePresetRangeForIlToday(preset, ilDateParts(), customRange);
}

/**
 * Test seam — same logic as `computePresetRange` but takes the IL
 * today-parts as an explicit input so tests can pin behavior across
 * DST boundaries without manipulating the system clock. Exported with
 * an underscore prefix to flag testing-only usage.
 */
export function _computePresetRangeForIlToday(
  preset: PresetKey,
  todayParts: { y: number; m: number; d: number },
  customRange?: DateRange,
): DateRange {
  const today = todayLocalFromParts(todayParts);

  switch (preset) {
    case 'today': {
      return { from: fmt(today), to: fmt(today) };
    }
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: fmt(y), to: fmt(y) };
    }
    case 'this_week': {
      const day = today.getUTCDay(); // 0=Sunday in IL — correct because `today` is anchored to UTC midnight of the IL calendar day.
      const sunday = addDays(today, -day);
      return { from: fmt(sunday), to: fmt(today) };
    }
    case 'last_7_days': {
      return { from: fmt(addDays(today, -6)), to: fmt(today) };
    }
    case 'this_month': {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from: fmt(first), to: fmt(today) };
    }
    case 'last_month': {
      const firstPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const lastPrev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: fmt(firstPrev), to: fmt(lastPrev) };
    }
    case 'last_30_days': {
      return { from: fmt(addDays(today, -29)), to: fmt(today) };
    }
    case 'custom':
    default:
      return customRange ?? { from: fmt(today), to: fmt(today) };
  }
}

/**
 * Hebrew range label for `<PageScope>`. When the operator is on a preset the
 * label is the preset's Hebrew name ("30 ימים אחרונים", "מתחילת החודש", …);
 * when the picker is in custom mode the label is "from — to" so the operator
 * always sees the active selection at a glance.
 *
 * Shared by every top-level page header in Wave 5 Task 5.9 so the label
 * format never drifts between tabs (Home / Trends / Archive / P&L / Detail /
 * Campaigns / Products).
 */
export function rangeLabelHebrew(
  preset: PresetKey,
  range: DateRange,
): string {
  return preset === 'custom' ? `${range.from} — ${range.to}` : PRESET_LABELS[preset];
}

/**
 * Hebrew "vs <previous period>" caption for a delta-vs-previous line. The delta
 * compares against the previous equal-length period (see `previousRange`), so
 * the caption must reflect the SELECTED range — not a hardcoded "מול אתמול".
 * e.g. today → "מול אתמול", this_month → "מול החודש הקודם", last_7_days →
 * "מול 7 הימים הקודמים". Falls back to the always-correct generic for `custom`.
 */
const COMPARISON_LABELS: Record<PresetKey, string> = {
  today: 'מול אתמול',
  yesterday: 'מול שלשום',
  this_month: 'מול החודש הקודם',
  this_week: 'מול השבוע הקודם',
  last_7_days: 'מול 7 הימים הקודמים',
  last_month: 'מול החודש שלפניו',
  last_30_days: 'מול 30 הימים הקודמים',
  custom: 'מול התקופה הקודמת',
};

export function comparisonLabelHebrew(preset: PresetKey): string {
  return COMPARISON_LABELS[preset] ?? 'מול התקופה הקודמת';
}

/** Previous period of equal length, ending the day before `range.from`. */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + 'T00:00:00Z');
  const to = new Date(range.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

/**
 * Period-compare baselines (Phase A). The operator picks WHAT the active
 * range is compared against:
 *  - 'prev_period' — the equal-length window ending the day before the range
 *    (delegates to `previousRange` so the math has a single source of truth);
 *  - 'prev_7d'     — the 7 days immediately before `range.from` (fixed length,
 *    independent of the range size);
 *  - 'prev_month'  — the same window shifted back exactly 1 calendar month;
 *  - 'prev_year'   — the same window shifted back exactly 1 year;
 *  - 'none'        — comparison off.
 */
export type CompareBaseline =
  | 'prev_period'
  | 'prev_7d'
  | 'prev_month'
  | 'prev_year'
  | 'none';

/** Hebrew labels for the period-compare baseline picker. */
export const COMPARE_BASELINE_LABELS: Record<CompareBaseline, string> = {
  prev_period: 'תקופה קודמת',
  prev_7d: '7 ימים קודמים',
  prev_month: 'חודש קודם',
  prev_year: 'שנה שעברה',
  none: 'ללא השוואה',
};

/**
 * Shift a single YYYY-MM-DD date back by `months` calendar months and/or
 * `years` years, anchored in UTC so the result is DST-immune.
 *
 * P1-1 (audit 2026-06-10): day-of-month is CLAMPED to the target month's
 * length before the date is built. The previous implementation passed the
 * raw day into Date.UTC(y, m-1, day), and JS Date ROLLS overflow forward
 * (Apr 31 → May 1, Feb 30 → Mar 2), so prev_month/prev_year compare
 * windows OVERLAPPED the active range on month-end dates — full May
 * compared against 2026-04-01..2026-05-01, double-counting May 1 in every
 * hero delta. shifting 2026-03-31 back one month now yields 2026-02-28
 * (or -29 in leap years) via an explicit min(day, daysInMonth) clamp.
 */
function daysInMonthUtc(year: number, monthIndex0: number): number {
  // Day 0 of the NEXT month = the last day of (year, monthIndex0).
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function shiftDateBack(date: string, months: number, years: number): string {
  const d = new Date(date + 'T00:00:00Z');
  // Normalize the target year/month FIRST via a day-1 anchor (month index
  // may go negative when crossing a year boundary — Date.UTC normalizes it).
  const anchor = new Date(
    Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth() - months, 1),
  );
  const targetYear = anchor.getUTCFullYear();
  const targetMonth = anchor.getUTCMonth();
  const day = Math.min(d.getUTCDate(), daysInMonthUtc(targetYear, targetMonth));
  return fmt(new Date(Date.UTC(targetYear, targetMonth, day)));
}

/**
 * Resolve the window the active `range` should be compared against, per the
 * chosen `baseline`. Returns `null` when comparison is off ('none'). All other
 * baselines return a concrete DateRange (see `CompareBaseline`).
 */
export function resolveCompareRange(
  baseline: CompareBaseline,
  range: DateRange,
): DateRange | null {
  switch (baseline) {
    case 'none':
      return null;
    case 'prev_period':
      return previousRange(range);
    case 'prev_7d': {
      const from = new Date(range.from + 'T00:00:00Z');
      const prevTo = addDays(from, -1);
      const prevFrom = addDays(prevTo, -6);
      return { from: fmt(prevFrom), to: fmt(prevTo) };
    }
    case 'prev_month':
      return {
        from: shiftDateBack(range.from, 1, 0),
        to: shiftDateBack(range.to, 1, 0),
      };
    case 'prev_year':
      return {
        from: shiftDateBack(range.from, 0, 1),
        to: shiftDateBack(range.to, 0, 1),
      };
    default: {
      // Exhaustiveness guard — a new baseline must be handled above.
      const _exhaustive: never = baseline;
      return _exhaustive;
    }
  }
}

/** Display-resolution shape consumed by the compare UI (see `resolveCompare`). */
export interface ResolvedCompare {
  /**
   * Effective compare window — ALWAYS a valid DateRange (never null), so
   * downstream fetches have a window even when comparison is off ('none').
   */
  range: DateRange;
  /** Whether to render the compare delta (false for 'none' or when off). */
  show: boolean;
  /** Hebrew caption for the compare line ('' when comparison is off). */
  caption: string;
}

/**
 * Single display-resolution helper for period-compare. Combines the chosen
 * `baseline` (defaults to 'prev_period' when undefined), the active `range`,
 * and the current `preset` into a UI-ready shape:
 *  - `range` is always valid: `resolveCompareRange` when non-null, else
 *    `previousRange(range)` (so 'none' still yields a fetchable window);
 *  - `show` is true only when the baseline is not 'none' AND
 *    `resolveCompareRange` returned a concrete window;
 *  - `caption` is '' for 'none', the preset-aware caption for 'prev_period',
 *    and "מול " + the baseline label otherwise.
 * Pure and side-effect-free.
 */
export function resolveCompare(
  baseline: CompareBaseline | undefined,
  range: DateRange,
  preset: PresetKey,
): ResolvedCompare {
  const b: CompareBaseline = baseline ?? 'prev_period';
  const resolved = resolveCompareRange(b, range);
  const effectiveRange = resolved ?? previousRange(range);
  const show = b !== 'none' && resolved !== null;

  let caption: string;
  if (b === 'none') {
    caption = '';
  } else if (b === 'prev_period') {
    caption = comparisonLabelHebrew(preset);
  } else {
    caption = 'מול ' + COMPARE_BASELINE_LABELS[b];
  }

  return { range: effectiveRange, show, caption };
}
