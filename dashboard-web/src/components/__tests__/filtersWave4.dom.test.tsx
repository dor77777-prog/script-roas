// dashboard-web/src/components/__tests__/filtersWave4.dom.test.tsx
//
// Wave 4 (B) — two NEW opt-in affordances inside <Filters>:
//   1) compare-baseline pills (showCompareBaseline) — 5 pills in the canonical
//      order prev_period · prev_7d · prev_month · prev_year · none; clicking a
//      pill fires onChange with filters.compareBaseline set; the active pill
//      reflects filters.compareBaseline (defaulting to prev_period).
//   2) saved-views dropdown (showSavedViews) — lists persisted views (most
//      recently used first), applies one (re-deriving relative ranges), and
//      saves the current filters under a typed name.
//
// Both default to false → with neither prop NONE of the new UI renders. The
// existing strip (presets/store/range) is untouched by these tests.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { Filters } from '@/components/Filters';
import { computePresetRange, COMPARE_BASELINE_LABELS } from '@/lib/presets';
import { saveView, readSavedViews } from '@/lib/savedViews';
import type { Filters as F } from '@/lib/types';

const STORES = ['uzoshop', 'usmile360'];

function baseFilters(preset: F['preset'] = 'today'): F {
  return {
    preset,
    range: computePresetRange(preset),
    store: 'All',
  };
}

beforeEach(() => {
  // Isolate persisted saved-views between tests (Map-backed localStorage stub).
  window.localStorage.clear();
});

// Horizon re-skin Wave 2 (2026-06-13): the compare-baseline row's hand-rolled
// <Button> pills are now a shared <SegmentedControl> (role="radiogroup" rail
// with role="radio" children + aria-checked). These assertions were re-pointed
// from getAllByRole('button') + aria-pressed to getAllByRole('radio') +
// aria-checked. The wiring, canonical order, and default-active baseline are
// unchanged.
describe('Wave 4 — compare-baseline segmented control in <Filters>', () => {
  it('renders 5 compare segments when showCompareBaseline is true', () => {
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={() => {}}
        showCompareBaseline
      />,
    );
    const row = container.querySelector('[data-testid="filters-compare-row"]');
    expect(row).toBeTruthy();
    // W2 re-skin: rail is a radiogroup with radio children (was <Button> pills).
    const seg = within(row as HTMLElement).getByTestId('filters-compare-seg');
    expect(seg.getAttribute('role')).toBe('radiogroup');
    const pills = within(seg).getAllByRole('radio');
    expect(pills).toHaveLength(5);
    const labels = pills.map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      COMPARE_BASELINE_LABELS.prev_period,
      COMPARE_BASELINE_LABELS.prev_7d,
      COMPARE_BASELINE_LABELS.prev_month,
      COMPARE_BASELINE_LABELS.prev_year,
      COMPARE_BASELINE_LABELS.none,
    ]);
  });

  it("clicking the 'month before' segment calls onChange with compareBaseline === 'prev_month'", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={onChange}
        showCompareBaseline
      />,
    );
    const row = container.querySelector('[data-testid="filters-compare-row"]') as HTMLElement;
    // W2 re-skin: segments are role="radio" (was aria-pressed <Button>).
    const pill = within(row)
      .getAllByRole('radio')
      .find((b) => b.textContent?.trim() === COMPARE_BASELINE_LABELS.prev_month);
    expect(pill).toBeTruthy();
    fireEvent.click(pill!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.compareBaseline).toBe('prev_month');
  });

  it('marks the segment matching filters.compareBaseline as active (aria-checked)', () => {
    const { container } = render(
      <Filters
        filters={{ ...baseFilters(), compareBaseline: 'prev_year' }}
        stores={STORES}
        onChange={() => {}}
        showCompareBaseline
      />,
    );
    const row = container.querySelector('[data-testid="filters-compare-row"]') as HTMLElement;
    // W2 re-skin: active state is aria-checked (radiogroup) not aria-pressed.
    const active = within(row)
      .getAllByRole('radio')
      .filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe(COMPARE_BASELINE_LABELS.prev_year);
  });

  it('defaults the active segment to prev_period when compareBaseline is unset', () => {
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={() => {}}
        showCompareBaseline
      />,
    );
    const row = container.querySelector('[data-testid="filters-compare-row"]') as HTMLElement;
    const active = within(row)
      .getAllByRole('radio')
      .filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0].textContent?.trim()).toBe(COMPARE_BASELINE_LABELS.prev_period);
  });
});

