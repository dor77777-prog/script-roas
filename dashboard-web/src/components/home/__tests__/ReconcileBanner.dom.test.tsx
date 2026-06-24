// @vitest-environment jsdom
//
// DQ-1 — ReconcileBanner DOM test. The component self-fetches via SWR from
// /api/operator/reconcile, so each test stubs `fetch` with a deterministic body
// and isolates the SWR cache (fresh Map provider + dedupingInterval 0) so one
// test's response never leaks into the next. We then `await waitFor(...)` for
// the post-fetch render to settle.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  ReconcileBanner,
  type ReconcileResponse,
} from '@/components/home/ReconcileBanner';
import { setReconcileAck } from '@/lib/reconcileAckStore';
import type { Violation } from '@/lib/audit/reconcile';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => { window.localStorage.clear(); });

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
        { label: 'INV-7 Meta spend 2026-05-30/uzoshop', detail: 'data_daily 1204 vs campaigns_daily 1180' }, // hard, no relGap → material
        { label: 'INV-10 orders vs data revenue 2026-05-30/Zol Plus', detail: 'data_daily 3010 vs orders_attribution 4515', relGap: 0.5 }, // ≥10% → material
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

  it('stays HIDDEN when the only violations are soft/sub-threshold (de-noise — no false alarm)', async () => {
    stubFetch({
      violations: [
        { label: 'INV-9 product vs data revenue 2026-06-01/uzoshop', detail: 'custom-item refunds', soft: true, relGap: 0.08 },
        { label: 'INV-10 orders vs data revenue 2026-05-31/uzoshop', detail: '6.7% gap', relGap: 0.067 },
      ],
    });
    const { container } = renderBanner();
    await waitFor(() => { expect(global.fetch).toHaveBeenCalled(); });
    expect(container.querySelector('[data-testid="reconcile-banner"]')).toBeNull();
  });

  it('the count reflects only UN-ACKED findings — acking one decrements it', async () => {
    const a: Violation = { label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 1204 vs campaigns_daily 1180' };
    const b: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/Zol Plus', detail: 'data_daily 3010 vs orders_attribution 4515', relGap: 0.5 };
    stubFetch({ violations: [a, b] });

    // Ack ONE of the two material findings BEFORE mount.
    setReconcileAck(a);

    renderBanner();
    const banner = await screen.findByTestId('reconcile-banner');
    // 2 material findings, 1 acked → banner shows 1.
    expect(banner.textContent ?? '').toMatch(/\b1\b/);
    expect(banner.textContent ?? '').not.toMatch(/\b2\b/);
  });

  it('disappears entirely once every material finding is acked', async () => {
    const a: Violation = { label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 1204 vs campaigns_daily 1180' };
    stubFetch({ violations: [a] });
    setReconcileAck(a);

    const { container } = renderBanner();
    await waitFor(() => { expect(global.fetch).toHaveBeenCalled(); });
    expect(container.querySelector('[data-testid="reconcile-banner"]')).toBeNull();
  });
});
