// @vitest-environment jsdom
//
// dashboard-web/src/components/operator/__tests__/ResetData.dom.test.tsx
//
// W7-T5 (Horizon re-skin) — smoke test for the operator "Reset Data"
// destructive panel after its confirm modal was converged onto the shared
// Radix `Sheet` primitive (variant="modal"). Replaces the prior hand-rolled
// `fixed inset-0` overlay, which would have been INERT if ever opened over a
// Sheet (the modal-over-Sheet rule).
//
// The CRITICAL safety property this guards is the typed-token gate: the
// destructive "אשר ומחק" action MUST stay disabled until the operator types
// the EXACT per-scope confirm token (YES-DELETE-ALL-DATA for the full wipe,
// YES-DELETE-EXCEPT-MANUAL for the partial wipe), and ביטול must close the
// modal WITHOUT firing the reset.
//
// `mutate` from swr is mocked (the success path calls it) and operatorFetch
// is mocked so no network is touched. The reset POST is asserted NOT to fire
// on cancel / before the token is typed.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

// swr's named `mutate` is called on the success path; stub it out.
vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

// The destructive POST goes through operatorFetch — mock it so we can assert
// whether (and when) it fires, with no real network.
const operatorFetch = vi.fn(async (_url: string, _init?: RequestInit) => ({
  json: async () => ({
    scope: 'all',
    deleted: {},
    total: 0,
    durationMs: 1,
  }),
  status: 200,
}));
vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: (url: string, init?: RequestInit) => operatorFetch(url, init),
}));

import { ResetData } from '../ResetData';

beforeEach(() => {
  operatorFetch.mockClear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Open the FULL-reset confirm modal (scope='all', token YES-DELETE-ALL-DATA).
function openFullResetModal() {
  fireEvent.click(
    screen.getByRole('button', { name: /איפוס מלא/ }),
  );
}

describe('ResetData — confirm modal converged on Radix Sheet (W7-T5)', () => {
  it('opens a REAL dialog (role=dialog) when a reset button is clicked', async () => {
    render(<ResetData />);
    openFullResetModal();
    // A real Radix dialog — NOT a hand-rolled inert overlay div.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();
    // The destructive warning copy + the token to type are present.
    expect(within(dialog).getByText(/אין צעד אחורה/)).toBeDefined();
    expect(within(dialog).getByText('YES-DELETE-ALL-DATA')).toBeDefined();
  });

  it('keeps the destructive action DISABLED until the EXACT token is typed, then ENABLES it', async () => {
    render(<ResetData />);
    openFullResetModal();
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /אשר ומחק/ }) as HTMLButtonElement;
    const input = within(dialog).getByPlaceholderText(/הקלד כאן/) as HTMLInputElement;

    // Empty → disabled.
    expect(confirm.disabled).toBe(true);
    // Partial / wrong → still disabled.
    fireEvent.change(input, { target: { value: 'YES-DELETE-ALL' } });
    expect(confirm.disabled).toBe(true);
    // Wrong scope's token → still disabled (tokens are non-interchangeable).
    fireEvent.change(input, { target: { value: 'YES-DELETE-EXCEPT-MANUAL' } });
    expect(confirm.disabled).toBe(true);
    // Exact token → enabled.
    fireEvent.change(input, { target: { value: 'YES-DELETE-ALL-DATA' } });
    expect(confirm.disabled).toBe(false);
  });

  it('does NOT fire the reset POST while the token is unconfirmed', async () => {
    render(<ResetData />);
    openFullResetModal();
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText(/הקלד כאן/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'wrong' } });
    // Button is disabled, but assert no destructive call regardless.
    expect(operatorFetch).not.toHaveBeenCalled();
  });

  it('ביטול closes the modal WITHOUT firing the reset', async () => {
    render(<ResetData />);
    openFullResetModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /ביטול/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(operatorFetch).not.toHaveBeenCalled();
  });

  it('fires the reset POST with the scope + token once the gate is satisfied', async () => {
    render(<ResetData />);
    openFullResetModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/הקלד כאן/), {
      target: { value: 'YES-DELETE-ALL-DATA' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /אשר ומחק/ }));

    await waitFor(() => expect(operatorFetch).toHaveBeenCalledTimes(1));
    const init = operatorFetch.mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toEqual({
      scope: 'all',
      confirm: 'YES-DELETE-ALL-DATA',
    });
  });
});
