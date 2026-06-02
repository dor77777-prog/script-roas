// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LogoutButton } from '@/components/LogoutButton';

// The component has a two-step contract: (1) POST /api/logout so the server
// clears the cookie, then (2) window.location.assign('/') so the now-
// unauthenticated shell re-renders. We control fetch's resolution to hold the
// button in its busy state and to exercise the catch branch deterministically —
// no real network, but the behaviour under test (post → navigate, disable while
// in flight, recover on error) is the actual code path, not a stub of it.
//
// jsdom's `location.assign` is a non-configurable, non-writable method, so it
// can't be patched in place. The `window.location` *property* IS configurable,
// though, so we swap the whole object for a stub that carries our assign spy
// (plus a real-ish href getter so nothing else breaks), then restore the
// original afterwards. One stable spy, cleared per test.
const realLocation = window.location;
const assignSpy = vi.fn();

beforeEach(() => {
  assignSpy.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign: assignSpy, href: realLocation.href },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('LogoutButton (2026-06-02)', () => {
  it('POSTs to /api/logout then navigates to "/" when clicked', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);

    const { getByRole } = render(<LogoutButton />);
    fireEvent.click(getByRole('button', { name: /התנתק|logout/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/logout', expect.objectContaining({ method: 'POST' })),
    );
    // The navigation is the load-bearing second half of the contract.
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'));
  });

  it('disables the button while the logout request is in flight', async () => {
    // Keep fetch pending so the busy/disabled state is observable.
    let resolveFetch: (v: { ok: boolean }) => void = () => undefined;
    const fetchSpy = vi.fn(
      () => new Promise<{ ok: boolean }>(res => { resolveFetch = res; }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { getByRole } = render(<LogoutButton />);
    const btn = getByRole('button', { name: /התנתק|logout/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());

    // Resolve so the navigation fires and we don't leak a pending promise.
    resolveFetch({ ok: true });
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'));
  });

  it('re-enables the button (does NOT navigate) if the logout request rejects', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchSpy);

    const { getByRole } = render(<LogoutButton />);
    const btn = getByRole('button', { name: /התנתק|logout/i });
    fireEvent.click(btn);

    // catch branch resets busy → button usable again, and we never navigated.
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('renders icon-only (no visible label) when collapsed, keeping an accessible name', () => {
    const { getByRole, queryByText } = render(<LogoutButton collapsed />);
    // The Hebrew label is gated out of the layout on the 72px rail...
    expect(queryByText('התנתק')).toBeNull();
    // ...but the accessible name is preserved via aria-label so the control
    // (and the wrapping RailTooltip) still announces correctly.
    expect(getByRole('button', { name: 'התנתק' })).toBeTruthy();
  });

  it('shows the inline label when expanded', () => {
    const { queryByText } = render(<LogoutButton collapsed={false} />);
    expect(queryByText('התנתק')).not.toBeNull();
  });
});
