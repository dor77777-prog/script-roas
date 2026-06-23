// @vitest-environment jsdom
//
// 2026-06-10 audit — Wave 8A items 5 + 6.
//
// Item 5 (keyboard row drilldown): campaign + ad-set row drilldown was a
// bare <tr onClick> — no tabIndex, no Enter/Space — so the core daily
// drilldown was unreachable by keyboard. Rows now adopt the Card.tsx
// keyboard pattern: tabIndex=0 on drillable rows, Enter/Space trigger the
// drill, focus-visible ring via existing tokens. The native `row` role is
// KEPT (role="button" on a <tr> is invalid ARIA — it would break the
// table's required structure and flatten the cells for screen readers).
//
// Item 6 (aria-sort placement): aria-sort sat on the inner sort <Button>
// — invalid ARIA (the attribute is only defined for header cells), so sort
// state was never announced. It now sits on the <th>.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

import { CampaignsTableRow } from '@/components/CampaignsTableRow';
import { AdSetTable } from '@/components/AdSetTable';
import { CampaignsTable } from '@/components/CampaignsTable';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { AdAccountMap } from '@/lib/campaignsLinks';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

const AGG: Aggregated = {
  key: 'uzoshop::Meta::c1::adset-1',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'c1',
  campaignName: 'Campaign One',
  adSetId: 'adset-1',
  adSetName: 'Ad Set 1',
  spend: 100,
  impressions: 1000,
  clicks: 25,
  conversions: 2,
  conversionValue: 300,
  campaignBudgetCad: 50,
  adSetBudgetCad: 25,
  budgetType: 'CBO',
  lastActiveDate: '2026-06-09',
  effectiveStatus: 'ACTIVE',
  lastLiveTickAt: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

function renderCampaignRow(onDrillCampaign = vi.fn()) {
  render(
    <table>
      <tbody>
        <CampaignsTableRow
          a={AGG}
          i={0}
          mode="campaign"
          trueRevenueByKey={new Map()}
          firstClickByCampaign={new Map()}
          mappedCampaignKeys={new Set()}
          health={undefined}
          columnOrder={['spend', 'roas', 'conversions']}
          adAccounts={{} as AdAccountMap}
          optimized={new Set()}
          today="2026-06-10"
          rangeIncludesToday={false}
          onToggleOptimized={vi.fn()}
          onDrillCampaign={onDrillCampaign}
          onDrillAd={vi.fn()}
        />
      </tbody>
    </table>,
  );
  return onDrillCampaign;
}

const AD_SET = {
  id: 'as1',
  name: 'Set One',
  storeId: 'uzoshop',
  platform: 'Meta',
  campaignId: 'c1',
  spend: 10,
  value: 20,
  clicks: 5,
  impressions: 100,
  conversions: 1,
  adSetBudgetCad: null,
  roas: 2,
};

function renderAdSetTable(onDrillAds = vi.fn()) {
  render(
    <AdSetTable
      adSets={[AD_SET]}
      sortKey="spend"
      sortDir="desc"
      onSort={vi.fn()}
      attributionByAdSet={new Map()}
      optimized={new Set()}
      onToggleOptimized={vi.fn()}
      onDrillAds={onDrillAds}
      rangeIncludesToday={false}
      onMapProducts={vi.fn()}
      mappingByAdSet={new Map()}
    />
  );
  return onDrillAds;
}

// --------------------------------------------------------------------------
// Item 5 — keyboard row drilldown
// --------------------------------------------------------------------------

describe('keyboard row drilldown (item 5)', () => {
  it('a drillable campaign row is focusable (tabIndex=0) and Enter opens the drill exactly once', () => {
    const onDrill = renderCampaignRow();
    const row = screen.getByRole('row');

    expect(row).toHaveAttribute('tabindex', '0');

    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith('c1', 'Meta', 'uzoshop');
  });

  it('Space also triggers the campaign drill (Card.tsx pattern)', () => {
    const onDrill = renderCampaignRow();
    const row = screen.getByRole('row');
    fireEvent.keyDown(row, { key: ' ' });
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('Enter on an in-row button does NOT also fire the row drill (target guard)', () => {
    const onDrill = renderCampaignRow();
    const row = screen.getByRole('row');
    const toggle = within(row).getByRole('button', { name: 'סמן כאופטימיזציה בוצעה' });
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(onDrill).not.toHaveBeenCalled();
  });

  it('the row keeps its native `row` role (no role=button — that would be invalid table ARIA)', () => {
    renderCampaignRow();
    const row = screen.getByRole('row');
    expect(row).not.toHaveAttribute('role');
  });

  it('a drillable AD-SET row is focusable and Enter fires onDrillAds exactly once', () => {
    const onDrillAds = renderAdSetTable();
    // rows: [0] header, [1] the ad-set body row
    const rows = screen.getAllByRole('row');
    const bodyRow = rows[rows.length - 1];

    expect(bodyRow).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(bodyRow, { key: 'Enter' });
    expect(onDrillAds).toHaveBeenCalledTimes(1);
    expect(onDrillAds).toHaveBeenCalledWith({
      storeId: 'uzoshop',
      campaignId: 'c1',
      adSetId: 'as1',
      adSetName: 'Set One',
    });
  });
});

// --------------------------------------------------------------------------
// Item 6 — aria-sort on the <th>, never on the inner button
// --------------------------------------------------------------------------

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

describe('aria-sort placement (item 6)', () => {
  it('CampaignsTable: aria-sort sits on the <th> (default sort roas/desc) and on NO button', async () => {
    installFetchMock();
    const { container } = render(
      <CampaignsTable
        range={{ from: '2026-05-01', to: '2026-05-31' }}
        store="uzoshop"
        stores={['uzoshop']}
        dailyRows={[]}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('th[data-col-id="roas"]')).not.toBeNull();
    });

    // The active sort column's <th> announces its direction…
    const active = container.querySelector('th[data-col-id="roas"]');
    expect(active?.getAttribute('aria-sort')).toBe('descending');
    // …inactive sortable columns carry aria-sort="none" on the <th>…
    const inactive = container.querySelector('th[data-col-id="spend"]');
    expect(inactive?.getAttribute('aria-sort')).toBe('none');
    // …and NO button anywhere carries aria-sort (invalid ARIA placement).
    expect(container.querySelector('button[aria-sort]')).toBeNull();
  });

  it('AdSetTable: aria-sort sits on the <th> and on NO button', () => {
    const { container } = renderAdSetTableForSort();
    const active = Array.from(container.querySelectorAll('th[aria-sort]'));
    expect(active.length).toBeGreaterThan(0);
    expect(
      active.some((th) => th.getAttribute('aria-sort') === 'descending'),
    ).toBe(true);
    expect(container.querySelector('button[aria-sort]')).toBeNull();
  });
});

function renderAdSetTableForSort() {
  return render(
    <AdSetTable
      adSets={[AD_SET]}
      sortKey="spend"
      sortDir="desc"
      onSort={vi.fn()}
      attributionByAdSet={new Map()}
      optimized={new Set()}
      onToggleOptimized={vi.fn()}
      onDrillAds={vi.fn()}
      rangeIncludesToday={false}
      onMapProducts={vi.fn()}
      mappingByAdSet={new Map()}
    />
  );
}
