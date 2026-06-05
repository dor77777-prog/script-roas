import { describe, it, expect } from 'vitest';
import {
  resolveCompare,
  previousRange,
  comparisonLabelHebrew,
  COMPARE_BASELINE_LABELS,
} from '@/lib/presets';
import type { DateRange, PresetKey } from '@/lib/types';

// `resolveCompare` is the single display-resolution helper the UI consumes:
// it always hands back a VALID compare window (so downstream fetches have a
// window even when comparison is off / 'none'), a `show` flag for whether to
// render the compare delta, and a Hebrew `caption`. This locks all three
// fields against the chosen baseline + range + preset.
describe('resolveCompare', () => {
  // A 5-day sample range that is NOT month/year aligned so calendar shifts are
  // unambiguous.
  const range: DateRange = { from: '2026-03-10', to: '2026-03-14' };
  const preset: PresetKey = 'last_7_days';

  it('undefined baseline → defaults to prev_period (show, previousRange, preset caption)', () => {
    const r = resolveCompare(undefined, range, preset);
    expect(r.show).toBe(true);
    expect(r.range).toEqual(previousRange(range));
    expect(r.caption).toBe(comparisonLabelHebrew(preset));
  });

  it("'none' → show false, empty caption, but range still falls back to previousRange", () => {
    const r = resolveCompare('none', range, preset);
    expect(r.show).toBe(false);
    expect(r.caption).toBe('');
    // Downstream fetches still need a window even with comparison off.
    expect(r.range).toEqual(previousRange(range));
  });

  it("'prev_7d' → show, 7 days before range.from, 'מול ' + label", () => {
    const r = resolveCompare('prev_7d', range, preset);
    expect(r.show).toBe(true);
    expect(r.range).toEqual({ from: '2026-03-03', to: '2026-03-09' });
    expect(r.caption).toBe('מול ' + COMPARE_BASELINE_LABELS.prev_7d);
  });

  it("'prev_month' → show, caption uses the matching label", () => {
    const r = resolveCompare('prev_month', range, preset);
    expect(r.show).toBe(true);
    expect(r.range).toEqual({ from: '2026-02-10', to: '2026-02-14' });
    expect(r.caption).toBe('מול ' + COMPARE_BASELINE_LABELS.prev_month);
  });

  it("'prev_year' → show, caption uses the matching label", () => {
    const r = resolveCompare('prev_year', range, preset);
    expect(r.show).toBe(true);
    expect(r.range).toEqual({ from: '2025-03-10', to: '2025-03-14' });
    expect(r.caption).toBe('מול ' + COMPARE_BASELINE_LABELS.prev_year);
  });

  it("'prev_period' → preset-aware caption (not the generic label)", () => {
    const r = resolveCompare('prev_period', range, preset);
    expect(r.show).toBe(true);
    expect(r.range).toEqual(previousRange(range));
    expect(r.caption).toBe(comparisonLabelHebrew(preset));
  });
});
