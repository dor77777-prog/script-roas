// dashboard-web/src/lib/operator/__tests__/runsSummary.test.ts
//
// Pure-aggregator tests for buildRunsSummary — the deep module behind the
// /operator "ריצות אחרונות" (recent runs / pipeline health) panel that
// replaced the removed Inngest JobsTable. The aggregator collapses
// data_freshness rows + cron_tick_snapshots into ONE row per cron/worker job.

import { describe, it, expect } from 'vitest';
import { buildRunsSummary } from '@/lib/operator/runsSummary';
import type { FreshnessRow } from '@/lib/inngest/freshness';
import type { CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

const NOW = Date.parse('2026-06-22T10:00:00.000Z');

function freshness(overrides: Partial<FreshnessRow> = {}): FreshnessRow {
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
    ...overrides,
  };
}

function tick(overrides: Partial<CronTickSnapshotRow> = {}): CronTickSnapshotRow {
  return {
    tick_id: 'tick_1',
    started_at: '2026-06-22T09:50:00.000Z',
    finished_at: '2026-06-22T09:50:05.000Z',
    fan_out_count: 18,
    events_completed_count: 16,
    events_skipped_count: 1,
    events_failed_count: 1,
    ...overrides,
  };
}

describe('buildRunsSummary — worker-meta', () => {
  it('derives a healthy worker-meta row from recent successful meta freshness rows', () => {
    const rows = buildRunsSummary(
      { freshness: [freshness({ platform: 'meta' })], ticks: [], now: NOW },
    );
    const meta = rows.find((r) => r.job === 'worker-meta');
    expect(meta).toBeDefined();
    expect(meta!.status).toBe('success');
    expect(meta!.lastSuccessAt).toBe('2026-06-22T09:59:00.000Z');
    expect(meta!.lastError).toBeNull();
  });

  it('flags worker-meta as error and surfaces the last error when a scope failed', () => {
    const rows = buildRunsSummary({
      freshness: [
        freshness({ platform: 'meta', scope: 'campaign_metrics' }),
        freshness({
          platform: 'meta',
          scope: 'campaign_status',
          status: 'auth_error',
          error_code: 'AUTH_INVALID',
          error_message: 'token expired',
          // a failed tick preserves the prior success timestamp
          last_success_at: '2026-06-22T08:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('error');
    expect(meta.lastError).toEqual({ code: 'AUTH_INVALID', message: 'token expired' });
    // newest success across scopes is still surfaced
    expect(meta.lastSuccessAt).toBe('2026-06-22T09:59:00.000Z');
  });

  it('marks worker-meta stale when the last success aged past the scope SLA (worker stopped firing)', () => {
    // campaign_metrics SLA is 60 min; last success 3h ago, status still "success".
    const rows = buildRunsSummary({
      freshness: [
        freshness({
          platform: 'meta',
          scope: 'campaign_metrics',
          status: 'success',
          last_success_at: '2026-06-22T07:00:00.000Z',
          last_attempt_at: '2026-06-22T07:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('stale');
    expect(meta.lastError).toBeNull();
  });
});

describe('buildRunsSummary — cron-tick', () => {
  it('derives a healthy cron-tick row from the latest snapshot and attaches recent ticks', () => {
    const ticks = [
      tick({ tick_id: 'tick_b', finished_at: '2026-06-22T09:50:05.000Z', events_failed_count: 0 }),
      tick({ tick_id: 'tick_a', finished_at: '2026-06-22T09:40:05.000Z', events_failed_count: 0 }),
    ];
    const rows = buildRunsSummary({ freshness: [], ticks, now: NOW });
    const cronTick = rows.find((r) => r.job === 'cron-tick')!;
    expect(cronTick).toBeDefined();
    expect(cronTick.source).toBe('cron_tick_snapshots');
    expect(cronTick.status).toBe('success');
    // finished_at of the most recent tick is the last success time
    expect(cronTick.lastSuccessAt).toBe('2026-06-22T09:50:05.000Z');
    // the panel's expandable detail gets the recent ticks
    expect(cronTick.ticks).toHaveLength(2);
    expect(cronTick.ticks![0].tick_id).toBe('tick_b');
  });

  it('marks cron-tick error when the latest tick has failed events', () => {
    const rows = buildRunsSummary({
      freshness: [],
      ticks: [tick({ tick_id: 'tick_x', events_failed_count: 3 })],
      now: NOW,
    });
    const cronTick = rows.find((r) => r.job === 'cron-tick')!;
    expect(cronTick.status).toBe('error');
  });
});

describe('buildRunsSummary — cohort', () => {
  it('derives cohort from cohort_monthly freshness with its 7-day SLA (not stale at 3h)', () => {
    const rows = buildRunsSummary({
      freshness: [
        freshness({
          platform: 'shopify',
          scope: 'cohort_monthly',
          table_name: 'customer_cohort_monthly',
          status: 'success',
          // 3h ago — well within the 7-day cohort SLA, so NOT stale
          last_success_at: '2026-06-22T07:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const cohort = rows.find((r) => r.job === 'cohort')!;
    expect(cohort).toBeDefined();
    expect(cohort.status).toBe('success');
    expect(cohort.lastSuccessAt).toBe('2026-06-22T07:00:00.000Z');
    // cohort_monthly rows must NOT leak into a platform worker row: worker-meta
    // is still rostered but has no derived source (cohort is shopify-platform).
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.source).toBe('none');
    expect(meta.lastSuccessAt).toBeNull();
  });
});

describe('buildRunsSummary — full roster', () => {
  it('always returns all 10 jobs in a stable order, with unknown for sourceless jobs', () => {
    const rows = buildRunsSummary({ freshness: [], ticks: [], now: NOW });
    expect(rows.map((r) => r.job)).toEqual([
      'cron-live',
      'cron-daily',
      'cron-yesterday',
      'cron-tick',
      'worker-meta',
      'worker-google',
      'worker-tiktok',
      'cohort',
      'whatsapp',
      'oauth-canary',
    ]);
    // Jobs with no dedicated DB telemetry degrade to unknown / source none.
    const live = rows.find((r) => r.job === 'cron-live')!;
    expect(live.status).toBe('unknown');
    expect(live.source).toBe('none');
    expect(live.lastSuccessAt).toBeNull();
  });
});
