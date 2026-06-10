// dashboard-web/src/components/__tests__/customerValueTabHonestStates.dom.test.tsx
//
// P1-2 (2026-06-10 state-honesty sweep) — CustomerValueTab honest states.
//
// /api/cohorts soft-fails with HTTP 200 + { rows: [], error } (documented
// degraded path). Pre-fix the tab's fetcher only threw on !res.ok and the
// component destructured ONLY { data } — so BOTH a DB failure AND the initial
// load rendered the legitimate business empty-verdict ("אין עדיין מספיק
// נתונים לחישוב שווי-לקוח") on a financial tab. These tests pin the new
// contract with the REAL SWR + a stubbed fetch (no swr mock), so the
// fetchJsonStrict → throwOnErrorBody path is exercised end-to-end:
//
//   1. 200-with-error body → red role=alert strip (cv-error), NOT the verdict.
//   2. HTTP 500            → same error strip.
//   3. still-loading       → skeleton (cv-loading), NOT the empty verdict.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { CustomerValueTab } from '@/components/CustomerValueTab';

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
      <CustomerValueTab stores={['uzoshop', 'zolplus']} />
    </SWRConfig>,
  );
}

const EMPTY_VERDICT = /אין עדיין מספיק נתונים לחישוב שווי-לקוח/;

describe('CustomerValueTab — P1-2 honest states', () => {
  it('renders the error strip (NOT the business empty-verdict) on a 200-with-error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ rows: [], lastUpdated: '2026-06-10T00:00:00Z', asOf: null, error: 'DB down' }),
      ),
    );
    renderTab();

    const alert = await screen.findByTestId('cv-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('שגיאה בטעינת נתוני הלקוחות');
    expect(alert.textContent).toContain('DB down');
    // Retry affordance exists.
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
    // The WRONG diagnosis must not render.
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryByTestId('cv-verdict')).toBeNull();
  });

  it('renders the error strip on a thrown HTTP 500 too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'boom' }, 500)),
    );
    renderTab();

    const alert = await screen.findByTestId('cv-error');
    expect(alert.textContent).toContain('boom');
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
  });

  it('renders the loading skeleton (NOT the empty verdict) while the fetch is in flight', async () => {
    // A fetch that never settles → SWR isLoading stays true.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderTab();

    expect(await screen.findByTestId('cv-loading')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_VERDICT)).toBeNull();
    expect(screen.queryByTestId('cv-error')).toBeNull();
  });
});
