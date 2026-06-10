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

describe('Sparkline flat-series centering (c/HI-05 — 2026-06-10 audit)', () => {
  // The old inline math (`range = max - min || 1`) glued an all-equal series
  // to the BOTTOM of the box — a constant ROAS read as "crashed to zero".
  // Routed through computeSparklineGeometry: degenerate range → vertical center.
  it('renders an all-equal series at the vertical CENTER (y ≈ height/2), not the bottom', () => {
    const height = 16;
    const { container } = render(
      <Sparkline data={[3, 3, 3, 3]} width={60} height={height} tone="green" />,
    );
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    // Every y coordinate in the path must be height/2.
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeCloseTo(height / 2, 1);
      expect(y).not.toBeCloseTo(height, 1); // the old bug: pinned to bottom
    }
  });

  it('keeps a non-flat series spanning the full box (regression)', () => {
    const height = 16;
    const { container } = render(
      <Sparkline data={[1, 5]} width={60} height={height} tone="green" />,
    );
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeCloseTo(0, 1);      // max value at top
    expect(Math.max(...ys)).toBeCloseTo(height, 1); // min value at bottom
  });
});
