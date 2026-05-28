import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuadrantScatter, type QuadrantPoint } from '../QuadrantScatter';

const POINTS: QuadrantPoint[] = [
  { name: 'A', roas: 1.5, cac: 80, spend: 1000 },
  { name: 'B', roas: 3.2, cac: 25, spend: 1500 },
  { name: 'C', roas: 2.0, cac: 50, spend: 800 },
  { name: 'D', roas: 4.5, cac: 12, spend: 2200 },
];

describe('QuadrantScatter', () => {
  it('renders without crashing on empty data', () => {
    expect(() => render(<QuadrantScatter data={[]} />)).not.toThrow();
  });

  it('renders the title when one is provided', () => {
    render(<QuadrantScatter data={POINTS} title="ROAS × CAC" />);
    expect(screen.getByText('ROAS × CAC')).toBeInTheDocument();
  });

  it('renders an empty-state message when data is empty', () => {
    render(<QuadrantScatter data={[]} />);
    expect(screen.getByText(/אין נתונים|לא נמצאו קמפיינים/)).toBeInTheDocument();
  });

  it('accepts a custom height prop', () => {
    const { container } = render(<QuadrantScatter data={POINTS} height={300} />);
    expect(container.firstChild).not.toBeNull();
  });
});