describe('Wave 4 — saved-views dropdown in <Filters>', () => {
  it('lists a seeded view and APPLIES it with a re-derived range for a non-custom preset', () => {
    // Seed a relative ("this_month") view whose STORED range is intentionally
    // stale so we can prove APPLY re-derives the range for the current month.
    const staleRange = { from: '2020-01-01', to: '2020-01-31' };
    saveView('החודש שלי', {
      preset: 'this_month',
      range: staleRange,
      store: 'uzoshop',
    });

    const onChange = vi.fn();
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={onChange}
        showSavedViews
      />,
    );

    const wrap = container.querySelector('[data-testid="filters-savedviews"]') as HTMLElement;
    expect(wrap).toBeTruthy();

    // Open the dropdown.
    const toggle = within(wrap).getAllByRole('button')[0];
    fireEvent.click(toggle);

    // The view row is listed.
    const viewBtn = within(wrap)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'החודש שלי');
    expect(viewBtn).toBeTruthy();

    fireEvent.click(viewBtn!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const applied = onChange.mock.calls[0][0] as F;
    expect(applied.preset).toBe('this_month');
    expect(applied.store).toBe('uzoshop');
    // Range re-derived for the CURRENT month, not the stale stored one.
    expect(applied.range).toEqual(computePresetRange('this_month'));
    expect(applied.range).not.toEqual(staleRange);
  });

  it('restores the saved compareBaseline when applying a non-custom view', () => {
    // Seed a relative view that ALSO carries a compare baseline. Applying it
    // must restore that baseline (not silently reset to prev_period).
    saveView('עם בסיס השוואה', {
      preset: 'this_month',
      range: { from: '2020-01-01', to: '2020-01-31' },
      store: 'uzoshop',
      compareBaseline: 'prev_month',
    });

    const onChange = vi.fn();
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={onChange} showSavedViews />,
    );
    const wrap = container.querySelector('[data-testid="filters-savedviews"]') as HTMLElement;
    fireEvent.click(within(wrap).getAllByRole('button')[0]);
    const viewBtn = within(wrap)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'עם בסיס השוואה');
    fireEvent.click(viewBtn!);

    const applied = onChange.mock.calls[0][0] as F;
    expect(applied.preset).toBe('this_month');
    expect(applied.store).toBe('uzoshop');
    expect(applied.range).toEqual(computePresetRange('this_month'));
    expect(applied.compareBaseline).toBe('prev_month');
  });

  it('applies a custom view UNCHANGED (no range re-derivation)', () => {
    const customRange = { from: '2024-03-01', to: '2024-03-15' };
    saveView('רבעון מותאם', {
      preset: 'custom',
      range: customRange,
      store: 'All',
    });

    const onChange = vi.fn();
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={onChange} showSavedViews />,
    );
    const wrap = container.querySelector('[data-testid="filters-savedviews"]') as HTMLElement;
    fireEvent.click(within(wrap).getAllByRole('button')[0]);
    const viewBtn = within(wrap)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'רבעון מותאם');
    fireEvent.click(viewBtn!);
    const applied = onChange.mock.calls[0][0] as F;
    expect(applied.preset).toBe('custom');
    expect(applied.range).toEqual(customRange);
  });

  it('typing a name and clicking save persists the current filters', () => {
    const { container } = render(
      <Filters
        filters={{ ...baseFilters('last_7_days'), store: 'usmile360' }}
        stores={STORES}
        onChange={() => {}}
        showSavedViews
      />,
    );
    const wrap = container.querySelector('[data-testid="filters-savedviews"]') as HTMLElement;
    fireEvent.click(within(wrap).getAllByRole('button')[0]);

    const input = within(wrap).getByPlaceholderText('שם לתצוגה הנוכחית');
    fireEvent.change(input, { target: { value: 'שבוע אחרון' } });

    const saveBtn = within(wrap)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'שמור תצוגה');
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn!);

    const persisted = readSavedViews();
    const names = Object.values(persisted.views).map((v) => v.name);
    expect(names).toContain('שבוע אחרון');
    const saved = Object.values(persisted.views).find((v) => v.name === 'שבוע אחרון');
    expect(saved!.filters.preset).toBe('last_7_days');
    expect(saved!.filters.store).toBe('usmile360');
  });
});

