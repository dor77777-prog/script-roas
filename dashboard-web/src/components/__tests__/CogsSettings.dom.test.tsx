import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CogsSettings } from '@/components/CogsSettings';
import { readCogsSettings } from '@/lib/cogsSettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

beforeEach(() => { window.localStorage.clear(); });

describe('CogsSettings', () => {
  it('renders the business % field at the 25% default', () => {
    render(<CogsSettings storeNames={['uzoshop', 'zolplus', 'usmile360']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    expect((screen.getByTestId('cogs-business-input') as HTMLInputElement).value).toBe('25');
  });

  it('applying a business % to the current month persists byMonth[current]', () => {
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '30' } });
    // 'current month' is the default selected apply-scope.
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.byMonth['2026-06']).toBe(30);
  });

  it('switching to per-store mode shows a field per store', () => {
    render(<CogsSettings storeNames={['uzoshop', 'zolplus']} currentMonth="2026-06" monthsInData={['2026-06']} />);
    fireEvent.click(screen.getByTestId('cogs-mode-per-store'));
    expect(screen.getByTestId('cogs-store-input-uzoshop')).toBeTruthy();
    expect(screen.getByTestId('cogs-store-input-zolplus')).toBeTruthy();
  });

  it('"everything" apply-scope sets default + clears byMonth', () => {
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '26' } });
    fireEvent.click(screen.getByTestId('cogs-scope-everything'));
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.default).toBe(26);
    expect(readCogsSettings().business.byMonth).toEqual({});
  });

  it('timeline marks an edited month with "נערך" and an un-edited month with "ברירת מחדל"', () => {
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-05','2026-06']} />);
    // Before editing, the current month shows the default badge, not the edited badge.
    expect(screen.getByTestId('cogs-default-2026-06')).toBeTruthy();
    expect(screen.queryByTestId('cogs-edited-2026-06')).toBeNull();

    // Apply a % to the current month (default selected apply-scope).
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));

    // The current month's row now carries the "נערך" marker…
    const editedBadge = screen.getByTestId('cogs-edited-2026-06');
    expect(editedBadge.textContent).toBe('נערך');
    expect(screen.queryByTestId('cogs-default-2026-06')).toBeNull();

    // …while an un-edited month still shows "ברירת מחדל".
    const defaultBadge = screen.getByTestId('cogs-default-2026-05');
    expect(defaultBadge.textContent).toBe('ברירת מחדל');
    expect(screen.queryByTestId('cogs-edited-2026-05')).toBeNull();
  });

  it('"all previous months" works on a short loaded range via the 18-month window', () => {
    // monthsInData covers ONLY the current month — yet all-previous must still
    // write byMonth for prior months from the fixed 18-month lookback.
    render(<CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-06']} />);
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('cogs-scope-all-previous'));
    fireEvent.click(screen.getByTestId('cogs-apply'));
    const bm = readCogsSettings().business.byMonth;
    expect(bm['2026-05']).toBe(20); // previous month, not in monthsInData
    expect(bm['2025-07']).toBe(20); // ~11 months back, still inside the 18-month window
    expect(bm['2026-06']).toBeUndefined(); // current month is excluded by all-previous
  });
});
