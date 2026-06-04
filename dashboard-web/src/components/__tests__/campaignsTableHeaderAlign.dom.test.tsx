// @vitest-environment jsdom
//
// BUG #1 — numeric column headers mis-align with their values.
//
// Each SortHeader rendered `<span>{label}</span>` THEN the sort arrow. Even the
// invisible inactive ArrowUpDown (opacity-0) still occupies layout, so with the
// Button's justify-end (RTL) the arrow sat at the flush edge and pushed the
// header LABEL ~12-16px inboard of the text-end numeric body cells.
//
// Fix: for align='end' columns render the sort arrow BEFORE the label, so the
// label becomes the flush (leftmost under RTL) element and lines up with the
// end-aligned numbers. align='start'/'center' keep label-first.
//
// We render the FULL CampaignsTable (SWR fetch stubbed) so the assertions hit
// the real painted <thead>, then inspect DOM child order inside each header's
// sort Button.

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

/** The clickable sort <button> inside a header cell carries aria-sort. */
function sortButton(cell: HTMLElement): HTMLElement {
  const btn = cell.querySelector('button[aria-sort]') as HTMLElement | null;
  expect(btn, 'header cell should contain an aria-sort button').not.toBeNull();
  return btn as HTMLElement;
}

describe('CampaignsTable header alignment — sort arrow before label for numeric columns (BUG #1)', () => {
  it('an align="end" numeric column (conversions) renders the sort arrow BEFORE the label span', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="conversions"]')).not.toBeNull();
    });
    const cell = container.querySelector('[data-col-id="conversions"]') as HTMLElement;
    const btn = sortButton(cell);
    const svg = btn.querySelector('svg') as SVGElement | null;
    const span = btn.querySelector('span') as HTMLElement | null;
    expect(svg, 'sort arrow svg should exist').not.toBeNull();
    expect(span, 'label span should exist').not.toBeNull();
    // The label span is the LAST child → it comes AFTER the arrow svg.
    const kids = Array.from(btn.children);
    expect(kids[kids.length - 1]).toBe(span);
    expect(
      svg!.compareDocumentPosition(span!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'label span must follow the sort arrow svg in DOM order',
    ).toBeTruthy();
  });

  it('an align="start" column (campaign name) keeps the label BEFORE the sort arrow', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="campaignName"]')).not.toBeNull();
    });
    const cell = container.querySelector('[data-col-id="campaignName"]') as HTMLElement;
    const btn = sortButton(cell);
    const svg = btn.querySelector('svg') as SVGElement | null;
    const span = btn.querySelector('span') as HTMLElement | null;
    expect(svg, 'sort arrow svg should exist').not.toBeNull();
    expect(span, 'label span should exist').not.toBeNull();
    // The label span is the FIRST child → it comes BEFORE the arrow svg.
    expect(btn.children[0]).toBe(span);
    expect(
      span!.compareDocumentPosition(svg!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'sort arrow svg must follow the label span in DOM order',
    ).toBeTruthy();
  });
});
