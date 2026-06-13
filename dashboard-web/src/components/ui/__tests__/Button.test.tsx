import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button primitive', () => {
  it('renders a <button> by default', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders as <a> when asChild + child is <a>', () => {
    render(<Button asChild><a href="/x">Link</a></Button>);
    const el = screen.getByText('Link');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/x');
  });

  it('applies primary variant by default (accent class)', () => {
    render(<Button data-testid="b">x</Button>);
    expect(screen.getByTestId('b').className).toMatch(/bg-accent/);
  });

  it('applies destructive variant class', () => {
    render(<Button variant="destructive" data-testid="b">x</Button>);
    expect(screen.getByTestId('b').className).toMatch(/status-red/);
  });

  // W7-T1 (debt #13): semantic success/warning variants mirror destructive —
  // solid status-btn bg (white-AA: green-btn #008651 = 4.64, orange-btn
  // #b25f00 = 4.64) + a *contrast* focus ring via the paired -Fg token.
  it('applies success variant (bg-status-greenBtn + contrast ring)', () => {
    render(<Button variant="success" data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).toMatch(/bg-status-greenBtn/);
    expect(cls).toMatch(/text-accent-fg/);
    expect(cls).toMatch(/focus-visible:ring-status-greenFg/);
  });

  it('applies warning variant (bg-status-orangeBtn + contrast ring)', () => {
    render(<Button variant="warning" data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).toMatch(/bg-status-orangeBtn/);
    expect(cls).toMatch(/text-accent-fg/);
    expect(cls).toMatch(/focus-visible:ring-status-warningFg/);
  });

  it('respects disabled prop', () => {
    render(<Button disabled data-testid="b">x</Button>);
    expect(screen.getByTestId('b')).toBeDisabled();
  });

  it('uses RTL-safe gap utilities (no pl-/pr-)', () => {
    render(<Button data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });

  // P0-11: focus ring must contrast against each variant's own background.
  // A ring in the same hue as the bg is invisible — the keyboard-only user
  // sees nothing on Tab. Primary (violet bg) → ring uses --accent-fg (white).
  // Destructive (red bg) → ring uses --status-redFg (near-white).
  it('primary variant uses contrast ring (accent-fg, not accent)', () => {
    render(<Button variant="primary" data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).toMatch(/focus-visible:ring-accent-fg/);
    expect(cls).not.toMatch(/focus-visible:ring-accent(\s|$|[^-])/);
  });

  it('destructive variant uses contrast ring (status-redFg)', () => {
    render(<Button variant="destructive" data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).toMatch(/focus-visible:ring-status-redFg/);
  });

  it('secondary / ghost / link variants keep standard accent ring', () => {
    for (const variant of ['secondary', 'ghost', 'link'] as const) {
      const { unmount } = render(<Button variant={variant} data-testid="b">x</Button>);
      expect(screen.getByTestId('b').className).toMatch(/focus-visible:ring-accent\b/);
      unmount();
    }
  });
});
