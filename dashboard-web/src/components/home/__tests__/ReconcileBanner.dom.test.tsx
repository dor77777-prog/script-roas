// @vitest-environment jsdom
//
// DQ-1 — ReconcileBanner DOM test. The component self-fetches via SWR from
// /api/operator/reconcile, so each test stubs `fetch` with a deterministic body
// and isolates the SWR cache (fresh Map provider + dedupingInterval 0) so one
// test's response never leaks into the next. We then `await waitFor(...)` for
// the post-fetch render to settle.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  ReconcileBanner,
  type ReconcileResponse,
} from '@/components/home/ReconcileBanner';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(body: ReconcileResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response)),
  );
}

function renderBanner() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ReconcileBanner />
    </SWRConfig>,
  );
}

describe('ReconcileBanner (DQ-1)', () => {
  it('renders the banner with the count + /operator link when violations are present', async () => {
    stubFetch({
      violations: [
        { check: 'INV-9 spend', storeName: 'uzoshop', platform: 'Meta', date: '30/05', expected: 1204, actual: 1180, delta: -24 },
        { check: 'INV-10 revenue', storeName: 'zolplus', platform: 'Google', date: '30/05', expected: 3010, actual: 3142, delta: 132 },
      ],
    });

    renderBanner();

    const banner = await screen.findByTestId('reconcile-banner');
    expect(banner).toBeInTheDocument();
    // count of 2 violations surfaced in the copy
    expect(banner.textContent ?? '').toMatch(/2/);
    expect(banner.textContent ?? '').toMatch(/אי-התאמות/);
    // warning Badge present
    expect(banner.textContent ?? '').toMatch(/אי-התאמה/);

    // real anchor to /operator
    const link = screen.getByTestId('reconcile-banner-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/operator');
    expect(link.textContent ?? '').toMatch(/operator/);
  });

  it('renders nothing when there are zero violations', async () => {
    stubFetch({ violations: [] });

    const { container } = renderBanner();

    // Give SWR a tick to resolve, then assert still empty.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('reconcile-banner')).toBeNull();
    expect(container.querySelector('[data-testid="reconcile-banner"]')).toBeNull();
  });
});
