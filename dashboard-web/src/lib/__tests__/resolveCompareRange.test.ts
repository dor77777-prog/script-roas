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

  // ── P1-1 (audit 2026-06-10) — month-end clamp ─────────────────────────
  // shiftDateBack used Date.UTC(y, m-1, day) which ROLLS overflow forward
  // (Apr 31 → May 1), so prev_month/prev_year compare windows OVERLAPPED
  // the active range on month-end dates: full May compared against
  // 2026-04-01..2026-05-01 — May 1 sat in BOTH windows and every hero
  // delta double-counted it. The fix clamps day to the target month's
  // length BEFORE building the date.
  describe('month-end clamp (P1-1)', () => {
    it("'prev_month' of a full 31-day month (May 1-31) yields Apr 1-30 — ZERO overlap", () => {
      const may: DateRange = { from: '2026-05-01', to: '2026-05-31' };
      const prev = resolveCompareRange('prev_month', may);
      expect(prev).toEqual({ from: '2026-04-01', to: '2026-04-30' });
      // Strictly before the active range — no shared day.
      expect(prev!.to < may.from).toBe(true);
    });

    it("'prev_year' of Feb 29 (leap year) clamps to Feb 28 — not Mar 1", () => {
      const leapDay: DateRange = { from: '2028-02-29', to: '2028-02-29' };
      expect(resolveCompareRange('prev_year', leapDay)).toEqual({
        from: '2027-02-28',
        to: '2027-02-28',
      });
    });

    it("'prev_month' into a leap February keeps Feb 29 (clamp, not blind 28)", () => {
      // 2024-03-31 shifted back 1 month → Feb 2024 has 29 days → 2024-02-29.
      const r: DateRange = { from: '2024-03-29', to: '2024-03-31' };
      expect(resolveCompareRange('prev_month', r)).toEqual({
        from: '2024-02-29',
        to: '2024-02-29',
      });
    });

    it('an arbitrary month-end range NEVER overlaps its own prev_month window', () => {
      const monthEndRanges: DateRange[] = [
        { from: '2026-03-01', to: '2026-03-31' }, // prev = Feb (28 days) — was a 3-day overlap
        { from: '2026-07-01', to: '2026-07-31' }, // prev = Jun (30 days)
        { from: '2026-10-29', to: '2026-10-31' }, // partial month-end tail
        { from: '2026-12-01', to: '2026-12-31' }, // year boundary
      ];
      for (const r of monthEndRanges) {
        const prev = resolveCompareRange('prev_month', r)!;
        expect(prev.to < r.from).toBe(true);   // zero overlap
        expect(prev.from <= prev.to).toBe(true); // window stays well-formed
      }
    });

    it("'prev_year' of a full December crosses no boundary and never overlaps", () => {
      const dec: DateRange = { from: '2026-12-01', to: '2026-12-31' };
      expect(resolveCompareRange('prev_year', dec)).toEqual({
        from: '2025-12-01',
        to: '2025-12-31',
      });
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
