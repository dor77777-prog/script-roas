// campaignDrawerFetchError.dom.test.tsx — P0-4 (2026-06-10 full-system audit)
//
// The CampaignDrawer's four SWR fetchers used to swallow EVERY failure into
// `{ rows: [] }` (and never read the 200-degraded `error` body), so a real DB
// failure rendered all drawer panels as the plausible "no data" state — the
// exact P0-9 class fixed in AdsDrawer on 2026-06-09, one level up. This pins
// the new contract: SWR error state ⇒ a visible role=alert error strip, so
// fake-empty can never masquerade as truth.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Error-mode SWR mock — every drawer fetch reports a failure.
let swrErrorMode = true;
vi.mock('swr', () => ({
  default: () => ({
    data: undefined,
    isLoading: false,
    error: swrErrorMode ? new Error('CampaignDrawer: 500 Internal Server Error') : undefined,
  }),
}));

vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
  pullCloudKey: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({}),
  writeCampaignStoreMap: vi.fn(),
  campaignStoreKey: (a: string, b: string, c: string) => `${a}::${b}::${c}`,
  resolveStoreForCampaign: vi.fn(() => null),
}));

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, readProductMap: () => ({}), setMappedProducts: vi.fn() };
});

import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { CampaignRow } from '@/lib/campaigns';

function makeRow(): CampaignRow {
  return {
    date: '2026-05-30', storeId: 'uzoshop', storeName: 'uzoshop',
    platform: 'Meta', campaignId: 'c-err', campaignName: 'Err Campaign',
    adSetId: 'as-1', adSetName: 'AS 1',
    spend: 100, impressions: 1000, clicks: 50, conversions: 5, conversionValue: 200,
    campaignBudgetCad: null, adSetBudgetCad: null, budgetType: '',
    effectiveStatus: 'ACTIVE', lastLiveTickAt: null,
    regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
    regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
  };
}

describe('CampaignDrawer — fetch-failure strip (P0-4)', () => {
  it('renders a role=alert error strip when drawer data fetches fail (not silent empty tabs)', () => {
    swrErrorMode = true;
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="c-err"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    const alert = screen.getByTestId('campaign-drawer-fetch-error');
    expect(alert).toBeInTheDocument();
    expect(alert.getAttribute('role')).toBe('alert');
    // Names the failed sources + states this is a load failure, not no-data.
    expect(alert.textContent).toContain('שגיאה בטעינת');
    expect(alert.textContent).toContain('תקלת טעינה');
  });

  it('does NOT render the strip when fetches succeed', () => {
    swrErrorMode = false;
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="c-err"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    expect(screen.queryByTestId('campaign-drawer-fetch-error')).not.toBeInTheDocument();
  });
});
