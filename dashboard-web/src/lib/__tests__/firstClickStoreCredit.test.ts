import { describe, it, expect } from 'vitest';
import { resolveStoreForCampaign, campaignStoreKey } from '@/lib/campaignStoreMap';
import { analyzeFirstClickForCampaign } from '@/lib/attributionAnalysis';
import { makeOrder } from './fixtures';

const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-31';

/**
 * First-click must credit the store via the EXISTING campaignStoreMap,
 * incl. the TikTok shared-account per-campaign override (default uzoshop,
 * remappable). We compose resolveStoreForCampaign -> analyzeFirstClickForCampaign
 * exactly as the UI does, proving the override re-routes credit.
 */
describe('first-click store credit via campaignStoreMap', () => {
  it('TikTok shared-account campaign defaults to uzoshop', () => {
    const store = resolveStoreForCampaign({}, 'tiktok', 'ADV-SHARED', 'tt-camp-1', 'uzoshop');
    expect(store).toBe('uzoshop');

    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'uzoshop', firstUtmId: 'tt-camp-1', totalCad: 100, date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', storeId: 'usmile360', firstUtmId: 'tt-camp-1', totalCad: 999, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(
      { campaignName: 'TT', campaignId: 'tt-camp-1', storeId: store, platform: 'TikTok', spend: 50 },
      orders, DATE_FROM, DATE_TO,
    )!;
    // Only the uzoshop order is credited; the usmile360 order is excluded.
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(100, 4);
  });

  it('per-campaign override re-routes TikTok credit to the mapped store', () => {
    const map = { [campaignStoreKey('tiktok', 'ADV-SHARED', 'tt-camp-1')]: 'usmile360' };
    const store = resolveStoreForCampaign(map, 'tiktok', 'ADV-SHARED', 'tt-camp-1', 'uzoshop');
    expect(store).toBe('usmile360');

    const orders = [
      makeOrder({ orderId: 'o-1', storeId: 'uzoshop', firstUtmId: 'tt-camp-1', totalCad: 100, date: '2026-05-10' }),
      makeOrder({ orderId: 'o-2', storeId: 'usmile360', firstUtmId: 'tt-camp-1', totalCad: 250, date: '2026-05-10' }),
    ];
    const r = analyzeFirstClickForCampaign(
      { campaignName: 'TT', campaignId: 'tt-camp-1', storeId: store, platform: 'TikTok', spend: 50 },
      orders, DATE_FROM, DATE_TO,
    )!;
    // Credit now follows the override → usmile360's order only.
    expect(r.firstClickOrders).toBe(1);
    expect(r.firstClickRevenue).toBeCloseTo(250, 4);
  });
});
