import { describe, expect, it } from 'vitest';
import {
  classifyStaleRows,
  extractTikTokMappingSteps,
  type BackfillStep,
} from '@/lib/backfill/tiktokMapping';

describe('extractTikTokMappingSteps()', () => {
  it('returns one step per TikTok entry in the map', () => {
    const map = {
      'tiktok::adv-1::camp-A': '360usmile',
      'tiktok::adv-1::camp-B': 'zolplus',
    };
    const out = extractTikTokMappingSteps(map);
    expect(out).toEqual<BackfillStep[]>([
      { campaignId: 'camp-A', targetStoreId: '360usmile' },
      { campaignId: 'camp-B', targetStoreId: 'zolplus' },
    ]);
  });

  it('ignores non-TikTok entries (Meta/Google never need backfill — 1:1 advertiser↔store)', () => {
    const map = {
      'tiktok::adv-1::camp-A': '360usmile',
      'meta::adv-2::camp-B': 'zolplus',
      'google::adv-3::camp-C': 'uzoshop',
    };
    const out = extractTikTokMappingSteps(map);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ campaignId: 'camp-A', targetStoreId: '360usmile' });
  });

  it('skips malformed keys (wrong shape, missing parts)', () => {
    const map = {
      'tiktok::camp-X': 'usmile360', // only 2 parts
      'tiktok::': 'usmile360', // empty parts
      '': 'usmile360', // empty key
      'tiktok::adv-1::camp-A': 'usmile360', // valid
    };
    const out = extractTikTokMappingSteps(map);
    expect(out).toEqual([{ campaignId: 'camp-A', targetStoreId: 'usmile360' }]);
  });

  it('skips entries with empty target store_id', () => {
    const map = {
      'tiktok::adv-1::camp-A': '',
      'tiktok::adv-1::camp-B': '360usmile',
    };
    const out = extractTikTokMappingSteps(map);
    expect(out).toEqual([{ campaignId: 'camp-B', targetStoreId: '360usmile' }]);
  });

  it('returns empty array on empty input', () => {
    expect(extractTikTokMappingSteps({})).toEqual([]);
  });

  it('deduplicates entries that resolve to the same (campaignId, targetStoreId)', () => {
    // Two map keys with different advertiserIds but same campaignId+target — the
    // UPDATE would do the same work twice; we collapse to one step.
    const map = {
      'tiktok::adv-1::camp-A': '360usmile',
      'tiktok::adv-2::camp-A': '360usmile',
    };
    const out = extractTikTokMappingSteps(map);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ campaignId: 'camp-A', targetStoreId: '360usmile' });
  });
});

describe('classifyStaleRows()', () => {
  // PK on campaigns_daily: (date, store_id, platform, campaign_id, ad_set_id).
  // PK on ads_daily:       (date, store_id, ad_id).
  // When a campaign moves stores, the per-tick DELETE-then-UPSERT writes the
  // target row. The stale source row (same date + ad_set_id, different
  // store_id) blocks any UPDATE that would move it to the target store_id
  // because the destination already exists.
  //
  // classifyStaleRows splits the stale set:
  //   toDelete = stale rows whose (date, conflictKey) ALREADY exists at target
  //              (cron-live-heavy or cron-daily already produced the correct
  //              row; the stale row is the duplicate and should disappear).
  //   toUpdate = stale rows with no counterpart at the target (older dates
  //              that pre-date both cron-live-heavy's rolling 2-day window
  //              and the mapping change; safe to move the row's store_id).

  const KEY = 'ad_set_id' as const;

  it('returns empty diffs on empty input', () => {
    const out = classifyStaleRows([], [], KEY);
    expect(out.toDelete).toEqual([]);
    expect(out.toUpdate).toEqual([]);
  });

  it('all stale rows have target counterparts → all to DELETE', () => {
    const stale = [
      { date: '2026-05-28', store_id: 'uzoshop', ad_set_id: 'A' },
      { date: '2026-05-29', store_id: 'uzoshop', ad_set_id: 'B' },
    ];
    const target = [
      { date: '2026-05-28', store_id: 'usmile360', ad_set_id: 'A' },
      { date: '2026-05-29', store_id: 'usmile360', ad_set_id: 'B' },
    ];
    const out = classifyStaleRows(stale, target, KEY);
    expect(out.toDelete).toEqual(stale);
    expect(out.toUpdate).toEqual([]);
  });

  it('no target rows → all stale to UPDATE (move historical store_id)', () => {
    const stale = [
      { date: '2026-05-10', store_id: 'uzoshop', ad_set_id: 'A' },
      { date: '2026-05-12', store_id: 'uzoshop', ad_set_id: 'B' },
    ];
    const out = classifyStaleRows(stale, [], KEY);
    expect(out.toDelete).toEqual([]);
    expect(out.toUpdate).toEqual(stale);
  });

  it('mixed — some stale have target counterparts, others don\'t', () => {
    const stale = [
      // Has counterpart at target → DELETE
      { date: '2026-05-28', store_id: 'uzoshop', ad_set_id: 'A' },
      // No counterpart at target → UPDATE
      { date: '2026-05-10', store_id: 'uzoshop', ad_set_id: 'A' },
      // Has counterpart at target (different ad_set_id) → DELETE
      { date: '2026-05-29', store_id: 'uzoshop', ad_set_id: 'B' },
    ];
    const target = [
      { date: '2026-05-28', store_id: 'usmile360', ad_set_id: 'A' },
      { date: '2026-05-29', store_id: 'usmile360', ad_set_id: 'B' },
    ];
    const out = classifyStaleRows(stale, target, KEY);
    expect(out.toDelete).toEqual([
      { date: '2026-05-28', store_id: 'uzoshop', ad_set_id: 'A' },
      { date: '2026-05-29', store_id: 'uzoshop', ad_set_id: 'B' },
    ]);
    expect(out.toUpdate).toEqual([
      { date: '2026-05-10', store_id: 'uzoshop', ad_set_id: 'A' },
    ]);
  });

  it('match key is (date, conflictKey) — same date, different ad_set_id ≠ match', () => {
    const stale = [
      { date: '2026-05-28', store_id: 'uzoshop', ad_set_id: 'A' },
    ];
    const target = [
      { date: '2026-05-28', store_id: 'usmile360', ad_set_id: 'B' },
    ];
    const out = classifyStaleRows(stale, target, KEY);
    expect(out.toDelete).toEqual([]);
    expect(out.toUpdate).toEqual(stale);
  });

  it('conflictKey="ad_id" works for ads_daily', () => {
    const stale = [
      { date: '2026-05-28', store_id: 'uzoshop', ad_id: 'AD-1' },
      { date: '2026-05-28', store_id: 'uzoshop', ad_id: 'AD-2' },
    ];
    const target = [
      { date: '2026-05-28', store_id: 'usmile360', ad_id: 'AD-1' },
    ];
    const out = classifyStaleRows(stale, target, 'ad_id');
    expect(out.toDelete).toEqual([{ date: '2026-05-28', store_id: 'uzoshop', ad_id: 'AD-1' }]);
    expect(out.toUpdate).toEqual([{ date: '2026-05-28', store_id: 'uzoshop', ad_id: 'AD-2' }]);
  });
});
