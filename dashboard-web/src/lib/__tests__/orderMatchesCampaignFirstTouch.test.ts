import { describe, it, expect } from 'vitest';
import { orderMatchesCampaign, analyzeAttributionForAdSet, analyzeAttributionForAd } from '@/lib/attributionAnalysis';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const base: OrderAttributionRow = {
  date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', orderId: '1',
  totalCad: 100, source: 'meta-paid',
  utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
  fbclidPresent: true, gclidPresent: false, referringSite: '',
  utmId: '', utmTerm: '', lineItems: [], customerId: null, orderCreatedAt: null,
  isFirstOrder: null, firstTouchSource: null,
  firstFbclidPresent: false, firstGclidPresent: false, firstTtclidPresent: false,
  firstUtmSource: null, firstUtmMedium: null, firstUtmCampaign: null,
  firstUtmContent: null, firstUtmId: null, firstUtmTerm: null, firstSeenAt: null,
  paymentGateway: null,
};
const camp = { campaignName: 'Sale', campaignId: 'c1', storeId: 'uzoshop', platform: 'Meta' };

describe('orderMatchesCampaign — first-touch fallback', () => {
  it('matches via first_utm_id when last-touch utm is absent', () => {
    expect(orderMatchesCampaign({ ...base, firstUtmId: 'c1' }, camp)).toBe(true);
  });
  it('matches via first_utm_campaign (name) when last-touch utm is absent', () => {
    expect(orderMatchesCampaign({ ...base, firstUtmCampaign: 'Sale' }, camp)).toBe(true);
  });
  it('last-touch wins: last utm_id=c2 (mismatch) does NOT fall back to first_utm_id=c1', () => {
    expect(orderMatchesCampaign({ ...base, utmId: 'c2', firstUtmId: 'c1' }, camp)).toBe(false);
  });
  it('no signal anywhere → no match', () => {
    expect(orderMatchesCampaign(base, camp)).toBe(false);
  });
  it('Google: first_utm_id fallback matches numeric id when last absent', () => {
    const g = { campaignName: 'x', campaignId: '999', storeId: 'uzoshop', platform: 'Google' };
    expect(orderMatchesCampaign({ ...base, source: 'google-paid', firstUtmId: '999' }, g)).toBe(true);
    expect(orderMatchesCampaign({ ...base, source: 'google-paid', utmId: '111', firstUtmId: '999' }, g)).toBe(false);
  });
});

describe('ad-set / ad first-touch fallback', () => {
  const window = ['2026-05-01', '2026-06-30'] as const;
  it('ad-set matches via first_utm_term when last utm_term absent', () => {
    const r = analyzeAttributionForAdSet(
      { adSetId: 'as1', adSetName: 'AS', storeId: 'uzoshop', platform: 'Meta', metaClaim: 0, spend: 10 },
      [{ ...base, firstUtmTerm: 'as1' }], window[0], window[1]);
    expect(r && r.deterministicOrders).toBe(1);
  });
  it('ad-set last-term present mismatch does NOT fall back', () => {
    const r = analyzeAttributionForAdSet(
      { adSetId: 'as1', adSetName: 'AS', storeId: 'uzoshop', platform: 'Meta', metaClaim: 0, spend: 10 },
      [{ ...base, utmTerm: 'asX', firstUtmTerm: 'as1' }], window[0], window[1]);
    expect(r && r.deterministicOrders).toBe(0);
  });
  it('ad matches via first_utm_content when last utm_content absent', () => {
    const r = analyzeAttributionForAd(
      { adId: 'ad1', adName: 'AD', storeId: 'uzoshop', platform: 'Meta', metaClaim: 0, spend: 10 },
      [{ ...base, firstUtmContent: 'ad1' }], window[0], window[1]);
    expect(r && r.deterministicOrders).toBe(1);
  });
});
