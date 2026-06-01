import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CountUp } from '../CountUp';
import { Money } from '../Money';

/**
 * The DOM test runner reports `prefers-reduced-motion: reduce` (see
 * setup-dom.ts), so count-ups render their FINAL value synchronously. These
 * tests therefore assert the settled output + the placeholder / a11y contract
 * — the easing progression itself is covered by useCountUp.dom.test.tsx.
 */
describe('<CountUp>', () => {
  it('renders the formatted final value (reduced-motion → no climb)', () => {
    const { container } = render(
      <CountUp value={3.45} format={(n) => `${n.toFixed(2)}x`} />,
    );
    expect(container.textContent).toBe('3.45x');
  });

  it('null value → em-dash placeholder', () => {
    const { container } = render(
      <CountUp value={null} format={(n) => `${n.toFixed(2)}x`} />,
    );
    expect(container.textContent).toBe('—');
  });
});

describe('<Money countUp>', () => {
  it('renders the final amount with the same formatting as static <Money>', () => {
    const { container } = render(
      <Money value={1172} prefix="$" countUp />,
    );
    expect(container.textContent).toContain('$1,172');
  });

  it('keeps the EXACT value in title + sr-only when compacted (a11y intact)', () => {
    const { container } = render(
      <Money value={2_400_000} prefix="$" compactAbove={1_000_000} countUp />,
    );
    const bdi = container.querySelector('bdi');
    // Painted text is the bounded compact token; the exact value is recoverable.
    expect(bdi?.getAttribute('title')).toBe('$2,400,000');
    expect(container.querySelector('.sr-only')?.textContent).toBe('$2,400,000');
  });

  it('null value → em-dash, no animation', () => {
    const { container } = render(<Money value={null} prefix="$" countUp />);
    expect(container.textContent).toBe('—');
  });
});
