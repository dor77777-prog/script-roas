// @vitest-environment jsdom
//
// Plan C — Task 9 (2026-06-02) — first-click ROAS lens in CampaignsTable.
//
// The Campaigns table renders a deterministic "ROAS Shopify" (last-click)
// column. Plan C adds a sibling first-click column: the value of the FIRST
// customer touch attributed to the campaign (from the order's ft_* / utm_id
// first-touch signal), at ~60-70% prominence beside last-click, plus a
// coverage chip (first-click-matched ÷ last-click-matched orders).
//
// We render the FULL CampaignsTable so the assertion is on the real painted
// body cell. CampaignsTable fetches via SWR, so global `fetch` is stubbed:
//   - /api/campaigns         → one in-range Meta campaign 'c1' (uzoshop, spend 100)
//   - /api/orders-attribution → one order whose FIRST touch (firstUtmId='c1')
//                               matches that campaign (totalCad 300, in range)
//   - every other endpoint    → safe empty payload
//
// Load-bearing assertions (the Task 9 contract):
//   - a first-click value cell keyed `first-click-roas-c1` renders
//   - the first-click coverage chip renders

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { CampaignsTable } from '@/components/CampaignsTable';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';

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

// One order whose FIRST touch matches campaign 'c1' (firstUtmId === campaignId).
const FIRST_CLICK_ORDER: OrderAttributionRow = {
  date: '2026-05-15',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  orderId: 'order-1',
  totalCad: 300,
  source: 'meta-paid',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  fbclidPresent: false,
  gclidPresent: false,
  referringSite: '',
  utmId: '',
  utmTerm: '',
  lineItems: [],
  customerId: null,
  orderCreatedAt: null,
  isFirstOrder: null,
  firstTouchSource: 'meta-paid',
  firstFbclidPresent: false,
  firstGclidPresent: false,
  firstTtclidPresent: false,
  firstUtmSource: null,
  firstUtmMedium: null,
  firstUtmCampaign: null,
  firstUtmContent: null,
  firstUtmId: 'c1', // ← first-touch matches the campaign id
  firstUtmTerm: null,
  firstSeenAt: null,
  paymentGateway: null,
};

const ORDERS_RESPONSE: OrdersAttributionResponse = {
  rows: [FIRST_CLICK_ORDER],
  lastUpdated: '2026-05-31T00:00:00.000Z',
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function installFetchMock() {
  const fn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/campaigns')) return jsonResponse(CAMPAIGNS_RESPONSE);
    if (url.includes('/api/orders-attribution')) return jsonResponse(ORDERS_RESPONSE);
    if (url.includes('/api/products')) {
      return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    }
    // store-meta, /api/data, and any other auxiliary read.
    return jsonResponse({ rows: [] });
  });
  vi.stubGlobal('fetch', fn);
}

const PROPS = {
  range: RANGE,
  store: 'uzoshop',
  stores: ['uzoshop'],
  dailyRows: [],
};

describe('CampaignsTable — first-click lens (Plan C Task 9)', () => {
  it('renders a first-click ROAS cell beside ROAS Shopify for a Meta campaign', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="first-click-roas-c1"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="first-click-roas-c1"]')).toBeTruthy();
  });

  it('renders the first-click coverage chip in the first-click cell', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="first-click-coverage-chip"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="first-click-coverage-chip"]')).toBeTruthy();
  });

  it('the first-click header column is present', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="firstClickRoas"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-col-id="firstClickRoas"]')?.textContent ?? '').toMatch(
      /first-click/,
    );
  });
});
