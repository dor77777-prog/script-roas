// dashboard-web/src/components/__tests__/paymentMethodsTabHonestStates.dom.test.tsx
//
// P1-2 (2026-06-10 state-honesty sweep) — PaymentMethodsTab honest states.
//
// /api/payment-methods soft-fails with HTTP 200 + { months: [], error }.
// Pre-fix the fetcher only threw on !res.ok and the component destructured
// ONLY { data } — so a DB failure AND the initial load both rendered the
// business empty copy "אין עדיין נתוני אמצעי-תשלום... הדאטה תופיע כאן ברגע
// שהזמנות יסונכרנו" (wrong diagnosis: a Supabase blip is not an unsynced
// store). Real SWR + stubbed fetch so fetchJsonStrict → throwOnErrorBody is
// exercised end-to-end:
//
//   1. 200-with-error body → red role=alert strip (pm-error), NOT pm-empty.
//   2. still-loading       → skeleton (pm-loading), NOT pm-empty.
//   3. settled SUCCESS empty → pm-empty (the ONLY state allowed to show it).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { PaymentMethodsTab } from '@/components/PaymentMethodsTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderTab() {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
    >
      <PaymentMethodsTab stores={['uzoshop', 'zolplus']} />
    </SWRConfig>,
  );
}

describe('PaymentMethodsTab — P1-2 honest states', () => {
  it('renders the error strip (NOT the "waiting for sync" empty verdict) on a 200-with-error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ months: [], lastUpdated: '2026-06-10T00:00:00Z', error: 'DB down' }),
      ),
    );
    renderTab();

    const alert = await screen.findByTestId('pm-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('שגיאה בטעינת נתוני אמצעי-התשלום');
    expect(alert.textContent).toContain('DB down');
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
    expect(screen.queryByTestId('pm-empty')).toBeNull();
  });

  it('renders the loading skeleton (NOT pm-empty) while the fetch is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderTab();

    expect(await screen.findByTestId('pm-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-empty')).toBeNull();
    expect(screen.queryByTestId('pm-error')).toBeNull();
  });

  it('still renders pm-empty on a SETTLED successful empty response (the only allowed case)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ months: [], lastUpdated: '2026-06-10T00:00:00Z' })),
    );
    renderTab();

    expect(await screen.findByTestId('pm-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-error')).toBeNull();
  });
});
