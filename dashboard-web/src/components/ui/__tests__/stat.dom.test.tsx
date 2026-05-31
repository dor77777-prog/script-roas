import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('applies glass treatment via Wave-1 tokens at default density', () => {
    const { container } = render(<Stat label="x" value="y" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('bg-glass-2');
    expect(root).toHaveClass('border-glass-edge');
    expect(root).toHaveClass('shadow-glass');
    expect(root).toHaveClass('rounded-card');
  });

  it('density="hero" sheds card chrome (no padding/border/shadow)', () => {
    const { container } = render(<Stat label="x" value="y" density="hero" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('p-0');
    expect(root).toHaveClass('border-0');
    expect(root).toHaveClass('bg-transparent');
    expect(root).toHaveClass('shadow-none');
  });

  it('renders prefix before value', () => {
    render(<Stat label="x" value="1.23" prefix="CAD" />);
    expect(screen.getByText('CAD')).toBeInTheDocument();
    expect(screen.getByText('1.23')).toBeInTheDocument();
  });

  it('renders chip + delta + subtitle slots', () => {
    render(
      <Stat
        label="x"
        value="y"
        chip={<span data-testid="chip">good</span>}
        delta={<span data-testid="delta">+5%</span>}
        subtitle={<span data-testid="sub">vs prev</span>}
      />
    );
    expect(screen.getByTestId('chip')).toBeInTheDocument();
    expect(screen.getByTestId('delta')).toBeInTheDocument();
    expect(screen.getByTestId('sub')).toBeInTheDocument();
  });

  it('becomes a button when onClick is passed and exposes aria-pressed', () => {
    const onClick = vi.fn();
    render(<Stat label="x" value="y" onClick={onClick} active />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accent="positive" tints value green; "attention" tints accent', () => {
    const { container, rerender } = render(<Stat label="x" value="y" accent="positive" />);
    const bdi = container.querySelector('bdi');
    expect(bdi).toHaveClass('text-status-green');
    rerender(<Stat label="x" value="y" accent="attention" />);
    const bdi2 = container.querySelector('bdi');
    expect(bdi2).toHaveClass('text-accent');
  });
});
