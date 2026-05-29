import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline primitive', () => {
  it('renders an svg with a single polyline path for the given series', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} width={60} height={16} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders nothing meaningful for empty series', () => {
    const { container } = render(<Sparkline data={[]} width={60} height={16} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
