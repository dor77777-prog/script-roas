import { describe, expect, it } from 'vitest';
import {
  buildEvents,
  cooldownSecondsForPct,
  cooldownSecondsForHotMetrics,
} from '@/lib/registries/priorityBuilder';
import type { FreshnessRow } from '@/lib/inngest/freshness';

const TICK_ID = '2026-05-29T14:30';
const NOW_MS = new Date('2026-05-29T14:30:42.000Z').getTime();

const ALL_STORES: Array<'uzoshop' | 'zolplus' | 'usmile360'> =
  ['uzoshop', 'zolplus', 'usmile360'];

type MetaBucState = { pct: number; etaMinutes: number };
type BucByStore = Partial<Record<'uzoshop' | 'zolplus' | 'usmile360', MetaBucState>>;

function freshness(over: Partial<FreshnessRow>): FreshnessRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_status',
    table_name: 'campaign_registry',
    last_attempt_at: '2026-05-29T14:20:00.000Z',
    last_success_at: '2026-05-29T14:20:00.000Z',
    status: 'success',
    lag_minutes: 10,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: '2026-05-29T14:20:00.000Z',
    ...over,
  };
}

describe('cooldownSecondsForPct()', () => {
  it('< 30% → 300s (aggressive)', () => {
    expect(cooldownSecondsForPct(0)).toBe(300);
    expect(cooldownSecondsForPct(29)).toBe(300);
  });
  it('30-60% → 480s (standard)', () => {
    expect(cooldownSecondsForPct(30)).toBe(480);
    expect(cooldownSecondsForPct(59)).toBe(480);
  });
  it('60-80% → 900s (conservative)', () => {
    expect(cooldownSecondsForPct(60)).toBe(900);
    expect(cooldownSecondsForPct(79)).toBe(900);
  });
  it('>= 80% → Infinity (skip)', () => {
    expect(cooldownSecondsForPct(80)).toBe(Number.POSITIVE_INFINITY);
    expect(cooldownSecondsForPct(99)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('cooldownSecondsForHotMetrics()', () => {
  it('returns 180s when pct < 30', () => {
    expect(cooldownSecondsForHotMetrics(0)).toBe(180);
    expect(cooldownSecondsForHotMetrics(29)).toBe(180);
  });
  it('returns 300s when 30 <= pct < 60', () => {
    expect(cooldownSecondsForHotMetrics(30)).toBe(300);
    expect(cooldownSecondsForHotMetrics(59)).toBe(300);
  });
  it('returns 600s when 60 <= pct < 80', () => {
    expect(cooldownSecondsForHotMetrics(60)).toBe(600);
    expect(cooldownSecondsForHotMetrics(79)).toBe(600);
  });
  it('returns Infinity when pct >= 80', () => {
    expect(cooldownSecondsForHotMetrics(80)).toBe(Number.POSITIVE_INFINITY);
    expect(cooldownSecondsForHotMetrics(100)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('buildEvents() — dynamic thresholds (meta-only assertions)', () => {
  // Phase B tests — assert Meta-platform fan-out behavior. Filter by
  // 'meta/job.requested' so the new multi-platform default (Phase C —
  // google + tiktok default to { pct: 0, etaMinutes: 0 } when their BUC
  // input is omitted, so they too emit events) doesn't pollute the count.
  // Also filter by scope='status' because Phase C added 'hot_metrics'.

  it('emits one meta status event per store when all stale + pct low', () => {
    const buc: BucByStore = {
      uzoshop: { pct: 10, etaMinutes: 0 },
      zolplus: { pct: 5, etaMinutes: 0 },
      usmile360: { pct: 0, etaMinutes: 0 },
    };
    const all = buildEvents({
      stores: ALL_STORES,
      freshness: [],
      metaBucStateByStore: buc,
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events).toHaveLength(3);
    expect(events.every(e => e.name === 'meta/job.requested')).toBe(true);
    expect(events.every(e => e.data.scope === 'status')).toBe(true);
  });

  it('Layer 1: eta > 0 → skip regardless of pct or staleness', () => {
    const all = buildEvents({
      stores: ALL_STORES,
      freshness: [],
      metaBucStateByStore: {
        uzoshop: { pct: 5, etaMinutes: 3 },
        zolplus: { pct: 5, etaMinutes: 0 },
        usmile360: { pct: 5, etaMinutes: 0 },
      },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events.map(e => e.data.store_id).sort()).toEqual(['usmile360', 'zolplus']);
  });

  it('Layer 1: pct >= 95 → skip', () => {
    const all = buildEvents({
      stores: ALL_STORES,
      freshness: [],
      metaBucStateByStore: {
        uzoshop: { pct: 95, etaMinutes: 0 },
        zolplus: { pct: 5, etaMinutes: 0 },
        usmile360: { pct: 5, etaMinutes: 0 },
      },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events.map(e => e.data.store_id).sort()).toEqual(['usmile360', 'zolplus']);
  });

  it('Layer 2: 60-80% pct → 15-min cooldown — 10 min stale insufficient', () => {
    const all = buildEvents({
      stores: ['uzoshop'],
      freshness: [
        freshness({ store_id: 'uzoshop', last_success_at: '2026-05-29T14:20:42.000Z' }),
      ],
      metaBucStateByStore: { uzoshop: { pct: 70, etaMinutes: 0 } },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events).toHaveLength(0);
  });

  it('Layer 2: < 30% pct → 5-min cooldown — 6 min stale sufficient', () => {
    const all = buildEvents({
      stores: ['uzoshop'],
      freshness: [
        freshness({ store_id: 'uzoshop', last_success_at: '2026-05-29T14:24:42.000Z' }),
      ],
      metaBucStateByStore: { uzoshop: { pct: 10, etaMinutes: 0 } },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events).toHaveLength(1);
  });

  it('Layer 2: >= 80% pct → Infinite cooldown → skip', () => {
    const all = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: { uzoshop: { pct: 82, etaMinutes: 0 } },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events).toHaveLength(0);
  });

  it('event id encodes platform:store:scope:tick (idempotency)', () => {
    const all = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: { uzoshop: { pct: 10, etaMinutes: 0 } },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events[0].id).toBe('meta:uzoshop:status:2026-05-29T14:30');
  });

  it('staleness_seconds reflects time since last_success_at', () => {
    const all = buildEvents({
      stores: ['uzoshop'],
      freshness: [
        freshness({ store_id: 'uzoshop', last_success_at: '2026-05-29T14:20:42.000Z' }),
      ],
      metaBucStateByStore: { uzoshop: { pct: 10, etaMinutes: 0 } },
      tickId: TICK_ID,
      nowMs: NOW_MS,
    });
    const events = all.filter(e => e.name === 'meta/job.requested' && e.data.scope === 'status');
    expect(events[0].data.staleness_seconds).toBe(600);
  });
});

describe('buildEvents() — multi-platform Phase C', () => {
  it('emits Meta + Google + TikTok events when all 3 are stale', () => {
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 } },
      googleBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 } },
      tiktokBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 } },
      tickId: '2026-05-29T14:30',
      nowMs: NOW_MS,
    });
    expect(events).toHaveLength(6);
    expect(events.map(e => e.name).sort()).toEqual(expect.arrayContaining([
      'meta/job.requested', 'google/job.requested', 'tiktok/job.requested',
    ]));
  });

  it('emits both status and hot_metrics events for the same platform when both are stale', () => {
    const events = buildEvents({
      stores: ['uzoshop'],
      freshness: [],
      metaBucStateByStore: { uzoshop: { pct: 5, etaMinutes: 0 } },
      googleBucStateByStore: {},
      tiktokBucStateByStore: {},
      tickId: '2026-05-29T14:30',
      nowMs: NOW_MS,
    });
    const metaEvents = events.filter(e => e.name === 'meta/job.requested');
    expect(metaEvents.map(e => e.data.scope).sort()).toEqual(['hot_metrics', 'status']);
  });
});
