import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CogsSettings } from '@/components/CogsSettings';
import { readCogsSettings } from '@/lib/cogsSettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

beforeEach(() => { window.localStorage.clear(); });

// FIX #27 — clampPct silently substituted the 25% default when a COGS field
// was blank/invalid on Apply, so clearing a field and hitting "Apply" wrote a
// surprise 25% the operator never typed. Apply must VALIDATE each active input
// and ABORT the write (with an inline error) when one is blank/non-finite.

describe('CogsSettings — Apply validation (FIX #27)', () => {
  it('business mode: clearing the field + Apply does NOT write 25%, shows an error', () => {
    render(
      <CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-06']} />,
    );
    // Clear the business % field.
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));

    // NO write occurred — byMonth stays empty (no silent 25% persisted).
    expect(readCogsSettings().business.byMonth['2026-06']).toBeUndefined();

    // An inline error is surfaced.
    expect(screen.getByTestId('cogs-apply-error')).toBeInTheDocument();
  });

  it('business mode: a non-numeric field + Apply aborts the write', () => {
    render(
      <CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-06']} />,
    );
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.byMonth['2026-06']).toBeUndefined();
    expect(screen.getByTestId('cogs-apply-error')).toBeInTheDocument();
  });

  it('per-store mode: a single blank store field aborts the WHOLE apply (no partial 25% write)', () => {
    render(
      <CogsSettings storeNames={['uzoshop', 'zolplus']} currentMonth="2026-06" monthsInData={['2026-06']} />,
    );
    fireEvent.click(screen.getByTestId('cogs-mode-per-store'));
    // uzoshop valid, zolplus cleared.
    fireEvent.change(screen.getByTestId('cogs-store-input-uzoshop'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('cogs-store-input-zolplus'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));

    // Neither store wrote a byMonth entry for the current month (whole apply aborted).
    expect(readCogsSettings().perStore['uzoshop']?.byMonth['2026-06']).toBeUndefined();
    expect(readCogsSettings().perStore['zolplus']?.byMonth['2026-06']).toBeUndefined();
    expect(screen.getByTestId('cogs-apply-error')).toBeInTheDocument();
  });

  it('a valid value still writes (no false-positive block; error clears)', () => {
    render(
      <CogsSettings storeNames={['uzoshop']} currentMonth="2026-06" monthsInData={['2026-06']} />,
    );
    // First produce an error.
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(screen.getByTestId('cogs-apply-error')).toBeInTheDocument();

    // Then a valid value writes and the error clears.
    fireEvent.change(screen.getByTestId('cogs-business-input'), { target: { value: '32' } });
    fireEvent.click(screen.getByTestId('cogs-apply'));
    expect(readCogsSettings().business.byMonth['2026-06']).toBe(32);
    expect(screen.queryByTestId('cogs-apply-error')).toBeNull();
  });
});
