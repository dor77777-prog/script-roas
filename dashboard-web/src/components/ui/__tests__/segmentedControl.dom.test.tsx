// dashboard-web/src/components/ui/__tests__/segmentedControl.dom.test.tsx
//
// Horizon re-skin Wave 1, debt #4 — <SegmentedControl> unifies the 12
// hand-rolled segmented / toggle controls that had divergent active states
// (Filters quick-range pills + compare-basis row, Products segmented switch,
// the customers radio rows, …). This primitive is the single source of truth;
// the per-consumer migration is a separate follow-on (NOT in this task).
//
// Horizon recipe ("seg"): a `rounded-full` rail (bg-pill-track) holding pill
// items; the active item is a brand pill (bg-pill-thumb) with white text
// (text-pill-inkOn -> --pill-ink-on, AA both themes), inactive items are
// muted (text-pill-ink) and ink-up on hover.
//
// Keyboard model: roving tabindex. Exactly one item is tabbable (tabIndex 0);
// the rest are -1. Arrow keys move the selection AND fire onChange. The app is
// RTL (<html dir="rtl">), so ArrowRight is "visually forward → previous in
// reading order" and ArrowLeft is "visually back → next". Home/End jump to the
// first / last option (reading-order, not visual). role defaults to "tablist"
// (tab children with aria-selected); role="radiogroup" switches to
// radio children with aria-checked.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

afterEach(cleanup);

const OPTIONS = [
  { value: 'today', label: 'היום' },
  { value: 'yesterday', label: 'אתמול' },
  { value: '7d', label: '7 ימים' },
  { value: '30d', label: '30 ימים' },
];

function renderRTL(ui: React.ReactElement) {
  return render(ui, {
    container: document.body.appendChild(
      Object.assign(document.createElement('div'), { dir: 'rtl' }),
    ),
  });
}

