// FIX #4 — adSpendFreshness pure helper tests.
//
// The main dashboard "LIVE / fresh" chip + per-store/hero desaturation used to
// read a single global data_daily.updated_at (max), which cron-live BUMPS every
// ~10 min on its Shopify-only revenue write. So if the ad-spend workers
// (meta/google/tiktok) stop while cron-live keeps writing, the chip stayed
// green and the cards stayed full-saturation over hours-stale ROAS/profit/MER.
//
// effectiveFreshnessAt folds the AD-SPEND freshness into the signal: it returns
// the OLDEST (most stale) of dataLastWriteAt and each known ad-spend platform,
// so a stale platform forces the chip/desaturation out of the fresh state —
// the Shopify-only write can never mask stale ad spend.

import { describe, it, expect } from 'vitest';
import {
  effectiveFreshnessAt,
  worstAdSpendFreshAt,
} from '../adSpendFreshness';
import type { AdSpendFreshness } from '@/lib/postgresReaders';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
function ago(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}

const FRESH: AdSpendFreshness = { meta: ago(2), google: ago(3), tiktok: ago(1) };

describe('worstAdSpendFreshAt', () => {
  it('returns the OLDEST non-null platform timestamp', () => {
    expect(worstAdSpendFreshAt({ meta: ago(2), google: ago(90), tiktok: ago(1) }))
      .toBe(ago(90));
  });

  it('skips null platforms', () => {
    expect(worstAdSpendFreshAt({ meta: ago(5), google: null, tiktok: null }))
      .toBe(ago(5));
  });

  it('all null → null', () => {
    expect(worstAdSpendFreshAt({ meta: null, google: null, tiktok: null })).toBeNull();
  });
});

describe('effectiveFreshnessAt', () => {
  it('all fresh → returns the dataLastWriteAt unchanged-ish (oldest of fresh set)', () => {
    // dataLastWriteAt fresh (1 min), ad spend fresh → result is the OLDEST
    // among them, still recent (3 min) → chip stays green.
    const eff = effectiveFreshnessAt(ago(1), FRESH);
    expect(eff).toBe(ago(3)); // google is the oldest of the fresh set
  });

  it('stale ad spend forces the signal stale even when data_daily write is recent', () => {
    // cron-live just wrote revenue (dataLastWriteAt = 1 min) but meta ad spend
    // is 90 min stale → effective freshness must reflect the 90-min staleness.
    const eff = effectiveFreshnessAt(ago(1), { meta: ago(90), google: ago(2), tiktok: ago(3) });
    expect(eff).toBe(ago(90));
  });

  it('null dataLastWriteAt → falls back to worst ad-spend timestamp', () => {
    expect(effectiveFreshnessAt(null, { meta: ago(40), google: ago(5), tiktok: null }))
      .toBe(ago(40));
  });

  it('no ad-spend data at all (all null) → degrades to dataLastWriteAt', () => {
    expect(effectiveFreshnessAt(ago(7), { meta: null, google: null, tiktok: null }))
      .toBe(ago(7));
  });

  it('both null → null', () => {
    expect(effectiveFreshnessAt(null, { meta: null, google: null, tiktok: null })).toBeNull();
  });

  it('undefined ad-spend map → degrades to dataLastWriteAt (back-compat)', () => {
    expect(effectiveFreshnessAt(ago(4), undefined)).toBe(ago(4));
  });
});
