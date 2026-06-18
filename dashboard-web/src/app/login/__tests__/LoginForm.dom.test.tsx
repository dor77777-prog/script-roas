// dashboard-web/src/app/login/__tests__/LoginForm.dom.test.tsx
//
// DOM tests for the password-gate <LoginForm> (Horizon re-skin W2).
//
// The form is a thin client wrapper over the re-skinned Card/Input/Button
// primitives; these tests pin the load-bearing structure + behaviour so the
// visual re-skin can't silently drop a piece:
//   - it renders the title, subtitle, password label (sr-only) + input, and
//     the submit button,
//   - the submit is disabled until a password is typed (and shows מתחבר… while
//     submitting),
//   - a failed POST surfaces the inline error line (role="alert"), and clearing
//     the field dismisses it.
//
// `useSearchParams` is mocked (Next App-Router hook); `fetch` is stubbed per
// test. NO password value is asserted or introduced — only the user-typed
// string flows through, exactly as in production.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the App-Router search-params hook (the only next/navigation API used).
// ---------------------------------------------------------------------------
let nextParam: string | null = null;
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'next' ? nextParam : null) }),
}));

import { LoginForm } from '../LoginForm';

describe('<LoginForm>', () => {
  beforeEach(() => {
    nextParam = null;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the brand title, subtitle, password input and submit button', () => {
    render(<LoginForm />);
    expect(screen.getByRole('heading', { name: 'Insight Owl' })).toBeInTheDocument();
    expect(screen.getByText('הזינו סיסמה כדי להמשיך')).toBeInTheDocument();
    // sr-only label is wired to the password field via htmlFor/id.
    const input = screen.getByLabelText('סיסמה') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument();
  });

  it('disables the submit button until a password is typed', () => {
    render(<LoginForm />);
    const submit = screen.getByRole('button', { name: 'כניסה' }) as HTMLButtonElement;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'x' } });
    expect(submit).not.toBeDisabled();
  });

  it('shows the inline error line when the POST is rejected, then clears it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('סיסמה שגויה. נסו שוב.');
    // The input is wired to the error via aria-describedby for AT.
    expect(screen.getByLabelText('סיסמה')).toHaveAttribute('aria-describedby', 'dash-password-error');

    // Editing the field dismisses the error.
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'wrong2' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the submitting state and POSTs to /api/login', async () => {
    let resolveFetch: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));

    // While the request is in flight the button shows the submitting label.
    const submitting = await screen.findByRole('button', { name: 'מתחבר…' });
    expect(submitting).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST' }));

    // Let the in-flight promise settle so React has no pending state on unmount.
    resolveFetch({ ok: false, status: 401, json: async () => ({}) });
    await screen.findByRole('alert');
  });
});
