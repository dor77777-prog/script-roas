import { describe, expect, it } from 'vitest';
import { aggregate, type AggregateMode } from '@/lib/campaignsAggregator';
import type { CampaignRow } from '@/lib/campaigns';

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const base: CampaignRow = {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Campaign 1',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    date: '2026-05-15',
    spend: 100,
    conversionValue: 0,
    impressions: 1000,
    clicks: 25,
    conversions: 1,
    campaignBudgetCad: 50,
    adSetBudgetCad: 25,
    budgetType: 'CBO',
  };
  return { ...base, ...overrides };
}

function aggregateSingle(rows: CampaignRow[], mode: AggregateMode): ReturnType<typeof aggregate>[number] {
  const out = aggregate(rows, mode, 'All', 'all', RANGE);
  expect(out).toHaveLength(1);
  return out[0];
}

describe('aggregate() — locks FIX-05, FIX-06, FIX-13', () => {
  it('FIX-05: latest-date budget wins; backfilled day appended late does not revert', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-15', campaignBudgetCad: 50 }),
      makeRow({ date: '2026-05-16', campaignBudgetCad: 60 }),
      makeRow({ date: '2026-05-14', campaignBudgetCad: 40 }),
    ], 'campaign');

    expect(row.campaignBudgetCad).toBe(60);
  });

  it('FIX-13: strict > keeps first-observed budget for duplicate dates', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-15', campaignBudgetCad: 50 }),
      makeRow({ date: '2026-05-15', campaignBudgetCad: 70 }),
    ], 'campaign');

    expect(row.campaignBudgetCad).toBe(50);
  });

  it('FIX-06: CBO -> ABO switch clears campaignBudgetCad on output', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-14', budgetType: 'CBO', campaignBudgetCad: 50, adSetBudgetCad: null }),
      makeRow({ date: '2026-05-15', budgetType: 'ABO', campaignBudgetCad: 50, adSetBudgetCad: 30 }),
    ], 'adset');

    expect(row.budgetType).toBe('ABO');
    expect(row.campaignBudgetCad).toBeNull();
    expect(row.adSetBudgetCad).toBe(30);
  });

  it('FIX-06: ABO -> CBO switch clears adSetBudgetCad on output', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-14', budgetType: 'ABO', campaignBudgetCad: null, adSetBudgetCad: 30 }),
      makeRow({ date: '2026-05-15', budgetType: 'CBO', campaignBudgetCad: 50, adSetBudgetCad: 30 }),
    ], 'adset');

    expect(row.budgetType).toBe('CBO');
    expect(row.campaignBudgetCad).toBe(50);
    expect(row.adSetBudgetCad).toBeNull();
  });
});
