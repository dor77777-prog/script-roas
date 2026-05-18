import { describe, it, expect } from 'vitest';
import { orderMatchesCampaign } from '@/lib/attributionAnalysis';
import { makeOrder, makeCampaign } from './fixtures';

describe('orderMatchesCampaign', () => {
  // ----------------------------------------------------------------
  // Tier 1 — utm_id match
  // ----------------------------------------------------------------

  it('Tier1: returns true when utm_id matches campaignId', () => {
    const order = makeOrder({ utmId: 'camp-1', utmCampaign: 'Summer Sale' });
    const campaign = makeCampaign({ campaignId: 'camp-1', campaignName: 'Summer Sale' });
    expect(orderMatchesCampaign(order, campaign)).toBe(true);
  });

  it('Tier1 CR5-01: does NOT fall through to name match when utm_id is present but mismatches campaignId', () => {
    // This is the critical test for CR5-01.
    // The order has utmId='camp-99' and utmCampaign='Summer Sale'.
    // The campaign has campaignId='camp-1' and campaignName='Summer Sale'.
    // Because utm_id is present but mismatches, result must be FALSE —
    // not true via name match.
    const order = makeOrder({ utmId: 'camp-99', utmCampaign: 'Summer Sale' });
    const campaign = makeCampaign({ campaignId: 'camp-1', campaignName: 'Summer Sale' });
    expect(orderMatchesCampaign(order, campaign)).toBe(false);
  });

  it('Tier1: returns false when utm_id is present but campaign has no campaignId (no fall-through)', () => {
    // utm_id on the order but campaignId absent from campaign — must not
    // fall through to name match.
    const order = makeOrder({ utmId: 'camp-1', utmCampaign: 'Summer Sale' });
    const campaign = makeCampaign({ campaignName: 'Summer Sale' });
    // Remove campaignId by omitting it
    const campaignWithoutId = {
      campaignName: campaign.campaignName,
      storeId: campaign.storeId,
      platform: campaign.platform,
    };
    expect(orderMatchesCampaign(order, campaignWithoutId)).toBe(false);
  });

  // ----------------------------------------------------------------
  // Tier 2 — name match (utm_id absent)
  // ----------------------------------------------------------------

  it('Tier2: matches case-insensitively when utm_id is absent', () => {
    const order = makeOrder({ utmId: '', utmCampaign: 'summer sale' });
    const campaign = makeCampaign({ campaignName: 'Summer Sale', campaignId: 'camp-1' });
    expect(orderMatchesCampaign(order, campaign)).toBe(true);
  });

  it('Tier2: returns false when utm_id absent and utmCampaign does not match campaignName', () => {
    const order = makeOrder({ utmId: '', utmCampaign: 'Winter Sale' });
    const campaign = makeCampaign({ campaignName: 'Summer Sale' });
    expect(orderMatchesCampaign(order, campaign)).toBe(false);
  });

  // ----------------------------------------------------------------
  // No UTM signals
  // ----------------------------------------------------------------

  it('returns false when both utmId and utmCampaign are empty strings', () => {
    const order = makeOrder({ utmId: '', utmCampaign: '' });
    const campaign = makeCampaign();
    expect(orderMatchesCampaign(order, campaign)).toBe(false);
  });

  // ----------------------------------------------------------------
  // storeId mismatch
  // ----------------------------------------------------------------

  it('returns false when storeId does not match even if utm_id matches', () => {
    const order = makeOrder({ storeId: 'uzoshop', utmId: 'camp-1' });
    const campaign = makeCampaign({ storeId: 'zolplus', campaignId: 'camp-1' });
    expect(orderMatchesCampaign(order, campaign)).toBe(false);
  });

  // ----------------------------------------------------------------
  // platform mismatch
  // ----------------------------------------------------------------

  it('returns false for non-Meta platform regardless of utm signals', () => {
    const order = makeOrder({ utmId: 'camp-1' });
    const campaign = makeCampaign({ platform: 'Google', campaignId: 'camp-1' });
    expect(orderMatchesCampaign(order, campaign)).toBe(false);
  });
});
