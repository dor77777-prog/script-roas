import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge primitive', () => {
  it('renders the children', () => {
    render(<Badge>Healthy</Badge>);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('applies each ROAS tone variant', () => {
    const tones = ['red', 'orange', 'green', 'blue', 'gray'] as const;
    for (const t of tones) {
      const { unmount } = render(<Badge tone={t} data-testid={t}>x</Badge>);
      expect(screen.getByTestId(t).className).toMatch(new RegExp(`status-${t}`));
      unmount();
    }
  });

  it('uses RTL-safe utilities', () => {
    render(<Badge data-testid="b">x</Badge>);
    const cls = screen.getByTestId('b').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });
});
