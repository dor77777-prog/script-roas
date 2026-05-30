import { describe, expect, it } from 'vitest';
import { filterDrillRows } from '@/lib/drillFilter';
import type { CampaignRow } from '@/lib/campaigns';

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const base: CampaignRow = {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-shared',
    campaignName: 'Shared Campaign',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    date: '2026-05-15',
    spend: 100,
    conversionValue: 0,
    impressions: 1000,
    clicks: 20,
    conversions: 1,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
  };
  return { ...base, ...overrides };
}

describe('drilldown isolation — locks FIX-03 (CODEX-NEW-P1-01, 5.2.2.1)', () => {
  const rows = [
    makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', conversionValue: 100 }),
    makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', conversionValue: 50 }),
    makeRow({ storeId: 'zolplus', storeName: 'Zol Plus', conversionValue: 999 }),
    makeRow({ storeId: 'zolplus', storeName: 'Zol Plus', conversionValue: 888 }),
  ];

  it('drilldown from uzoshop returns only uzoshop rows', () => {
    const out = filterDrillRows(rows, {
      storeId: 'uzoshop',
      platform: 'Meta',
      campaignId: 'camp-shared',
      rangeFrom: '2026-05-01',
      rangeTo: '2026-05-31',
    });

    expect(out).toHaveLength(2);
    expect(out.every(r => r.storeId === 'uzoshop')).toBe(true);
  });

  it('drilldown from zolplus returns only zolplus rows', () => {
    const out = filterDrillRows(rows, {
      storeId: 'zolplus',
      platform: 'Meta',
      campaignId: 'camp-shared',
      rangeFrom: '2026-05-01',
      rangeTo: '2026-05-31',
    });

    expect(out).toHaveLength(2);
    expect(out.every(r => r.storeId === 'zolplus')).toBe(true);
  });

  it('platform mismatch returns empty even when storeId and campaignId match', () => {
    const out = filterDrillRows(rows, {
      storeId: 'uzoshop',
      platform: 'Google',
      campaignId: 'camp-shared',
      rangeFrom: '2026-05-01',
      rangeTo: '2026-05-31',
    });

    expect(out).toHaveLength(0);
  });

  it('out-of-range dates are excluded', () => {
    const out = filterDrillRows(rows, {
      storeId: 'uzoshop',
      platform: 'Meta',
      campaignId: 'camp-shared',
      rangeFrom: '2026-06-01',
      rangeTo: '2026-06-30',
    });

    expect(out).toHaveLength(0);
  });
});
