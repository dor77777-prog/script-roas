import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stat } from '@/components/ui/Stat';

describe('Stat primitive', () => {
  it('renders label + value with proper bidi isolation on value', () => {
    render(<Stat label="הוצאה" value="$1,234" />);
    expect(screen.getByText('הוצאה')).toBeInTheDocument();
    const value = screen.getByText('$1,234');
    expect(value.tagName.toLowerCase()).toBe('bdi');
    expect(value.getAttribute('dir')).toBe('ltr');
  });

  it('applies tone="warning" class to root', () => {
    const { container } = render(<Stat label="x" value="y" tone="warning" />);
    expect(container.firstChild).toHaveClass('border-status-warning');
  });

  it('renders optional help node', () => {
    render(<Stat label="x" value="y" help={<span data-testid="help">?</span>} />);
    expect(screen.getByTestId('help')).toBeInTheDocument();
  });
});
