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
  yesterday: 'אתמול',
  this_month: 'מתחילת החודש',
  this_week: 'השבוע',
  last_7_days: '7 ימים אחרונים',
  last_month: 'חודש קודם',
  last_30_days: '30 ימים אחרונים',
  custom: 'מותאם אישית',
};

/** הצגה ראשונה ומודגשת: אתמול ומתחילת החודש (השאלות הכי נפוצות). */
export const PRESET_FEATURED: PresetKey[] = ['yesterday', 'this_month'];
export const PRESET_SECONDARY: PresetKey[] = [
  'this_week',
  'last_7_days',
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

/** Previous period of equal length, ending the day before `range.from`. */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + 'T00:00:00Z');
  const to = new Date(range.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}
