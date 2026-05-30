import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YearSelector } from '@/components/YearSelector';

describe('YearSelector', () => {
  it('renders [N..currentYear] chips and highlights the selected year', () => {
    render(<YearSelector value={2026} onChange={() => {}} startYear={2024} endYear={2026} />);
    expect(screen.getByRole('button', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
    const chip2026 = screen.getByRole('button', { name: '2026' });
    expect(chip2026).toBeInTheDocument();
    expect(chip2026.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onChange when a chip is clicked', () => {
    const onChange = vi.fn();
    render(<YearSelector value={2026} onChange={onChange} startYear={2024} endYear={2026} />);
    fireEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(onChange).toHaveBeenCalledWith(2025);
  });
});
