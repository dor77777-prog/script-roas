// @vitest-environment jsdom
//
// ux-table-search (Wave 1) — the in-table free-text filter narrows the rendered
// rows by campaign name, and the export button is present. Renders the FULL
// CampaignsTable (SWR fetch stubbed) so the assertions hit the real toolbar +
// the real aggregate→sort→filter pipeline.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { CampaignsTable } from '@/components/CampaignsTable';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function campaign(id: string, name: string): CampaignRow {
  return {
    storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta',
    campaignId: id, campaignName: name, adSetId: id + '-as', adSetName: name + ' AS',
    date: '2026-05-15', spend: 100, conversionValue: 300, impressions: 1000, clicks: 25, conversions: 3,
    campaignBudgetCad: 50, adSetBudgetCad: 25, budgetType: 'CBO',
    effectiveStatus: null, regConfiguredStatus: null, regEffectiveStatus: null,
    regDeliveryStatus: null, regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
  };
}

const RESPONSE: CampaignsResponse = {
  rows: [campaign('c1', 'Winter Sale'), campaign('c2', 'Spring Launch')],
  lastUpdated: '2026-05-31T00:00:00.000Z',
  dataLastWriteAt: '2026-05-31T00:00:00.000Z',
  currentEffectiveStatus: {},
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/campaigns')) return jsonResponse(RESPONSE);
    if (url.includes('/api/products')) return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    if (url.includes('/api/orders-attribution')) return jsonResponse({ rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' });
    return jsonResponse({ rows: [] });
  }));
}

const PROPS = { range: RANGE, store: 'uzoshop', stores: ['uzoshop'], dailyRows: [] };

describe('CampaignsTable — in-table search (Wave 1)', () => {
  it('filters visible rows by campaign name and shows an export button', async () => {
    installFetchMock();
    render(<CampaignsTable {...PROPS} />);
    await waitFor(() => expect(screen.getByText('Winter Sale')).toBeInTheDocument());
    // both visible before searching
    expect(screen.getByText('Spring Launch')).toBeInTheDocument();
    // export button present
    expect(screen.getByLabelText('ייצוא CSV')).toBeInTheDocument();
    // type a query → only the matching row remains
    fireEvent.change(screen.getByLabelText('חיפוש בטבלה'), { target: { value: 'winter' } });
    await waitFor(() => expect(screen.queryByText('Spring Launch')).not.toBeInTheDocument());
    expect(screen.getByText('Winter Sale')).toBeInTheDocument();
  });
});
