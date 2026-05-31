import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageSynthesis } from '../PageSynthesis';

describe('PageSynthesis primitive', () => {
  it('renders nothing when text is empty', () => {
    const { container } = render(<PageSynthesis text="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the sentence with role="status" and aria-live="polite"', () => {
    render(<PageSynthesis text="ROAS עלה 12% ב-30 הימים האחרונים." />);
    const node = screen.getByRole('status');
    expect(node).toBeInTheDocument();
    expect(node).toHaveAttribute('aria-live', 'polite');
    expect(node).toHaveTextContent('ROAS עלה 12% ב-30 הימים האחרונים.');
  });

  it('applies opacity-60 when confidence is "low"', () => {
    render(<PageSynthesis text="ROAS יציב סביב 2.8." confidence="low" />);
    const node = screen.getByRole('status');
    expect(node.className).toMatch(/opacity-60/);
  });

  it('does NOT apply opacity-60 when confidence is "high"', () => {
    render(<PageSynthesis text="ROAS יציב סביב 2.8." confidence="high" />);
    const node = screen.getByRole('status');
    expect(node.className).not.toMatch(/opacity-60/);
  });

  it('merges user className via cn()', () => {
    render(<PageSynthesis text="hello" className="mt-10" />);
    const node = screen.getByRole('status');
    expect(node.className).toMatch(/mt-10/);
  });

  it('exposes [data-page-synthesis] for downstream styling/queries', () => {
    const { container } = render(<PageSynthesis text="hello" />);
    expect(container.querySelector('[data-page-synthesis]')).not.toBeNull();
  });
});
