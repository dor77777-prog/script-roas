import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input primitive', () => {
  it('accepts user typing', async () => {
    render(<Input defaultValue="" aria-label="x" />);
    await userEvent.type(screen.getByLabelText('x'), 'hello');
    expect(screen.getByLabelText('x')).toHaveValue('hello');
  });

  it('defaults dir="auto" for text/search inputs (mixed Hebrew + English copy)', () => {
    render(<Input type="text" aria-label="text-field" />);
    expect(screen.getByLabelText('text-field')).toHaveAttribute('dir', 'auto');
  });

  it('defaults dir="auto" for search inputs', () => {
    render(<Input type="search" aria-label="search-field" />);
    expect(screen.getByLabelText('search-field')).toHaveAttribute('dir', 'auto');
  });

  it('does NOT default dir="auto" for date inputs (would be meaningless)', () => {
    render(<Input type="date" aria-label="date-field" />);
    expect(screen.getByLabelText('date-field')).not.toHaveAttribute('dir');
  });

  it('caller-supplied dir wins over the default', () => {
    render(<Input type="text" aria-label="ltr" dir="ltr" />);
    expect(screen.getByLabelText('ltr')).toHaveAttribute('dir', 'ltr');
  });

  it('renders prefix and suffix adornments', () => {
    render(
      <Input
        aria-label="amount"
        prefix={<span data-testid="prefix">$</span>}
        suffix={<span data-testid="suffix">%</span>}
      />,
    );
    expect(screen.getByTestId('prefix')).toBeInTheDocument();
    expect(screen.getByTestId('suffix')).toBeInTheDocument();
  });

  it('applies aria-invalid + red border when error is truthy', () => {
    render(<Input aria-label="bad" error="invalid" />);
    const input = screen.getByLabelText('bad');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toMatch(/border-status-red/);
  });

  it('renders error message text with role="alert"', () => {
    render(<Input aria-label="bad" error="חובה" />);
    expect(screen.getByRole('alert')).toHaveTextContent('חובה');
  });

  it('error={true} styles only — no alert text node', () => {
    render(<Input aria-label="bad" error />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('bad')).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes through to bare <input> for type=checkbox (no field styling)', () => {
    render(<Input type="checkbox" aria-label="cb" />);
    const cb = screen.getByLabelText('cb');
    // No h-9 / glass-1 surface — checkbox keeps its native chrome.
    expect(cb.className).not.toMatch(/bg-glass-1/);
    expect(cb.className).not.toMatch(/h-9/);
    expect(cb.getAttribute('type')).toBe('checkbox');
  });
});
