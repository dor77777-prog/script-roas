import { describe, it, expect } from 'vitest';
import { tiktokCoverage } from '@/lib/home/tiktokCoverage';
import { campaignStoreKey } from '@/lib/campaignStoreMap';

// DQ-7 — TikTok account-vs-per-campaign coverage.
//
// TikTok runs a single shared ad account whose campaigns are split across
// stores via the campaign-store-map (default store 'uzoshop', remappable
// per campaign — see campaignStoreMap.ts + ARCHITECTURE §A.5). This pure
// helper mirrors that key + default-store logic to surface (a) which
// campaigns are NOT mapped and (b) how much account spend is unattributed
// to any campaign (the INV-7 account-level ≥ Σ per-campaign gap, clamped
// to never go negative — campaigns can over-report vs the account total).

const ADV = '7000000000000000001'; // shared TikTok advertiser id

function key(campaignId: string): string {
  return campaignStoreKey('tiktok', ADV, campaignId);
}

describe('tiktokCoverage (DQ-7)', () => {
  it('all campaigns mapped → no unmapped ids', () => {
    const storeMap = {
      [key('c1')]: 'uzoshop',
      [key('c2')]: 'usmile360',
    };
    const res = tiktokCoverage({
      accountTotalCad: 100,
      campaigns: [
        { campaignId: 'c1', advertiserId: ADV, spendCad: 60 },
        { campaignId: 'c2', advertiserId: ADV, spendCad: 40 },
      ],
      storeMap,
    });
    expect(res.unmappedCampaignIds).toEqual([]);
    expect(res.mappedSpendCad).toBe(100);
    expect(res.unattributedSpendCad).toBe(0);
  });

  it('lists an unmapped campaign and excludes its spend from mappedSpendCad', () => {
    const storeMap = {
      [key('c1')]: 'uzoshop',
    };
    const res = tiktokCoverage({
      accountTotalCad: 100,
      campaigns: [
        { campaignId: 'c1', advertiserId: ADV, spendCad: 60 },
        { campaignId: 'c2', advertiserId: ADV, spendCad: 40 },
      ],
      storeMap,
    });
    expect(res.unmappedCampaignIds).toEqual(['c2']);
    expect(res.mappedSpendCad).toBe(60);
    // account == Σ campaigns (100), so nothing unattributed even though c2 unmapped.
    expect(res.unattributedSpendCad).toBe(0);
  });

  it('defaultStoreId applies → campaign counts as mapped even without an entry', () => {
    const res = tiktokCoverage({
      accountTotalCad: 50,
      campaigns: [{ campaignId: 'c9', advertiserId: ADV, spendCad: 50 }],
      storeMap: {},
      defaultStoreId: 'uzoshop',
    });
    expect(res.unmappedCampaignIds).toEqual([]);
    expect(res.mappedSpendCad).toBe(50);
    expect(res.unattributedSpendCad).toBe(0);
  });

  it('no entry and no defaultStoreId → campaign is unmapped', () => {
    const res = tiktokCoverage({
      accountTotalCad: 50,
      campaigns: [{ campaignId: 'c9', advertiserId: ADV, spendCad: 50 }],
      storeMap: {},
    });
    expect(res.unmappedCampaignIds).toEqual(['c9']);
    expect(res.mappedSpendCad).toBe(0);
  });

  it('account total > Σ campaigns → positive unattributed spend', () => {
    const res = tiktokCoverage({
      accountTotalCad: 100,
      campaigns: [
        { campaignId: 'c1', advertiserId: ADV, spendCad: 60 },
        { campaignId: 'c2', advertiserId: ADV, spendCad: 30 },
      ],
      storeMap: { [key('c1')]: 'uzoshop', [key('c2')]: 'uzoshop' },
    });
    // 100 account − 90 Σcampaigns = 10 unattributed.
    expect(res.unattributedSpendCad).toBe(10);
    expect(res.mappedSpendCad).toBe(90);
    expect(res.unmappedCampaignIds).toEqual([]);
  });

  it('account total ≤ Σ campaigns (TikTok over-report) → unattributed clamped to 0', () => {
    const res = tiktokCoverage({
      accountTotalCad: 80,
      campaigns: [
        { campaignId: 'c1', advertiserId: ADV, spendCad: 60 },
        { campaignId: 'c2', advertiserId: ADV, spendCad: 40 },
      ],
      storeMap: { [key('c1')]: 'uzoshop', [key('c2')]: 'uzoshop' },
    });
    // Σcampaigns (100) > account (80) — never negative.
    expect(res.unattributedSpendCad).toBe(0);
    expect(res.mappedSpendCad).toBe(100);
  });

  it('advertiserId is part of the key — same campaignId under a different advertiser is unmapped', () => {
    const storeMap = { [campaignStoreKey('tiktok', 'ADV_A', 'c1')]: 'uzoshop' };
    const res = tiktokCoverage({
      accountTotalCad: 20,
      campaigns: [{ campaignId: 'c1', advertiserId: 'ADV_B', spendCad: 20 }],
      storeMap,
    });
    expect(res.unmappedCampaignIds).toEqual(['c1']);
    expect(res.mappedSpendCad).toBe(0);
  });

  it('no campaigns → all account spend is unattributed', () => {
    const res = tiktokCoverage({
      accountTotalCad: 42,
      campaigns: [],
      storeMap: {},
    });
    expect(res.unmappedCampaignIds).toEqual([]);
    expect(res.mappedSpendCad).toBe(0);
    expect(res.unattributedSpendCad).toBe(42);
  });

  it('does not mutate inputs', () => {
    const campaigns = [{ campaignId: 'c1', advertiserId: ADV, spendCad: 10 }];
    const storeMap = { [key('c1')]: 'uzoshop' };
    const frozenCampaigns = Object.freeze(campaigns.map(c => Object.freeze({ ...c })));
    Object.freeze(storeMap);
    expect(() =>
      tiktokCoverage({ accountTotalCad: 10, campaigns: frozenCampaigns as typeof campaigns, storeMap }),
    ).not.toThrow();
  });
});
