// dashboard-web/src/components/__tests__/aiReportButtonErrorState.dom.test.tsx
//
// P1-4b (2026-06-10 state-honesty sweep) — AiReportButton honest data states.
//
// Pre-fix all four report feeds used fetchJsonOrNull:
//   • a products/campaigns failure kept `dataReady` false FOREVER → the
//     modal's generate button spun "טוען נתונים…" indefinitely;
//   • an orders/ads failure silently dropped those sections from the
//     generated report (no signal at all).
// Now: core (products/campaigns) errors render an inline alert + disable the
// generate button WITH A REASON; orders/ads stay optional but their failure
// is SIGNALED with a small warning note. Real SWR + stubbed fetch.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { AiReportButton } from '@/components/AiReportButton';
import type { DashboardData, Filters } from '@/lib/types';

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

const FILTERS: Filters = {
  preset: 'custom',
  range: { from: '2026-06-01', to: '2026-06-09' },
  store: 'All',
} as Filters;

const DATA = { rows: [], stores: [], lastUpdated: '' } as unknown as DashboardData;

function renderAndOpen() {
  render(
    <SWRConfig
      value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
    >
      <AiReportButton data={DATA} filters={FILTERS} />
    </SWRConfig>,
  );
  fireEvent.click(screen.getByRole('button', { name: /ייצא דוח ל-AI/ }));
}

const OK_EMPTY = { rows: [], lastUpdated: '' };

describe('AiReportButton — P1-4b honest data states', () => {
  it('a failed CORE feed (/api/products 500) shows an inline alert + a disabled reasoned button — no endless spinner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/products')) return jsonResponse({ error: 'products down' }, 500);
        if (url.includes('/api/campaigns')) {
          return jsonResponse({ ...OK_EMPTY, currentEffectiveStatus: {}, lastKnownBudgetTypes: {} });
        }
        return jsonResponse(OK_EMPTY);
      }),
    );
    renderAndOpen();

    const alert = await screen.findByTestId('ai-report-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('/api/products');
    expect(alert.textContent).toContain('products down');

    // The generate button states the REASON and is disabled — it must NOT
    // show the pre-fix perpetual "טוען נתונים…" spinner.
    const btn = screen.getByRole('button', { name: /לא ניתן ליצור דוח/ });
    expect(btn).toBeDisabled();
    expect(screen.queryByText('טוען נתונים…')).toBeNull();
    // Retry affordance exists inside the alert.
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
  });

  it('a failed OPTIONAL feed (/api/ads 500) is SIGNALED with a partial-report note while צור דוח stays enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/ads')) return jsonResponse({ error: 'ads down' }, 500);
        if (url.includes('/api/campaigns')) {
          return jsonResponse({ ...OK_EMPTY, currentEffectiveStatus: {}, lastKnownBudgetTypes: {} });
        }
        return jsonResponse(OK_EMPTY);
      }),
    );
    renderAndOpen();

    const note = await screen.findByTestId('ai-report-partial-note');
    expect(note.textContent).toContain('מודעות');
    expect(note.textContent).toContain('הדוח ייווצר בלעדיהם');
    // Core feeds are fine → no error strip, and the generate button is live.
    expect(screen.queryByTestId('ai-report-error')).toBeNull();
    const btn = await screen.findByRole('button', { name: /צור דוח/ });
    expect(btn).toBeEnabled();
  });
});
