// dashboard-web/src/components/operator/__tests__/OperatorSecretBanner.dom.test.tsx
//
// 2026-06-10 audit (destructive-action friction, inverted): pressing Enter on
// an EMPTY secret input used to call handleSave unconditionally, which wrote
// `setOperatorSecret(null)` — silently CLEARING the working secret while the
// (disabled) Save button suggested nothing would happen. Clearing must remain
// the explicit "נקה" action only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const setOperatorSecret = vi.fn();
let storedSecret: string | null = null;

vi.mock('@/lib/operatorClient', () => ({
  getOperatorSecret: vi.fn(() => storedSecret),
  setOperatorSecret: (v: string | null) => setOperatorSecret(v),
}));

import { OperatorSecretBanner } from '../OperatorSecretBanner';

beforeEach(() => {
  setOperatorSecret.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OperatorSecretBanner — empty-Enter guard', () => {
  it('Enter on an EMPTY input while a secret is stored does NOT clear it', async () => {
    storedSecret = 'existing-secret';
    render(<OperatorSecretBanner />);
    // Stored state → open the "החלף secret" inline input.
    fireEvent.click(await screen.findByRole('button', { name: /החלף secret/ }));
    const input = screen.getByPlaceholderText(/secret חדש/);
    fireEvent.keyDown(input, { key: 'Enter' });
    // The guard: no write at all (previously wrote null = cleared).
    expect(setOperatorSecret).not.toHaveBeenCalled();
    // The banner still reports a stored secret.
    expect(screen.getByText(/Operator secret מוגדר/)).toBeInTheDocument();
  });

  it('Enter with whitespace-only input is also a no-op', async () => {
    storedSecret = 'existing-secret';
    render(<OperatorSecretBanner />);
    fireEvent.click(await screen.findByRole('button', { name: /החלף secret/ }));
    const input = screen.getByPlaceholderText(/secret חדש/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setOperatorSecret).not.toHaveBeenCalled();
  });

  it('Enter with a real value saves it (regression)', async () => {
    storedSecret = null;
    render(<OperatorSecretBanner />);
    const input = await screen.findByPlaceholderText(/הזן את ה-secret/);
    fireEvent.change(input, { target: { value: ' s3cret ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setOperatorSecret).toHaveBeenCalledWith('s3cret');
  });

  it('the explicit "נקה" button still clears (regression)', async () => {
    storedSecret = 'existing-secret';
    render(<OperatorSecretBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'נקה' }));
    expect(setOperatorSecret).toHaveBeenCalledWith(null);
  });
});
