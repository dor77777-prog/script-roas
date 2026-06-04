// dashboard-web/src/components/home/__tests__/SourceHealthChip.dom.test.tsx
//
// Wave 3 · Data-Trust (DQ-5) — DOM tests for the self-fetching
// <SourceHealthChip>.
//
// The component self-fetches via SWR (`/api/freshness-summary`,
// `fetchJsonOrNull`). We stub the GLOBAL fetch so SWR's real fetcher reads our
// deterministic body, and isolate the SWR cache per render via a fresh
// `SWRConfig` provider Map (dedupingInterval:0 so back-to-back renders don't
// dedupe across the cache). Then `waitFor` the resolved render.
//
// Health rule under test:
//   anyUnhealthy:true  → one danger Badge per unhealthy source, "● <platform> ·
//                        <status>" (+ " · <Nh>" lag), each in a HelpTooltip → /operator.
//   anyUnhealthy:false → renders nothing (chip hidden when healthy).
//   loading / null     → renders nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { SourceHealthChip } from '@/components/home/SourceHealthChip';

type Body = {
  anyUnhealthy: boolean;
  unhealthy: Array<{
    storeId: string;
    platform: string;
    status: string;
    lagMinutes: number | null;
  }>;
  error?: string;
};

function stubFetch(body: Body) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  // Fresh provider Map per render isolates the SWR cache; dedupingInterval:0
  // means each render actually hits the (stubbed) fetcher.
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<SourceHealthChip> — unhealthy', () => {
  it('renders a danger badge per unhealthy source with platform + status', async () => {
    stubFetch({
      anyUnhealthy: true,
      unhealthy: [
        { storeId: 'uzoshop', platform: 'Meta', status: 'auth_error', lagMinutes: null },
      ],
    });

    render(
      <Wrapper>
        <SourceHealthChip />
      </Wrapper>,
    );

    // Wait for SWR to resolve the stubbed body and the chip to mount.
    const badge = await screen.findByTestId('source-health-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Meta');
    expect(badge.textContent).toContain('auth_error');
    // danger tone → red status tokens (mockup .badge.danger).
    expect(badge.className).toMatch(/status-redBg/);
    expect(badge.className).toMatch(/status-redFg/);
    // platform/status are LTR-isolated for RTL safety.
    expect(badge.querySelector('bdi[dir="ltr"]')).not.toBeNull();
  });

  it('formats lagMinutes into hours and appends it to the badge', async () => {
    stubFetch({
      anyUnhealthy: true,
      unhealthy: [
        { storeId: 'zolplus', platform: 'Google', status: 'transient_error', lagMinutes: 360 },
      ],
    });

    render(
      <Wrapper>
        <SourceHealthChip />
      </Wrapper>,
    );

    const badge = await screen.findByTestId('source-health-badge');
    expect(badge.textContent).toContain('Google');
    // 360 min → 6h.
    expect(badge.textContent).toMatch(/6h/);
  });

  it('renders one badge per unhealthy source', async () => {
    stubFetch({
      anyUnhealthy: true,
      unhealthy: [
        { storeId: 'uzoshop', platform: 'Meta', status: 'auth_error', lagMinutes: null },
        { storeId: 'zolplus', platform: 'Google', status: 'transient_error', lagMinutes: 360 },
      ],
    });

    render(
      <Wrapper>
        <SourceHealthChip />
      </Wrapper>,
    );

    const badges = await screen.findAllByTestId('source-health-badge');
    expect(badges).toHaveLength(2);
  });
});

describe('<SourceHealthChip> — healthy / loading', () => {
  it('renders nothing when anyUnhealthy is false', async () => {
    stubFetch({ anyUnhealthy: false, unhealthy: [] });

    const { container } = render(
      <Wrapper>
        <SourceHealthChip />
      </Wrapper>,
    );

    // Give SWR a tick to resolve, then assert still empty.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="source-health-badge"]')).toBeNull();
    });
    expect(container.textContent).toBe('');
  });

  it('renders nothing while loading (no data yet)', () => {
    // fetch never resolves → data stays undefined → hidden.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
    const { container } = render(
      <Wrapper>
        <SourceHealthChip />
      </Wrapper>,
    );
    expect(container.textContent).toBe('');
  });
});
