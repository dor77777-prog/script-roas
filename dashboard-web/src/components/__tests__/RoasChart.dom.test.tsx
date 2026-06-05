// dashboard-web/src/components/__tests__/RoasChart.dom.test.tsx
//
// DOM contract test for the Trends-tab <RoasChart> annotation pins.
//
// The Trends chart now renders the SAME annotation pins as the hero
// RoasTargetChart, via the shared <ChartAnnotationPins> primitive. These
// tests pin:
//   (a) given in-range annotations + a `range`, a pin renders for each one
//   (b) clicking a pin opens its tooltip (hover-and-click contract)
//   (c) WITHOUT a `range` prop, no pins render (back-compat for callers
//       that don't thread filter scope)
//   (d) an annotation OUTSIDE the active range is not rendered
//
// Recharts renders 0-width in jsdom, but the pin overlay is HTML positioned
// independently of the plot geometry — so the pins assert cleanly here.

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoasChart } from '@/components/RoasChart';
import { writeAnnotations, type Annotation } from '@/lib/annotations';
import type { DailySeries } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';

function series(): DailySeries[] {
  return [
    { date: '2026-05-01', byStore: { uzoshop: 3.1 }, totalRoas: 3.1, totalRevenue: 1000, totalSpend: 320 },
    { date: '2026-05-02', byStore: { uzoshop: 2.8 }, totalRoas: 2.8, totalRevenue: 900, totalSpend: 320 },
    { date: '2026-05-03', byStore: { uzoshop: 2.4 }, totalRoas: 2.4, totalRevenue: 800, totalSpend: 330 },
    { date: '2026-05-04', byStore: { uzoshop: 2.1 }, totalRoas: 2.1, totalRevenue: 700, totalSpend: 330 },
  ];
}

const RANGE = { from: '2026-05-01', to: '2026-05-04' };

function annotation(over: Partial<Annotation>): Annotation {
  return {
    id: 'ann-1',
    date: '2026-05-02',
    kind: 'launch',
    title: 'השקת מבצע חורף',
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  // Each test starts from a clean annotation store.
  writeAnnotations([]);
});

describe('<RoasChart> annotation pins', () => {
  it('renders a pin for each in-range annotation when range is provided', () => {
    writeAnnotations([
      annotation({ id: 'a-1', date: '2026-05-02', title: 'השקה' }),
      annotation({ id: 'a-2', date: '2026-05-04', kind: 'budget', title: 'תקציב' }),
    ]);

    render(
      <RoasChart data={series()} stores={['uzoshop']} rows={[] as DailyRow[]} range={RANGE} bare />,
    );

    expect(screen.getByTestId('chart-pin-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('chart-pin-a-2')).toBeInTheDocument();
  });

  it('clicking a pin opens its tooltip', () => {
    writeAnnotations([annotation({ id: 'a-1', date: '2026-05-02', title: 'השקה' })]);

    render(
      <RoasChart data={series()} stores={['uzoshop']} rows={[] as DailyRow[]} range={RANGE} bare />,
    );

    expect(screen.queryByTestId('chart-pin-tooltip-a-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chart-pin-a-1'));
    expect(screen.getByTestId('chart-pin-tooltip-a-1')).toBeInTheDocument();
  });

  it('renders no pins when no range prop is provided (back-compat)', () => {
    writeAnnotations([annotation({ id: 'a-1', date: '2026-05-02', title: 'השקה' })]);

    render(<RoasChart data={series()} stores={['uzoshop']} rows={[] as DailyRow[]} bare />);

    expect(screen.queryByTestId('chart-pin-a-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-annotation-pins')).not.toBeInTheDocument();
  });

  it('does not render an annotation outside the active range', () => {
    writeAnnotations([
      annotation({ id: 'in', date: '2026-05-02', title: 'בטווח' }),
      annotation({ id: 'out', date: '2026-06-30', title: 'מחוץ לטווח' }),
    ]);

    render(
      <RoasChart data={series()} stores={['uzoshop']} rows={[] as DailyRow[]} range={RANGE} bare />,
    );

    expect(screen.getByTestId('chart-pin-in')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-pin-out')).not.toBeInTheDocument();
  });
});
