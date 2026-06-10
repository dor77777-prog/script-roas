// dashboard-web/src/components/__tests__/productCentricViewErrorState.dom.test.tsx
//
// P1-4a (2026-06-10 state-honesty sweep) — ProductCentricView error surfacing.
//
// Pre-fix the SWR fetcher returned `null` on `!r.ok`, so a failed
// /api/campaigns (or /api/products) left `!campaignsData` true FOREVER →
// the view rendered 'טוען…' indefinitely with no error signal; and a degraded
// 200 + { rows: [], error } body read as the 'אין מיפויים פעילים' business
// verdict. Real SWR + stubbed fetch so fetchJsonStrict is exercised:
//
//   1. /api/campaigns HTTP 500   → pcv-error strip, NOT infinite 'טוען…'.
//   2. 200-with-error body       → same error strip (NOT 'אין מיפויים פעילים').

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ProductCentricView } from '@/components/ProductCentricView';

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

const RANGE = { from: '2026-06-01', to: '2026-06-09' };

function renderView() {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}
    >
      <ProductCentricView storeId="uzoshop" range={RANGE} productMap={{}} />
    </SWRConfig>,
  );
}

describe('ProductCentricView — P1-4a error surfacing', () => {
  it('renders the error strip (NOT infinite "טוען…") when /api/campaigns 500s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/campaigns')) return jsonResponse({ error: 'boom' }, 500);
        if (url.includes('/api/products')) return jsonResponse({ rows: [], lastUpdated: '', dataLastWriteAt: null });
        if (url.includes('/api/orders-attribution')) return jsonResponse({ rows: [], lastUpdated: '' });
        return jsonResponse({ rows: [], lastUpdated: '' });
      }),
    );
    renderView();

    const alert = await screen.findByTestId('pcv-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('/api/campaigns');
    expect(alert.textContent).toContain('boom');
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
    // The infinite-loading symptom is gone…
    expect(screen.queryByText('טוען…')).toBeNull();
    // …and so is the wrong "no mappings" business verdict.
    expect(screen.queryByText(/אין מיפויים פעילים/)).toBeNull();
  });

  it('renders the error strip on a degraded 200-with-error /api/products body (NOT "אין מיפויים פעילים")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/campaigns')) {
          return jsonResponse({
            rows: [], lastUpdated: '', dataLastWriteAt: null,
            currentEffectiveStatus: {}, lastKnownBudgetTypes: {},
          });
        }
        if (url.includes('/api/products')) {
          return jsonResponse({ rows: [], lastUpdated: '', dataLastWriteAt: null, error: 'db read failed' });
        }
        return jsonResponse({ rows: [], lastUpdated: '' });
      }),
    );
    renderView();

    const alert = await screen.findByTestId('pcv-error');
    expect(alert.textContent).toContain('/api/products');
    expect(alert.textContent).toContain('db read failed');
    expect(screen.queryByText(/אין מיפויים פעילים/)).toBeNull();
  });
});
