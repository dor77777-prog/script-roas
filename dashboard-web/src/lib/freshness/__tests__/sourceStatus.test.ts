/**
 * sourceStatus.test.ts — DQ-5 pure rollup of data_freshness rows into a
 * per-(store, platform) health verdict.
 */

import { describe, it, expect } from 'vitest';
import type { FreshnessRow } from '@/lib/inngest/freshness';
import { sourceStatusRollup, scopeSlaMinutes, isAgeStale } from '../sourceStatus';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
function isoMinutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}
function isoDaysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

// Minimal FreshnessRow factory — only the fields the rollup reads matter;
// the rest are filled with inert defaults to satisfy the type. last_success_at
// defaults to 1 min before NOW so a `success` row is fresh under any SLA unless
// a test overrides it (the age gate keys off last_success_at vs the injected
// NOW; see FIX #5).
function row(overrides: Partial<FreshnessRow>): FreshnessRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'kpi_daily',
    table_name: 'data_daily',
    last_attempt_at: isoMinutesAgo(1),
    last_success_at: isoMinutesAgo(1),
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: isoMinutesAgo(1),
    ...overrides,
  };
}

describe('sourceStatusRollup', () => {
  it('empty input → healthy, no unhealthy entries', () => {
    const out = sourceStatusRollup([], NOW);
    expect(out.anyUnhealthy).toBe(false);
    expect(out.unhealthy).toEqual([]);
  });

  it('all-success rows → healthy', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', status: 'success' }),
      row({ store_id: 'uzoshop', platform: 'google', status: 'success' }),
      row({ store_id: 'zolplus', platform: 'tiktok', status: 'success' }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(false);
    expect(out.unhealthy).toEqual([]);
  });

  it('budget_skip is treated as healthy (budget-off is normal, not an outage)', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', status: 'budget_skip', lag_minutes: 120 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(false);
    expect(out.unhealthy).toEqual([]);
  });

  it('auth_error → unhealthy with store/platform/status/lag surfaced', () => {
    const rows = [
      row({
        store_id: 'zolplus',
        platform: 'google',
        status: 'auth_error',
        lag_minutes: 47,
      }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toEqual([
      { storeId: 'zolplus', platform: 'google', status: 'auth_error', lagMinutes: 47 },
    ]);
  });

  it('worst-of: an error in the same group wins over a success', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'kpi_daily', status: 'success', lag_minutes: 0 }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'campaign_status', status: 'transient_error', lag_minutes: 12 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toEqual([
      { storeId: 'uzoshop', platform: 'meta', status: 'transient_error', lagMinutes: 12 },
    ]);
  });

  it('worst-of severity: auth_error beats transient_error within a group', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'a', status: 'transient_error', lag_minutes: 5 }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'b', status: 'auth_error', lag_minutes: 200 }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'c', status: 'parse_error', lag_minutes: 9 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toEqual([
      { storeId: 'uzoshop', platform: 'meta', status: 'auth_error', lagMinutes: 200 },
    ]);
  });

  it('groups are independent: one unhealthy + one healthy → only the unhealthy is reported', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', status: 'success' }),
      row({ store_id: 'uzoshop', platform: 'google', status: 'parse_error', lag_minutes: 33 }),
      // budget_skip keeps zolplus/tiktok healthy
      row({ store_id: 'zolplus', platform: 'tiktok', status: 'budget_skip', lag_minutes: 999 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toEqual([
      { storeId: 'uzoshop', platform: 'google', status: 'parse_error', lagMinutes: 33 },
    ]);
  });

  it('a success/budget_skip in the same group does NOT clear a real error', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'a', status: 'auth_error', lag_minutes: 60 }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'b', status: 'success', lag_minutes: 0 }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'c', status: 'budget_skip', lag_minutes: 0 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toHaveLength(1);
    expect(out.unhealthy[0]).toEqual({
      storeId: 'uzoshop',
      platform: 'meta',
      status: 'auth_error',
      lagMinutes: 60,
    });
  });

  it('preserves null lag_minutes on an unhealthy row', () => {
    const rows = [
      row({ store_id: 'usmile360', platform: 'tiktok', status: 'transient_error', lag_minutes: null }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.unhealthy).toEqual([
      { storeId: 'usmile360', platform: 'tiktok', status: 'transient_error', lagMinutes: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// FIX #5 — age gate. A `success`/`budget_skip` row is healthy ONLY if its
// last_success_at is within the per-scope SLA. A worker that simply stops
// being invoked keeps its last 'success' status forever; without the age gate
// it sorts as "freshest" and the operator never sees the dead pipeline.
// ---------------------------------------------------------------------------

describe('sourceStatusRollup — age gate (#5)', () => {
  it('aged success (campaign_metrics > 60 min) → synthetic stale / unhealthy', () => {
    const rows = [
      row({
        store_id: 'uzoshop',
        platform: 'meta',
        scope: 'campaign_metrics',
        status: 'success',
        lag_minutes: 0, // frozen-at-write 0 lies; the gate ignores it
        last_success_at: isoMinutesAgo(90),
      }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy).toHaveLength(1);
    expect(out.unhealthy[0].storeId).toBe('uzoshop');
    expect(out.unhealthy[0].platform).toBe('meta');
    expect(out.unhealthy[0].status).toBe('stale');
    // live lag computed at read time from last_success_at, not the frozen 0.
    expect(out.unhealthy[0].lagMinutes).toBe(90);
  });

  it('fresh success (campaign_metrics < 60 min) → stays healthy', () => {
    const rows = [
      row({
        store_id: 'uzoshop',
        platform: 'meta',
        scope: 'campaign_metrics',
        status: 'success',
        last_success_at: isoMinutesAgo(59),
      }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(false);
  });

  it('aged budget_skip (> 60 min) → also flips to stale (worker stopped firing)', () => {
    const rows = [
      row({
        store_id: 'zolplus',
        platform: 'tiktok',
        scope: 'campaign_metrics',
        status: 'budget_skip',
        last_success_at: isoMinutesAgo(120),
      }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy[0].status).toBe('stale');
  });

  it('cohort_monthly tolerates 7 days: fresh at 6 days, stale at 8 days', () => {
    const fresh = sourceStatusRollup(
      [row({ scope: 'cohort_monthly', status: 'success', last_success_at: isoDaysAgo(6) })],
      NOW,
    );
    expect(fresh.anyUnhealthy).toBe(false);

    const stale = sourceStatusRollup(
      [row({ scope: 'cohort_monthly', status: 'success', last_success_at: isoDaysAgo(8) })],
      NOW,
    );
    expect(stale.anyUnhealthy).toBe(true);
    expect(stale.unhealthy[0].status).toBe('stale');
  });

  it('a success row with NULL last_success_at (never succeeded) → unhealthy (never fresh)', () => {
    const rows = [
      row({ scope: 'campaign_metrics', status: 'success', last_success_at: null }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.anyUnhealthy).toBe(true);
    expect(out.unhealthy[0].status).toBe('stale');
  });

  it('a REAL error still beats a synthetic-stale success in the same group (severity)', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'campaign_metrics', status: 'success', last_success_at: isoMinutesAgo(90) }),
      row({ store_id: 'uzoshop', platform: 'meta', scope: 'campaign_status', status: 'auth_error', lag_minutes: 90 }),
    ];
    const out = sourceStatusRollup(rows, NOW);
    expect(out.unhealthy).toHaveLength(1);
    expect(out.unhealthy[0].status).toBe('auth_error');
  });
});

describe('scopeSlaMinutes / isAgeStale (#5)', () => {
  it('campaign_metrics + status scopes → 60 min SLA', () => {
    expect(scopeSlaMinutes('campaign_metrics')).toBe(60);
    expect(scopeSlaMinutes('campaign_status')).toBe(60);
    expect(scopeSlaMinutes('status')).toBe(60);
    expect(scopeSlaMinutes('hot_metrics')).toBe(60);
  });

  it('cohort_monthly → 7 days', () => {
    expect(scopeSlaMinutes('cohort_monthly')).toBe(7 * 24 * 60);
  });

  it('isAgeStale: null last_success_at is always stale', () => {
    expect(isAgeStale(null, 'campaign_metrics', NOW)).toBe(true);
  });

  it('isAgeStale: exactly at the SLA boundary is NOT yet stale; one minute past is', () => {
    expect(isAgeStale(isoMinutesAgo(60), 'campaign_metrics', NOW)).toBe(false);
    expect(isAgeStale(isoMinutesAgo(61), 'campaign_metrics', NOW)).toBe(true);
  });
});
