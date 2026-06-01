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
});
