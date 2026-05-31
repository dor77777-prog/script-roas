import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '../ChartTooltip';

describe('ChartTooltip', () => {
  it('renders an RTL container with elevated background', () => {
    const { container } = render(
      <ChartTooltip>
        <ChartTooltipLabel>2026-05-29</ChartTooltipLabel>
      </ChartTooltip>,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.getAttribute('dir')).toBe('rtl');
    expect(card.className).toMatch(/bg-glass-1/);
  });

  it('renders label, row, and value text content', () => {
    render(
      <ChartTooltip>
        <ChartTooltipLabel>2026-05-29</ChartTooltipLabel>
        <ChartTooltipRow color="#16a34a" label="uzoshop">
          <ChartTooltipValue>2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    expect(screen.getByText('2026-05-29')).toBeInTheDocument();
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('2.85')).toBeInTheDocument();
  });

  it('applies font-mono to numeric values for 2026 vocab compliance', () => {
    render(
      <ChartTooltip>
        <ChartTooltipRow color="#16a34a" label="uzoshop">
          <ChartTooltipValue data-testid="val">2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    const val = screen.getByTestId('val');
    expect(val.className).toMatch(/font-mono/);
  });

  it('row swatch uses the color prop as inline backgroundColor', () => {
    const { container } = render(
      <ChartTooltip>
        <ChartTooltipRow color="rgb(22, 163, 74)" label="uzoshop">
          <ChartTooltipValue>2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    const swatch = container.querySelector('[data-swatch="true"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(22, 163, 74)');
  });
});
