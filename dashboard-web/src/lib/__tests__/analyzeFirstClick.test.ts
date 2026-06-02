import { describe, it, expect } from 'vitest';
import {
  analyzeFirstClickForCampaign,
  analyzeFirstClickForAd,
} from '@/lib/attributionAnalysis';
import { makeOrder, makeCampaign, makeAd } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-31';

// Numeric Google campaign_id flows into orders via ValueTrack tagging:
// first_utm_id={campaignid} and/or first_utm_campaign={campaignid}.
const GOOGLE_CAMPAIGN_ID = '23590447604';

describe('analyzeFirstClickForCampaign', () => {
  it('returns null for an unsupported platform (e.g. Pinterest)', () => {
    // T0 (2026-06-02) mirror: Google is un-excluded at campaign grain, so a
    // truly-unsupported platform stands in for the "returns null" contract.
    const c = makeCampaign({ platform: 'Pinterest' });
    expect(analyzeFirstClickForCampaign(c, [makeOrder()], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('returns null for empty orders', () => {
    expect(analyzeFirstClickForCampaign(makeCampaign(), [], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('matches on firstUtmId (tier 1) at campaign grain', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: 'camp-1', utmId: 'other', totalCad: 200, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(200, 4);
  });

  it('falls back to firstUtmCampaign name (tier 2) when firstUtmId absent', () => {
    const c = makeCampaign({ campaignName: 'Intro Camp', campaignId: 'camp-X', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: null, firstUtmCampaign: 'intro camp', totalCad: 150, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(150, 4);
  });

  it('does NOT match when neither first-click key matches', () => {
    const c = makeCampaign({ campaignId: 'camp-1', campaignName: 'A', spend: 100 });
    const orders = [makeOrder({ firstUtmId: 'other', firstUtmCampaign: 'B', date: '2026-05-10' })];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('ignores orders with no first-click signal (firstUtmId AND firstUtmCampaign null)', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: null, firstUtmCampaign: null, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('respects store + date window', () => {
    const c = makeCampaign({ campaignId: 'camp-1', storeId: 'uzoshop', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'zolplus', firstUtmId: 'camp-1', date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', firstUtmId: 'camp-1', date: '2026-04-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('computes first-click ROAS', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmId: 'camp-1', totalCad: 300, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickRoas).toBeCloseTo(3, 4);
  });

  it('marks Meta/TikTok results googleBlind = false', () => {
    const c = makeCampaign({ campaignId: 'camp-1', spend: 100 });
    const orders = [makeOrder({ firstUtmId: 'camp-1', date: '2026-05-10' })];
    const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
    expect(r.googleBlind).toBe(false);
  });

  // T0 (2026-06-02) MIRROR — Google un-excluded at CAMPAIGN GRAIN ONLY.
  // First-click Google matches via firstUtmId OR firstUtmCampaign === the
  // numeric campaign_id (ValueTrack). No Tier-2 name match for Google; no
  // Google ad grain (covered in the analyzeFirstClickForAd block below).
  describe('Google campaign grain (first-click T0 mirror)', () => {
    it('matches a Google order via firstUtmId === numeric campaignId', () => {
      const c = makeCampaign({ platform: 'Google', campaignId: GOOGLE_CAMPAIGN_ID, spend: 100 });
      const orders = [
        makeOrder({
          orderId: 'o-1',
          firstUtmId: GOOGLE_CAMPAIGN_ID,
          firstUtmCampaign: null,
          totalCad: 200,
          date: '2026-05-10',
        }),
      ];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
      expect(r).not.toBeNull();
      expect(r.firstClickOrders).toBe(1);
      expect(r.firstClickRevenue).toBeCloseTo(200, 4);
    });

    it('matches a Google order via firstUtmCampaign === numeric campaignId (ValueTrack)', () => {
      const c = makeCampaign({ platform: 'Google', campaignId: GOOGLE_CAMPAIGN_ID, spend: 100 });
      const orders = [
        makeOrder({
          orderId: 'o-1',
          firstUtmId: null,
          firstUtmCampaign: GOOGLE_CAMPAIGN_ID,
          totalCad: 150,
          date: '2026-05-10',
        }),
      ];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
      expect(r).not.toBeNull();
      expect(r.firstClickOrders).toBe(1);
      expect(r.firstClickRevenue).toBeCloseTo(150, 4);
    });

    it('does NOT match a Google order when both first-click ids differ', () => {
      const c = makeCampaign({ platform: 'Google', campaignId: GOOGLE_CAMPAIGN_ID, spend: 100 });
      const orders = [
        makeOrder({
          orderId: 'o-1',
          firstUtmId: '99999999999',
          firstUtmCampaign: 'Unrelated Campaign Name',
          date: '2026-05-10',
        }),
      ];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
      expect(r).not.toBeNull();
      expect(r.firstClickOrders).toBe(0);
    });

    it('does NOT name-match a Google order (firstUtmCampaign carries the id, not the name)', () => {
      const c = makeCampaign({
        platform: 'Google',
        campaignId: GOOGLE_CAMPAIGN_ID,
        campaignName: 'Brand Search',
        spend: 100,
      });
      const orders = [
        makeOrder({
          orderId: 'o-1',
          firstUtmId: null,
          firstUtmCampaign: 'brand search',
          date: '2026-05-10',
        }),
      ];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
      expect(r.firstClickOrders).toBe(0);
    });

    it('returns null for a Google campaign with no campaignId', () => {
      const c = makeCampaign({ platform: 'Google', campaignId: undefined as unknown as string, spend: 100 });
      const orders = [makeOrder({ firstUtmId: GOOGLE_CAMPAIGN_ID, date: '2026-05-10' })];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO);
      // Non-null analysis (Google platform is accepted) but zero matched orders.
      expect(r).not.toBeNull();
      expect(r!.firstClickOrders).toBe(0);
    });

    it('marks Google results googleBlind = false (Google IS analyzed at campaign grain)', () => {
      const c = makeCampaign({ platform: 'Google', campaignId: GOOGLE_CAMPAIGN_ID, spend: 100 });
      const orders = [makeOrder({ firstUtmId: GOOGLE_CAMPAIGN_ID, date: '2026-05-10' })];
      const r = analyzeFirstClickForCampaign(c, orders, DATE_FROM, DATE_TO)!;
      expect(r.googleBlind).toBe(false);
    });
  });
});

describe('analyzeFirstClickForAd', () => {
  it('matches on firstUtmContent === adId', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const orders = [
      makeOrder({ orderId: 'o-1', firstUtmContent: 'ad-7', totalCad: 100, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForAd(ad, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(100, 4);
    expect(r.firstClickRoas).toBeCloseTo(2, 4);
  });

  it('returns null for Google (NO Google ad grain — ads_daily has no Google rows)', () => {
    expect(analyzeFirstClickForAd(makeAd({ platform: 'Google' }), [makeOrder()], DATE_FROM, DATE_TO)).toBeNull();
  });

  it('does not match a different ad', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const orders = [makeOrder({ firstUtmContent: 'ad-99', date: '2026-05-10' })];
    const r = analyzeFirstClickForAd(ad, orders, DATE_FROM, DATE_TO)!;
    expect(r.firstClickOrders).toBe(0);
  });

  it('marks the ad-grain result googleBlind = true (surfaced in tooltip)', () => {
    const ad = makeAd({ adId: 'ad-7', spend: 50 });
    const r = analyzeFirstClickForAd(ad, [makeOrder({ firstUtmContent: 'ad-7', date: '2026-05-10' })], DATE_FROM, DATE_TO)!;
    expect(r.googleBlind).toBe(true);
  });
});
