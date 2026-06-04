/**
 * sourceStatus.test.ts — DQ-5 pure rollup of data_freshness rows into a
 * per-(store, platform) health verdict.
 */

import { describe, it, expect } from 'vitest';
import type { FreshnessRow } from '@/lib/inngest/freshness';
import { sourceStatusRollup } from '../sourceStatus';

// Minimal FreshnessRow factory — only the fields the rollup reads matter;
// the rest are filled with inert defaults to satisfy the type.
function row(overrides: Partial<FreshnessRow>): FreshnessRow {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'kpi_daily',
    table_name: 'data_daily',
    last_attempt_at: '2026-06-04T00:00:00.000Z',
    last_success_at: '2026-06-04T00:00:00.000Z',
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: '2026-06-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('sourceStatusRollup', () => {
  it('empty input → healthy, no unhealthy entries', () => {
    const out = sourceStatusRollup([]);
    expect(out.anyUnhealthy).toBe(false);
    expect(out.unhealthy).toEqual([]);
  });

  it('all-success rows → healthy', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', status: 'success' }),
      row({ store_id: 'uzoshop', platform: 'google', status: 'success' }),
      row({ store_id: 'zolplus', platform: 'tiktok', status: 'success' }),
    ];
    const out = sourceStatusRollup(rows);
    expect(out.anyUnhealthy).toBe(false);
    expect(out.unhealthy).toEqual([]);
  });

  it('budget_skip is treated as healthy (budget-off is normal, not an outage)', () => {
    const rows = [
      row({ store_id: 'uzoshop', platform: 'meta', status: 'budget_skip', lag_minutes: 120 }),
    ];
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
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
    const out = sourceStatusRollup(rows);
    expect(out.unhealthy).toEqual([
      { storeId: 'usmile360', platform: 'tiktok', status: 'transient_error', lagMinutes: null },
    ]);
  });
});
