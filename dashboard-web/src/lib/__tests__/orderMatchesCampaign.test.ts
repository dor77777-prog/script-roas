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

  // ----------------------------------------------------------------
  // Whitespace trimming + long-ID handling (TEST-07 — pins AUDIT-P3-07)
  // ----------------------------------------------------------------

  describe('whitespace trimming and long IDs', () => {
    it('matches utm_id with leading/trailing whitespace', () => {
      // Some Meta integrations pass whitespace-padded URL parameter values.
      // Both sides of the comparison are .trim()ed in orderMatchesCampaign
      // (attributionAnalysis.ts:178). This regression test pins that.
      const order = makeOrder({ utmId: '  120207312456789  ' });
      const campaign = makeCampaign({ campaignId: '120207312456789' });
      expect(orderMatchesCampaign(order, campaign)).toBe(true);
    });

    it('matches utm_id when campaign side has trailing whitespace', () => {
      const order = makeOrder({ utmId: '120207312456789' });
      const campaign = makeCampaign({ campaignId: '120207312456789\n' });
      expect(orderMatchesCampaign(order, campaign)).toBe(true);
    });

    it('handles 17-digit Meta campaign IDs as strings without precision loss', () => {
      // JavaScript Number can only safely represent integers up to 2^53-1
      // (16 decimal digits). Meta campaign IDs at scale are 17-18 digits,
      // so coercing to Number would silently round the last 1-2 digits to
      // the nearest representable value and produce false matches between
      // distinct campaigns. The implementation compares trimmed strings —
      // this test would have caught a regression to Number coercion.
      const longId = '120207312456789999';
      const orderMatching = makeOrder({ utmId: longId });
      const orderNeighbor = makeOrder({ utmId: '120207312456789998' });

      const campaign = makeCampaign({ campaignId: longId });
      expect(orderMatchesCampaign(orderMatching, campaign)).toBe(true);
      // Neighbor differs in only the last digit. Both digits are beyond
      // Number.MAX_SAFE_INTEGER (9007199254740991) so a Number-coerced
      // comparison would equate them. String comparison must reject.
      expect(orderMatchesCampaign(orderNeighbor, campaign)).toBe(false);
    });

    it('matches utm_campaign name with mixed-case + whitespace via Tier 2 fallback', () => {
      // utm_id absent → Tier 2 name match. orderMatchesCampaign does
      // .trim().toLowerCase() on both sides (attributionAnalysis.ts:182-184).
      const order = makeOrder({ utmId: '', utmCampaign: '   Summer Sale  ' });
      const campaign = makeCampaign({ campaignName: 'summer sale' });
      expect(orderMatchesCampaign(order, campaign)).toBe(true);
    });
  });
});
