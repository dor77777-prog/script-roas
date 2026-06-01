// dashboard-web/src/components/home/__tests__/ActivityFeedRefreshInterval.test.ts
//
// Phase 3 (2026-06-01) — the Home <ActivityFeed> was rebuilt into a REAL-TIME
// Shopify activity feed. It now polls `/api/store-events` (the dedicated
// real-time read route) instead of the campaign-status endpoint, at a 12s
// cadence so it reads as genuinely live vs the dashboard's ~10-min cadence.
//
// History: the prior guard (2026-05-31) pinned a 15s poll + a 30s
// dedupingInterval against `/api/home/activity-events` (campaign-status). That
// data source moved entirely (the operator <StatusEventsFeed> still carries the
// status events); this guard now pins the real-time contract.
//
// Source-file guard rather than a DOM mount so the SWR options object literal
// is verified directly — a regression that bumps the interval back up (the feed
// would stop feeling live) fails loud, fast, without mocking SWR.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ACTIVITY_FEED_SRC = resolve(__dirname, '..', 'ActivityFeed.tsx');

describe('ActivityFeed real-time SWR polling — Phase 3 (2026-06-01)', () => {
  const src = readFileSync(ACTIVITY_FEED_SRC, 'utf8');

  it('polls the real-time read route /api/store-events (not the old status endpoint)', () => {
    expect(src).toMatch(/\/api\/store-events/);
    expect(src).not.toMatch(/\/api\/home\/activity-events/);
    expect(src).not.toMatch(/\/api\/operator\/status-events/);
  });

  it('uses a 12s refreshInterval so the feed reads as genuinely real-time', () => {
    expect(src).toMatch(/refreshInterval:\s*12_000/);
    // Must not regress to the dashboard's slow cadences.
    expect(src).not.toMatch(/refreshInterval:\s*(?:15_000|60_000)/);
  });
});
