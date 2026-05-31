import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '../Textarea';

describe('Textarea primitive', () => {
  it('accepts user typing', async () => {
    render(<Textarea aria-label="notes" />);
    await userEvent.type(screen.getByLabelText('notes'), 'one two');
    expect(screen.getByLabelText('notes')).toHaveValue('one two');
  });

  it('defaults dir="auto" for mixed Hebrew + English content', () => {
    render(<Textarea aria-label="ta" />);
    expect(screen.getByLabelText('ta')).toHaveAttribute('dir', 'auto');
  });

  it('caller-supplied dir wins over the default', () => {
    render(<Textarea aria-label="ltr" dir="ltr" />);
    expect(screen.getByLabelText('ltr')).toHaveAttribute('dir', 'ltr');
  });

  it('applies aria-invalid + red border on error', () => {
    render(<Textarea aria-label="bad" error="required" />);
    const ta = screen.getByLabelText('bad');
    expect(ta).toHaveAttribute('aria-invalid', 'true');
    expect(ta.className).toMatch(/border-status-red/);
  });

  it('renders error message with role="alert"', () => {
    render(<Textarea aria-label="bad" error="חובה" />);
    expect(screen.getByRole('alert')).toHaveTextContent('חובה');
  });
});
