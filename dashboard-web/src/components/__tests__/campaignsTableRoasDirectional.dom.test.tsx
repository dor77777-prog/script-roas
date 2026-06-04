// @vitest-environment jsdom
//
// Task 16 (2026-06-02) — Demote per-platform ROAS to "directional / מכוון".
//
// The per-platform `roas` column reports the ROAS the AD PLATFORM itself
// claims (conversion_value ÷ spend from Meta Pixel / Google Ads / TikTok),
// which is NOT what Shopify actually recorded. To stop the operator reading
// it as ground truth, its header gains a "מכוון · directional" sub-label
// (mirroring the existing stacked `roasShopifyPlatform` header). By contrast,
// the deterministic "ROAS Shopify" column is promoted — this test pins that
// it stays present.
//
// We render the FULL CampaignsTable so the assertion is on the real painted
// header row. CampaignsTable fetches its data via SWR, so global `fetch` is
// stubbed: /api/campaigns returns one in-range Meta campaign (enough for the
// table — and therefore its <thead> — to render), every other endpoint
// returns a safe empty payload.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
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
    if (url.includes('/api/products')) {
      return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    }
    if (url.includes('/api/orders-attribution')) {
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

describe('CampaignsTable per-platform ROAS demotion (2026-06-02)', () => {
  it('the platform-ROAS header carries a "מכוון" (directional) sub-label', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="roas"]')).not.toBeNull();
    });
    const head = container.querySelector('[data-col-id="roas"]');
    expect(head?.textContent ?? '').toMatch(/מכוון/);
  });

  it('the deterministic "ROAS Shopify" header is still present (promoted)', async () => {
    installFetchMock();
    const { container } = render(<CampaignsTable {...PROPS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-col-id="roasShopify"]')).not.toBeNull();
    });
    const det = container.querySelector('[data-col-id="roasShopify"]');
    expect(det?.textContent ?? '').toContain('ROAS Shopify');
  });
});
