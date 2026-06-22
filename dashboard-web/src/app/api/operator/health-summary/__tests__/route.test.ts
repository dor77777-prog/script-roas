// dashboard-web/src/app/api/operator/health-summary/__tests__/route.test.ts
//
// Route tests for GET /api/operator/health-summary — the rolled-up "is
// everything green?" signal behind the /operator <StatusPill>.
//
// PRIMARY GUARD (observability hardening): the 'system' heartbeat lane
// (recordHeartbeat writes one '__system__'/'system'/<cron>/'heartbeat' row per
// schedule-cadence cron) must NOT count toward freshness_pct. Those rows live
// on a daily / ~11.5 h / every-2h cadence that far exceeds the 60-min scope
// default, so without the exclusion ~4 perpetually-"stale" heartbeat rows would
// drag freshness_pct under the 0.95 GREEN threshold and flip the StatusPill
// GREEN→YELLOW for most of the day even when every cron is healthy. This is the
// inverse false-alarm the hardening set out to KILL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FreshnessRow } from '@/lib/inngest/freshness';

const state = vi.hoisted(() => ({
  freshness: [] as FreshnessRow[],
  tokenFailuresCount: 0 as number | null,
}));

vi.mock('@/lib/inngest/freshness', async (orig) => {
  const actual = await orig<typeof import('@/lib/inngest/freshness')>();
  return {
    ...actual,
    getFreshness: vi.fn(async () => state.freshness),
  };
});

// token_failures count query: sb.from(...).select(..., { count, head }).is(...)
// resolves to { count, error }. We model the chain so the final await yields it.
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        is: () => Promise.resolve({ count: state.tokenFailuresCount, error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: vi.fn() }));

import { GET } from '../route';

// Heartbeat-row factory: the 'system' lane recordHeartbeat writes.
function heartbeat(scope: string, lastSuccessAt: string | null): FreshnessRow {
  return {
    store_id: '__system__',
    platform: 'system',
    scope,
    table_name: 'heartbeat',
    last_attempt_at: lastSuccessAt ?? '2026-06-22T00:00:00.000Z',
    last_success_at: lastSuccessAt,
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: lastSuccessAt ?? '2026-06-22T00:00:00.000Z',
  };
}

function dataRow(overrides: Partial<FreshnessRow> = {}): FreshnessRow {
  const fresh = new Date(Date.now() - 2 * 60_000).toISOString(); // 2 min ago
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_metrics',
    table_name: 'campaigns_daily',
    last_attempt_at: fresh,
    last_success_at: fresh,
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: fresh,
    ...overrides,
  };
}

beforeEach(() => {
  state.freshness = [];
  state.tokenFailuresCount = 0;
});

describe('GET /api/operator/health-summary', () => {
  it('all fresh data rows + zero errors → GREEN, freshness_pct 1', async () => {
    state.freshness = [
      dataRow({ platform: 'meta' }),
      dataRow({ platform: 'google' }),
      dataRow({ platform: 'tiktok' }),
    ];
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('green');
    expect(body.freshness_pct).toBe(1);
  });

  // THE FALSE-NOT-GREEN GUARD. The 'system' heartbeat rows sit on a daily /
  // overnight / every-2h cadence and are hours old by design. Counting them
  // against the 60-min scope default would mark them stale and crater
  // freshness_pct (e.g. 3/7 ≈ 0.43 → RED). With the exclusion only the 3 fresh
  // data rows count → freshness_pct 1 → GREEN.
  it('EXCLUDES the system heartbeat lane: hours-old daily/whatsapp/yesterday heartbeats do NOT drag freshness_pct', async () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60_000).toISOString();
    const elevenHoursAgo = new Date(Date.now() - 11 * 60 * 60_000).toISOString();
    const ninetyMinAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    state.freshness = [
      // 3 genuinely-fresh per-(store,platform) data rows.
      dataRow({ platform: 'meta' }),
      dataRow({ platform: 'google' }),
      dataRow({ platform: 'tiktok' }),
      // 4 heartbeat rows that are HEALTHY for their cadence but old in minutes.
      heartbeat('cron_daily', eightHoursAgo),
      heartbeat('oauth_canary', eightHoursAgo),
      heartbeat('whatsapp', elevenHoursAgo),
      heartbeat('cron_yesterday', ninetyMinAgo),
    ];
    const res = await GET();
    const body = await res.json();
    expect(body.freshness_pct).toBe(1); // only the 3 data rows count
    expect(body.status).toBe('green'); // StatusPill stays GREEN, not YELLOW
  });

  it('a genuinely-stale DATA row (90-min-old success on a 60-min scope) still drags freshness_pct', async () => {
    const ninetyMinAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    state.freshness = [
      dataRow({ platform: 'meta' }),
      dataRow({ platform: 'google', scope: 'campaign_metrics', last_success_at: ninetyMinAgo }),
      // a heartbeat present but excluded — must not change the denominator.
      heartbeat('cron_daily', new Date(Date.now() - 8 * 60 * 60_000).toISOString()),
    ];
    const res = await GET();
    const body = await res.json();
    // 1 of 2 DATA rows fresh → 0.5; heartbeat excluded from both num + denom.
    expect(body.freshness_pct).toBe(0.5);
    expect(body.status).toBe('red'); // < 0.80
  });

  it('unresolved token_failures escalate the pill (errors_1h drives YELLOW/RED)', async () => {
    state.freshness = [dataRow()];
    state.tokenFailuresCount = 2; // [1,3] → YELLOW
    const res = await GET();
    const body = await res.json();
    expect(body.errors_1h).toBe(2);
    expect(body.status).toBe('yellow');
  });
});
