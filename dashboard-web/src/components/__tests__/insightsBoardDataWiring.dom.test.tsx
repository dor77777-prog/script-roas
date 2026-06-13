// @vitest-environment jsdom
//
// Regression guard for the 2026-06-04 "empty board" bug: InsightsBoard fetched
// /api/campaigns, /api/ads, /api/products, /api/data with NO ?from=&to= params.
// Those routes REQUIRE the range (parseRangeParams throws otherwise) and return
// empty — so recommendations + the WS3 detectors got [] and the board (+ action
// list) was silently blank, especially once the dashboard default range became
// "today".
//
// This renders the FULL InsightsBoard with a stubbed fetch and asserts:
//   1. it requests /api/campaigns WITH a from=&to= range, and
//   2. a went-dark campaign in that range surfaces in the action list.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { InsightsBoard } from '@/components/InsightsBoard';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { DashboardData } from '@/lib/types';
import type { AdStateMap } from '@/lib/adState';
import { getTodayInIsraelTz } from '@/lib/dateRange';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = getTodayInIsraelTz();

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function campaign(date: string, spend: number): CampaignRow {
  return {
    storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta',
    campaignId: 'cdead', campaignName: 'Dead Winner', adSetId: 'as1', adSetName: 'as1',
    date, spend, conversionValue: spend * 3, impressions: 1000, clicks: 25, conversions: 3,
    campaignBudgetCad: 50, adSetBudgetCad: 25, budgetType: 'CBO',
    effectiveStatus: null, regConfiguredStatus: null, regEffectiveStatus: null,
    regDeliveryStatus: null, regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
  };
}

// 8 active days (today-2 … today-9) at CAD 100/day, and NO row for the most
// recent completed day (today-1) → "went dark" (missing recent row = 0 spend).
function wentDarkRows(): CampaignRow[] {
  const rows: CampaignRow[] = [];
  for (let i = 2; i <= 9; i++) rows.push(campaign(addDays(TODAY, -i), 100));
  return rows;
}

const CAMPAIGNS: CampaignsResponse = {
  rows: wentDarkRows(),
  lastUpdated: `${TODAY}T00:00:00.000Z`,
  dataLastWriteAt: `${TODAY}T00:00:00.000Z`,
  currentEffectiveStatus: {},
  lastKnownBudgetTypes: {},
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

// A second campaign row for a different store/platform — used in ads-off tests.
function metaCampaignRow(date: string): CampaignRow {
  return {
    storeId: 'usmile360', storeName: 'usmile360', platform: 'Meta',
    campaignId: 'c-usmile', campaignName: 'usmile Winner', adSetId: 'as2', adSetName: 'as2',
    date, spend: 100, conversionValue: 300, impressions: 1000, clicks: 25, conversions: 3,
    campaignBudgetCad: 50, adSetBudgetCad: 25, budgetType: 'CBO',
    effectiveStatus: null, regConfiguredStatus: null, regEffectiveStatus: null,
    regDeliveryStatus: null, regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
  };
}

// 8 active days for usmile360/Meta (today-2 … today-9), no today-1 row → "went dark".
function usmileWentDarkRows(): CampaignRow[] {
  const rows: CampaignRow[] = [];
  for (let i = 2; i <= 9; i++) rows.push(metaCampaignRow(addDays(TODAY, -i)));
  return rows;
}

describe('InsightsBoard — ads-off adStateMap wiring', () => {
  it('suppresses insights for an off (store,platform) and keeps insights for an on store', async () => {
    // uzoshop/Meta went dark (from wentDarkRows) → should produce a "Dead Winner כבה" insight
    // usmile360/Meta went dark (from usmileWentDarkRows) → "usmile Winner כבה" insight
    // adStateMap marks usmile360:meta=false (OFF), uzoshop:meta=true (ON / default)
    const adStateMap: AdStateMap = { 'usmile360:meta': false };
    const storeApplicablePlatforms = {
      uzoshop: ['meta' as const],
      usmile360: ['meta' as const],
    };

    const allCampaigns: CampaignsResponse = {
      rows: [...wentDarkRows(), ...usmileWentDarkRows()],
      lastUpdated: `${TODAY}T00:00:00.000Z`,
      dataLastWriteAt: `${TODAY}T00:00:00.000Z`,
      currentEffectiveStatus: {},
      lastKnownBudgetTypes: {},
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/campaigns')) return jsonResponse(allCampaigns);
      if (url.includes('/api/data')) return jsonResponse({ rows: [], stores: [], lastUpdated: `${TODAY}T00:00:00.000Z`, adStateMap, storeApplicablePlatforms });
      if (url.includes('/api/ads')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      if (url.includes('/api/products')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      return jsonResponse({ rows: [] });
    }));

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InsightsBoard data={{ rows: [], stores: [], adStateMap, storeApplicablePlatforms } as unknown as DashboardData} />
      </SWRConfig>,
    );

    // ON store's insight ("Dead Winner") must appear in the action list
    await waitFor(() =>
      expect(screen.getByTestId('action-list-panel').textContent).toContain('Dead Winner'),
    );

    // OFF store's insight ("usmile Winner") must NOT appear anywhere
    expect(screen.queryByText(/usmile Winner/)).toBeNull();
  });
});

describe('InsightsBoard — data wiring (range-scoped fetch)', () => {
  it('fetches campaigns WITH a from=&to= range and surfaces a went-dark campaign in the action list', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);
      if (url.includes('/api/campaigns')) return jsonResponse(CAMPAIGNS);
      if (url.includes('/api/data')) return jsonResponse({ rows: [], stores: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      if (url.includes('/api/ads')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      if (url.includes('/api/products')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      return jsonResponse({ rows: [] });
    }));

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InsightsBoard data={{ rows: [], stores: [] } as unknown as DashboardData} />
      </SWRConfig>,
    );

    // The action list surfaces the critical "כבה" (went-dark) insight…
    await waitFor(() =>
      expect(screen.getByTestId('action-list-panel').textContent).toContain('כבה'),
    );
    expect(screen.getByText(/Dead Winner כבה/)).toBeInTheDocument();

    // …and it only could have, because the campaigns fetch carried a real range.
    const campaignsUrl = calledUrls.find((u) => u.includes('/api/campaigns'));
    expect(campaignsUrl).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  });
});

describe('InsightsBoard — Horizon re-skin (W3.7)', () => {
  it('renders neutral Horizon headers (no accent-gradient band) and lucide-only icons (no emoji)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/campaigns')) return jsonResponse(CAMPAIGNS);
      if (url.includes('/api/data')) return jsonResponse({ rows: [], stores: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      if (url.includes('/api/ads')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      if (url.includes('/api/products')) return jsonResponse({ rows: [], lastUpdated: `${TODAY}T00:00:00.000Z` });
      return jsonResponse({ rows: [] });
    }));

    const { container } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InsightsBoard data={{ rows: [], stores: [] } as unknown as DashboardData} />
      </SWRConfig>,
    );

    // Wait until the surface has data (the went-dark insight surfaced).
    await waitFor(() =>
      expect(screen.getByTestId('action-list-panel').textContent).toContain('כבה'),
    );

    // The accent-gradient header band (old recipe) is gone from BOTH the
    // ActionListPanel header and the board header.
    expect(container.querySelector('[class*="bg-gradient-to-l"]')).toBeNull();
    // The board + action-list icons are lucide <svg>s; no emoji codepoint
    // leaks into the rendered text (Horizon rule: lucide, never emoji).
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    expect(emoji.test(container.textContent ?? '')).toBe(false);
  });
});
