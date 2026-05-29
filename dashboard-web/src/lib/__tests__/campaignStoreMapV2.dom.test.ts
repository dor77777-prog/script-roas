// dashboard-web/src/lib/__tests__/campaignStoreMapV2.dom.test.ts
//
// Phase A.5 v2 — verifies writeCampaignStoreMap fires pushCloudKey (cloud-sync)
// in addition to writing localStorage + dispatching the window event. This
// guards against another rollback-style regression where the cloud-sync was
// silently disabled.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pushCloudKeyMock } = vi.hoisted(() => ({ pushCloudKeyMock: vi.fn() }));
vi.mock('../cloudSync', () => ({ pushCloudKey: pushCloudKeyMock }));

import {
  campaignStoreKey,
  readCampaignStoreMap,
  writeCampaignStoreMap,
  resolveStoreForCampaign,
} from '../campaignStoreMap';

beforeEach(() => {
  window.localStorage.clear();
  pushCloudKeyMock.mockReset();
});

describe('Phase A.5 v2 — cloud-sync round-trip', () => {
  it('writeCampaignStoreMap calls pushCloudKey with the storage key and the map', () => {
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'usmile360' });
    expect(pushCloudKeyMock).toHaveBeenCalledTimes(1);
    expect(pushCloudKeyMock).toHaveBeenCalledWith(
      'roas-dashboard:campaign-store-map',
      { 'tiktok::adv1::C1': 'usmile360' },
      { immediate: true },
    );
  });

  it('writeCampaignStoreMap also writes localStorage + dispatches change event', () => {
    const eventSpy = vi.fn();
    window.addEventListener('roas-campaign-store-map-changed', eventSpy);
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'uzoshop' });
    expect(window.localStorage.getItem('roas-dashboard:campaign-store-map')).toBe(
      JSON.stringify({ 'tiktok::adv1::C1': 'uzoshop' }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener('roas-campaign-store-map-changed', eventSpy);
  });

  it('readCampaignStoreMap parses what writeCampaignStoreMap wrote', () => {
    writeCampaignStoreMap({ 'tiktok::adv1::C1': 'zolplus' });
    expect(readCampaignStoreMap()).toEqual({ 'tiktok::adv1::C1': 'zolplus' });
  });

  it('campaignStoreKey + resolveStoreForCampaign behave as in v1 (regression guard)', () => {
    const key = campaignStoreKey('tiktok', 'adv1', 'C1');
    expect(key).toBe('tiktok::adv1::C1');
    expect(resolveStoreForCampaign({ [key]: 'usmile360' }, 'tiktok', 'adv1', 'C1', 'uzoshop')).toBe('usmile360');
    expect(resolveStoreForCampaign({}, 'tiktok', 'adv1', 'C1', 'uzoshop')).toBe('uzoshop');
  });
});
