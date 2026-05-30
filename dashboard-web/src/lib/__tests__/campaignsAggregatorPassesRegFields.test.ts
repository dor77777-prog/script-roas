// dashboard-web/src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts

import { describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/campaignsAggregator';
import type { CampaignRow } from '@/lib/campaigns';

const baseRow = (overrides: Partial<CampaignRow>): CampaignRow => ({
  date: '2026-05-30',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'C1',
  campaignName: 'Test',
  adSetId: 'AS1',
  adSetName: 'AS',
  spend: 10,
  impressions: 100,
  clicks: 5,
  conversions: 1,
  conversionValue: 25,
  campaignBudgetCad: null,
  adSetBudgetCad: null,
  budgetType: '',
  effectiveStatus: null,
  lastLiveTickAt: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
  ...overrides,
});

describe('aggregate threads reg* fields through to Aggregated', () => {
  it('seeds the aggregate from the first matching CampaignRow', () => {
    const rows = [baseRow({
      regConfiguredStatus: 'ENABLED',
      regEffectiveStatus: 'ACTIVE',
      regDeliveryStatus: 'DELIVERING',
      regFirstSeenAt: '2026-05-20T00:00:00Z',
      regStatusChangedAt: '2026-05-28T12:00:00Z',
      regLastStatusSuccessAt: '2026-05-30T09:50:00Z',
    })];
    const out = aggregate(rows, 'campaign', 'All', 'all', { from: '2026-05-30', to: '2026-05-30' });
    expect(out).toHaveLength(1);
    expect(out[0].regConfiguredStatus).toBe('ENABLED');
    expect(out[0].regEffectiveStatus).toBe('ACTIVE');
    expect(out[0].regDeliveryStatus).toBe('DELIVERING');
    expect(out[0].regFirstSeenAt).toBe('2026-05-20T00:00:00Z');
    expect(out[0].regStatusChangedAt).toBe('2026-05-28T12:00:00Z');
    expect(out[0].regLastStatusSuccessAt).toBe('2026-05-30T09:50:00Z');
  });

  it("preserves reg* values across multiple rows for the same aggregate key", () => {
    // Two CampaignRow entries for the same (store, platform, campaign, adset)
    // should fold into one Aggregated; reg* fields from the seed row stay.
    const rows = [
      baseRow({
        date: '2026-05-28',
        regConfiguredStatus: 'ENABLED',
        regEffectiveStatus: 'ACTIVE',
        regDeliveryStatus: 'DELIVERING',
      }),
      baseRow({
        date: '2026-05-29',
        // Different status on the second row — should NOT overwrite the
        // seed because the registry is constant per (store, platform, campaign).
        regConfiguredStatus: 'PAUSED',
        regEffectiveStatus: 'PAUSED',
        regDeliveryStatus: 'NOT_DELIVERING',
      }),
    ];
    const out = aggregate(rows, 'campaign', 'All', 'all', { from: '2026-05-28', to: '2026-05-30' });
    expect(out).toHaveLength(1);
    expect(out[0].regConfiguredStatus).toBe('ENABLED');     // seeded from row 1
    expect(out[0].regEffectiveStatus).toBe('ACTIVE');
    expect(out[0].regDeliveryStatus).toBe('DELIVERING');
  });
});
