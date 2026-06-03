// @vitest-environment jsdom
//
// Tooltip-system-redesign — Phase 3b.
//
// CampaignsTable's ColumnHeaderTh (the cell used by the 4 direct headers AND
// every SortHeader metric column) hand-rolled an absolutely-positioned
// role="tooltip" span that was CLIPPED by the table's overflow-auto wrapper
// (the long-standing `:2616` TODO). It now rides the sanctioned HelpTooltip
// primitive in variant="rich" mode via a dedicated ⓘ affordance — a PORTALLED
// Radix Popover (role="dialog") that escapes the scroll container.
//
// We render the FULL CampaignsTable (SWR fetch stubbed) so the assertions hit
// the real painted <thead>. Desktop is pinned (useIsMobile → false) so rich is
// a Radix Popover. We prove: every help column exposes an ⓘ button; clicking
// one opens a portalled role=dialog with the column's exact help copy; it is
// never a role=tooltip.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent, within } from '@testing-library/react';

// Pin desktop so the rich path is a Radix Popover (role="dialog").
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { CampaignsTable } from '@/components/CampaignsTable';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

const CAMPAIGN_ROW: CampaignRow = {
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'c1',
  campaignName: 'Campaign 1',
  adSetId: 'adset-1',
  adSetName: 'Ad Set 1',
  date: '2026-05-15',
  spend: 100,
  conversionValue: 200,
  impressions: 1000,
  clicks: 25,
  conversions: 1,
  campaignBudgetCad: 50,
  adSetBudgetCad: 25,
  budgetType: 'CBO',
  effectiveStatus: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

const CAMPAIGNS_RESPONSE: CampaignsResponse = {
  rows: [CAMPAIGN_ROW],
  lastUpdated: '2026-05-31T00:00:00.000Z',
  dataLastWriteAt: '2026-05-31T00:00:00.000Z',
  currentEffectiveStatus: {},
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function installFetchMock() {
  const fn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/campaigns')) return jsonResponse(CAMPAIGNS_RESPONSE);
    if (url.includes('/api/products')) {
      return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    }
    if (url.includes('/api/orders-attribution')) {
      return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    }
    return jsonResponse({ rows: [] });
  });
  vi.stubGlobal('fetch', fn);
}

const PROPS = { range: RANGE, store: 'uzoshop', stores: ['uzoshop'], dailyRows: [] };

describe('CampaignsTable header help — rich primitive (Phase 3b)', () => {
  it('the roasTrend (direct ColumnHeaderTh) header exposes an ⓘ that opens a portalled role=dialog with its exact copy', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="roasTrend"]')).not.toBeNull();
    });
    const cell = container.querySelector('[data-col-id="roasTrend"]') as HTMLElement;
    // the visible label is preserved …
    expect(cell.textContent ?? '').toContain('מגמה');
    // … and an ⓘ help trigger lives in the cell
    const info = within(cell).getByRole('button', { name: /הסבר/ });
    fireEvent.click(info);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('מגמת ROAS היומית בטווח המסונן');
    // portalled — escapes the overflow-auto wrapper (no longer clipped)
    expect(document.body.contains(dialog)).toBe(true);
    expect(cell.contains(dialog)).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('the optimized (direct ColumnHeaderTh, ariaLabel) header ⓘ opens its exact copy', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="optimized"]')).not.toBeNull();
    });
    const cell = container.querySelector('[data-col-id="optimized"]') as HTMLElement;
    fireEvent.click(within(cell).getByRole('button', { name: 'הסבר על סימון אופטימיזציה' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('צ׳קבוקס לסימון קמפיינים');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a SortHeader column (cpa) routes its tooltip through the same ⓘ → role=dialog path', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="cpa"]')).not.toBeNull();
    });
    const cell = container.querySelector('[data-col-id="cpa"]') as HTMLElement;
    // sort label still present + sortable
    expect(cell.textContent ?? '').toContain('CPA');
    fireEvent.click(within(cell).getByRole('button', { name: /הסבר/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cost Per Acquisition');
    expect(document.body.contains(dialog)).toBe(true);
  });
});
