// @vitest-environment jsdom
//
// dashboard-web/src/app/operator/__tests__/OperatorTabs.dom.test.tsx
//
// Self-serve stores Phase 6a — the operator console tab shell is CONTROLLED so
// the ad-state "מצב פרסום" tab's "חבר" link can switch the console to the
// "חנויות" credential-matrix tab. This test renders the real OperatorTabs,
// drives into the ad-state tab, clicks a "חבר" link on an unconnected
// store×platform cell, and asserts the active tab flips to "חנויות".
//
// All operator sub-tabs self-fetch on mount via operatorFetch + global fetch;
// both are stubbed with benign responses so the shell mounts without crashing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };

// A store with NO google + NO tiktok credentials → its google/tiktok cells are
// "לא מחובר" with a "חבר" link.
const STORE_META = [
  {
    storeId: 'zolplus',
    storeName: 'Zol Plus',
    metaAdAccountId: '1',
    googleAdsCustomerId: null,
    tiktokAdvertiserId: null,
    planDisplayName: '',
    shopifyPlus: false,
    partnerDevelopment: false,
    updatedAt: null,
    lastError: null,
  },
];

function jsonRes(body: unknown): FakeRes {
  return { ok: true, status: 200, json: async () => body };
}

// operatorFetch: ad-state map empty (all-ON default), stores list empty.
vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async (url: string) => {
    if (url.includes('/api/operator/ad-state')) return jsonRes({ map: {} });
    if (url.endsWith('/api/operator/stores')) return jsonRes({ stores: [] });
    // Every other gated GET (token-failures, reconcile, coverage, jobs, …) gets
    // a benign empty 200 so the other tabs mount without throwing.
    return jsonRes({});
  }),
}));

import { OperatorTabs } from '../OperatorTabs';

beforeEach(() => {
  // Plain global fetch (e.g. /api/store-meta) → store-meta fixture, else empty.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/store-meta')) {
        return jsonRes({ rows: STORE_META }) as unknown as Response;
      }
      return jsonRes({}) as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('OperatorTabs — controlled tab shell (Phase 6a)', () => {
  it('switches to the "חנויות" tab when the ad-state "חבר" link is clicked', async () => {
    render(<OperatorTabs />);

    // Move to the "מצב פרסום" (ads) tab. Radix Tabs activate on mouseDown
    // (see Tabs primitive test), not click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'מצב פרסום' }));

    // The unconnected google cell for Zol Plus exposes a "חבר" link once
    // store-meta resolves.
    const connect = await screen.findByTestId('connect-zolplus-google');
    fireEvent.click(connect);

    // The "חנויות" tab is now the selected tab.
    await waitFor(() => {
      const storesTab = screen.getByRole('tab', { name: 'חנויות' });
      expect(storesTab.getAttribute('aria-selected')).toBe('true');
    });

    // And its panel content is visible (heading "חנויות" inside the active panel).
    const storesPanel = screen.getByRole('tabpanel');
    expect(within(storesPanel).getAllByText('חנויות').length).toBeGreaterThan(0);
  });

  it('defaults to the "בריאות" tab on mount', () => {
    render(<OperatorTabs />);
    const healthTab = screen.getByRole('tab', { name: 'בריאות' });
    expect(healthTab.getAttribute('aria-selected')).toBe('true');
  });
});
