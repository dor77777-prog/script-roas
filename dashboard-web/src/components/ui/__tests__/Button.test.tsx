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
});
