// dashboard-web/src/components/ui/__tests__/ChartAnnotationPins.test.tsx
//
// Contract tests for the shared <ChartAnnotationPins> overlay primitive.
//
// What this pins:
//   (a) renders one pin button per in-range annotation
//   (b) drops pins whose date isn't on the axis (out-of-range)
//   (c) initial state: NO tooltip (hover-and-click only)
//   (d) clicking a pin opens its tooltip; clicking outside the overlay closes it
//   (e) hover (mouseenter) opens the tooltip
//   (f) tooltip surfaces the optional value context (valueForDate)
//   (g) renders nothing when no pins are in range
//   (h) showGuides draws a per-pin guide line

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  ChartAnnotationPins,
  type ChartAnnotationPin,
} from '@/components/ui/ChartAnnotationPins';

const DATES = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'];

function pins(): ChartAnnotationPin[] {
  return [
    { id: 'launch-1', date: '2026-05-02', icon: '✨', label: 'השקת מבצע' },
    { id: 'budget-1', date: '2026-05-04', label: 'העלאת תקציב' },
  ];
}

// Even spread so each index maps to a deterministic %.
function leftPct(i: number) {
  return DATES.length <= 1 ? 50 : (i / (DATES.length - 1)) * 100;
}

describe('<ChartAnnotationPins>', () => {
  it('renders one pin button per in-range annotation', () => {
    render(
      <ChartAnnotationPins pins={pins()} dates={DATES} leftPctForIndex={leftPct} />,
    );
    expect(screen.getByTestId('chart-pin-launch-1')).toBeInTheDocument();
    expect(screen.getByTestId('chart-pin-budget-1')).toBeInTheDocument();
  });

  it('drops pins whose date is not on the axis', () => {
    const offAxis: ChartAnnotationPin[] = [
      { id: 'in', date: '2026-05-02', label: 'בתוך הטווח' },
      { id: 'out', date: '2026-12-25', label: 'מחוץ לטווח' },
    ];
    render(
      <ChartAnnotationPins pins={offAxis} dates={DATES} leftPctForIndex={leftPct} />,
    );
    expect(screen.getByTestId('chart-pin-in')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-pin-out')).not.toBeInTheDocument();
  });

  it('initial render shows NO tooltip', () => {
    render(
      <ChartAnnotationPins pins={pins()} dates={DATES} leftPctForIndex={leftPct} />,
    );
    expect(
      screen.queryByTestId('chart-pin-tooltip-launch-1'),
    ).not.toBeInTheDocument();
  });

  it('clicking a pin opens its tooltip; clicking outside closes it', () => {
    render(
      <div>
        <ChartAnnotationPins pins={pins()} dates={DATES} leftPctForIndex={leftPct} />
        <div data-testid="outside">outside</div>
      </div>,
    );

    fireEvent.click(screen.getByTestId('chart-pin-launch-1'));
    expect(
      screen.getByTestId('chart-pin-tooltip-launch-1'),
    ).toBeInTheDocument();

    act(() => {
      const evt = new Event('pointerdown', { bubbles: true });
      screen.getByTestId('outside').dispatchEvent(evt);
    });
    expect(
      screen.queryByTestId('chart-pin-tooltip-launch-1'),
    ).not.toBeInTheDocument();
  });

  it('hover (mouseenter) opens the tooltip', () => {
    render(
      <ChartAnnotationPins pins={pins()} dates={DATES} leftPctForIndex={leftPct} />,
    );
    fireEvent.mouseEnter(screen.getByTestId('chart-pin-budget-1'));
    expect(
      screen.getByTestId('chart-pin-tooltip-budget-1'),
    ).toBeInTheDocument();
  });

  it('tooltip surfaces the optional value context', () => {
    const valueForDate = vi.fn((d: string) => (d === '2026-05-02' ? 2.84 : null));
    render(
      <ChartAnnotationPins
        pins={pins()}
        dates={DATES}
        leftPctForIndex={leftPct}
        valueForDate={valueForDate}
        valueLabel="ROAS"
      />,
    );
    fireEvent.click(screen.getByTestId('chart-pin-launch-1'));
    const tip = screen.getByTestId('chart-pin-tooltip-launch-1');
    expect(tip.textContent).toMatch(/ROAS\s*2\.84/);
  });

  it('renders nothing when no pins are in range', () => {
    const { container } = render(
      <ChartAnnotationPins
        pins={[{ id: 'x', date: '2030-01-01', label: 'x' }]}
        dates={DATES}
        leftPctForIndex={leftPct}
      />,
    );
    expect(
      screen.queryByTestId('chart-annotation-pins'),
    ).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('showGuides draws a per-pin guide line', () => {
    render(
      <ChartAnnotationPins
        pins={pins()}
        dates={DATES}
        leftPctForIndex={leftPct}
        showGuides
      />,
    );
    expect(screen.getByTestId('chart-pin-guide-launch-1')).toBeInTheDocument();
    expect(screen.getByTestId('chart-pin-guide-budget-1')).toBeInTheDocument();
  });
});
