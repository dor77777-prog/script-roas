import { describe, it, expect } from 'vitest';
import {
  isAdsEnabled,
  applicablePlatforms,
  tiktokAccountFetchEnabled,
  TIKTOK_SHARED_STORES,
  type AdStateMap,
} from '@/lib/adState';

const store = (over: Partial<{ storeId: string; metaAdAccountId: string | null; googleAdsCustomerId: string | null }>) => ({
  storeId: 'uzoshop', storeName: 'uzoshop', planDisplayName: '', shopifyPlus: false,
  partnerDevelopment: false, updatedAt: null, lastError: null,
  metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: null, ...over,
});

describe('isAdsEnabled — missing key defaults to ON', () => {
  it('returns true when no row exists', () => {
    expect(isAdsEnabled({}, 'uzoshop', 'meta')).toBe(true);
  });
  it('returns false only when explicitly disabled', () => {
    const m: AdStateMap = { 'uzoshop:google': false };
    expect(isAdsEnabled(m, 'uzoshop', 'google')).toBe(false);
    expect(isAdsEnabled(m, 'uzoshop', 'meta')).toBe(true);
  });
});

describe('applicablePlatforms — derived from config', () => {
  it('uzoshop = meta+google+tiktok', () => {
    const p = applicablePlatforms(
      store({ storeId: 'uzoshop', metaAdAccountId: '123', googleAdsCustomerId: '456' }),
      new Set(['uzoshop', 'usmile360']),
    );
    expect(p.sort()).toEqual(['google', 'meta', 'tiktok']);
  });
  it('zolplus = meta only', () => {
    const p = applicablePlatforms(store({ storeId: 'zolplus', metaAdAccountId: '123' }), new Set(['uzoshop', 'usmile360']));
    expect(p).toEqual(['meta']);
  });
  it('usmile360 = meta+tiktok', () => {
    const p = applicablePlatforms(store({ storeId: 'usmile360', metaAdAccountId: '123' }), new Set(['uzoshop', 'usmile360']));
    expect(p.sort()).toEqual(['meta', 'tiktok']);
  });
});

describe('tiktokAccountFetchEnabled — shared account', () => {
  it('true when ANY shared-account store has tiktok on', () => {
    expect(tiktokAccountFetchEnabled({ 'uzoshop:tiktok': false })).toBe(true); // usmile still on
  });
  it('false only when ALL shared-account stores are off', () => {
    const m: AdStateMap = { 'uzoshop:tiktok': false, 'usmile360:tiktok': false };
    expect(tiktokAccountFetchEnabled(m)).toBe(false);
  });
  it('exposes the shared-store list', () => {
    expect(TIKTOK_SHARED_STORES).toContain('uzoshop');
    expect(TIKTOK_SHARED_STORES).toContain('usmile360');
  });
});
