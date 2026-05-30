import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YearSelector } from '@/components/YearSelector';

describe('YearSelector', () => {
  it('renders a select with options [startYear..endYear] and highlights value', () => {
    render(<YearSelector value={2026} onChange={() => {}} startYear={2024} endYear={2026} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('2026');
    // Each year appears as an option
    expect(screen.getByRole('option', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2025' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2026' })).toBeInTheDocument();
  });

  it('calls onChange with the parsed numeric year on change', () => {
    const onChange = vi.fn();
    render(<YearSelector value={2026} onChange={onChange} startYear={2024} endYear={2026} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2025' } });
    expect(onChange).toHaveBeenCalledWith(2025);
  });
});