describe('Wave 4 — defaults render none of the new UI', () => {
  it('renders neither the compare row nor the saved-views dropdown by default', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    expect(container.querySelector('[data-testid="filters-compare-row"]')).toBeNull();
    expect(container.querySelector('[data-testid="filters-savedviews"]')).toBeNull();
  });
});

// Horizon re-skin Wave 2 (2026-06-13) — both the quick-range toggle and the
// compare-basis row now adopt the shared <SegmentedControl> primitive. This
// block asserts the structural migration (both rails are role="radiogroup")
// AND that changing a segment fires the SAME onChange contract the page wires
// to the URL/state effect (preset+range for quick-range, compareBaseline for
// compare-basis) — i.e. the re-skin did not alter the data flow.
describe('Wave 2 re-skin — quick-range + compare-basis adopt SegmentedControl', () => {
  it('renders the quick-range rail as a role=radiogroup SegmentedControl', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    const seg = container.querySelector('[data-testid="filters-quickrange"]');
    expect(seg).toBeTruthy();
    expect(seg!.getAttribute('role')).toBe('radiogroup');
    expect(within(seg as HTMLElement).getAllByRole('radio')).toHaveLength(4);
  });

  it('renders the compare-basis rail as a role=radiogroup SegmentedControl', () => {
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={() => {}}
        showCompareBaseline
      />,
    );
    const seg = container.querySelector('[data-testid="filters-compare-seg"]');
    expect(seg).toBeTruthy();
    expect(seg!.getAttribute('role')).toBe('radiogroup');
    expect(within(seg as HTMLElement).getAllByRole('radio')).toHaveLength(5);
  });

  it('changing a quick-range segment fires onChange with preset + recomputed range (same as pre-W2)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Filters filters={baseFilters('today')} stores={STORES} onChange={onChange} />,
    );
    const seg = container.querySelector('[data-testid="filters-quickrange"]') as HTMLElement;
    const sevenDays = within(seg)
      .getAllByRole('radio')
      .find((b) => b.textContent?.trim() === '7 ימים'); // short label for last_7_days
    expect(sevenDays).toBeTruthy();
    fireEvent.click(sevenDays!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.preset).toBe('last_7_days');
    // Same selectPreset contract that the page's URL/state effect consumes.
    expect(next.range).toEqual(computePresetRange('last_7_days'));
  });

  it('changing a compare-basis segment fires onChange with the new compareBaseline (same as pre-W2)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Filters
        filters={baseFilters()}
        stores={STORES}
        onChange={onChange}
        showCompareBaseline
      />,
    );
    const seg = container.querySelector('[data-testid="filters-compare-seg"]') as HTMLElement;
    const none = within(seg)
      .getAllByRole('radio')
      .find((b) => b.textContent?.trim() === COMPARE_BASELINE_LABELS.none);
    expect(none).toBeTruthy();
    fireEvent.click(none!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.compareBaseline).toBe('none');
  });
});
