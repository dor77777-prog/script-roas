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

  // ---- ORPHANED / LEGACY scope must NOT poison the worker verdict ----------
  // The live metaWorker writes ONLY these scopes: campaign_status, adset_status,
  // ad_status (status branch) + campaign_metrics, ad_metrics (hot_metrics
  // branch). `kpi_daily` + `adset_metrics` are written by cron-daily on a
  // DIFFERENT cadence/table (data_daily), NOT by the worker. A stale/errored
  // kpi_daily row that the worker no longer touches must be ignored — it is the
  // wrong job's telemetry, and counting it shows a false worker-meta=error.
  it('IGNORES an orphaned legacy kpi_daily error while the live worker scopes are fresh+success (the bug)', () => {
    // Concrete reproduction: uzoshop has a dead meta/kpi_daily row (8h-old
    // transient_error, never succeeded) alongside fresh successful live scopes.
    const rows = buildRunsSummary({
      freshness: [
        freshness({ platform: 'meta', scope: 'campaign_metrics' }),
        freshness({ platform: 'meta', scope: 'ad_metrics', table_name: 'ads_daily' }),
        freshness({ platform: 'meta', scope: 'campaign_status', table_name: 'campaign_registry' }),
        freshness({ platform: 'meta', scope: 'adset_status', table_name: 'adset_registry' }),
        freshness({ platform: 'meta', scope: 'ad_status', table_name: 'ad_registry' }),
        // ORPHAN: legacy cron-daily scope the worker no longer writes.
        freshness({
          platform: 'meta',
          scope: 'kpi_daily',
          table_name: 'data_daily',
          status: 'transient_error',
          error_code: 'META_FETCH_FAILED',
          error_message: 'request failed 8h ago',
          last_success_at: null,
          last_attempt_at: '2026-06-22T02:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    // The dead kpi_daily row is the wrong job's telemetry → excluded.
    expect(meta.status).toBe('success');
    expect(meta.lastError).toBeNull();
    // Verdict is driven by the live worker scopes (newest success surfaced).
    expect(meta.lastSuccessAt).toBe('2026-06-22T09:59:00.000Z');
  });

  it('GENUINE OUTAGE: ALL live worker scopes stale → worker-meta = stale (not green, not error)', () => {
    // Every live scope last succeeded 3h ago (SLA 60 min) but stored status is
    // still "success" — the worker stopped firing entirely. A lone fresh
    // orphan kpi_daily must NOT rescue the verdict to green either.
    const staleAt = '2026-06-22T07:00:00.000Z';
    const rows = buildRunsSummary({
      freshness: [
        freshness({ platform: 'meta', scope: 'campaign_metrics', last_success_at: staleAt, last_attempt_at: staleAt }),
        freshness({ platform: 'meta', scope: 'ad_metrics', table_name: 'ads_daily', last_success_at: staleAt, last_attempt_at: staleAt }),
        freshness({ platform: 'meta', scope: 'campaign_status', table_name: 'campaign_registry', last_success_at: staleAt, last_attempt_at: staleAt }),
        freshness({ platform: 'meta', scope: 'adset_status', table_name: 'adset_registry', last_success_at: staleAt, last_attempt_at: staleAt }),
        freshness({ platform: 'meta', scope: 'ad_status', table_name: 'ad_registry', last_success_at: staleAt, last_attempt_at: staleAt }),
        // A fresh orphan must NOT count toward (or rescue) the worker verdict.
        freshness({ platform: 'meta', scope: 'kpi_daily', table_name: 'data_daily' }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('stale');
    expect(meta.lastError).toBeNull();
  });

  it('LIVE FAILURE still flags error: a recent error on a live worker scope → worker-meta = error', () => {
    // Even with the allowlist, a real recent failure on an ACTIVE worker scope
    // must still escalate — we are filtering out orphans, not muting failures.
    const rows = buildRunsSummary({
      freshness: [
        freshness({ platform: 'meta', scope: 'campaign_metrics' }),
        freshness({
          platform: 'meta',
          scope: 'ad_status',
          table_name: 'ad_registry',
          status: 'transient_error',
          error_code: '429',
          error_message: 'rate limited',
          last_attempt_at: '2026-06-22T09:58:00.000Z',
          last_success_at: '2026-06-22T08:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('error');
    expect(meta.lastError).toEqual({ code: '429', message: 'rate limited' });
  });

  it('worker-meta is unknown (not success) when ONLY orphaned/legacy scopes exist (no live telemetry)', () => {
    // If the only meta rows are non-worker scopes (kpi_daily / adset_metrics),
    // the worker has NO observable live telemetry → must degrade to unknown,
    // never fabricate a green light from another job's rows.
    const rows = buildRunsSummary({
      freshness: [
        freshness({ platform: 'meta', scope: 'kpi_daily', table_name: 'data_daily' }),
        freshness({ platform: 'meta', scope: 'adset_metrics', table_name: 'adsets_daily' }),
      ],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('unknown');
    expect(meta.source).toBe('none');
    expect(meta.lastSuccessAt).toBeNull();
  });

  it('single-scope job: one fresh successful live scope → worker-meta = success', () => {
    const rows = buildRunsSummary({
      freshness: [freshness({ platform: 'meta', scope: 'campaign_status', table_name: 'campaign_registry' })],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('success');
    expect(meta.source).toBe('data_freshness');
  });

  // With TWO errored live scopes, the surfaced lastError must be the genuinely
  // MOST-RECENT one (by last_attempt_at), independent of DB row ordering — the
  // OLDER error appears LAST in the array but must NOT win.
  it('surfaces the most-recent error by last_attempt_at, not the last row iterated', () => {
    const olderError = freshness({
      platform: 'meta',
      scope: 'campaign_status',
      table_name: 'campaign_registry',
      status: 'transient_error',
      error_code: 'OLD',
      error_message: 'older failure',
      last_attempt_at: '2026-06-22T08:00:00.000Z',
      last_success_at: '2026-06-22T07:00:00.000Z',
    });
    const newerError = freshness({
      platform: 'meta',
      scope: 'ad_status',
      table_name: 'ad_registry',
      status: 'auth_error',
      error_code: 'NEW',
      error_message: 'newer failure',
      last_attempt_at: '2026-06-22T09:30:00.000Z',
      last_success_at: '2026-06-22T07:00:00.000Z',
    });
    // newer error first, older error LAST in row order — older must not clobber.
    const rows = buildRunsSummary({
      freshness: [newerError, olderError],
      ticks: [],
      now: NOW,
    });
    const meta = rows.find((r) => r.job === 'worker-meta')!;
    expect(meta.status).toBe('error');
    expect(meta.lastError).toEqual({ code: 'NEW', message: 'newer failure' });
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

  // ---- AGE-GATE: a stopped orchestrator must NOT stay green forever ----------
  // The tick fires every 10 min. If the cron stops firing entirely, the latest
  // tick is just the last clean tick from hours ago (events_failed_count:0).
  // Without an age-gate it would read 'success' = GREEN FOREVER (the case-3
  // dead-job-stays-green hole). A clean-but-aged latest tick must be 'stale'.
  it('GENUINE OUTAGE: a single old clean tick (3h ago, 0 failures) → cron-tick = stale (not success)', () => {
    const threeHoursAgo = '2026-06-22T07:00:00.000Z';
    const rows = buildRunsSummary({
      freshness: [],
      ticks: [
        tick({
          tick_id: 'tick_old',
          started_at: '2026-06-22T06:59:55.000Z',
          finished_at: threeHoursAgo,
          events_failed_count: 0,
        }),
      ],
      now: NOW,
    });
    const cronTick = rows.find((r) => r.job === 'cron-tick')!;
    expect(cronTick.status).toBe('stale');
    expect(cronTick.lastSuccessAt).toBe(threeHoursAgo);
  });

  it('a fresh clean tick (5 min ago) stays success — normal cadence is not flagged', () => {
    const rows = buildRunsSummary({
      freshness: [],
      ticks: [
        tick({
          tick_id: 'tick_fresh',
          finished_at: '2026-06-22T09:55:00.000Z', // 5 min ago, within 30-min SLA
          events_failed_count: 0,
        }),
      ],
      now: NOW,
    });
    const cronTick = rows.find((r) => r.job === 'cron-tick')!;
    expect(cronTick.status).toBe('success');
  });

  it('a tick boundary just inside the SLA (25 min) stays success; one just past (35 min) is stale', () => {
    const inside = buildRunsSummary({
      freshness: [],
      ticks: [tick({ tick_id: 'tick_25', finished_at: '2026-06-22T09:35:00.000Z', events_failed_count: 0 })],
      now: NOW,
    });
    expect(inside.find((r) => r.job === 'cron-tick')!.status).toBe('success');

    const outside = buildRunsSummary({
      freshness: [],
      ticks: [tick({ tick_id: 'tick_35', finished_at: '2026-06-22T09:25:00.000Z', events_failed_count: 0 })],
      now: NOW,
    });
    expect(outside.find((r) => r.job === 'cron-tick')!.status).toBe('stale');
  });

  it('a failed-event count still wins as error even when the tick is aged (failures surfaced, not muted)', () => {
    const rows = buildRunsSummary({
      freshness: [],
      ticks: [
        tick({
          tick_id: 'tick_old_fail',
          finished_at: '2026-06-22T06:00:00.000Z', // 4h ago (would be stale if clean)
          events_failed_count: 2,
        }),
      ],
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
    // Jobs with NO heartbeat yet still degrade to unknown / source none.
    const live = rows.find((r) => r.job === 'cron-live')!;
    expect(live.status).toBe('unknown');
    expect(live.source).toBe('none');
    expect(live.lastSuccessAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HEARTBEAT-DERIVED schedule-cadence jobs. The 5 crons that have no per-store /
// platform run-telemetry (cron-live, cron-daily, cron-yesterday, whatsapp,
// oauth-canary) now write a 'system'-platform heartbeat row per successful run
// (or transient_error on a caught failure). buildRunsSummary maps each
// heartbeat scope → its job with a per-job SLA reflecting the REAL cadence
// (vercel.json): cron-live ~10 min, cron-yesterday every 2 h, cron-daily +
// oauth-canary ~daily, whatsapp ~3×/day.
// ---------------------------------------------------------------------------

// A heartbeat row uses platform 'system', store '__system__', table 'heartbeat'
// and the job key as scope.
function heartbeat(scope: string, overrides: Partial<FreshnessRow> = {}): FreshnessRow {
  return freshness({
    store_id: '__system__',
    platform: 'system',
    scope,
    table_name: 'heartbeat',
    ...overrides,
  });
}

describe('buildRunsSummary — heartbeat-derived crons', () => {
  it('lights up a fresh cron-live heartbeat as success', () => {
    const rows = buildRunsSummary({
      freshness: [heartbeat('cron_live', { last_success_at: '2026-06-22T09:55:00.000Z' })],
      ticks: [],
      now: NOW,
    });
    const live = rows.find((r) => r.job === 'cron-live')!;
    expect(live.status).toBe('success');
    expect(live.source).toBe('data_freshness');
    expect(live.lastSuccessAt).toBe('2026-06-22T09:55:00.000Z');
  });

  it('marks cron-live STALE when its heartbeat aged past the ~10-min cadence SLA', () => {
    // cron-live fires every ~10 min; a heartbeat 45 min old means it stopped.
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('cron_live', {
          status: 'success',
          last_success_at: '2026-06-22T09:15:00.000Z', // 45 min ago
          last_attempt_at: '2026-06-22T09:15:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'cron-live')!.status).toBe('stale');
  });

  it('marks cron-live ERROR (surfacing the message) on a transient_error heartbeat', () => {
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('cron_live', {
          status: 'transient_error',
          error_code: null,
          error_message: 'qstash down',
          last_attempt_at: '2026-06-22T09:58:00.000Z',
          last_success_at: '2026-06-22T08:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    const live = rows.find((r) => r.job === 'cron-live')!;
    expect(live.status).toBe('error');
    expect(live.lastError).toEqual({ code: null, message: 'qstash down' });
  });

  it('a daily-cadence heartbeat 8 h old is STILL success (daily SLA, not the 60-min worker SLA)', () => {
    // The false-alarm shape inverted: a daily job at 8h must NOT read stale.
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('cron_daily', {
          status: 'success',
          last_success_at: '2026-06-22T02:00:00.000Z', // 8 h ago
          last_attempt_at: '2026-06-22T02:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'cron-daily')!.status).toBe('success');
  });

  it('a daily heartbeat older than ~a day reads STALE (the daily job stopped)', () => {
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('cron_daily', {
          status: 'success',
          last_success_at: '2026-06-20T09:00:00.000Z', // ~49 h ago
          last_attempt_at: '2026-06-20T09:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'cron-daily')!.status).toBe('stale');
  });

  it('oauth-canary heartbeat: fresh success at 6 h stays success; old at 2 days is stale', () => {
    const fresh = buildRunsSummary({
      freshness: [heartbeat('oauth_canary', { last_success_at: '2026-06-22T04:00:00.000Z' })],
      ticks: [],
      now: NOW,
    });
    expect(fresh.find((r) => r.job === 'oauth-canary')!.status).toBe('success');

    const stale = buildRunsSummary({
      freshness: [heartbeat('oauth_canary', { last_success_at: '2026-06-20T09:00:00.000Z' })],
      ticks: [],
      now: NOW,
    });
    expect(stale.find((r) => r.job === 'oauth-canary')!.status).toBe('stale');
  });

  it('whatsapp heartbeat tolerates the overnight gap: 11 h old stays success', () => {
    // eod 00:30 IL → next noon 12:00 IL ≈ 11.5 h apart; the SLA must not
    // false-alarm across that gap.
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('whatsapp', {
          status: 'success',
          last_success_at: '2026-06-21T23:00:00.000Z', // 11 h ago
          last_attempt_at: '2026-06-21T23:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'whatsapp')!.status).toBe('success');
  });

  it('whatsapp heartbeat 20 h old reads STALE (well past 3×/day cadence)', () => {
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('whatsapp', {
          status: 'success',
          last_success_at: '2026-06-21T14:00:00.000Z', // 20 h ago
          last_attempt_at: '2026-06-21T14:00:00.000Z',
        }),
      ],
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'whatsapp')!.status).toBe('stale');
  });

  it('cron-yesterday every-2h cadence: 3 h old stays success, 6 h old is stale', () => {
    const fresh = buildRunsSummary({
      freshness: [heartbeat('cron_yesterday', { last_success_at: '2026-06-22T07:00:00.000Z' })],
      ticks: [],
      now: NOW,
    });
    expect(fresh.find((r) => r.job === 'cron-yesterday')!.status).toBe('success');

    const stale = buildRunsSummary({
      freshness: [heartbeat('cron_yesterday', { last_success_at: '2026-06-22T04:00:00.000Z' })],
      ticks: [],
      now: NOW,
    });
    expect(stale.find((r) => r.job === 'cron-yesterday')!.status).toBe('stale');
  });

  it('a job with NO heartbeat row still falls back to the honest unknown placeholder', () => {
    const rows = buildRunsSummary({
      freshness: [heartbeat('cron_live')], // only cron-live beat
      ticks: [],
      now: NOW,
    });
    expect(rows.find((r) => r.job === 'cron-live')!.status).toBe('success');
    // whatsapp + oauth-canary + cron-daily + cron-yesterday have no heartbeat.
    expect(rows.find((r) => r.job === 'whatsapp')!.status).toBe('unknown');
    expect(rows.find((r) => r.job === 'whatsapp')!.source).toBe('none');
    expect(rows.find((r) => r.job === 'oauth-canary')!.status).toBe('unknown');
    expect(rows.find((r) => r.job === 'cron-daily')!.status).toBe('unknown');
  });

  it('heartbeat rows do NOT leak into worker-* or cohort verdicts', () => {
    const rows = buildRunsSummary({
      freshness: [
        heartbeat('cron_live'),
        heartbeat('cron_daily'),
        heartbeat('whatsapp'),
      ],
      ticks: [],
      now: NOW,
    });
    // platform 'system' is not a worker platform and the heartbeat scopes are
    // not worker scopes → workers stay unknown.
    expect(rows.find((r) => r.job === 'worker-meta')!.status).toBe('unknown');
    expect(rows.find((r) => r.job === 'cohort')!.status).toBe('unknown');
  });
});
