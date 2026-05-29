import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart, Line } from 'recharts';
import { ChartContainer } from '../ChartContainer';

const NOOP_DATA = [{ x: 0, y: 1 }, { x: 1, y: 2 }];

describe('ChartContainer', () => {
  it('renders the chart child inside a wrapper div', () => {
    const { container } = render(
      <ChartContainer height={200} data-testid="cc">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]');
    expect(wrapper).not.toBeNull();
  });

  it('applies the chart-surface CSS vars to the wrapper', () => {
    const { container } = render(
      <ChartContainer height={120} data-testid="cc">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]') as HTMLElement;
    const style = wrapper.getAttribute('style') || '';
    expect(style).toMatch(/--chart-grid/);
  });

  it('forwards arbitrary HTML attributes (data-testid, aria-label) to the wrapper', () => {
    const { container } = render(
      <ChartContainer height={120} data-testid="cc" aria-label="My chart">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]') as HTMLElement;
    expect(wrapper.getAttribute('aria-label')).toBe('My chart');
  });

  it('renders nothing crashy when given a height of 0', () => {
    expect(() =>
      render(
        <ChartContainer height={0}>
          <LineChart data={NOOP_DATA}>
            <Line dataKey="y" />
          </LineChart>
        </ChartContainer>,
      ),
    ).not.toThrow();
  });
});
