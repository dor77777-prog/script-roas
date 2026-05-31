import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button destructive variant', () => {
  it('uses --accent-fg (white-on-solid-red) token for text (not hardcoded white)', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    // On a SOLID red fill the legible on-color ink is text-accent-fg (white in
    // both themes); text-status-redFg is engineered for the TINTED redBg
    // surface and is illegible here (~1.4–1.8 contrast).
    expect(btn.className).toMatch(/text-accent-fg/);
    expect(btn.className).not.toMatch(/\btext-white\b/);
  });
});
