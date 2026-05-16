import type { DateRange, PresetKey } from './types';

const TZ_OFFSET_HOURS = 3; // Asia/Jerusalem (winter is +2, summer +3; close enough for default presets)

function todayLocal(): Date {
  const now = new Date();
  // Shift to Israel local day boundary
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
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
  const today = todayLocal();

  switch (preset) {
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: fmt(y), to: fmt(y) };
    }
    case 'this_week': {
      const day = today.getUTCDay(); // 0=Sunday in IL
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
