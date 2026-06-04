import { describe, it, expect } from 'vitest';
import { overcountByChannelFromCampaigns } from '@/lib/home/channelTruth';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

// Minimal CampaignRow factory — only the fields overcountByChannelFromCampaigns reads
// (platform, conversionValue, date, storeName) carry meaning; the rest are filler.
function campaign(over: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-06-02',
    storeId: 's1',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'C1',
    adSetId: 'a1',
    adSetName: 'A1',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
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
    ...over,
  } as CampaignRow;
}

// Minimal OrderAttributionRow factory — only source/totalCad/storeName/date matter.
function order(over: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-06-02',
    storeId: 's1',
    storeName: 'uzoshop',
    orderId: 'o1',
    totalCad: 0,
    source: 'direct',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    fbclidPresent: false,
    gclidPresent: false,
    referringSite: '',
    utmId: '',
    utmTerm: '',
    lineItems: [],
    customerId: null,
    orderCreatedAt: null,
    isFirstOrder: null,
    firstTouchSource: null,
    firstFbclidPresent: false,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    firstUtmContent: null,
    firstUtmId: null,
    firstUtmTerm: null,
    firstSeenAt: null,
    ...over,
  } as OrderAttributionRow;
}

describe('overcountByChannelFromCampaigns', () => {
  it('computes overcountPct = (claim − verified) / claim (the 0.40 case)', () => {
    // Meta claims 1000, Shopify click-ID-verified revenue 600 → 0.40 overcount.
    const campaigns: CampaignRow[] = [campaign({ platform: 'Meta', conversionValue: 1000 })];
    const orders: OrderAttributionRow[] = [
      order({ source: 'meta-paid', totalCad: 400 }),
      order({ source: 'meta-paid', totalCad: 200 }),
    ];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.meta.claim).toBe(1000);
    expect(out.meta.verified).toBe(600);
    expect(out.meta.overcountPct).toBeCloseTo(0.4, 5);
  });

  it('counts ALL orders (not first-order-only) for verified revenue', () => {
    const campaigns: CampaignRow[] = [campaign({ platform: 'Google', conversionValue: 500 })];
    const orders: OrderAttributionRow[] = [
      order({ source: 'google-paid', totalCad: 100, isFirstOrder: true }),
      order({ source: 'google-paid', totalCad: 150, isFirstOrder: false }), // returning still counts
    ];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.google.verified).toBe(250);
    expect(out.google.overcountPct).toBeCloseTo(0.5, 5); // (500-250)/500
  });

  it('clamps to 0 when verified ≥ claim (no negative / halo overcount)', () => {
    const campaigns: CampaignRow[] = [campaign({ platform: 'TikTok', conversionValue: 300 })];
    const orders: OrderAttributionRow[] = [order({ source: 'tiktok-paid', totalCad: 900 })];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.tiktok.claim).toBe(300);
    expect(out.tiktok.verified).toBe(900);
    expect(out.tiktok.overcountPct).toBe(0);
  });

  it('overcountPct is null when claim is 0 (no platform-claimed value)', () => {
    const campaigns: CampaignRow[] = []; // no meta claim
    const orders: OrderAttributionRow[] = [order({ source: 'meta-paid', totalCad: 500 })];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.meta.claim).toBe(0);
    expect(out.meta.verified).toBe(500);
    expect(out.meta.overcountPct).toBeNull();
  });

  it('excludes rows outside the [from,to] date window (both arrays)', () => {
    const campaigns: CampaignRow[] = [
      campaign({ platform: 'Meta', conversionValue: 1000, date: '2026-06-15' }), // in window
      campaign({ platform: 'Meta', conversionValue: 5000, date: '2026-05-01' }), // before — excluded
      campaign({ platform: 'Meta', conversionValue: 7000, date: '2026-07-01' }), // after — excluded
    ];
    const orders: OrderAttributionRow[] = [
      order({ source: 'meta-paid', totalCad: 600, date: '2026-06-15' }), // in window
      order({ source: 'meta-paid', totalCad: 9999, date: '2026-05-02' }), // before — excluded
    ];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30');
    expect(out.meta.claim).toBe(1000);
    expect(out.meta.verified).toBe(600);
    expect(out.meta.overcountPct).toBeCloseTo(0.4, 5);
  });

  it('scopes both arrays to storeName when supplied', () => {
    const campaigns: CampaignRow[] = [
      campaign({ platform: 'Meta', conversionValue: 1000, storeName: 'uzoshop' }),
      campaign({ platform: 'Meta', conversionValue: 8000, storeName: 'Zol Plus' }), // excluded
    ];
    const orders: OrderAttributionRow[] = [
      order({ source: 'meta-paid', totalCad: 600, storeName: 'uzoshop' }),
      order({ source: 'meta-paid', totalCad: 7777, storeName: 'Zol Plus' }), // excluded
    ];
    const out = overcountByChannelFromCampaigns(campaigns, orders, '2026-06-01', '2026-06-30', 'uzoshop');
    expect(out.meta.claim).toBe(1000);
    expect(out.meta.verified).toBe(600);
    expect(out.meta.overcountPct).toBeCloseTo(0.4, 5);
  });

  it('returns an entry for every channel in CHANNELS', () => {
    const out = overcountByChannelFromCampaigns([], [], '2026-06-01', '2026-06-30');
    expect(out.meta).toEqual({ claim: 0, verified: 0, overcountPct: null });
    expect(out.google).toEqual({ claim: 0, verified: 0, overcountPct: null });
    expect(out.tiktok).toEqual({ claim: 0, verified: 0, overcountPct: null });
  });
});
