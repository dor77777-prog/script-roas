import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money } from '../Money';

describe('Money', () => {
  it('renders the full value when it fits', () => {
    render(<Money value={9840} />);
    expect(screen.getByText('$9,840')).toBeTruthy();
  });
  it('shows compact display but exposes the exact value in title + sr-only', () => {
    const { container } = render(<Money value={7_500_000} compactAbove={10_000} />);
    expect(screen.getByText('$7.5M')).toBeTruthy();
    const bdi = container.querySelector('bdi');
    expect(bdi?.getAttribute('title')).toBe('$7,500,000');
    expect(container.querySelector('.sr-only')?.textContent).toBe('$7,500,000');
  });
  it('never renders an ellipsis character', () => {
    const { container } = render(<Money value={1_234_567} compactAbove={10_000} />);
    expect(container.textContent).not.toMatch(/…/);
  });
  it('wraps the number in <bdi dir="ltr"> for RTL safety', () => {
    const { container } = render(<Money value={1500} />);
    expect(container.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
  });
});
