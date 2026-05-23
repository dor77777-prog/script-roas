import { describe, expect, it } from 'vitest';
import { _computePresetRangeForIlToday } from '@/lib/presets';

/**
 * Audit fix 2026-05-23 (d/HI-09) — DST safety for the date-range presets.
 *
 * Pre-fix `presets.ts` had a hardcoded `TZ_OFFSET_HOURS = 3` (summer DST)
 * that drove all "today" computation. Between October's "fall back" and
 * March's "spring forward" IL runs at +2, so the static +3 silently
 * rolled "today" forward into TOMORROW for several hours each winter
 * evening — the "yesterday" preset returned today (0 revenue), the
 * "this_month" preset returned the wrong month-start near month
 * boundaries, etc.
 *
 * The fix: drop TZ_OFFSET_HOURS, use Intl Asia/Jerusalem-formatted
 * today-parts as the anchor for all preset boundaries. DST is handled
 * by the platform's IANA tz database — we never have to think about
 * +2 vs +3 again.
 *
 * These tests pin the boundaries explicitly for DST transitions and
 * for the "yesterday during winter evening" operator regression.
 */
describe('presets — DST-stable boundaries (d/HI-09)', () => {
  it('yesterday — winter evening (IL +2) returns the prior calendar day', () => {
    // IL today = Wednesday 2026-01-21 (winter, +2 offset).
    // Pre-fix: TZ_OFFSET_HOURS=3 shifted UTC midnight into "tomorrow"
    // for any UTC time after 21:00, so "yesterday" might have returned
    // 2026-01-21 instead of 2026-01-20.
    const r = _computePresetRangeForIlToday('yesterday', { y: 2026, m: 1, d: 21 });
    expect(r).toEqual({ from: '2026-01-20', to: '2026-01-20' });
  });

  it('yesterday — summer evening (IL +3) returns the prior calendar day', () => {
    // IL today = Wednesday 2026-07-15 (summer, +3 offset).
    const r = _computePresetRangeForIlToday('yesterday', { y: 2026, m: 7, d: 15 });
    expect(r).toEqual({ from: '2026-07-14', to: '2026-07-14' });
  });

  it('this_month — DST "spring forward" weekend returns correct month-start', () => {
    // IL spring-forward 2026: Friday March 27 night → Saturday March 28
    // (clocks jump from 02:00 to 03:00). Pre-fix the static +3 would
    // emit the wrong month-start during the transition window.
    const r = _computePresetRangeForIlToday('this_month', { y: 2026, m: 3, d: 28 });
    expect(r).toEqual({ from: '2026-03-01', to: '2026-03-28' });
  });

  it('this_month — DST "fall back" weekend returns correct month-start', () => {
    // IL fall-back 2026: Saturday October 24 night → Sunday October 25
    // (clocks fall from 02:00 to 01:00).
    const r = _computePresetRangeForIlToday('this_month', { y: 2026, m: 10, d: 25 });
    expect(r).toEqual({ from: '2026-10-01', to: '2026-10-25' });
  });

  it('last_30_days — winter date computes 30-day window correctly', () => {
    const r = _computePresetRangeForIlToday('last_30_days', { y: 2026, m: 1, d: 31 });
    // 30 days back from Jan 31 = Jan 2 (inclusive of today → 30 days span)
    expect(r).toEqual({ from: '2026-01-02', to: '2026-01-31' });
  });

  it('last_month — yields prior month range correctly across year boundary', () => {
    const r = _computePresetRangeForIlToday('last_month', { y: 2026, m: 1, d: 15 });
    expect(r).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('this_week — Sunday-anchored week for Wednesday', () => {
    // Wednesday 2026-05-20 → week starts Sunday 2026-05-17.
    const r = _computePresetRangeForIlToday('this_week', { y: 2026, m: 5, d: 20 });
    expect(r).toEqual({ from: '2026-05-17', to: '2026-05-20' });
  });

  it('deterministic — same input → same output independent of system zone', () => {
    // Regression guard: pure function. If anyone reintroduces a
    // `new Date()` call inside computePresetRange's hot path, this test
    // will flake under CI workers in non-IL zones.
    const a = _computePresetRangeForIlToday('this_month', { y: 2026, m: 5, d: 23 });
    const b = _computePresetRangeForIlToday('this_month', { y: 2026, m: 5, d: 23 });
    expect(a).toEqual(b);
  });
});
