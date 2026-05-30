import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonthSelector } from '@/components/MonthSelector';

describe('MonthSelector', () => {
  it('renders a select with "כל השנה" + 12 months; selected reflects value', () => {
    render(<MonthSelector value={5} onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('5');
    expect(screen.getByRole('option', { name: /כל השנה/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /מאי/ })).toBeInTheDocument();
  });

  it('selecting "כל השנה" fires onChange(null)', () => {
    const onChange = vi.fn();
    render(<MonthSelector value={5} onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'all' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('selecting a month fires onChange with the numeric month', () => {
    const onChange = vi.fn();
    render(<MonthSelector value={null} onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
