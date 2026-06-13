import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';

// The Checkbox primitive is a styled NATIVE <input type="checkbox"> (no Radix
// dep installed) — so it carries the real checkbox a11y contract: role,
// aria-checked, Space-to-toggle, label association. These tests mirror the
// Switch.test.tsx setup and assert that contract + the token/glyph wiring.

describe('Checkbox primitive', () => {
  it('renders with role=checkbox and aria-checked reflecting `checked`', () => {
    const { rerender } = render(<Checkbox checked={false} aria-label="cb" />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeTruthy();
    expect(box.getAttribute('aria-checked')).toBe('false');

    rerender(<Checkbox checked aria-label="cb" />);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });

  it('fires onCheckedChange with the toggled value on click', () => {
    let value = false;
    const onCheckedChange = vi.fn((v: boolean) => (value = v));
    const { rerender } = render(
      <Checkbox checked={value} onCheckedChange={onCheckedChange} aria-label="cb" />,
    );
    fireEvent.click(screen.getByLabelText('cb'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox checked={value} onCheckedChange={onCheckedChange} aria-label="cb" />);
    expect(value).toBe(true);
  });

  it('toggles on Space key (native checkbox keyboard semantics)', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} aria-label="cb" />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    box.focus();
    expect(box).toHaveFocus();
    await user.keyboard(' '); // Space activates a focused native checkbox
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('disabled prevents toggle and exposes the disabled state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox checked={false} disabled onCheckedChange={onCheckedChange} aria-label="cb" />,
    );
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    // userEvent honours the disabled state (a real browser dispatches no click
    // to a disabled control) where fireEvent.click would bypass it in jsdom.
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('shows the check glyph and accent fill in the checked state', () => {
    const { container } = render(<Checkbox checked aria-label="cb" />);
    // lucide Check renders an <svg class="lucide-check"> (token-driven fill).
    const glyph = container.querySelector('svg.lucide-check');
    expect(glyph).toBeTruthy();
    // the on-accent token (never derived) drives the glyph colour
    expect(glyph?.getAttribute('class') || '').toContain('text-accent-fg');
    // the painted box flips to the accent fill when the peer input is checked
    const painted = container.querySelector('[class*="peer-checked:bg-accent"]');
    expect(painted).toBeTruthy();
  });

  it('renders the indeterminate dash glyph and aria-checked=mixed', () => {
    const { container } = render(<Checkbox indeterminate aria-label="cb" />);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed');
    expect(container.querySelector('svg.lucide-minus')).toBeTruthy();
    // the native indeterminate DOM flag is set imperatively
    expect((screen.getByRole('checkbox') as HTMLInputElement).indeterminate).toBe(true);
  });

  it('wires the focus-visible accent ring on the painted box', () => {
    const { container } = render(<Checkbox aria-label="cb" />);
    const painted = container.querySelector('[class*="peer-focus-visible:ring-accent"]');
    expect(painted).toBeTruthy();
    expect(painted?.getAttribute('class') || '').toContain('peer-focus-visible:ring-2');
  });

  it('associates with an external <label htmlFor> (id wiring)', () => {
    render(
      <>
        <label htmlFor="terms">קראתי את התנאים</label>
        <Checkbox id="terms" checked={false} aria-label="cb" />
      </>,
    );
    // clicking the label toggles the input it points at — proves association
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.id).toBe('terms');
    expect(screen.getByText('קראתי את התנאים').getAttribute('for')).toBe('terms');
  });

  it('supports aria-labelledby wiring', () => {
    render(
      <>
        <span id="lbl">בחר חנות</span>
        <Checkbox aria-labelledby="lbl" checked={false} />
      </>,
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-labelledby')).toBe('lbl');
  });
});
