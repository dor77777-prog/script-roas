// @vitest-environment jsdom
//
// 2026-06-10 audit — touch double-ⓘ in rich column-header tooltips
// (Wave 8A item 2).
//
// Pre-fix: on touch, ColumnHeaderTh's HelpTooltip (variant="rich") routed to
// the Toggletip/RichSheet PHRASING branch, which paired the child with a
// SECOND, gray ⓘ button — so each help column rendered TWO ⓘ glyphs: the
// operator's violet ⓘ was dead (its only handler is stopPropagation) and the
// duplicate gray one opened the surface.
//
// Post-fix: ColumnHeaderTh passes `touchTrigger="child"` so the EXISTING
// violet ⓘ Button IS the tap trigger — exactly ONE ⓘ renders and it opens
// the help surface (bottom Sheet when the column has a title/ariaLabel,
// tap-popover otherwise).
//
// Full CampaignsTable render (SWR fetch stubbed) so the assertions hit the
// real painted <thead>. TOUCH pointer mode is pinned via the pointer-
// capability hook.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent, within } from '@testing-library/react';

// Pin the TOUCH (coarse-pointer) branch.
vi.mock('@/components/ui/tooltip/useTouchTooltipMode', () => ({
  useTouchTooltipMode: () => true,
}));

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
  lastKnownBudgetTypes: {},
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

describe('CampaignsTable column-header help on TOUCH — single ⓘ trigger (item 2)', () => {
  it('a titled header (optimized) renders exactly ONE ⓘ and that ⓘ opens the bottom sheet', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('th[data-col-id="optimized"]')).not.toBeNull();
    });
    const cell = container.querySelector('th[data-col-id="optimized"]') as HTMLElement;

    // EXACTLY ONE button in the cell — the violet ⓘ. Pre-fix the RichSheet
    // phrasing branch paired it with a duplicate gray ⓘ (2 buttons).
    const buttons = within(cell).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('הסבר על סימון אופטימיזציה');

    // The violet ⓘ is ALIVE — tapping it opens the help sheet with the
    // column's copy + a visible ✕ close (the mode-D bottom Sheet).
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('צ׳קבוקס לסימון קמפיינים');
    expect(within(dialog).getByRole('button', { name: 'סגור' })).toBeInTheDocument();
  });

  it('an untitled SortHeader column (cpa) renders exactly ONE ⓘ help trigger and it opens the tap-popover', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('th[data-col-id="cpa"]')).not.toBeNull();
    });
    const cell = container.querySelector('th[data-col-id="cpa"]') as HTMLElement;

    // The cell has its sort button + EXACTLY ONE ⓘ help trigger.
    const infoButtons = within(cell).getAllByRole('button', { name: /הסבר/ });
    expect(infoButtons).toHaveLength(1);

    fireEvent.click(infoButtons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cost Per Acquisition');
  });
});
