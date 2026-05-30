import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthSelector } from '@/components/MonthSelector';

describe('MonthSelector', () => {
  it('renders 12 month chips and highlights the selected month', () => {
    render(<MonthSelector value={5} onChange={() => {}} />);
    // 12 buttons by aria-label
    const may = screen.getByRole('button', { name: /מאי/ });
    expect(may.getAttribute('aria-pressed')).toBe('true');
    const jan = screen.getByRole('button', { name: /ינואר/ });
    expect(jan.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange with the clicked month (1-12)', () => {
    const onChange = vi.fn();
    render(<MonthSelector value={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /מרץ/ }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('"כל השנה" chip clears the month (calls onChange with null)', () => {
    const onChange = vi.fn();
    render(<MonthSelector value={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /כל השנה/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
