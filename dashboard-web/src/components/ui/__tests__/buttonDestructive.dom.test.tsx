import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button destructive variant', () => {
  it('uses --status-redFg for text (not hardcoded white)', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/text-status-redFg/);
    expect(btn.className).not.toMatch(/\btext-white\b/);
  });
});
