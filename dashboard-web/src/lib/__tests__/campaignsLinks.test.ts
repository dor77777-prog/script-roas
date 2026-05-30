import { describe, expect, it } from 'vitest';
import {
  resolveSharedTikTokAdvertiserId,
  type AdAccountMap,
} from '@/lib/campaignsLinks';

// Phase C soak (2026-05-30) — drawer hotfix.
//
// Background: ARCHITECTURE.md §5.4 — TikTok runs on a SINGLE shared
// advertiser (uzoshop's). usmile360 + zolplus are "tenants" attributed
// via the Phase A.5 v2 campaign-store-map. The drawer's
// campaign↔store-mapping section previously read
// `adAccounts[storeId].tiktokAdvertiserId`, which returned '' for
// usmile360-attributed campaigns → dropdown disabled + storeMap lookup
// hit `''` key → all mapped campaigns rendered as "unmapped (default
// uzoshop)" the moment the operator opened them from any view other
// than uzoshop's filter. This helper centralises the
// shared-advertiser-id resolution so callers don't repeat the bug.

describe('resolveSharedTikTokAdvertiserId()', () => {
  it('returns the advertiser id when only uzoshop has one (the real-world shape today)', () => {
    const accounts: AdAccountMap = {
      uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: 'G-UZO', tiktokAdvertiserId: 'TT-UZO' },
      zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
      usmile360: { metaAdAccountId: 'M-USM', googleAdsCustomerId: null },
    };
    expect(resolveSharedTikTokAdvertiserId(accounts)).toBe('TT-UZO');
  });

  it('returns the first non-empty id when multiple stores carry the same shared advertiser', () => {
    // Defensive: if /api/store-meta ever stamps the same advertiserId
    // on >1 row (e.g. as a future "tenant marker"), any of them is the
    // correct answer because the underlying advertiser is shared.
    const accounts: AdAccountMap = {
      uzoshop: { metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: 'TT-SHARED' },
      usmile360: { metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: 'TT-SHARED' },
    };
    expect(resolveSharedTikTokAdvertiserId(accounts)).toBe('TT-SHARED');
  });

  it('returns empty string when no store has a TikTok advertiser id', () => {
    const accounts: AdAccountMap = {
      uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: 'G-UZO' },
      zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null, tiktokAdvertiserId: null },
    };
    expect(resolveSharedTikTokAdvertiserId(accounts)).toBe('');
  });

  it('returns empty string for an empty adAccounts map', () => {
    expect(resolveSharedTikTokAdvertiserId({})).toBe('');
  });

  it('ignores blank-string ids (empty env var, not absent)', () => {
    const accounts: AdAccountMap = {
      uzoshop: { metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: '' },
      usmile360: { metaAdAccountId: null, googleAdsCustomerId: null, tiktokAdvertiserId: 'TT-USM' },
    };
    expect(resolveSharedTikTokAdvertiserId(accounts)).toBe('TT-USM');
  });
});
