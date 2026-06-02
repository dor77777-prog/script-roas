import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalarySettings } from '@/components/SalarySettings';
import { readSalarySettings } from '@/lib/salarySettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
beforeEach(() => { window.localStorage.clear(); });

describe('SalarySettings', () => {
  it('renders the default value field at 7 in percent mode', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    expect((screen.getByTestId('salary-value-input') as HTMLInputElement).value).toBe('7');
  });

  it('applying a % to the current month persists a percent entry in byMonth[current]', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('salary-apply')); // 'current' is the default scope
    expect(readSalarySettings().byMonth['2026-06']).toEqual({ kind: 'percent', value: 10 });
  });

  it('switching to amount mode then applying persists an amount entry', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
    fireEvent.click(screen.getByTestId('salary-mode-amount'));
    fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '8000' } });
    fireEvent.click(screen.getByTestId('salary-apply'));
    expect(readSalarySettings().byMonth['2026-06']).toEqual({ kind: 'amount', value: 8000 });
  });

  it('"everything" scope sets default + clears byMonth', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('salary-scope-everything'));
    fireEvent.click(screen.getByTestId('salary-apply'));
    expect(readSalarySettings().default).toEqual({ kind: 'percent', value: 9 });
    expect(readSalarySettings().byMonth).toEqual({});
  });

  it('"all previous" works on a short loaded range via the 18-month window', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
    fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('salary-scope-all-previous'));
    fireEvent.click(screen.getByTestId('salary-apply'));
    const bm = readSalarySettings().byMonth;
    expect(bm['2026-05']).toEqual({ kind: 'percent', value: 5 }); // prior month not in monthsInData
    expect(bm['2025-07']).toEqual({ kind: 'percent', value: 5 }); // inside the 18-month window
    expect(bm['2026-06']).toBeUndefined();                        // current excluded
  });

  it('hides the months timeline by default and expands on toggle', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    const toggle = screen.getByTestId('salary-timeline-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('salary-timeline')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('salary-timeline')).toBeTruthy();
    expect(screen.getByTestId('salary-default-2026-06')).toBeTruthy(); // un-edited → default badge
  });

  it('timeline marks an edited month "נערך" after apply', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('salary-value-input'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('salary-apply'));
    fireEvent.click(screen.getByTestId('salary-timeline-toggle'));
    expect(screen.getByTestId('salary-edited-2026-06')).toBeTruthy();
    expect(screen.queryByTestId('salary-default-2026-06')).toBeNull();
  });

  it('shows the double-count reminder note', () => {
    render(<SalarySettings currentMonth="2026-06" monthsInData={['2026-06']} />);
    expect(screen.getByTestId('salary-double-count-note').textContent)
      .toContain('הסר משם כדי לא לספור פעמיים');
  });
});
