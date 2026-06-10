// dashboard-web/src/components/__tests__/insightsBoardErrorState.dom.test.tsx
//
// P1-4c (2026-06-10 state-honesty sweep) — InsightsBoard / ActionListPanel
// must NOT render a false all-clear when the data feeds FAIL.
//
// Pre-fix all four feeds (/api/data, /api/products, /api/campaigns, /api/ads)
// used fetchJsonOrNull: a failure resolved to null → zero insights → the
// always-visible action list rendered "אין פעולות דחופות כרגע. הכול נראה
// תקין." — the worst possible degradation for an ALERTING surface (an outage
// indistinguishable from a healthy business). Now the fetchers throw and a
// failed feed renders the neutral "לא ניתן לטעון תובנות כרגע" state.
//
// Full-board integration with real SWR + stubbed fetch (all feeds 500).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { InsightsBoard } from '@/components/InsightsBoard';
import type { DashboardData } from '@/lib/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const DATA = { rows: [], stores: [], adStateMap: {}, storeApplicablePlatforms: {} } as unknown as DashboardData;

describe('InsightsBoard — P1-4c failed feeds must not read as all-clear', () => {
  it('renders the neutral "לא ניתן לטעון תובנות כרגע" state (NOT the green all-clear) when every feed 500s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        // The four insight feeds fail; anything else (e.g. store-meta for the
        // ad-accounts hook) succeeds with an empty body.
        if (
          url.includes('/api/data') ||
          url.includes('/api/products') ||
          url.includes('/api/campaigns') ||
          url.includes('/api/ads')
        ) {
          return jsonResponse({ error: 'db down' }, 500);
        }
        return jsonResponse({});
      }),
    );

    render(
      <SWRConfig
        value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
      >
        <InsightsBoard data={DATA} />
      </SWRConfig>,
    );

    // The action list shows the neutral can't-analyze state…
    const alert = await screen.findByTestId('action-list-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('לא ניתן לטעון תובנות כרגע');
    // …and the false all-clear never renders.
    await waitFor(() => {
      expect(screen.queryByText(/אין פעולות דחופות כרגע/)).toBeNull();
      expect(screen.queryByText(/הכול נראה תקין/)).toBeNull();
    });
  });

  it('still renders the green all-clear on settled SUCCESS with zero insights', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/campaigns')) {
          return jsonResponse({
            rows: [], lastUpdated: '', dataLastWriteAt: '',
            currentEffectiveStatus: {}, lastKnownBudgetTypes: {},
          });
        }
        if (url.includes('/api/data')) {
          return jsonResponse({ rows: [], stores: [], lastUpdated: '', adStateMap: {}, storeApplicablePlatforms: {} });
        }
        return jsonResponse({ rows: [], lastUpdated: '' });
      }),
    );

    render(
      <SWRConfig
        value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
      >
        <InsightsBoard data={DATA} />
      </SWRConfig>,
    );

    expect(await screen.findByText(/אין פעולות דחופות כרגע/)).toBeInTheDocument();
    expect(screen.queryByTestId('action-list-error')).toBeNull();
  });
});
