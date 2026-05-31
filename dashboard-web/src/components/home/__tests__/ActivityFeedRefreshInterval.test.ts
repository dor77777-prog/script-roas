// dashboard-web/src/components/home/__tests__/ActivityFeedRefreshInterval.test.ts
//
// Bug fix regression guard (2026-05-31).
//
// User report: "יומן אירועים לא מתעדכן" — the Home activity feed appeared
// frozen because SWR was polling at 60s and the operator was logging
// events faster than that. The fix drops the poll to 15s + adds an
// explicit `dedupingInterval: 30_000` so multiple ActivityFeed mounts
// (e.g. open in another tab) don't multiply the upstream cost.
//
// Source-file guard rather than a DOM mount because the SWR options live
// inside the component module and inspecting the actual SWR config from
// the test would require mocking SWR — losing the very thing we want to
// guarantee (that the options object literal stays the right shape).
// This stays fast (no React render, no SWR mock, no jsdom), and any
// regression that bumps the polling interval back to 60s will fail loud.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ACTIVITY_FEED_SRC = resolve(
  __dirname,
  '..',
  'ActivityFeed.tsx',
);

describe('ActivityFeed SWR polling — Bug fix (2026-05-31)', () => {
  const src = readFileSync(ACTIVITY_FEED_SRC, 'utf8');

  it('uses a 15s refreshInterval (not the old 60s) so events surface within a quarter-minute', () => {
    // Match the literal so a future refactor that swaps to a constant has
    // to either rename the constant to something semantic OR update this
    // guard — both are explicit decisions, not silent regressions.
    expect(src).toMatch(/refreshInterval:\s*15_000/);
    expect(src).not.toMatch(/refreshInterval:\s*60_000/);
  });

  it('keeps SWR dedupingInterval at 30s so concurrent tabs do not multiply Supabase calls', () => {
    // The /api/operator/status-events route is ISR-cached at 60s; SWR's
    // default dedupingInterval (2s) would only protect against multiple
    // mounts within 2s. 30s gives us a meaningful coalescing window
    // without sacrificing the 15s "fresh enough" promise to the operator.
    expect(src).toMatch(/dedupingInterval:\s*30_000/);
  });
});
