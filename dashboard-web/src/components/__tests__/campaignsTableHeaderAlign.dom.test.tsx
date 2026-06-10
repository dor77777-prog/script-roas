// @vitest-environment jsdom
//
// Numeric column header↔value alignment (operator request 2026-06-05).
//
// The earlier end-alignment left the (short) numbers clustered at the cell's
// flush edge, not under the header — "leaning". Per the operator the data
// columns are now CENTER-aligned (header label centered + value centered), so
// each value sits directly under the center of its column header. Only the
// numeric/data columns center; the campaign-name column stays start-aligned.
//
// We render the FULL CampaignsTable (SWR fetch stubbed) so the assertions hit
// the real painted <thead> + a body <td>, and check the center classes.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Pin desktop so the table thead renders its full SortHeader set.
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

/**
 * The clickable sort <button> inside a header cell. aria-sort moved to the
 * <th> itself (2026-06-10 audit — valid ARIA placement), so the sort button
 * is located as the cell's non-ⓘ button (the ⓘ help trigger carries an
 * aria-label starting with "הסבר").
 */
function sortButton(cell: HTMLElement): HTMLElement {
  expect(
    cell.getAttribute('aria-sort'),
    'sortable header <th> should carry aria-sort',
  ).not.toBeNull();
  const btn = Array.from(cell.querySelectorAll('button')).find(
    (b) => !(b.getAttribute('aria-label') ?? '').includes('הסבר'),
  ) as HTMLElement | undefined;
  expect(btn, 'header cell should contain a sort button').not.toBeUndefined();
  return btn as HTMLElement;
}

describe('CampaignsTable — numeric columns are CENTER-aligned (value under the column header)', () => {
  it('a numeric column (conversions) is center-aligned in BOTH the header and the body cell', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="conversions"]')).not.toBeNull();
    });
    const th = container.querySelector('th[data-col-id="conversions"]') as HTMLElement;
    const td = container.querySelector('td[data-col-id="conversions"]') as HTMLElement;
    expect(th, 'conversions header cell').not.toBeNull();
    expect(td, 'conversions body cell').not.toBeNull();
    // Header th + its sort button are centered → the label sits in the column center.
    expect(th.className).toContain('text-center');
    expect(sortButton(th).className).toContain('justify-center');
    // Body value is centered → it sits directly UNDER the centered header (operator
    // request 2026-06-05: align numeric values to the center of each column).
    expect(td.className).toContain('text-center');
  });

  it('the campaign-name column stays start-aligned (only numeric/data columns center)', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="campaignName"]')).not.toBeNull();
    });
    const th = container.querySelector('th[data-col-id="campaignName"]') as HTMLElement;
    expect(th.className).toContain('text-start');
  });
});
