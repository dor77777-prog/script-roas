// dashboard-web/src/components/__tests__/FiltersPills.dom.test.tsx
//
// Feature A3 (2026-06-01) originally covered the MOBILE-ONLY sliding range-pill
// bar inside <Filters>. Horizon re-skin Wave 2 (2026-06-13) REPLACED both the
// desktop featured-preset <Button> grid AND the mobile sliding-thumb pill bar
// with ONE shared <SegmentedControl> primitive (role="radiogroup", single
// rail that scrolls on narrow phones). These assertions were re-pointed from
// the old hand-rolled markup (data-testid="filters-pillbar" / sliding thumb /
// aria-pressed) to the SegmentedControl structure (role="radiogroup" with
// role="radio" children + aria-checked). The behaviour under test is identical:
// the 4 featured presets render (incl. 'אתמול'), clicking 'אתמול' fires
// onChange({preset:'yesterday'}) with the recomputed range, the segment
// matching filters.preset is marked active, and a non-featured (secondary)
// preset leaves NO segment selected.

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { Filters } from '@/components/Filters';
import { computePresetRange } from '@/lib/presets';
import type { Filters as F } from '@/lib/types';

const STORES = ['uzoshop', 'usmile360'];

function baseFilters(preset: F['preset'] = 'today'): F {
  return {
    preset,
    range: computePresetRange(preset),
    store: 'All',
  };
}

/** The quick-range rail is the SegmentedControl (role="radiogroup"). */
function quickRange(container: HTMLElement): HTMLElement {
  const seg = container.querySelector('[data-testid="filters-quickrange"]');
  if (!seg) throw new Error('filters-quickrange not found');
  return seg as HTMLElement;
}

describe('A3 / Wave-2 — quick-range SegmentedControl in <Filters>', () => {
  it('renders the 4 featured segments including אתמול via role=radiogroup/radio', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    const seg = quickRange(container);
    // W2 re-skin: SegmentedControl rail is a radiogroup with radio children.
    expect(seg.getAttribute('role')).toBe('radiogroup');
    const radios = within(seg).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    const labels = radios.map((b) => b.textContent?.trim());
    // 'היום' + 'אתמול' kept verbatim; the two long labels may be shortened.
    expect(labels).toContain('היום');
    expect(labels).toContain('אתמול');
  });

  it("clicking the אתמול segment calls onChange with preset === 'yesterday'", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Filters filters={baseFilters('today')} stores={STORES} onChange={onChange} />,
    );
    const seg = quickRange(container);
    // W2 re-skin: segments are role="radio" (was aria-pressed <Button>).
    const yesterday = within(seg)
      .getAllByRole('radio')
      .find((b) => b.textContent?.trim() === 'אתמול');
    expect(yesterday).toBeTruthy();
    fireEvent.click(yesterday!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.preset).toBe('yesterday');
    // Range is recomputed exactly like selectPreset — unchanged from pre-W2.
    expect(next.range).toEqual(computePresetRange('yesterday'));
  });

  it('marks the segment matching filters.preset as active (aria-checked + on-thumb ink)', () => {
    const { container } = render(
      <Filters filters={baseFilters('this_month')} stores={STORES} onChange={() => {}} />,
    );
    const seg = quickRange(container);
    const radios = within(seg).getAllByRole('radio');
    // W2 re-skin: active state is aria-checked (radiogroup) not aria-pressed.
    const active = radios.filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(active).toHaveLength(1);
    // 'מתחילת החודש' shortened to 'מהחודש' on the segment label.
    expect(active[0].textContent?.trim()).toBe('מהחודש');
    // On-thumb ink token (white-on-brand, AA-locked) is applied to the active.
    expect(active[0].className).toContain('text-pill-inkOn');
  });

  it('renders a single unified rail (no separate desktop grid / mobile pill bar)', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    // W2 re-skin: the legacy hidden-md desktop grid + md:hidden pill bar were
    // collapsed into ONE SegmentedControl, so those testids no longer exist.
    expect(container.querySelector('[data-testid="filters-featured-desktop"]')).toBeNull();
    expect(container.querySelector('[data-testid="filters-pillbar"]')).toBeNull();
    expect(container.querySelector('[data-testid="filters-pill-thumb"]')).toBeNull();
    // The unified rail is present exactly once.
    expect(container.querySelectorAll('[data-testid="filters-quickrange"]')).toHaveLength(1);
  });

  it('leaves NO segment selected when filters.preset is a non-featured (secondary) preset', () => {
    const { container } = render(
      <Filters filters={baseFilters('last_30_days')} stores={STORES} onChange={() => {}} />,
    );
    const seg = quickRange(container);
    // W2 re-skin: value='' when the active preset isn't featured →
    // SegmentedControl marks nothing checked (mirrors the old hidden thumb).
    const active = within(seg)
      .getAllByRole('radio')
      .filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(active).toHaveLength(0);
  });
});
