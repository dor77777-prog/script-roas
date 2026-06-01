import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline legibility', () => {
  it('renders a casing (under-stroke) path plus the colored stroke when onBand', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} tone="green" onBand />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2); // casing + data line
  });
  it('paints a plot scrim rect behind the line when onBand', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="green" onBand />);
    expect(container.querySelector('rect')).toBeTruthy();
  });
  it('stays a single path with no scrim when NOT on a band', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="green" />);
    expect(container.querySelectorAll('path').length).toBe(1);
    expect(container.querySelector('rect')).toBeNull();
  });
  it('keeps role=img + aria-label', () => {
    const { container } = render(<Sparkline data={[1, 2]} tone="blue" onBand />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('טרנד');
  });
});
