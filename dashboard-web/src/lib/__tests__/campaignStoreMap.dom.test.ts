// dashboard-web/src/lib/__tests__/campaignStoreMap.dom.test.ts
//
// Phase A.5 — Tests for campaignStoreMap client helpers.
// Runs under jsdom (vitest.config.dom.ts) because they rely on
// window.localStorage and window.dispatchEvent.

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../cloudSync', () => ({ pushCloudKey: vi.fn() }));

import {
  campaignStoreKey,
  readCampaignStoreMap,
  writeCampaignStoreMap,
  resolveStoreForCampaign,
} from '../campaignStoreMap';

const STORAGE_KEY = 'roas-dashboard:campaign-store-map';

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('campaignStoreKey', () => {
  it('returns <platform>::<advertiserId>::<campaignId> format', () => {
    expect(campaignStoreKey('tiktok', 'adv123', 'camp456')).toBe(
      'tiktok::adv123::camp456',
    );
  });

  it('produces different keys for different platforms with the same campaign id', () => {
    const meta = campaignStoreKey('meta', 'adv1', 'c1');
    const google = campaignStoreKey('google', 'adv1', 'c1');
    const tiktok = campaignStoreKey('tiktok', 'adv1', 'c1');
    expect(meta).not.toBe(google);
    expect(meta).not.toBe(tiktok);
    expect(google).not.toBe(tiktok);
  });
});

describe('readCampaignStoreMap', () => {
  it('returns {} when localStorage is empty', () => {
    expect(readCampaignStoreMap()).toEqual({});
  });

  it('parses valid JSON and filters non-string values', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ k1: 'uzoshop', k2: 42, k3: null }),
    );
    expect(readCampaignStoreMap()).toEqual({ k1: 'uzoshop' });
  });

  it('returns {} for malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-valid-json');
    expect(readCampaignStoreMap()).toEqual({});
  });

  it('returns {} for non-object JSON (array)', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']));
    expect(readCampaignStoreMap()).toEqual({});
  });
});

describe('writeCampaignStoreMap', () => {
  it('writes to localStorage and dispatches roas-campaign-store-map-changed event', () => {
    const map = { 'tiktok::adv1::c1': 'uzoshop' };
    const eventSpy = vi.fn();
    window.addEventListener('roas-campaign-store-map-changed', eventSpy);

    writeCampaignStoreMap(map);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored).toEqual(map);
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('roas-campaign-store-map-changed', eventSpy);
  });
});

describe('resolveStoreForCampaign', () => {
  it('returns the mapped store when the key exists', () => {
    const map = { 'tiktok::adv1::c1': 'uzoshop' };
    expect(resolveStoreForCampaign(map, 'tiktok', 'adv1', 'c1', 'fallback-store')).toBe(
      'uzoshop',
    );
  });

  it('returns the default store when the key is missing', () => {
    const map = { 'tiktok::adv1::c1': 'uzoshop' };
    expect(
      resolveStoreForCampaign(map, 'meta', 'adv1', 'c1', 'fallback-store'),
    ).toBe('fallback-store');
  });
});
