import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartLegend, ChartLegendItem } from '../ChartLegend';

describe('ChartLegend', () => {
  it('renders all legend items', () => {
    render(
      <ChartLegend>
        <ChartLegendItem color="#16a34a" label="uzoshop" />
        <ChartLegendItem color="#1c4587" label="Zol Plus" />
        <ChartLegendItem color="#d97706" label="360usmile" />
      </ChartLegend>,
    );
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('Zol Plus')).toBeInTheDocument();
    expect(screen.getByText('360usmile')).toBeInTheDocument();
  });

  it('item swatch uses the color prop as inline backgroundColor', () => {
    const { container } = render(
      <ChartLegend>
        <ChartLegendItem color="rgb(22, 163, 74)" label="uzoshop" />
      </ChartLegend>,
    );
    const swatch = container.querySelector('[data-swatch="true"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(22, 163, 74)');
  });

  it('uses flex-wrap so long legends wrap on narrow viewports', () => {
    const { container } = render(
      <ChartLegend>
        <ChartLegendItem color="#000" label="a" />
      </ChartLegend>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/flex-wrap/);
  });
});
