// dashboard-web/src/components/__tests__/FiltersPills.dom.test.tsx
//
// Feature A3 (2026-06-01) — MOBILE-ONLY sliding range-pill bar inside
// <Filters>. Desktop (md+) is frozen: the featured-preset <Button> grid is
// wrapped `hidden md:flex`, and the pill bar carries `md:hidden`. These tests
// assert the mobile pill behaviour (the 4 featured presets incl. 'אתמול',
// clicking 'אתמול' fires onChange({preset:'yesterday'}), and the pill matching
// filters.preset is marked active).

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

/** The pill bar is the md:hidden container that holds the 4 featured pills. */
function pillBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('[data-testid="filters-pillbar"]');
  if (!bar) throw new Error('filters-pillbar not found');
  return bar as HTMLElement;
}

describe('A3 — mobile sliding range-pills in <Filters>', () => {
  it('renders the 4 featured pills including אתמול', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    const bar = pillBar(container);
    const buttons = within(bar).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    const labels = buttons.map((b) => b.textContent?.trim());
    // 'היום' + 'אתמול' kept verbatim; the two long labels may be shortened.
    expect(labels).toContain('היום');
    expect(labels).toContain('אתמול');
  });

  it("clicking the אתמול pill calls onChange with preset === 'yesterday'", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Filters filters={baseFilters('today')} stores={STORES} onChange={onChange} />,
    );
    const bar = pillBar(container);
    const yesterday = within(bar)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'אתמול');
    expect(yesterday).toBeTruthy();
    fireEvent.click(yesterday!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as F;
    expect(next.preset).toBe('yesterday');
    // Range is recomputed exactly like selectPreset.
    expect(next.range).toEqual(computePresetRange('yesterday'));
  });

  it('marks the pill matching filters.preset as active (aria-pressed + on-thumb ink)', () => {
    const { container } = render(
      <Filters filters={baseFilters('this_month')} stores={STORES} onChange={() => {}} />,
    );
    const bar = pillBar(container);
    const buttons = within(bar).getAllByRole('button');
    const active = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(active).toHaveLength(1);
    // 'מתחילת החודש' shortened to 'מהחודש' on the pill.
    expect(active[0].textContent?.trim()).toBe('מהחודש');
  });

  it('keeps the desktop featured-preset grid wrapped hidden md:flex (frozen at md+)', () => {
    const { container } = render(
      <Filters filters={baseFilters()} stores={STORES} onChange={() => {}} />,
    );
    // Desktop wrapper present and hidden below md.
    const desktop = container.querySelector('[data-testid="filters-featured-desktop"]');
    expect(desktop).toBeTruthy();
    expect(desktop!.className).toContain('hidden');
    expect(desktop!.className).toContain('md:flex');
    // Pill bar is mobile-only.
    expect(pillBar(container).className).toContain('md:hidden');
  });

  it('shows no active thumb when filters.preset is a non-featured (secondary) preset', () => {
    const { container } = render(
      <Filters filters={baseFilters('last_30_days')} stores={STORES} onChange={() => {}} />,
    );
    const bar = pillBar(container);
    // No pill marked active.
    const active = within(bar)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(active).toHaveLength(0);
    // Thumb element is hidden when there is no active featured pill.
    const thumb = bar.querySelector('[data-testid="filters-pill-thumb"]') as HTMLElement | null;
    expect(thumb).toBeTruthy();
    expect(thumb!.getAttribute('aria-hidden')).toBe('true');
    expect(thumb!.style.opacity).toBe('0');
  });
});