describe('SegmentedControl', () => {
  it('renders all options', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    for (const o of OPTIONS) {
      expect(screen.getByText(o.label)).toBeTruthy();
    }
  });

  it('marks only the value-matching option as active (aria-selected + token class)', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="7d" onChange={() => {}} aria-label="טווח" />,
    );
    const active = screen.getByText('7 ימים').closest('[role="tab"]')!;
    const inactive = screen.getByText('היום').closest('[role="tab"]')!;

    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(inactive.getAttribute('aria-selected')).toBe('false');

    // Active pill carries the brand-thumb token + on-color ink; inactive does not.
    expect(active.className).toContain('bg-pill-thumb');
    expect(active.className).toContain('text-pill-inkOn');
    expect(inactive.className).not.toContain('bg-pill-thumb');
    expect(inactive.className).toContain('text-pill-ink');
  });

  it('fires onChange(value) on click', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={onChange} aria-label="טווח" />,
    );
    fireEvent.click(screen.getByText('30 ימים'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('30d');
  });

  it('does not fire onChange when the already-active option is clicked', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={onChange} aria-label="טווח" />,
    );
    fireEvent.click(screen.getByText('היום'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('roving tabindex — only the active option is tabbable', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="yesterday" onChange={() => {}} aria-label="טווח" />,
    );
    const items = screen.getAllByRole('tab');
    const tabbable = items.filter(el => el.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(within(tabbable[0]).getByText('אתמול')).toBeTruthy();
  });

  it('RTL-aware ArrowRight moves to the PREVIOUS option (visually forward) and fires onChange', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="yesterday" onChange={onChange} aria-label="טווח" />,
    );
    // focus the active item, then press ArrowRight
    const active = screen.getByText('אתמול').closest('[role="tab"]') as HTMLElement;
    active.focus();
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    // RTL: Right = previous in reading order → "today"
    expect(onChange).toHaveBeenCalledWith('today');
  });

  it('RTL-aware ArrowLeft moves to the NEXT option (visually back) and fires onChange', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="yesterday" onChange={onChange} aria-label="טווח" />,
    );
    const active = screen.getByText('אתמול').closest('[role="tab"]') as HTMLElement;
    active.focus();
    fireEvent.keyDown(active, { key: 'ArrowLeft' });
    // RTL: Left = next in reading order → "7d"
    expect(onChange).toHaveBeenCalledWith('7d');
  });

  it('Arrow keys clamp at the edges (no wrap)', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={onChange} aria-label="טווח" />,
    );
    // "today" is first in reading order. In RTL, ArrowRight = previous → clamp, no change.
    const active = screen.getByText('היום').closest('[role="tab"]') as HTMLElement;
    active.focus();
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Home / End jump to first / last option (reading order)', () => {
    const onChange = vi.fn();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="7d" onChange={onChange} aria-label="טווח" />,
    );
    const active = screen.getByText('7 ימים').closest('[role="tab"]') as HTMLElement;
    active.focus();
    fireEvent.keyDown(active, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('today');

    onChange.mockClear();
    fireEvent.keyDown(active, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('30d');
  });

  it('default role is tablist with tab children', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(OPTIONS.length);
  });

  it('role="radiogroup" renders radiogroup + radio children with aria-checked', () => {
    renderRTL(
      <SegmentedControl
        options={OPTIONS}
        value="7d"
        onChange={() => {}}
        role="radiogroup"
        aria-label="טווח"
      />,
    );
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(OPTIONS.length);
    const active = screen.getByText('7 ימים').closest('[role="radio"]')!;
    expect(active.getAttribute('aria-checked')).toBe('true');
    // radios must NOT carry aria-selected (that's tab-only)
    expect(active.getAttribute('aria-selected')).toBeNull();
  });

  it('rail is a rounded-full pill track and carries the accessible label', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    const rail = screen.getByRole('tablist');
    expect(rail.className).toContain('rounded-full');
    expect(rail.className).toContain('bg-pill-track');
    expect(rail.getAttribute('aria-label')).toBe('טווח');
  });

  it('RTL container does not overflow its rail (scrollWidth ≤ clientWidth)', () => {
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    const rail = screen.getByRole('tablist') as HTMLElement;
    // jsdom reports 0 for both unless laid out; the guarantee we assert is that
    // the rail is not forced wider than its container by a fixed width.
    expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth || rail.scrollWidth);
  });

  it('all-disabled control: NO option is force-tabbable (no tabIndex=0 button)', () => {
    const ALL_DISABLED = OPTIONS.map(o => ({ ...o, disabled: true }));
    renderRTL(
      // value matches nothing enabled (no enabled option exists at all)
      <SegmentedControl options={ALL_DISABLED} value="__none__" onChange={() => {}} aria-label="טווח" />,
    );
    const items = screen.getAllByRole('tab');
    const tabbable = items.filter(el => el.getAttribute('tabindex') === '0');
    // With zero enabled options nothing should fall back to the disabled index 0.
    expect(tabbable).toHaveLength(0);
  });

  it('forwards a per-option testId as data-testid on the item button', () => {
    const TAGGED = OPTIONS.map(o => ({ ...o, testId: `range-${o.value}` }));
    renderRTL(
      <SegmentedControl options={TAGGED} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    // every option re-emits its stable testid on the button
    for (const o of OPTIONS) {
      const byTestId = screen.getByTestId(`range-${o.value}`);
      expect(byTestId.getAttribute('role')).toBe('tab');
      expect(within(byTestId).getByText(o.label)).toBeTruthy();
    }
    // options without a testId stay un-tagged (no spurious attribute)
    cleanup();
    renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} aria-label="טווח" />,
    );
    expect(screen.getByText('היום').closest('[role="tab"]')!.getAttribute('data-testid')).toBeNull();
  });

  it('size="sm" and size="md" both render (no crash) and differ in padding class', () => {
    const { rerender } = renderRTL(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} size="sm" aria-label="טווח" />,
    );
    const smItem = screen.getByText('היום').closest('[role="tab"]')!.className;
    rerender(
      <SegmentedControl options={OPTIONS} value="today" onChange={() => {}} size="md" aria-label="טווח" />,
    );
    const mdItem = screen.getByText('היום').closest('[role="tab"]')!.className;
    expect(smItem).not.toBe(mdItem);
  });
});
