import { describe, it, expect } from 'vitest';
import {
  resolveCompareRange,
  previousRange,
  COMPARE_BASELINE_LABELS,
  type CompareBaseline,
} from '@/lib/presets';
import type { DateRange } from '@/lib/types';

// Period-compare resolution (Phase A). `resolveCompareRange` translates a
// chosen baseline + the active range into the window we compare against.
// 'prev_period' MUST delegate to the existing previousRange() so the
// equal-length-previous-window logic has a single source of truth.
describe('resolveCompareRange', () => {
  // A 5-day sample range that is NOT month/year aligned, so the calendar
  // shifts ('prev_month' / 'prev_year') are unambiguous.
  const range: DateRange = { from: '2026-03-10', to: '2026-03-14' };

  it("'none' returns null", () => {
    expect(resolveCompareRange('none', range)).toBeNull();
  });

  it("'prev_period' equals previousRange(range)", () => {
    expect(resolveCompareRange('prev_period', range)).toEqual(previousRange(range));
    // sanity: previousRange of a 5-day window is the 5 days ending the day
    // before range.from.
    expect(resolveCompareRange('prev_period', range)).toEqual({
      from: '2026-03-05',
      to: '2026-03-09',
    });
  });

  it("'prev_7d' = the 7 days immediately before range.from (independent of range length)", () => {
    expect(resolveCompareRange('prev_7d', range)).toEqual({
      from: '2026-03-03',
      to: '2026-03-09',
    });
  });

  it("'prev_month' = same window shifted back 1 calendar month", () => {
    expect(resolveCompareRange('prev_month', range)).toEqual({
      from: '2026-02-10',
      to: '2026-02-14',
    });
  });

  it("'prev_year' = same window shifted back 1 year", () => {
    expect(resolveCompareRange('prev_year', range)).toEqual({
      from: '2025-03-10',
      to: '2025-03-14',
    });
  });

  it('exposes Hebrew labels for every baseline', () => {
    const expected: Record<CompareBaseline, string> = {
      prev_period: 'תקופה קודמת',
      prev_7d: '7 ימים קודמים',
      prev_month: 'חודש קודם',
      prev_year: 'שנה שעברה',
      none: 'ללא השוואה',
    };
    expect(COMPARE_BASELINE_LABELS).toEqual(expected);
  });
});
