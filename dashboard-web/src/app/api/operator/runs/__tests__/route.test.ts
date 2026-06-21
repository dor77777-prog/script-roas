// dashboard-web/src/app/api/operator/runs/__tests__/route.test.ts
//
// Route tests for GET /api/operator/runs — the QStash/DB-backed replacement
// for the removed Inngest /api/operator/jobs proxy. Soft-fails with HTTP 200
// + {error} exactly like the old proxy so the panel degrades gracefully.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FreshnessRow } from '@/lib/inngest/freshness';
import type { CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

const state = vi.hoisted(() => ({
  freshness: [] as FreshnessRow[],
  freshnessThrows: false,
  ticks: [] as CronTickSnapshotRow[],
}));

vi.mock('@/lib/inngest/freshness', async (orig) => {
  const actual = await orig<typeof import('@/lib/inngest/freshness')>();
  return {
    ...actual,
    getFreshness: vi.fn(async () => {
      if (state.freshnessThrows) throw new Error('boom: SPREADSHEET_ID leaked');
      return state.freshness;
    }),
  };
});

vi.mock('@/lib/operator/registriesReaders', async (orig) => {
  const actual = await orig<typeof import('@/lib/operator/registriesReaders')>();
  return {
    ...actual,
    fetchCronTickSnapshots: vi.fn(async () => state.ticks),
  };
});

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({}),
}));

import { GET } from '../route';

function freshness(o: Partial<FreshnessRow> = {}): FreshnessRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_metrics',
    table_name: 'campaigns_daily',
    last_attempt_at: '2026-06-22T09:59:00.000Z',
    last_success_at: '2026-06-22T09:59:00.000Z',
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: '2026-06-22T09:59:00.000Z',
    ...o,
  };
}

beforeEach(() => {
  state.freshness = [];
  state.freshnessThrows = false;
  state.ticks = [];
});

describe('GET /api/operator/runs', () => {
  it('returns the full job roster with verdicts derived from DB sources', async () => {
    state.freshness = [freshness({ platform: 'meta' })];
    state.ticks = [
      {
        tick_id: 'tick_1',
        started_at: '2026-06-22T09:50:00.000Z',
        finished_at: '2026-06-22T09:50:05.000Z',
        fan_out_count: 18,
        events_completed_count: 18,
        events_skipped_count: 0,
        events_failed_count: 0,
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows).toHaveLength(10);
    const meta = body.rows.find((r: { job: string }) => r.job === 'worker-meta');
    expect(meta.status).toBe('success');
    const tick = body.rows.find((r: { job: string }) => r.job === 'cron-tick');
    expect(tick.status).toBe('success');
    expect(typeof body.lastUpdated).toBe('string');
  });

  it('soft-fails with HTTP 200 + sanitized {error} (no raw leak) when a source throws', async () => {
    state.freshnessThrows = true;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    // raw message must NOT leak to the client
    expect(JSON.stringify(body)).not.toContain('SPREADSHEET_ID');
    expect(body.rows).toEqual([]);
  });
});
